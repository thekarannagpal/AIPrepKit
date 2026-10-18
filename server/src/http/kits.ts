import { Router } from "express";
import { z } from "zod";
import {
  KitSchema,
  QuestionSchema,
  FlashcardSchema,
  MIN_DAYS,
  MAX_DAYS,
  computeCoverage,
  allocateSchedule,
  validateOrRepair,
  type Kit,
} from "@aiprepkit/core";
import { KitModel, PracticeModel } from "../db/models";
import { badRequest, conflict, notFound } from "../lib/errors";
import { log } from "../lib/logger";
import { inputFingerprint } from "../lib/hash";
import { LlmClient } from "../llm/client";
import { runPipeline, clampDays, defaultSteps } from "../pipeline/runPipeline";
import { regenerateSection, isPreserved } from "../pipeline/regenerate";
import { REGEN_SECTIONS, type RegenSection } from "../pipeline/regenerateSection";
import { subscribe, publish } from "./sse";
import type { AuthedRequest } from "./auth";
import { runOverlap } from "../pipeline/overlap";

export const kitsRouter = Router();

const daysSchema = z.number().int().min(MIN_DAYS).max(MAX_DAYS);

/* ---------------------------------------------------------------- creation */

const CreateKitSchema = z.object({
  jd: z.string().min(1, "Paste a job description.").max(50_000),
  company_url: z.string().max(500).default(""),
  days: daysSchema,
  force: z.boolean().optional(),
});

kitsRouter.post("/", async (req: AuthedRequest, res, next) => {
  try {
    const body = CreateKitSchema.parse(req.body);
    const fingerprint = inputFingerprint(body.jd, body.company_url, body.days);

    // Duplicate submission (brief §10): same description + company + days
    // returns the existing kit unless the user explicitly forces a rebuild.
    if (!body.force) {
      const existing = await KitModel.findOne({
        userId: req.userId,
        "input.fingerprint": fingerprint,
        status: { $in: ["queued", "running", "complete"] },
      }).sort({ createdAt: -1 });
      if (existing) {
        res.status(200).json({
          kit: publicKit(existing),
          deduplicated: true,
          message: "You already prepared for this exact role — reopened the existing kit.",
        });
        return;
      }
    }

    const doc = await KitModel.create({
      userId: req.userId,
      status: "queued",
      input: { jd: body.jd, companyUrl: body.company_url, days: body.days, fingerprint },
      steps: defaultSteps(),
      kit: null,
    });

    // Fire and forget: the UI watches progress over SSE. kickOff registers
    // the id synchronously, so no reader can mistake this live run for one
    // stranded by a restart.
    kickOff(doc._id.toString());

    res.status(201).json({ kit: publicKit(doc), deduplicated: false });
  } catch (err) {
    next(err);
  }
});

const BatchCreateSchema = z.object({
  cases: z
    .array(
      z.object({
        jd: z.string().min(1).max(50_000),
        company_url: z.string().max(500).default(""),
        days: daysSchema,
      })
    )
    .min(1)
    .max(12, "Batch uploads are capped at 12 cases at a time."),
});

kitsRouter.post("/batch", async (req: AuthedRequest, res, next) => {
  try {
    const body = BatchCreateSchema.parse(req.body);
    const created = [];
    for (const c of body.cases) {
      const fingerprint = inputFingerprint(c.jd, c.company_url, c.days);
      const existing = await KitModel.findOne({
        userId: req.userId,
        "input.fingerprint": fingerprint,
        status: { $in: ["queued", "running", "complete"] },
      });
      if (existing) {
        created.push({ kit: publicKit(existing), deduplicated: true });
        continue;
      }
      const doc = await KitModel.create({
        userId: req.userId,
        status: "queued",
        input: { jd: c.jd, companyUrl: c.company_url, days: c.days, fingerprint },
        steps: defaultSteps(),
        kit: null,
      });
      created.push({ kit: publicKit(doc), deduplicated: false });
    }
    // Kick off sequentially: the LLM rate budget is shared, and parallel
    // starts would just queue on the same limiter anyway.
    for (const entry of created) {
      if (!entry.deduplicated) kickOff(String((entry.kit as any)._id));
    }
    res.status(201).json({ kits: created });
  } catch (err) {
    next(err);
  }
});

