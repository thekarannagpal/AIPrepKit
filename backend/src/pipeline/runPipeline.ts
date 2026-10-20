import { z } from "zod";
import net from "net";
import {
  allocateSchedule,
  computeCoverage,
  validateOrRepair,
  MIN_DAYS,
  MAX_DAYS,
  type Kit,
  type Requirement,
  type Question,
  type Flashcard,
  type ResearchLogEntry,
} from "@aiprepkit/core";
import { AppError } from "../lib/errors";
import { log } from "../lib/logger";
import { LlmClient } from "../llm/client";
import { Fetcher } from "../research/fetcher";
import { crawlSite, type CrawlResult } from "../research/crawler";
import { findPublicDiscussion, type DiscussionSource } from "../research/discussion";
import { guardUrl } from "../research/urlGuard";
import type { PageForPrompt } from "./prompts";
import * as P from "./prompts";

/**
 * The generation pipeline (brief §3, §4, §8).
 *
 * Sequencing — each step consumes what the previous one produced, and the
 * deterministic steps never touch the model:
 *
 *   1. guard input (url validation, days clamp)
 *   2. crawl company site -> pages, hiring/about classification
 *   3. search public discussion of the interview process
 *   4. LLM: extract requirements from the JD (ids assigned by code)
 *   5. LLM: company brief from crawled pages
 *   6. LLM: interview-process intel from hiring pages + discussion
 *   7. LLM: questions per category (separate calls, separate instructions)
 *   8. CODE: coverage check -> uncovered requirements
 *   9. LLM: gap-fill pass for uncovered requirements   } repeat up to
 *  10. CODE: re-check coverage                        } MAX_COVERAGE_PASSES
 *  11. CODE: schedule allocation (arithmetic)
 *  12. CODE: structure validation/repair before return
 */

export const MAX_COVERAGE_PASSES = 3;

/** Context every question-generation call shares. */
interface QuestionGenContext {
  role: string;
  company: string;
  seniority: string;
  responsibilities: string[];
  processSummary: string;
  stages: string[];
  companyFacts: string;
}

export interface PipelineInput {
  jd: string;
  companyUrl: string;
  days: number;
}

export type PipelineEvent =
  | { type: "step"; key: string; label: string; status: "started" | "done" | "failed"; detail?: string }
  | { type: "progress"; key: string; message: string };

export interface PipelineResult {
  kit: Kit;
  /** Set when the run finished but sections are thin/absent. */
  warnings: string[];
}

const StepKeys = [
  "validate_input",
  "crawl_site",
  "search_discussion",
  "extract_requirements",
  "company_brief",
  "interview_intel",
  "generate_questions",
  "coverage_loop",
  "build_schedule",
  "validate_kit",
] as const;

export function defaultSteps(): { key: string; label: string; status: "pending" }[] {
  const labels: Record<string, string> = {
    validate_input: "Validate input",
    crawl_site: "Crawl company site",
    search_discussion: "Search public interview discussion",
    extract_requirements: "Extract requirements from the description",
    company_brief: "Write company brief",
    interview_intel: "Summarise interview process",
    generate_questions: "Generate question bank",
    coverage_loop: "Check coverage, fill gaps",
    build_schedule: "Build study schedule",
    validate_kit: "Validate kit structure",
  };
  return StepKeys.map((key) => ({ key, label: labels[key], status: "pending" as const }));
}

export interface RunOptions {
  llm: LlmClient;
  fetcher?: Fetcher;
  onEvent?: (event: PipelineEvent) => void;
  /** Injected in tests to hermetically simulate a site. */
  crawl?: typeof crawlSite;
  discuss?: typeof findPublicDiscussion;
}

