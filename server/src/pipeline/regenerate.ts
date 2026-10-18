import {
  computeCoverage,
  allocateSchedule,
  type Kit,
  type Question,
  type Flashcard,
} from "@aiprepkit/core";
import type { LlmClient } from "../llm/client";
import { runSectionRegeneration, type RegenSection } from "./regenerateSection";
import { log } from "../lib/logger";

/**
 * Regeneration with edit preservation (brief §6).
 *
 * State model — every question and flashcard carries three flags:
 *   origin:  "generated" | "user"     — who created it
 *   edited:  boolean                  — the user changed a generated item
 *   pinned:  boolean                  — the user explicitly protected it
 *
 * Rules when a section regenerates:
 *   - items with origin=user, edited=true, or pinned=true are PRESERVED
 *   - only untouched generated items are replaced
 *   - preserved items keep their ids and their relative order (user order
 *     wins); new generated items are appended after them in their category
 *   - other sections are never touched, so edits elsewhere survive
 *
 * Ids are never renumbered: stable ids are what make the schedule,
 * flashcard progress and requirement coverage survive a regeneration.
 */

export interface RegenerateInput {
  kit: Kit;
  section: RegenSection;
  llm: LlmClient;
  onProgress?: (message: string) => void;
}

export interface RegenerateResult {
  kit: Kit;
  /** What was kept vs replaced, for the UI toast and the audit trail. */
  summary: { kept: number; replaced: number; added: number };
}

export function isPreserved(item: { origin: string; edited: boolean; pinned: boolean }): boolean {
  return item.origin === "user" || item.edited || item.pinned;
}

export async function regenerateSection(input: RegenerateInput): Promise<RegenerateResult> {
  const { kit, section, llm, onProgress } = input;

  if (section === "schedule") {
    // Pure arithmetic — regenerate straight from current questions.
    const schedule = allocateSchedule(kit.questions, kit.role.requirements, kit.schedule.days_available);
    return { kit: { ...kit, schedule }, summary: { kept: 0, replaced: schedule.days.length, added: 0 } };
  }

  if (section === "company_brief") {
    const out = await runSectionRegeneration(kit, section, llm, onProgress);
    return {
      kit: { ...kit, company_brief: out.company_brief ?? kit.company_brief },
      summary: { kept: 0, replaced: 1, added: 0 },
    };
  }

  // questions (whole bank or one category), flashcards
  const generated = await runSectionRegeneration(kit, section, llm, onProgress);
  let questions = kit.questions;
  let flashcards = kit.flashcards;
  let summary = { kept: 0, replaced: 0, added: 0 };

  if (section === "questions" || section.startsWith("questions:")) {
    const category = section.includes(":") ? section.split(":")[1] : null;
    const { kept, incoming } = splitForQuestions(kit.questions, category);
    const merged = dedupeAndNumber([...kept, ...incomingWith(incoming, generated.questions ?? [])], kit);
    questions = merged;
    summary = {
      kept: kept.length,
      replaced: incoming.length,
      added: Math.max(0, merged.length - kept.length - incoming.length),
    };
  } else if (section === "flashcards") {
    const kept = kit.flashcards.filter(isPreserved);
    const incoming = (generated.flashcards ?? []).map((f) => ({
      ...f,
      origin: "generated" as const,
      edited: false,
      pinned: false,
    }));
    // Kept cards retain their original ids so practice progress survives;
    // new cards take the next free numbers.
    flashcards = reassignKeeping(kept, incoming);
    summary = { kept: kept.length, replaced: kit.flashcards.length - kept.length, added: incoming.length };
  }

  // Deterministic bookkeeping updates after any content change.
  const coverage = computeCoverage(kit.role.requirements, questions);
  const schedule =
    section === "questions" || section.startsWith("questions:")
      ? allocateSchedule(questions, kit.role.requirements, kit.schedule.days_available)
      : kit.schedule;

  return {
    kit: {
      ...kit,
      questions,
      flashcards,
      schedule,
      coverage: {
        uncovered_requirement_ids: coverage.uncovered_requirement_ids,
        uncovered_must_requirement_ids: coverage.uncovered_must_requirement_ids,
        passes: kit.coverage.passes + (section === "questions" || section.startsWith("questions:") ? 1 : 0),
      },
    },
    summary,
  };
}

/** Split current questions into preserved vs replaceable (optionally per category). */
function splitForQuestions(existing: Question[], category: string | null) {
  const kept: Question[] = [];
  const replaceable: Question[] = [];
  for (const q of existing) {
    const inScope = !category || q.category === category;
    if (inScope && !isPreserved(q)) replaceable.push(q);
    else kept.push(q);
  }
  return { kept, incoming: replaceable };
}

function incomingWith(_replaceable: Question[], fresh: Question[]): Question[] {
  return fresh.map((q) => ({ ...q, origin: "generated" as const, edited: false, pinned: false }));
}

/**
 * Numbering policy: kept items retain their original ids (stable ids are the
 * contract with the schedule and practice progress); new items take the next
 * free numbers.
 */
function dedupeAndNumber(items: Question[], kit: Kit): Question[] {
  const usedIds = new Set(items.filter((q) => q.id).map((q) => q.id));
  let next = 1;
  const nextId = () => {
    while (usedIds.has(`q${next}`)) next++;
    const id = `q${next}`;
    usedIds.add(id);
    return id;
  };
  const seenPrompts = new Set<string>();
  const out: Question[] = [];
  for (const q of items) {
    const key = q.prompt.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (seenPrompts.has(key)) continue; // collapse model duplicates
    seenPrompts.add(key);
    out.push({ ...q, id: q.id && usedIds.has(q.id) ? q.id : nextId() });
  }
  void kit;
  return out;
}

function reassignKeeping(kept: Flashcard[], incoming: Flashcard[]): Flashcard[] {
  const used = new Set(kept.map((f) => f.id));
  let next = 1;
  const out = [...kept];
  for (const f of incoming) {
    while (used.has(`f${next}`)) next++;
    const id = `f${next}`;
    used.add(id);
    out.push({ ...f, id });
  }
  log.debug("flashcards reassigned", { kept: kept.length, added: incoming.length });
  return out;
}
