import { z } from "zod";
import type { Kit } from "@aiprepkit/core";
import type { LlmClient } from "../llm/client";
import { SYSTEM_PREAMBLE } from "./prompts";

/**
 * Creative feature: "Prepare once, apply twice."
 *
 * Problem it solves: candidates rarely interview at exactly one company.
 * Two postings at different companies usually share 40-70% of their skill
 * requirements, but candidates prep each from scratch and double their work.
 * This module compares two kits the user already owns, finds the overlap,
 * and tells them exactly what a combined prep plan saves.
 *
 * Matching is two-phase so the cheap, certain work never costs a token:
 *   1. CODE: exact match on normalised requirement text (deterministic)
 *   2. LLM: fuzzy match on the remainder (wording differs, skill is same)
 * The candidate decides — we present each fuzzy pair with its rationale.
 */
export interface OverlapPair {
  requirement_id_a: string;
  requirement_id_b: string;
  text_a: string;
  text_b: string;
  match_type: "exact" | "fuzzy";
  rationale?: string;
}

export interface OverlapReport {
  kit_a: { role: string; company: string };
  kit_b: { role: string; company: string };
  shared: OverlapPair[];
  unique_to_a: { id: string; text: string; priority: string }[];
  unique_to_b: { id: string; text: string; priority: string }[];
  summary: {
    overlap_pct: number;
    minutes_saved: number;
    headline: string;
  };
}

export async function runOverlap(kitA: Kit, kitB: Kit, llm: LlmClient): Promise<OverlapReport> {
  const reqsA = kitA.role.requirements;
  const reqsB = kitB.role.requirements;

  // --- phase 1: deterministic exact match -----------------------------------
  const shared: OverlapPair[] = [];
  const matchedB = new Set<string>();
  for (const a of reqsA) {
    const key = normalise(a.text);
    for (const b of reqsB) {
      if (matchedB.has(b.id)) continue;
      if (key === normalise(b.text)) {
        shared.push({
          requirement_id_a: a.id,
          requirement_id_b: b.id,
          text_a: a.text,
          text_b: b.text,
          match_type: "exact",
        });
        matchedB.add(b.id);
        break;
      }
    }
  }

  // --- phase 2: fuzzy match on the remainder (one LLM call) ----------------
  const restA = reqsA.filter((a) => !shared.some((s) => s.requirement_id_a === a.id));
  const restB = reqsB.filter((b) => !matchedB.has(b.id));
  if (restA.length && restB.length && llm.remainingBudget > 0) {
    try {
      const raw = await llm.json<{ pairs?: { a?: string; b?: string; rationale?: string }[] }>(
        [
          { role: "system", text: SYSTEM_PREAMBLE },
          {
            role: "user",
            text: `[[STEP:overlap]]
Match job requirements that describe the SAME underlying skill or experience, even when worded differently. "5+ years React" matches "strong React experience"; "Mentoring juniors" does NOT match "public speaking".

Requirements from posting A:
${restA.map((r) => `- ${r.id}: ${r.text}`).join("\n")}

Requirements from posting B:
${restB.map((r) => `- ${r.id}: ${r.text}`).join("\n")}

Return {"pairs":[{"a":"r1","b":"r3","rationale":"..."}]} with only genuine matches. Empty list if none.`,
          },
        ],
        { temperature: 0.2 }
      );
      const knownA = new Set(restA.map((r) => r.id));
      const knownB = new Set(restB.map((r) => r.id));
      for (const pair of raw.pairs ?? []) {
        if (!pair.a || !pair.b || !knownA.has(pair.a) || !knownB.has(pair.b)) continue;
        const a = restA.find((r) => r.id === pair.a)!;
        const b = restB.find((r) => r.id === pair.b)!;
        shared.push({
          requirement_id_a: a.id,
          requirement_id_b: b.id,
          text_a: a.text,
          text_b: b.text,
          match_type: "fuzzy",
          rationale: pair.rationale ?? "",
        });
        matchedB.add(b.id);
      }
    } catch {
      // Fuzzy matching is best-effort; exact matches already produced value.
    }
  }

  const sharedMinutes = new Set(shared.map((s) => s.requirement_id_a));
  const minutesSaved = kitA.questions
    .filter((q) => q.requirement_ids.some((id) => sharedMinutes.has(id)))
    .reduce((sum, q) => sum + ({ 1: 15, 2: 30, 3: 45 }[q.difficulty] ?? 30), 0);

  const total = reqsA.length + reqsB.length || 1;
  const overlapPct = Math.round((shared.length * 2 * 100) / total);

  return {
    kit_a: { role: kitA.role.title, company: kitA.source.company },
    kit_b: { role: kitB.role.title, company: kitB.source.company },
    shared,
    unique_to_a: reqsA
      .filter((a) => !shared.some((s) => s.requirement_id_a === a.id))
      .map((r) => ({ id: r.id, text: r.text, priority: r.priority })),
    unique_to_b: reqsB
      .filter((b) => !matchedB.has(b.id))
      .map((r) => ({ id: r.id, text: r.text, priority: r.priority })),
    summary: {
      overlap_pct: overlapPct,
      minutes_saved: minutesSaved,
      headline:
        shared.length === 0
          ? "These two roles share little — prep them separately."
          : `${overlapPct}% overlap — prep the shared ${shared.length} requirement(s) once and save ~${minutesSaved} minutes on the other kit.`,
    },
  };
}

function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(years?| experience| with| and| the| a| an| strong| good solid)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