export async function runPipeline(input: PipelineInput, opts: RunOptions): Promise<PipelineResult> {
  const emit = opts.onEvent ?? (() => {});
  const warnings: string[] = [];
  const researchLog: ResearchLogEntry[] = [];
  const step = (key: string, label: string) => {
    emit({ type: "step", key, label, status: "started" });
    return {
      done: (detail?: string) => emit({ type: "step", key, label, status: "done", detail }),
      fail: (detail: string) => emit({ type: "step", key, label, status: "failed", detail }),
    };
  };

  // --- 1. validate input ----------------------------------------------------
  const s1 = step("validate_input", "Validate input");
  if (!input.jd || input.jd.trim().length < 20) {
    throw new AppError(
      "JD_EMPTY",
      "The job description is too short to extract anything (need at least a couple of lines).",
      400
    );
  }
  const days = clampDays(input.days);
  if (input.days !== days) {
    warnings.push(`Requested ${input.days} days; using ${days} (supported range ${MIN_DAYS}-${MAX_DAYS}).`);
  }

  let companyUrl = input.companyUrl?.trim() ?? "";
  let guarded: Awaited<ReturnType<typeof guardUrl>> | null = null;
  if (companyUrl) {
    try {
      guarded = await guardUrl(companyUrl);
      companyUrl = guarded.href;
    } catch (err) {
      warnings.push(
        `Company URL could not be used: ${err instanceof AppError ? err.message : String(err)}. Continuing with the description alone.`
      );
      researchLog.push({
        url: companyUrl,
        status: "error",
        note: err instanceof AppError ? err.message : "invalid URL",
      });
      companyUrl = "";
    }
  } else {
    warnings.push("No company website supplied; the brief will be built from the description alone.");
  }
  s1.done(days === input.days ? `days=${days}` : `days=${days} (clamped)`);

  // --- 2. crawl the company site -------------------------------------------
  const fetcher = opts.fetcher ?? new Fetcher();
  const crawlFn = opts.crawl ?? crawlSite;
  const s2 = step("crawl_site", "Crawl company site");
  let crawlResult: CrawlResult | null = null;
  if (companyUrl) {
    try {
      crawlResult = await crawlFn(companyUrl, fetcher);
      researchLog.push(...crawlResult.log);
      if (crawlResult.pages.length === 0) {
        warnings.push("The company site could not be retrieved; no website content informed this kit.");
        s2.fail("site unreachable");
      } else {
        s2.done(
          `${crawlResult.pages.length} page(s)` +
            (crawlResult.foundHiringPage ? `, hiring page found` : `, no hiring page found`)
        );
        if (!crawlResult.foundHiringPage) {
          warnings.push("No hiring or interview page was discoverable on the company site.");
        }
      }
    } catch (err) {
      researchLog.push({ url: companyUrl, status: "error", note: describeErr(err) });
      warnings.push(`Crawling failed: ${describeErr(err)}`);
      s2.fail(describeErr(err));
    }
  } else {
    s2.done("skipped — no company URL");
  }
  // --- 3. public discussion -------------------------------------------------
  const s3 = step("search_discussion", "Search public interview discussion");
  const companyGuess = await guessCompanyName(input.jd, companyUrl, opts.llm);
  let discussion: DiscussionSource[] = [];
  if (companyGuess.name) {
    try {
      const discussFn = opts.discuss ?? findPublicDiscussion;
      const found = await discussFn(companyGuess.name, companyUrl || "https://example.com", fetcher);
      discussion = found.sources;
      researchLog.push(...found.log);
      s3.done(discussion.length ? `${discussion.length} source(s)` : "no public discussion found");
      if (discussion.length === 0) {
        warnings.push(`No public discussion of ${companyGuess.name}'s interview process was found.`);
      }
    } catch (err) {
      researchLog.push({ url: "(search)", status: "error", note: describeErr(err) });
      warnings.push(`Discussion search failed: ${describeErr(err)}`);
      s3.fail(describeErr(err));
    }
  } else {
    s3.done("skipped — no company name identifiable");
  }

  // --- 4. extract requirements (LLM) ---------------------------------------
  const s4 = step("extract_requirements", "Extract requirements from the description");
  let extracted: Extracted;
  try {
    extracted = await extractRequirements(input.jd, companyUrl, opts.llm);
  } catch (err) {
    s4.fail(describeErr(err));
    throw err instanceof AppError
      ? err
      : new AppError("LLM_INVALID_RESPONSE", `Requirement extraction failed: ${describeErr(err)}`, 502);
  }
  const requirements = assignRequirementIds(extracted.requirements);
  const companyName = extracted.company || companyGuess.name || hostLabel(companyUrl);
  const roleName = extracted.role || "Unspecified role";
  s4.done(
    `${requirements.length} requirement(s), ${requirements.filter((r) => r.priority === "must").length} must-have`
  );
  if (requirements.length === 0) {
    warnings.push(
      "The description yielded no extractable requirements — this kit is deliberately thin rather than invented."
    );
  } else if (requirements.length <= 2 || input.jd.trim().length < 300) {
    warnings.push("The description is thin; expect a correspondingly small question bank.");
  }

  // --- 5. company brief (LLM) ----------------------------------------------
  const s5 = step("company_brief", "Write company brief");
  let brief = { summary: "", what_they_do: "", sources: [] as string[] };
  const homePage = crawlResult?.pages[0] ?? null;
  if (crawlResult && crawlResult.pages.length > 0) {
    try {
      const raw = await opts.llm.json<{ summary?: string; what_they_do?: string }>(
        P.companyBriefPrompt(
          toPromptPage(homePage),
          promptPages(crawlResult.aboutPages, 2),
          promptPages(crawlResult.hiringPages, 2)
        ),
        { temperature: 0.3 }
      );
      brief = {
        summary: str(raw.summary),
        what_they_do: str(raw.what_they_do),
        sources: crawlResult.pages.slice(0, 5).map((p) => p.url),
      };
      s5.done();
    } catch (err) {
      warnings.push(`Company brief generation failed: ${describeErr(err)}`);
      s5.fail(describeErr(err));
    }
  } else {
    brief.summary = companyUrl
      ? `The company website could not be retrieved, so no factual brief is available. Everything below comes from the job description alone.`
      : `No company website was supplied. Everything below comes from the job description alone.`;
    brief.what_they_do = "";
    s5.done("no site content — honest empty brief");
  }

  // --- 6. interview intel (LLM) --------------------------------------------
  const s6 = step("interview_intel", "Summarise interview process");
  let intel = { process_summary: "", stages: [] as string[], formats: [] as string[] };
  if (crawlResult?.foundHiringPage || discussion.length > 0) {
    try {
      const raw = await opts.llm.json<{ process_summary?: string; stages?: string[]; formats?: string[] }>(
        P.interviewIntelPrompt(
          companyName || "the company",
          promptPages(crawlResult?.hiringPages ?? [], 2),
          discussion.slice(0, 4)
        ),
        { temperature: 0.3 }
      );
      intel = {
        process_summary: str(raw.process_summary),
        stages: asStringArray(raw.stages).slice(0, 8),
        formats: asStringArray(raw.formats).slice(0, 8),
      };
      s6.done(intel.stages.length ? `stages: ${intel.stages.join(", ")}` : "no concrete stages found");
    } catch (err) {
      warnings.push(`Interview-process summary failed: ${describeErr(err)}`);
      s6.fail(describeErr(err));
    }
  } else {
    s6.done("no hiring page or public discussion — nothing to summarise");
  }

  const companyFacts = [brief.summary, brief.what_they_do].filter(Boolean).join("\n");
  const ctx = {
    role: roleName,
    company: companyName,
    seniority: extracted.seniority || "unknown",
    responsibilities: extracted.responsibilities,
    processSummary: intel.process_summary,
    stages: intel.stages,
    companyFacts,
  };

  // --- 7..10. question generation with the coverage loop -------------------
  const s7 = step("generate_questions", "Generate question bank");
  const s8 = step("coverage_loop", "Check coverage, fill gaps");
  let questions: Question[] = [];
  let pass = 1;
  try {
    questions = await generateByCategory(requirements, ctx, opts.llm, (msg) =>
      emit({ type: "progress", key: "generate_questions", message: msg })
    );
    s7.done(`${questions.length} question(s) across categories`);
  } catch (err) {
    warnings.push(`Question generation failed: ${describeErr(err)}`);
    s7.fail(describeErr(err));
  }

  let coverage = computeCoverage(requirements, questions);
  while (coverage.uncovered_requirement_ids.length > 0 && pass < MAX_COVERAGE_PASSES) {
    if (opts.llm.remainingBudget <= 0) {
      warnings.push("LLM call budget exhausted; remaining coverage gaps were not filled.");
      break;
    }
    pass++;
    const gapIds = coverage.uncovered_requirement_ids;
    emit({
      type: "progress",
      key: "coverage_loop",
      message: `pass ${pass}: filling ${gapIds.length} gap(s)`,
    });
    try {
      const gapQuestions = await fillGaps(gapIds, requirements, ctx, opts.llm);
      const before = questions.length;
      questions = mergeQuestions(questions, gapQuestions, requirements);
      const added = questions.length - before;
      if (added === 0) break; // model could not cover them; stop, report honestly
    } catch (err) {
      warnings.push(`Coverage gap-fill failed: ${describeErr(err)}`);
      break;
    }
    coverage = computeCoverage(requirements, questions);
  }

  coverage = computeCoverage(requirements, questions);
  if (coverage.uncovered_must_requirement_ids.length > 0) {
    warnings.push(
      `${coverage.uncovered_must_requirement_ids.length} must-have requirement(s) remain uncovered after ${pass} pass(es): ${coverage.uncovered_must_requirement_ids.join(", ")}.`
    );
  }
  s8.done(
    `${pass} pass(es); uncovered: ${coverage.uncovered_requirement_ids.length}` +
      (coverage.uncovered_must_requirement_ids.length
        ? ` (${coverage.uncovered_must_requirement_ids.length} must-have!)`
        : "")
  );

  // --- 11. schedule (arithmetic, no model) ---------------------------------
  const s9 = step("build_schedule", "Build study schedule");
  const schedule = allocateSchedule(questions, requirements, days);
  const allocated = schedule.days.reduce((n, d) => n + d.question_ids.length, 0);
  s9.done(`${days} day(s), ${allocated} question slot(s), ${schedule.days.reduce((n, d) => n + d.minutes, 0)} min total`);

  // --- 12. flashcards (LLM) -------------------------------------------------
  let flashcards: Flashcard[] = [];
  try {
    flashcards = await generateFlashcards(requirements, questions, companyFacts, opts.llm);
  } catch (err) {
    warnings.push(`Flashcard generation failed: ${describeErr(err)}`);
  }

  // --- 13. validate and repair ---------------------------------------------
  const s10 = step("validate_kit", "Validate kit structure");
  const candidate = {
    source: {
      company: companyName,
      company_url: companyUrl || "",
      role: roleName,
      location: extracted.location || "",
      jd_chars: input.jd.length,
      researched_at: new Date().toISOString(),
      pages_used: (crawlResult?.pages ?? []).slice(0, 8).map((p) => p.url),
      research_log: researchLog.slice(0, 40),
    },
    company_brief: brief,
    role: {
      title: roleName,
      seniority: extracted.seniority || "unknown",
      responsibilities: extracted.responsibilities,
      requirements,
    },
    questions,
    flashcards,
    schedule,
    coverage: {
      uncovered_requirement_ids: coverage.uncovered_requirement_ids,
      uncovered_must_requirement_ids: coverage.uncovered_must_requirement_ids,
      passes: pass,
    },
    notes: warnings,
  };

  const validated = validateOrRepair(candidate);
  if (!validated.ok || !validated.kit) {
    s10.fail(validated.errors.slice(0, 3).join("; "));
    throw new AppError(
      "LLM_INVALID_RESPONSE",
      `Generated kit failed structure validation: ${validated.errors.slice(0, 5).join("; ")}`,
      502
    );
  }
  if (validated.repairs.length) {
    log.warn("kit repaired before save", { repairs: validated.repairs.length });
    validated.kit.notes.push(`Kit required ${validated.repairs.length} automatic repair(s) before saving.`);
  }
  s10.done(`${validated.kit.questions.length} questions, ${validated.kit.flashcards.length} flashcards`);
  emit({
    type: "progress",
    key: "validate_kit",
    message: `provider=${opts.llm.provider.name}/${opts.llm.provider.model}, llm_calls=${opts.llm.callCount}`,
  });

  return { kit: validated.kit, warnings };
}

