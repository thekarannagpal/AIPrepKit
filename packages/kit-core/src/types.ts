import { z } from "zod";

/**
 * Kit structure — Appendix A of the brief.
 *
 * Every field listed in Appendix A is present and named exactly as given.
 * The schema is extended (additively, never renamably) with:
 *   - source.research_log   honest record of every source attempted, incl. skips
 *   - notes[]               top-level honest reporting (thin JD, no hiring page…)
 *   - question/flashcard    origin | edited | pinned  (builder state, section 6)
 *   - coverage.uncovered_must_requirement_ids  must-haves still open after loops
 */

export const REQUIREMENT_KINDS = ["technical", "behavioural", "domain"] as const;
export const PRIORITIES = ["must", "nice"] as const;
export const QUESTION_CATEGORIES = [
  "technical",
  "behavioural",
  "system-design",
  "company-fit",
] as const;

export const RequirementKindSchema = z.enum(REQUIREMENT_KINDS);
export const PrioritySchema = z.enum(PRIORITIES);
export const QuestionCategorySchema = z.enum(QUESTION_CATEGORIES);

export const MIN_DAYS = 1;
export const MAX_DAYS = 60;
export const MAX_QUESTIONS_PER_KIT = 80;
export const MAX_FLASHCARDS_PER_KIT = 120;

/** Deterministic minutes per difficulty level — integers, never floats. */
export const MINUTES_BY_DIFFICULTY: Record<number, number> = {
  1: 15,
  2: 30,
  3: 45,
};

export const RequirementSchema = z.object({
  id: z.string().regex(/^r\d+$/, "requirement ids look like r1, r2, …"),
  text: z.string().min(1),
  kind: RequirementKindSchema,
  priority: PrioritySchema,
});
export type Requirement = z.infer<typeof RequirementSchema>;

export const QuestionSchema = z.object({
  id: z.string().regex(/^q\d+$/, "question ids look like q1, q2, …"),
  requirement_ids: z.array(z.string()),
  category: QuestionCategorySchema,
  prompt: z.string().min(1),
  answer_outline: z.string(),
  difficulty: z.number().int().min(1).max(3),
  // builder-state extensions (section 6 of the brief)
  origin: z.enum(["generated", "user"]).default("generated"),
  edited: z.boolean().default(false),
  pinned: z.boolean().default(false),
});
export type Question = z.infer<typeof QuestionSchema>;

export const FlashcardSchema = z.object({
  id: z.string().regex(/^f\d+$/),
  front: z.string().min(1),
  back: z.string().min(1),
  requirement_ids: z.array(z.string()),
  origin: z.enum(["generated", "user"]).default("generated"),
  edited: z.boolean().default(false),
  pinned: z.boolean().default(false),
});
export type Flashcard = z.infer<typeof FlashcardSchema>;

export const ResearchLogEntrySchema = z.object({
  url: z.string(),
  status: z.enum(["fetched", "skipped", "error"]),
  note: z.string(),
});
export type ResearchLogEntry = z.infer<typeof ResearchLogEntrySchema>;

export const SourceSchema = z.object({
  company: z.string(),
  company_url: z.string(),
  role: z.string(),
  location: z.string(),
  jd_chars: z.number().int(),
  researched_at: z.string(),
  pages_used: z.array(z.string()),
  research_log: z.array(ResearchLogEntrySchema).default([]),
});
export type Source = z.infer<typeof SourceSchema>;

export const CompanyBriefSchema = z.object({
  summary: z.string(),
  what_they_do: z.string(),
  sources: z.array(z.string()),
});
export type CompanyBrief = z.infer<typeof CompanyBriefSchema>;

export const RoleSchema = z.object({
  title: z.string(),
  seniority: z.string(),
  responsibilities: z.array(z.string()),
  requirements: z.array(RequirementSchema),
});
export type Role = z.infer<typeof RoleSchema>;

export const ScheduleDaySchema = z.object({
  day: z.number().int().min(1),
  focus: z.string(),
  question_ids: z.array(z.string()),
  minutes: z.number().int().min(0),
});
export type ScheduleDay = z.infer<typeof ScheduleDaySchema>;

export const ScheduleSchema = z.object({
  days_available: z.number().int().min(MIN_DAYS).max(MAX_DAYS),
  days: z.array(ScheduleDaySchema),
});
export type Schedule = z.infer<typeof ScheduleSchema>;

export const CoverageSchema = z.object({
  uncovered_requirement_ids: z.array(z.string()),
  passes: z.number().int().min(1),
  // extension: distinguishes must-haves (ship-blocking) from nice-to-haves
  uncovered_must_requirement_ids: z.array(z.string()).default([]),
});
export type Coverage = z.infer<typeof CoverageSchema>;

export const KitSchema = z.object({
  source: SourceSchema,
  company_brief: CompanyBriefSchema,
  role: RoleSchema,
  questions: z.array(QuestionSchema).max(MAX_QUESTIONS_PER_KIT),
  flashcards: z.array(FlashcardSchema).max(MAX_FLASHCARDS_PER_KIT),
  schedule: ScheduleSchema,
  coverage: CoverageSchema,
  notes: z.array(z.string()).default([]),
});
export type Kit = z.infer<typeof KitSchema>;

/** A kit as produced by the pipeline, before validation defaults are applied. */
export type RawKit = z.input<typeof KitSchema>;