/** The one generation path — web and batch share this pipeline module. */
async function generate(kitId: string): Promise<void> {
  const doc = await KitModel.findById(kitId);
  if (!doc || doc.status !== "queued") return;
  doc.status = "running";
  await doc.save();

  // Every write to this document goes through one queue: mongoose throws a
  // ParallelSaveError if save() is called while another save is in flight,
  // and step events can easily fire while the final save is running.
  let saveChain: Promise<void> = Promise.resolve();
  const enqueueSave = (): Promise<void> => {
    saveChain = saveChain
      .then(async () => {
        await doc.save();
      })
      .catch((err) => {
        log.warn("kit save failed", { kitId, err: err instanceof Error ? err.message : String(err) });
      });
    return saveChain;
  };

  const llm = new LlmClient({});
  try {
    const input = doc.input!;
    const result = await runPipeline(
      { jd: input.jd, companyUrl: input.companyUrl ?? "", days: input.days },
      {
        llm,
        onEvent: (event) => {
          publish(kitId, event);
          if (event.type === "step") {
            const step = doc.steps.find((s) => s.key === event.key);
            if (step) {
              step.status = event.status === "started" ? "started" : event.status;
              if (event.detail) step.detail = event.detail;
            }
            void enqueueSave();
          }
        },
      }
    );
    doc.kit = result.kit;
    doc.status = "complete";
    doc.generatedWith = {
      provider: llm.provider.name,
      model: llm.provider.model,
      llmCalls: llm.callCount,
    };
    doc.version += 1;
    await enqueueSave();
    publish(kitId, { type: "done", kit: result.kit });
  } catch (err) {
    const e = err as { code?: string; message?: string };
    doc.status = "failed";
    doc.error = { code: e.code ?? "INTERNAL", message: e.message ?? "Generation failed." };
    await enqueueSave();
    publish(kitId, { type: "failed", error: doc.error });
    log.error("kit generation failed", { kitId, code: doc.error.code, message: doc.error.message });
  }
}

/**
 * Fire-and-forget entry: callers use `kickOff` so a rejection can never
 * become an unhandled promise rejection (which would take the API down).
 * The kit id joins `activeGenerations` synchronously, so any reader can
 * tell a live run from one stranded by a restart (see recoverIfStale).
 */
const activeGenerations = new Set<string>();

function kickOff(kitId: string): void {
  activeGenerations.add(kitId);
  generate(kitId)
    .catch(async (err) => {
      const error = {
        code: (err as { code?: string }).code ?? "INTERNAL",
        message: err instanceof Error ? err.message : String(err),
      };
      log.error("kit generation crashed", { kitId, code: error.code, message: error.message });
      await KitModel.updateOne({ _id: kitId }, { $set: { status: "failed", error } }).catch(() => undefined);
      publish(kitId, { type: "failed", error });
    })
    .finally(() => activeGenerations.delete(kitId));
}

type KitDoc = NonNullable<Awaited<ReturnType<typeof KitModel.findOne>>>;

/**
 * Generation lives in this process. If the process dies mid-run, the document
 * is stranded in queued/running forever: no `done` event will ever arrive and
 * the UI would show progress that never resolves. The first reader to touch
 * such a kit fails it with a structured error instead of leaving a ghost.
 * The grace period covers the window between document creation and kick-off
 * (the batch route creates all documents first, then starts them).
 */
async function recoverIfStale(doc: any | null | undefined): Promise<void> {
  if (!doc) return;
  if (doc.status !== "queued" && doc.status !== "running") return;
  if (activeGenerations.has(String(doc._id))) return;
  const createdAt = new Date((doc as unknown as { createdAt?: Date }).createdAt ?? 0).getTime();
  if (createdAt && Date.now() - createdAt < 120_000) return;

  doc.status = "failed";
  doc.error = {
    code: "INTERRUPTED",
    message:
      "Generation was interrupted before it finished (the server restarted mid-run). Create the kit again to regenerate it.",
  };
  await doc.save();
  publish(String(doc._id), { type: "failed", error: doc.error });
  log.warn("recovered stale kit", { kitId: String(doc._id) });
}

/* ------------------------------------------------------------------- lists */