/* -------------------------------------------------------------------------- */
/* step implementations                                                        */
/* -------------------------------------------------------------------------- */

const ExtractedSchema = z.object({
  company: z.string().catch("").default(""),
  role: z.string().catch("").default(""),
  location: z.string().catch("").default(""),
  seniority: z.string().catch("").default(""),
  responsibilities: z.array(z.string()).catch([]).default([]),
  requirements: z
    .array(
      z.object({
        text: z.string(),
        kind: z.enum(["technical", "behavioural", "domain"]).catch("technical"),
        priority: z.enum(["must", "nice"]).catch("must"),
      })
    )
    .catch([])
    .default([]),
});
type Extracted = z.infer<typeof ExtractedSchema>;

async function extractRequirements(jd: string, companyUrl: string, llm: LlmClient): Promise<Extracted> {
  const raw = await llm.json(P.extractRequirementsPrompt(jd, companyUrl ? new URL(companyUrl).hostname : "pasted description"), {
    temperature: 0.2,
  });
  const parsed = ExtractedSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError("LLM_INVALID_RESPONSE", "Requirement extraction returned an unexpected shape.", 502);
  }
  // Near-duplicate merge: the model occasionally restates a requirement.
  const seen = new Map<string, Requirement>();
  const out: Requirement[] = [];
  const reqs = parsed.data.requirements.filter((r) => r.text.trim().length > 0);
  for (const r of reqs) {
    const key = normalise(r.text);
    if (seen.has(key)) continue;
    seen.set(key, r as Requirement);
    out.push(r as Requirement);
  }
  return { ...parsed.data, requirements: out };
}

