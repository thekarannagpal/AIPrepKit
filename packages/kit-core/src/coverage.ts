import type { Kit, Requirement } from "./types";

export interface CoverageReport {
  /** Every requirement (must and nice) with no question referencing it. */
  uncovered_requirement_ids: string[];
  /** The ship-blocking subset: must-have requirements with no question. */
  uncovered_must_requirement_ids: string[];
  /** requirement id -> question ids that cover it. */
  coverage_map: Record<string, string[]>;
  total_requirements: number;
  covered_count: number;
  must_total: number;
  must_covered_count: number;
}

/**
 * Deterministic coverage check — pure code, never the model (brief §3).
 *
 * A requirement is covered when at least one question references its id.
 * This is what makes coverage checkable rather than a matter of opinion.
 */
export function computeCoverage(
  requirements: Requirement[],
  questions: { id: string; requirement_ids: string[] }[]
): CoverageReport {
  const coverage_map: Record<string, string[]> = {};
  for (const req of requirements) coverage_map[req.id] = [];
  for (const q of questions) {
    for (const rid of q.requirement_ids) {
      if (!coverage_map[rid]) coverage_map[rid] = [];
      if (!coverage_map[rid].includes(q.id)) coverage_map[rid].push(q.id);
    }
  }

  const uncovered = requirements.filter((r) => coverage_map[r.id].length === 0);
  const uncovered_must = uncovered.filter((r) => r.priority === "must");
  const mustTotal = requirements.filter((r) => r.priority === "must").length;

  return {
    uncovered_requirement_ids: uncovered.map((r) => r.id),
    uncovered_must_requirement_ids: uncovered_must.map((r) => r.id),
    coverage_map,
    total_requirements: requirements.length,
    covered_count: requirements.length - uncovered.length,
    must_total: mustTotal,
    must_covered_count: mustTotal - uncovered_must.length,
  };
}

/**
 * Convenience: coverage computed straight off a kit, including the
 * coverage block the kit already carries (used to re-check after user edits).
 */
export function kitCoverage(kit: Pick<Kit, "role" | "questions">): CoverageReport {
  return computeCoverage(kit.role.requirements, kit.questions);
}

/** True when every must-have requirement has at least one question. */
export function allMustRequirementsCovered(kit: Pick<Kit, "role" | "questions">): boolean {
  return kitCoverage(kit).uncovered_must_requirement_ids.length === 0;
}
