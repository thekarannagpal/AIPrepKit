import { describe, it, expect } from "vitest";
import { computeCoverage, kitCoverage, allMustRequirementsCovered } from "./coverage";
import type { Question, Requirement } from "./types";

const requirement = (
  id: string,
  priority: "must" | "nice" = "must",
  kind: "technical" | "behavioural" | "domain" = "technical"
): Requirement => ({ id, text: `text ${id}`, kind, priority });

const question = (id: string, refs: string[]): Question => ({
  id,
  requirement_ids: refs,
  category: "technical",
  prompt: `p ${id}`,
  answer_outline: "",
  difficulty: 2,
  origin: "generated",
  edited: false,
  pinned: false,
});

describe("computeCoverage", () => {
  it("finds requirements with no question referencing them", () => {
    const requirements = [requirement("r1"), requirement("r2"), requirement("r3", "nice")];
    const questions = [question("q1", ["r1"]), question("q2", ["r1", "r3"])];
    const report = computeCoverage(requirements, questions);
    expect(report.uncovered_requirement_ids).toEqual(["r2"]);
    expect(report.uncovered_must_requirement_ids).toEqual(["r2"]);
    expect(report.coverage_map).toEqual({ r1: ["q1", "q2"], r2: [], r3: ["q2"] });
  });

  it("separates must from nice gaps", () => {
    const requirements = [requirement("r1", "must"), requirement("r2", "nice")];
    const report = computeCoverage(requirements, []);
    expect(report.uncovered_requirement_ids).toEqual(["r1", "r2"]);
    expect(report.uncovered_must_requirement_ids).toEqual(["r1"]);
    expect(report.must_total).toBe(1);
    expect(report.must_covered_count).toBe(0);
  });

  it("is empty when everything is covered", () => {
    const requirements = [requirement("r1"), requirement("r2", "nice", "behavioural")];
    const questions = [question("q1", ["r1"]), question("q2", ["r2"])];
    const report = computeCoverage(requirements, questions);
    expect(report.uncovered_requirement_ids).toEqual([]);
    expect(report.uncovered_must_requirement_ids).toEqual([]);
    expect(report.covered_count).toBe(2);
  });

  it("ignores questions referencing unknown requirement ids for those ids but never crashes", () => {
    const requirements = [requirement("r1")];
    const questions = [question("q1", ["r1", "rX"])];
    const report = computeCoverage(requirements, questions);
    expect(report.uncovered_requirement_ids).toEqual([]);
    expect(report.coverage_map["r1"]).toEqual(["q1"]);
  });

  it("deduplicates question ids per requirement", () => {
    const requirements = [requirement("r1")];
    const questions = [question("q1", ["r1", "r1"])];
    const report = computeCoverage(requirements, questions);
    expect(report.coverage_map["r1"]).toEqual(["q1"]);
  });

  it("handles empty kits (thin descriptions)", () => {
    const report = computeCoverage([], []);
    expect(report.total_requirements).toBe(0);
    expect(report.uncovered_requirement_ids).toEqual([]);
  });
});

describe("kitCoverage / allMustRequirementsCovered", () => {
  const kit = {
    role: { title: "", seniority: "", responsibilities: [], requirements: [requirement("r1"), requirement("r2", "nice")] },
    questions: [question("q1", ["r1"])],
  } as any;

  it("reads coverage straight off a kit", () => {
    expect(kitCoverage(kit).uncovered_requirement_ids).toEqual(["r2"]);
    expect(allMustRequirementsCovered(kit)).toBe(true);
  });

  it("fails when a must-have is uncovered", () => {
    const broken = { ...kit, questions: [] } as any;
    expect(allMustRequirementsCovered(broken)).toBe(false);
  });
});