/** Code assigns stable ids — never the model. */
export function assignRequirementIds(reqs: { text: string; kind: string; priority: string }[]): Requirement[] {
  return reqs.map((r, i) => ({
    id: `r${i + 1}`,
    text: r.text.trim(),
    kind: (["technical", "behavioural", "domain"].includes(r.kind) ? r.kind : "technical") as Requirement["kind"],
    priority: (r.priority === "nice" ? "nice" : "must") as Requirement["priority"],
  }));
}

const CategorySchema = z.enum(["technical", "behavioural", "system-design", "company-fit"]);
const QuestionBatchSchema = z.object({
  questions: z
    .array(
      z.object({
        requirement_ids: z.array(z.string()).catch([]).default([]),
        category: CategorySchema.catch("technical"),
        prompt: z.string(),
        answer_outline: z.string().catch(""),
        difficulty: z.number().int().min(1).max(3).catch(2),
      })
    )
    .catch([])
    .default([]),
});

/**
 * Category calls are SEPARATE (brief §3): a React requirement and a mentoring
 * requirement get different instructions and different calls. system-design
 * only runs when the role plausibly needs it; company-fit only when we have
 * sourced company facts to ground it.
 */
async function generateByCategory(
  requirements: Requirement[],
  ctx: QuestionGenContext,
  llm: LlmClient,
  progress: (msg: string) => void
): Promise<Question[]> {
  const technical = requirements.filter((r) => r.kind === "technical");
  const behavioural = requirements.filter((r) => r.kind === "behavioural");
  const domain = requirements.filter((r) => r.kind === "domain");
  const architecture = technical.filter((r) => /architect|scale|distributed|system|infra|platform|data model|migration/i.test(r.text));
  const seniorish = /senior|lead|principal|staff/i.test(ctx.seniority);

  const out: Question[] = [];
  const push = (batch: z.infer<typeof QuestionBatchSchema>, fallbackCategory: Question["category"], allowedIds: Set<string>) => {
    for (const q of batch.questions) {
      const refs = q.requirement_ids.filter((id) => allowedIds.has(id));
      if (!refs.length || !q.prompt.trim()) continue;
      out.push({
        id: "",
        requirement_ids: refs,
        category: fallbackCategory,
        prompt: q.prompt.trim(),
        answer_outline: q.answer_outline.trim(),
        difficulty: q.difficulty,
        origin: "generated",
        edited: false,
        pinned: false,
      });
    }
  };

  if (technical.length) {
    progress(`technical (${technical.length} requirement(s))`);
    const batch = await llm.json<z.infer<typeof QuestionBatchSchema>>(
      P.questionsPrompt("technical", technical, ctx),
      { temperature: 0.6 }
    );
    push(QuestionBatchSchema.safeParse(batch).data ?? batch, "technical", new Set(technical.map((r) => r.id)));
  }
  const behTargets = behavioural.length ? behavioural : requirements.slice(0, 3);
  if (behTargets.length) {
    progress(`behavioural (${behavioural.length} requirement(s))`);
    const batch = await llm.json<z.infer<typeof QuestionBatchSchema>>(
      P.questionsPrompt("behavioural", behTargets, ctx),
      { temperature: 0.7 }
    );
    push(QuestionBatchSchema.safeParse(batch).data ?? batch, "behavioural", new Set(behTargets.map((r) => r.id)));
  }
  if (architecture.length || (seniorish && technical.length)) {
    const target = architecture.length ? architecture : technical.slice(0, 3);
    progress(`system-design (${target.length} requirement(s))`);
    const batch = await llm.json<z.infer<typeof QuestionBatchSchema>>(
      P.questionsPrompt("system-design", target, ctx),
      { temperature: 0.6 }
    );
    push(QuestionBatchSchema.safeParse(batch).data ?? batch, "system-design", new Set(target.map((r) => r.id)));
  }
  if (domain.length && ctx.companyFacts) {
    progress(`company-fit (${domain.length} requirement(s))`);
    const batch = await llm.json<z.infer<typeof QuestionBatchSchema>>(
      P.questionsPrompt("company-fit", domain, ctx),
      { temperature: 0.6 }
    );
    push(QuestionBatchSchema.safeParse(batch).data ?? batch, "company-fit", new Set(domain.map((r) => r.id)));
  }

  return assignQuestionIds(out);
}

