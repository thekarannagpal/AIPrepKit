import {
  KitSchema,
  MAX_DAYS,
  MIN_DAYS,
  PRIORITIES,
  QUESTION_CATEGORIES,
  REQUIREMENT_KINDS,
  type Kit,
  type Question,
  type Flashcard,
} from "./types";
import { computeCoverage } from "./coverage";
import { scheduleProblems } from "./schedule";

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  /** Repaired kit when repair succeeded; undefined when unrepairable. */
  kit?: Kit;
  repairs: string[];
}

/**
 * Validate a generated kit against the expected structure (Appendix A) and
 * check cross-references: stable ids, schedule integrity, coverage bookkeeping.
 */
export function validateKit(candidate: unknown): ValidationResult {
  const parsed = KitSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`),
      repairs: [],
    };
  }
  const kit = parsed.data;
  const errors: string[] = [];

  const reqIds = new Set<string>();
  for (const r of kit.role.requirements) {
    if (reqIds.has(r.id)) errors.push(`duplicate requirement id ${r.id}`);
    reqIds.add(r.id);
  }

  const qIds = new Set<string>();
  for (const q of kit.questions) {
    if (qIds.has(q.id)) errors.push(`duplicate question id ${q.id}`);
    qIds.add(q.id);
    for (const rid of q.requirement_ids) {
      if (!reqIds.has(rid)) errors.push(`question ${q.id} references unknown requirement ${rid}`);
    }
  }

  const fIds = new Set<string>();
  for (const f of kit.flashcards) {
    if (fIds.has(f.id)) errors.push(`duplicate flashcard id ${f.id}`);
    fIds.add(f.id);
    for (const rid of f.requirement_ids) {
      if (!reqIds.has(rid)) errors.push(`flashcard ${f.id} references unknown requirement ${rid}`);
    }
  }

  errors.push(...scheduleProblems(kit.schedule, kit.questions, kit.role.requirements));

  const expected = computeCoverage(kit.role.requirements, kit.questions);
  const sorted = (a: string[]) => [...a].sort();
  if (
    JSON.stringify(sorted(kit.coverage.uncovered_requirement_ids)) !==
    JSON.stringify(sorted(expected.uncovered_requirement_ids))
  ) {
    errors.push("coverage.uncovered_requirement_ids does not match the actual coverage");
  }

  return { ok: errors.length === 0, errors, kit, repairs: [] };
}

/**
 * Best-effort repair of a kit the model returned in a broken shape. The
 * strategy is conservative: keep everything structurally sound, clamp invalid
 * scalar values, and drop dangling references rather than failing the kit —
 * then recompute the deterministic blocks (coverage) so they are always true.
 */
export function repairKit(candidate: unknown): ValidationResult {
  const repairs: string[] = [];
  if (typeof candidate !== "object" || candidate === null) {
    return { ok: false, errors: ["kit is not an object"], repairs };
  }
  const raw: Record<string, any> = { ...(candidate as Record<string, any>) };

  // --- source / brief / role: coerce scalars to strings -----------------------
  const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
  raw.source = typeof raw.source === "object" && raw.source ? raw.source : {};
  raw.company_brief = typeof raw.company_brief === "object" && raw.company_brief ? raw.company_brief : {};
  raw.role = typeof raw.role === "object" && raw.role ? raw.role : {};

  raw.source = {
    company: str(raw.source.company),
    company_url: str(raw.source.company_url),
    role: str(raw.source.role),
    location: str(raw.source.location),
    jd_chars: Number.isFinite(raw.source.jd_chars) ? Math.floor(raw.source.jd_chars) : 0,
    researched_at: str(raw.source.researched_at) || new Date().toISOString(),
    pages_used: asStringArray(raw.source.pages_used),
    research_log: Array.isArray(raw.source.research_log) ? raw.source.research_log : [],
  };
  raw.company_brief = {
    summary: str(raw.company_brief.summary),
    what_they_do: str(raw.company_brief.what_they_do),
    sources: asStringArray(raw.company_brief.sources),
  };

  // --- requirements: keep only well-formed entries, re-id densely ------------
  const reqsIn = Array.isArray(raw.role.requirements) ? raw.role.requirements : [];
  const reqs: any[] = [];
  for (const r of reqsIn) {
    if (!r || typeof r !== "object") continue;
    const text = str(r.text).trim();
    if (!text) continue;
    const kind = REQUIREMENT_KINDS.includes(r.kind) ? r.kind : "technical";
    if (r.kind !== kind) repairs.push(`requirement "${text.slice(0, 40)}": kind coerced to technical`);
    let priority = r.priority;
    if (!PRIORITIES.includes(priority)) {
      priority = /bonus|nice|preferred|plus|desirable|optional/i.test(text) ? "nice" : "must";
      repairs.push(`requirement "${text.slice(0, 40)}": priority inferred as ${priority}`);
    }
    reqs.push({ id: `r${reqs.length + 1}`, text, kind, priority });
  }
  const oldToNewReq = new Map<string, string>();
  reqsIn.forEach((r: any, i: number) => {
    if (r && typeof r === "object" && str(r.id).trim()) oldToNewReq.set(String(r.id).trim(), `r${i + 1}`);
  });
  const mapReq = (id: unknown): string | null => {
    const s = str(id).trim();
    const mapped = oldToNewReq.get(s) ?? s;
    return reqs.some((r) => r.id === mapped) ? mapped : null;
  };
  raw.role = {
    title: str(raw.role.title),
    seniority: str(raw.role.seniority) || "unknown",
    responsibilities: asStringArray(raw.role.responsibilities),
    requirements: reqs,
  };

  // --- questions: clamp difficulty, drop dangling refs ------------------------
  const qIn = Array.isArray(raw.questions) ? raw.questions : [];
  const questions: any[] = [];
  for (const q of qIn) {
    if (!q || typeof q !== "object") continue;
    const prompt = str(q.prompt).trim();
    if (!prompt) continue;
    let difficulty = Math.round(Number(q.difficulty));
    if (!Number.isFinite(difficulty) || difficulty < 1 || difficulty > 3) {
      difficulty = Math.min(3, Math.max(1, Number.isFinite(difficulty) ? difficulty : 2));
      repairs.push(`question "${prompt.slice(0, 40)}": difficulty clamped to ${difficulty}`);
    }
    const category = QUESTION_CATEGORIES.includes(q.category) ? q.category : "technical";
    if (q.category !== category) repairs.push(`question "${prompt.slice(0, 40)}": category coerced to technical`);
    const mappedRefs = (asStringArray(q.requirement_ids).map(mapReq).filter(Boolean) as string[]);
    if (mappedRefs.length !== asStringArray(q.requirement_ids).length) {
      repairs.push(`question "${prompt.slice(0, 40)}": dangling requirement refs dropped`);
    }
    questions.push({
      id: `q${questions.length + 1}`,
      requirement_ids: mappedRefs,
      category,
      prompt,
      answer_outline: str(q.answer_outline),
      difficulty,
      origin: q.origin === "user" ? "user" : "generated",
      edited: Boolean(q.edited),
      pinned: Boolean(q.pinned),
    });
  }
  const oldToNewQ = new Map<string, string>();
  qIn.forEach((q: any, i: number) => {
    if (q && typeof q === "object" && str(q.id).trim()) oldToNewQ.set(String(q.id).trim(), `q${i + 1}`);
  });
  const mapQ = (id: unknown): string | null => {
    const s = str(id).trim();
    const mapped = oldToNewQ.get(s) ?? s;
    return questions.some((q) => q.id === mapped) ? mapped : null;
  };

  // --- flashcards -------------------------------------------------------------
  const fIn = Array.isArray(raw.flashcards) ? raw.flashcards : [];
  const flashcards: any[] = [];
  for (const f of fIn) {
    if (!f || typeof f !== "object") continue;
    const front = str(f.front).trim();
    const back = str(f.back).trim();
    if (!front || !back) continue;
    flashcards.push({
      id: `f${flashcards.length + 1}`,
      front,
      back,
      requirement_ids: (asStringArray(f.requirement_ids).map(mapReq).filter(Boolean) as string[]),
      origin: f.origin === "user" ? "user" : "generated",
      edited: Boolean(f.edited),
      pinned: Boolean(f.pinned),
    });
  }

  // --- schedule: drop dangling refs, recompute days count, fix minutes --------
  const schedIn = typeof raw.schedule === "object" && raw.schedule ? raw.schedule : {};
  let daysAvailable = Math.round(Number(schedIn.days_available));
  if (!Number.isFinite(daysAvailable) || daysAvailable < MIN_DAYS || daysAvailable > MAX_DAYS) {
    daysAvailable = Math.min(MAX_DAYS, Math.max(MIN_DAYS, Number.isFinite(daysAvailable) ? daysAvailable : 1));
    repairs.push(`schedule.days_available clamped to ${daysAvailable}`);
  }
  const daysIn = Array.isArray(schedIn.days) ? schedIn.days : [];
  const days: any[] = [];
  for (let i = 0; i < daysAvailable; i++) {
    const d = daysIn[i] ?? {};
    const qids = (asStringArray(d.question_ids).map(mapQ).filter(Boolean) as string[]);
    const minutes = Math.max(0, Math.round(Number(d.minutes)));
    days.push({
      day: i + 1,
      focus: str(d.focus) || "Practice day.",
      question_ids: qids,
      minutes: Number.isFinite(minutes) ? minutes : 0,
    });
  }
  if (days.length !== daysIn.length) repairs.push("schedule resized to the requested day count");
  // Any question that lost its slot gets appended to the first day with room.
  const scheduled = new Set(days.flatMap((d) => d.question_ids));
  for (const q of questions) {
    if (!scheduled.has(q.id)) {
      days[0].question_ids.push(q.id);
      repairs.push(`question ${q.id} re-inserted into day 1 (was missing from the schedule)`);
    }
  }
  raw.schedule = { days_available: daysAvailable, days };

  raw.flashcards = flashcards;
  raw.questions = questions;
  raw.notes = asStringArray(raw.notes);

  // --- coverage: always recomputed by code, never trusted from the model ------
  const cov = computeCoverage(reqs, questions);
  raw.coverage = {
    uncovered_requirement_ids: cov.uncovered_requirement_ids,
    uncovered_must_requirement_ids: cov.uncovered_must_requirement_ids,
    passes: Number.isFinite(raw.coverage?.passes) ? Math.max(1, Math.floor(raw.coverage.passes)) : 1,
  };

  const parsed = KitSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`),
      repairs,
    };
  }
  return { ok: true, errors: [], kit: parsed.data, repairs };
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

/** Re-export so callers can pick validation style in one import. */
export function validateOrRepair(candidate: unknown): ValidationResult {
  const direct = validateKit(candidate);
  if (direct.ok) return direct;
  const repaired = repairKit(candidate);
  return repaired.ok ? repaired : direct;
}