kitsRouter.get("/", async (req: AuthedRequest, res, next) => {
  try {
    const docs = await KitModel.find({ userId: req.userId }).sort({ createdAt: -1 }).limit(100);
    res.json({ kits: docs.map((d) => publicKit(d, { summary: true })) });
  } catch (err) {
    next(err);
  }
});

kitsRouter.get("/:id", async (req: AuthedRequest, res, next) => {
  try {
    const doc = await ownKit(req);
    res.json({ kit: publicKit(doc) });
  } catch (err) {
    next(err);
  }
});

kitsRouter.get("/:id/events", async (req: AuthedRequest, res, next) => {
  try {
    const doc = await ownKit(req);
    // Replay the current state first so a late subscriber is not blind.
    res.write(
      `data: ${JSON.stringify({
        type: "snapshot",
        status: doc.status,
        steps: doc.steps,
        error: doc.error ?? null,
      })}\n\n`
    );
    const unsubscribe = subscribe(String(doc._id), res);
    req.on("close", unsubscribe);
  } catch (err) {
    next(err);
  }
});

kitsRouter.delete("/:id", async (req: AuthedRequest, res, next) => {
  try {
    const doc = await ownKit(req);
    await PracticeModel.deleteMany({ kitId: doc._id });
    await doc.deleteOne();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/* ---------------------------------------------------------------- editing */

const EditKitSchema = z.object({
  questions: z.array(QuestionSchema).max(80).optional(),
  flashcards: z.array(FlashcardSchema).max(120).optional(),
  company_brief: z
    .object({ summary: z.string().max(4000), what_they_do: z.string().max(4000), sources: z.array(z.string()) })
    .optional(),
  role: z
    .object({
      title: z.string().max(200),
      seniority: z.string().max(40),
      responsibilities: z.array(z.string().max(500)).max(40),
    })
    .optional(),
  expected_version: z.number().int().optional(),
});

/**
 * Section-scoped edit endpoint. The client sends the whole section it has
 * (optimistically edited locally); the server validates structure, recomputes
 * the deterministic bookkeeping (coverage; schedule only when questions
 * changed) and bumps the version. Last-write-wins with version hint — one
 * user, usually one tab, and the hint lets the UI warn on a stale editor.
 */
kitsRouter.put("/:id", async (req: AuthedRequest, res, next) => {
  try {
    const doc = await ownKit(req);
    if (doc.status !== "complete" || !doc.kit) throw conflict("This kit is not editable yet.");
    if (
      req.body?.expected_version !== undefined &&
      Number(req.body.expected_version) !== doc.version
    ) {
      res.status(409).json({
        error: {
          code: "CONFLICT",
          message: "This kit changed elsewhere. Reload to get the latest version.",
          current_version: doc.version,
        },
      });
      return;
    }

    const body = EditKitSchema.parse(req.body);
    const kit = { ...(doc.kit as unknown as Kit) };

    if (body.questions) {
      kit.questions = body.questions.map(stripToQuestion);
      const coverage = computeCoverage(kit.role.requirements, kit.questions);
      kit.coverage = {
        uncovered_requirement_ids: coverage.uncovered_requirement_ids,
        uncovered_must_requirement_ids: coverage.uncovered_must_requirement_ids,
        passes: kit.coverage.passes,
      };
      // Keep the schedule consistent with the questions it references.
      const scheduled = new Set(kit.schedule.days.flatMap((d) => d.question_ids));
      const nowMissing = [...scheduled].filter((id) => !kit.questions.some((q) => q.id === id));
      if (nowMissing.length) {
        kit.schedule = allocateSchedule(kit.questions, kit.role.requirements, kit.schedule.days_available);
      }
    }
    if (body.flashcards) kit.flashcards = body.flashcards.map(stripToFlashcard);
    if (body.company_brief) kit.company_brief = { ...kit.company_brief, ...body.company_brief };
    if (body.role) kit.role = { ...kit.role, ...body.role };

    const validated = validateOrRepair(kit);
    if (!validated.ok || !validated.kit) {
      throw badRequest(`Refusing to save an invalid kit: ${validated.errors.slice(0, 3).join("; ")}`);
    }

    doc.kit = validated.kit;
    doc.version += 1;
    await doc.save();
    res.json({ kit: publicKit(doc) });
  } catch (err) {
    next(err);
  }
});

/* ----------------------------------------------------------- regeneration */

const RegenSchema = z.object({
  section: z.enum(REGEN_SECTIONS as [RegenSection, ...RegenSection[]]),
});

kitsRouter.post("/:id/regenerate", async (req: AuthedRequest, res, next) => {
  try {
    const doc = await ownKit(req);
    if (doc.status !== "complete" || !doc.kit) throw conflict("This kit is not ready yet.");
    const { section } = RegenSchema.parse(req.body);

    const llm = new LlmClient({});
    const kit = doc.kit as unknown as Kit;
    publish(String(doc._id), { type: "step", key: "regenerate", label: `Regenerate ${section}`, status: "started" });

    try {
      const result = await regenerateSection({
        kit,
        section,
        llm,
        onProgress: (message) =>
          publish(String(doc._id), { type: "progress", key: "regenerate", message }),
      });
      const validated = validateOrRepair(result.kit);
      if (!validated.ok || !validated.kit) {
        throw badRequest(`Regeneration produced an invalid kit: ${validated.errors.slice(0, 3).join("; ")}`);
      }
      doc.kit = validated.kit;
      doc.version += 1;
      await doc.save();
      publish(String(doc._id), { type: "step", key: "regenerate", label: `Regenerate ${section}`, status: "done" });
      res.json({
        kit: publicKit(doc),
        summary: result.summary,
        preserved_editable: true,
      });
    } catch (err) {
      publish(String(doc._id), {
        type: "step",
        key: "regenerate",
        label: `Regenerate ${section}`,
        status: "failed",
        detail: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

/* -------------------------------------------------------------- practice */

const ConfidenceSchema = z.object({
  card_id: z.string().min(1),
  confidence: z.number().int().min(1).max(4),
});

/**
 * Confidence-weighted ordering (brief §7, "pick one and defend it"):
 * simplified Leitner boxes. Confidence 1-2 drops the card back to box 1
 * (due now); 3 advances a box; 4 advances two. Box n is due in
 * [0, 1, 2, 4, 8] days. The next session orders by (confidence asc,
 * dueAt asc) so the least confident cards come first — the brief's rule —
 * while easy cards fade into spaced repetition instead of vanishing.
 */
const BOX_INTERVAL_DAYS = [0, 1, 2, 4, 8];

kitsRouter.post("/:id/practice", async (req: AuthedRequest, res, next) => {
  try {
    const doc = await ownKit(req);
    if (!doc.kit) throw conflict("This kit has no flashcards yet.");
    const { card_id, confidence } = ConfidenceSchema.parse(req.body);
    const kit = doc.kit as unknown as Kit;
    const card = kit.flashcards.find((f) => f.id === card_id);
    if (!card) throw notFound("No such flashcard in this kit.");

    const existing = await PracticeModel.findOne({ userId: req.userId, kitId: doc._id, cardId: card_id });
    const currentBox = existing?.box ?? 1;
    const nextBox =
      confidence <= 2 ? 1 : confidence === 3 ? Math.min(5, currentBox + 1) : Math.min(5, currentBox + 2);
    const dueAt = new Date(Date.now() + BOX_INTERVAL_DAYS[nextBox - 1] * 86_400_000);

    await PracticeModel.findOneAndUpdate(
      { userId: req.userId, kitId: doc._id, cardId: card_id },
      {
        $set: { box: nextBox, confidence, dueAt },
        $inc: { reviews: 1 },
        $setOnInsert: { requirementIds: card.requirement_ids },
      },
      { upsert: true }
    );
    res.json({ card_id, box: nextBox, due_at: dueAt.toISOString() });
  } catch (err) {
    next(err);
  }
});

kitsRouter.get("/:id/practice", async (req: AuthedRequest, res, next) => {
  try {
    const doc = await ownKit(req);
    if (!doc.kit) throw conflict("This kit has no flashcards yet.");
    const kit = doc.kit as unknown as Kit;
    const progress = await PracticeModel.find({ userId: req.userId, kitId: doc._id });
    const byCard = new Map(progress.map((p) => [p.cardId, p]));

    // Least confident first, then oldest due — the brief's ordering rule.
    const ordered = [...kit.flashcards].sort((a, b) => {
      const pa = byCard.get(a.id);
      const pb = byCard.get(b.id);
      const ca = pa?.confidence ?? 0;
      const cb = pb?.confidence ?? 0;
      if (ca !== cb) return ca - cb;
      const da = pa?.dueAt?.getTime() ?? 0;
      const db = pb?.dueAt?.getTime() ?? 0;
      return da - db;
    });

    const coveredReqs = new Set(progress.flatMap((p) => p.requirementIds ?? []));
    res.json({
      order: ordered.map((f) => ({
        id: f.id,
        front: f.front,
        back: f.back,
        requirement_ids: f.requirement_ids,
        confidence: byCard.get(f.id)?.confidence ?? null,
        box: byCard.get(f.id)?.box ?? null,
        due_at: byCard.get(f.id)?.dueAt?.toISOString() ?? null,
      })),
      stats: {
        total: kit.flashcards.length,
        seen: progress.length,
        by_confidence: countBy(progress.map((p) => p.confidence)),
        requirement_coverage: kit.role.requirements.map((r) => ({
          id: r.id,
          text: r.text,
          practised: coveredReqs.has(r.id),
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

/* --------------------------------------------------------------- compare */

const CompareSchema = z.object({ other_kit_id: z.string().min(1) });

kitsRouter.post("/:id/compare", async (req: AuthedRequest, res, next) => {
  try {
    const doc = await ownKit(req);
    const other = await KitModel.findOne({ _id: req.body?.other_kit_id ?? "", userId: req.userId });
    if (!other || !other.kit) throw notFound("The other kit was not found among your kits.");
    if (!doc.kit) throw conflict("This kit has no content to compare.");
    const report = await runOverlap(doc.kit as unknown as Kit, other.kit as unknown as Kit, new LlmClient({}));
    res.json({ report });
  } catch (err) {
    next(err);
  }
});

/* ---------------------------------------------------------------- helpers */

async function ownKit(req: AuthedRequest) {
  const doc = await KitModel.findOne({ _id: req.params.id, userId: req.userId });
  if (!doc) throw notFound("Kit not found.");
  await recoverIfStale(doc);
  // reload in case recoverIfStale mutated it
  if (doc.status === "failed" && !doc.kit) {
    // re-fetch the persisted failed state
    const fresh = await KitModel.findOne({ _id: req.params.id, userId: req.userId });
    if (fresh) return fresh;
  }
  return doc;
}

function publicKit(doc: any, opts: { summary?: boolean } = {}) {
  const base = {
    _id: String(doc._id),
    status: doc.status,
    input: {
      company_url: doc.input?.companyUrl ?? "",
      days: doc.input?.days ?? 1,
      jd_chars: doc.input?.jd?.length ?? 0,
    },
    steps: doc.steps ?? [],
    error: doc.error ?? null,
    generatedWith: doc.generatedWith ?? null,
    version: doc.version ?? 1,
    created_at: doc.createdAt,
  };
  if (opts.summary) {
    return {
      ...base,
      role_title: doc.kit?.role?.title ?? "",
      company: doc.kit?.source?.company ?? "",
      questions: doc.kit?.questions?.length ?? 0,
      flashcards: doc.kit?.flashcards?.length ?? 0,
      days: doc.kit?.schedule?.days_available ?? doc.input?.days ?? 1,
      uncovered_must: doc.kit?.coverage?.uncovered_must_requirement_ids?.length ?? null,
    };
  }
  return { ...base, kit: doc.kit ?? null };
}

function stripToQuestion(q: z.infer<typeof QuestionSchema>): Kit["questions"][number] {
  return {
    id: q.id,
    requirement_ids: q.requirement_ids,
    category: q.category,
    prompt: q.prompt,
    answer_outline: q.answer_outline,
    difficulty: q.difficulty,
    origin: q.origin,
    edited: q.edited,
    pinned: q.pinned,
  };
}
function stripToFlashcard(f: z.infer<typeof FlashcardSchema>): Kit["flashcards"][number] {
  return {
    id: f.id,
    front: f.front,
    back: f.back,
    requirement_ids: f.requirement_ids,
    origin: f.origin,
    edited: f.edited,
    pinned: f.pinned,
  };
}
function countBy(values: number[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[String(v)] = (out[String(v)] ?? 0) + 1;
  return out;
}

export { isPreserved };