async function fillGaps(
  gapIds: string[],
  requirements: Requirement[],
  ctx: QuestionGenContext,
  llm: LlmClient
): Promise<Question[]> {
  const uncovered = requirements.filter((r) => gapIds.includes(r.id));
  if (!uncovered.length) return [];
  const raw = await llm.json<z.infer<typeof QuestionBatchSchema>>(
    P.gapFillPrompt(uncovered, {
      role: ctx.role,
      company: ctx.company,
      seniority: ctx.seniority,
      processSummary: ctx.processSummary,
      companyFacts: ctx.companyFacts,
      failingCategory: "",
    }),
    { temperature: 0.6 }
  );
  const batch = QuestionBatchSchema.safeParse(raw);
  const parsed = batch.success ? batch.data : { questions: [] };
  const allowed = new Set(uncovered.map((r) => r.id));
  const out: Question[] = [];
  for (const q of parsed.questions) {
    const refs = q.requirement_ids.filter((id) => allowed.has(id));
    if (!refs.length || !q.prompt.trim()) continue;
    out.push({
      id: "",
      requirement_ids: refs,
      category: q.category,
      prompt: q.prompt.trim(),
      answer_outline: q.answer_outline.trim(),
      difficulty: q.difficulty,
      origin: "generated",
      edited: false,
      pinned: false,
    });
  }
  return out;
}

