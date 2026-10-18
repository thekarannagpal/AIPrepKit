import type { Kit, Question, Flashcard, CompanyBrief } from "@aiprepkit/core";
import type { LlmClient } from "../llm/client";
import * as P from "./prompts";
import { AppError } from "../lib/errors";

export type RegenSection =
  | "company_brief"
  | "questions"
  | "questions:technical"
  | "questions:behavioural"
  | "questions:system-design"
  | "questions:company-fit"
  | "flashcards"
  | "schedule";

export const REGEN_SECTIONS: RegenSection[] = [
  "company_brief",
  "questions",
  "questions:technical",
  "questions:behavioural",
  "questions:system-design",
  "questions:company-fit",
  "flashcards",
  "schedule",
];

export interface RegenOutput {
  company_brief?: CompanyBrief;
  questions?: Question[];
  flashcards?: Flashcard[];
}

/**
 * Runs the LLM call for one section only. The caller (regenerate.ts) is
 * responsible for merging the result with preserved items — this module
 * never sees the user's edits, which is what makes "regenerate one section
 * cannot clobber another" structurally true rather than a convention.
 */
export async function runSectionRegeneration(
  kit: Kit,
  section: RegenSection,
  llm: LlmClient,
  onProgress?: (message: string) => void
): Promise<RegenOutput> {
  const ctx: P.SectionContext = {
    role: kit.role.title,
    company: kit.source.company,
    seniority: kit.role.seniority,
    responsibilities: kit.role.responsibilities,
    processSummary: "",
    stages: [],
    companyFacts: [kit.company_brief.summary, kit.company_brief.what_they_do].filter(Boolean).join("\n"),
  };

  if (section === "company_brief") {
    onProgress?.("re-reading the company pages");
    // The crawl result is not persisted; regeneration re-uses whatever page
    // text we can re-fetch cheaply, or falls back to an honest stub when the
    // site is unreachable. Refetching keeps this step self-contained.
    const { Fetcher } = await import("../research/fetcher");
    const { crawlSite } = await import("../research/crawler");
    const fetcher = new Fetcher();
    let summary = kit.company_brief.summary;
    let whatTheyDo = kit.company_brief.what_they_do;
    if (kit.source.company_url) {
      try {
        const crawl = await crawlSite(kit.source.company_url, fetcher);
        if (crawl.pages.length) {
          const raw = await llm.json<{ summary?: string; what_they_do?: string }>(
            P.companyBriefPrompt(
              { url: crawl.pages[0].url, title: crawl.pages[0].title, text: crawl.pages[0].text },
              crawl.aboutPages.slice(0, 2).map((p) => ({ url: p.url, title: p.title, text: p.text })),
              crawl.hiringPages.slice(0, 2).map((p) => ({ url: p.url, title: p.title, text: p.text }))
            ),
            { temperature: 0.4 }
          );
          summary = typeof raw.summary === "string" ? raw.summary : summary;
          whatTheyDo = typeof raw.what_they_do === "string" ? raw.what_they_do : whatTheyDo;
        }
      } catch (err) {
        throw err instanceof AppError
          ? err
          : new AppError("COMPANY_UNREACHABLE", "Company site unreachable for brief regeneration.", 502);
      }
    }
    return {
      company_brief: {
        summary,
        what_they_do: whatTheyDo,
        sources: kit.company_brief.sources,
      },
    };
  }
  if (section === "flashcards") {
    onProgress?.("writing flashcards");
    const raw = await llm.json<{ flashcards?: { front?: string; back?: string; requirement_ids?: string[] }[] }>(
      P.flashcardsPrompt(
        kit.role.requirements,
        kit.questions.map((q) => ({ prompt: q.prompt, requirement_ids: q.requirement_ids })),
        ctx.companyFacts
      ),
      { temperature: 0.5 }
    );
    const known = new Set(kit.role.requirements.map((r) => r.id));
    const flashcards: Flashcard[] = (raw.flashcards ?? [])
      .filter((f) => f && typeof f.front === "string" && typeof f.back === "string" && f.front.trim() && f.back.trim())
      .map((f) => ({
        id: "",
        front: f.front!.trim(),
        back: f.back!.trim(),
        requirement_ids: (f.requirement_ids ?? []).filter((id) => known.has(id)),
        origin: "generated" as const,
        edited: false,
        pinned: false,
      }));
    return { flashcards };
  }

  if (section === "questions" || section.startsWith("questions:")) {
    const category = section.includes(":") ? ((section.split(":")[1] ?? null) as P.QuestionCategory | null) : null;
    const targets = category ? kit.role.requirements.filter((r) => r.kind === category) : kit.role.requirements;
    // For category regen, keep non-kind-matching requirements in play too when
    // the category is system-design or company-fit (their inputs differ).
    const input =
      category === "system-design"
        ? kit.role.requirements.filter((r) => r.kind === "technical")
        : category === "company-fit"
          ? kit.role.requirements.filter((r) => r.kind === "domain" || r.kind === "technical")
          : targets;
    onProgress?.(`writing ${category ?? "all"} questions for ${input.length} requirement(s)`);
    const cats: P.QuestionCategory[] = category ? [category] : ["technical", "behavioural"];
    const out: Question[] = [];
    for (const cat of cats) {
      const subset = filterForCategory(input, cat);
      if (!subset.length) continue;
      const raw = await llm.json<{ questions?: P.QuestionDraft[] }>(
        P.questionsPrompt(cat, subset, ctx),
        { temperature: 0.6 }
      );
      const known = new Set(subset.map((r) => r.id));
      for (const q of raw.questions ?? []) {
        if (!q || typeof q.prompt !== "string" || !q.prompt.trim()) continue;
        const refs = (q.requirement_ids ?? []).filter((id: string) => known.has(id));
        if (!refs.length) continue;
        out.push({
          id: "",
          requirement_ids: refs,
          category: (q.category && ["technical", "behavioural", "system-design", "company-fit"].includes(q.category)
            ? q.category
            : cat) as Question["category"],
          prompt: q.prompt.trim(),
          answer_outline: typeof q.answer_outline === "string" ? q.answer_outline.trim() : "",
          difficulty: clampDifficulty(q.difficulty),
          origin: "generated" as const,
          edited: false,
          pinned: false,
        });
      }
    }
    return { questions: out };
  }

  throw new AppError("VALIDATION", `Unknown section: ${section}`, 400);
}

function filterForCategory<T extends { id: string; text: string; kind: string }>(
  requirements: T[],
  category: P.QuestionCategory
): T[] {
  switch (category) {
    case "technical":
      return requirements.filter((r) => r.kind === "technical");
    case "behavioural":
      return requirements.filter((r) => r.kind === "behavioural");
    case "system-design":
      return requirements.filter((r) => /architect|scale|distributed|system|infra|platform|data model|migration/i.test(r.text));
    case "company-fit":
      return requirements.filter((r) => r.kind === "domain" || r.kind === "technical");
    default:
      return requirements;
  }
}

function clampDifficulty(d: unknown): number {
  const n = Math.round(Number(d));
  return Number.isFinite(n) ? Math.min(3, Math.max(1, n)) : 2;
}