const FlashcardBatchSchema = z.object({
  flashcards: z
    .array(
      z.object({
        front: z.string(),
        back: z.string(),
        requirement_ids: z.array(z.string()).catch([]).default([]),
      })
    )
    .catch([])
    .default([]),
});

async function generateFlashcards(
  requirements: Requirement[],
  questions: Question[],
  companyFacts: string,
  llm: LlmClient
): Promise<Flashcard[]> {
  const raw = await llm.json<z.infer<typeof FlashcardBatchSchema>>(
    P.flashcardsPrompt(requirements, questions, companyFacts),
    { temperature: 0.5 }
  );
  const parsed = FlashcardBatchSchema.safeParse(raw);
  const batch = parsed.success ? parsed.data : { flashcards: [] };
  const known = new Set(requirements.map((r) => r.id));
  const out: Flashcard[] = [];
  for (const f of batch.flashcards) {
    const refs = f.requirement_ids.filter((id) => known.has(id));
    if (!f.front.trim() || !f.back.trim()) continue;
    out.push({
      id: "",
      front: f.front.trim(),
      back: f.back.trim(),
      requirement_ids: refs,
      origin: "generated",
      edited: false,
      pinned: false,
    });
  }
  return assignCardIds(out.slice(0, 120));
}

/* -------------------------------------------------------------------------- */
/* helpers                                                                     */
/* -------------------------------------------------------------------------- */

export function clampDays(days: number): number {
  if (!Number.isFinite(days)) return 5;
  return Math.min(MAX_DAYS, Math.max(MIN_DAYS, Math.round(days)));
}

function assignQuestionIds(questions: Question[]): Question[] {
  return questions.map((q, i) => ({ ...q, id: `q${i + 1}` }));
}
function assignCardIds(cards: Flashcard[]): Flashcard[] {
  return cards.map((f, i) => ({ ...f, id: `f${i + 1}` }));
}

/** Merge new questions into an existing bank, skipping near-duplicates. */
export function mergeQuestions(existing: Question[], incoming: Question[], requirements: Requirement[]): Question[] {
  const ids = new Set(existing.map((q) => q.id));
  const knownReqIds = new Set(requirements.map((r) => r.id));
  const seen = new Set(existing.map((q) => normalise(q.prompt)));
  const merged = [...existing];
  for (const q of incoming) {
    const key = normalise(q.prompt);
    if (seen.has(key)) continue;
    const refs = q.requirement_ids.filter((id) => knownReqIds.has(id));
    if (!refs.length) continue;
    seen.add(key);
    let id = q.id;
    let n = merged.length + 1;
    while (ids.has(id) || !id) id = `q${n++}`;
    ids.add(id);
    merged.push({ ...q, id, requirement_ids: refs });
  }
  return merged;
}

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function toPromptPage(p: { url: string; title: string; text: string } | null): PageForPrompt | null {
  return p ? { url: p.url, title: p.title, text: p.text } : null;
}

function promptPages(pages: { url: string; title: string; text: string }[], limit: number): PageForPrompt[] {
  return pages
    .slice(0, limit)
    .map(toPromptPage)
    .filter((p): p is PageForPrompt => p !== null);
}

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}
function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}
function describeErr(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

async function guessCompanyName(jd: string, companyUrl: string, llm: LlmClient): Promise<{ name: string }> {
  // Cheap heuristic first: "About Acme" / "Acme is hiring" style lines.
  const m =
    jd.match(/\b(?:at|join|about)\s+([A-Z][A-Za-z0-9&.'-]{2,40})\b/) ??
    jd.match(/^([A-Z][A-Za-z0-9&.'-]{2,40})\s+(?:is|are)\s+(?:hiring|looking)/);
  if (m) return { name: m[1] };
  if (companyUrl) {
    const host = hostLabel(companyUrl);
    // Never derive a company name from an IP literal (localhost fixtures).
    if (net.isIP(host)) return { name: "" };
    const base = host.split(".")[0];
    if (base && base.length >= 3 && base !== "www") return { name: base.charAt(0).toUpperCase() + base.slice(1) };
  }
  return { name: "" };
}

