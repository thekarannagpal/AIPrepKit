import { describe, it, expect } from "vitest";
import { validateKit, repairKit, validateOrRepair } from "./validate";
import { allocateSchedule } from "./schedule";
import { computeCoverage } from "./coverage";
import type { Kit, Question, Requirement } from "./types";

function makeKit(): Kit {
  const requirements: Requirement[] = [
    { id: "r1", text: "5+ years with React", kind: "technical", priority: "must" },
    { id: "r2", text: "Mentoring experience", kind: "behavioural", priority: "nice" },
  ];
  const questions: Question[] = [
    {
      id: "q1",
      requirement_ids: ["r1"],
      category: "technical",
      prompt: "Walk through a React performance problem you solved.",
      answer_outline: "- profiling\n- memoisation",
      difficulty: 2,
      origin: "generated",
      edited: false,
      pinned: false,
    },
  ];
  const schedule = allocateSchedule(questions, requirements, 3);
  const coverage = computeCoverage(requirements, questions);
  return {
    source: {
      company: "Acme",
      company_url: "https://acme.test",
      role: "Frontend Engineer",
      location: "Remote",
      jd_chars: 1200,
      researched_at: new Date().toISOString(),
      pages_used: ["https://acme.test/careers"],
      research_log: [],
    },
    company_brief: { summary: "Acme builds things.", what_they_do: "Things.", sources: [] },
    role: { title: "Frontend Engineer", seniority: "mid", responsibilities: ["Build UI"], requirements },
    questions,
    flashcards: [
      { id: "f1", front: "What is hydration?", back: "Attaching JS to server HTML.", requirement_ids: ["r1"], origin: "generated", edited: false, pinned: false },
    ],
    schedule,
    coverage: {
      uncovered_requirement_ids: coverage.uncovered_requirement_ids,
      uncovered_must_requirement_ids: coverage.uncovered_must_requirement_ids,
      passes: 2,
    },
    notes: [],
  };
}

describe("validateKit", () => {
  it("accepts a well-formed kit", () => {
    const result = validateKit(makeKit());
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects a kit missing a required Appendix A field", () => {
    const kit: any = makeKit();
    delete kit.schedule;
    const result = validateKit(kit);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("schedule"))).toBe(true);
  });

  it("rejects a question referencing an unknown requirement", () => {
    const kit: any = makeKit();
    kit.questions[0].requirement_ids = ["r99"];
    expect(validateKit(kit).ok).toBe(false);
  });

  it("rejects duplicate question ids", () => {
    const kit: any = makeKit();
    kit.questions.push({ ...kit.questions[0] });
    kit.schedule.days[0].question_ids.push("q1");
    kit.schedule.days[0].minutes += 30;
    expect(validateKit(kit).ok).toBe(false);
  });

  it("rejects non-integer minutes", () => {
    const kit: any = makeKit();
    kit.schedule.days[0].minutes = 30.5;
    expect(validateKit(kit).ok).toBe(false);
  });

  it("rejects difficulty outside 1..3", () => {
    const kit: any = makeKit();
    kit.questions[0].difficulty = 4;
    expect(validateKit(kit).ok).toBe(false);
  });

  it("rejects a schedule whose day count does not match days_available", () => {
    const kit: any = makeKit();
    kit.schedule.days_available = 5; // schedule was built for 3
    expect(validateKit(kit).ok).toBe(false);
  });

  it("rejects stale coverage bookkeeping", () => {
    const kit: any = makeKit();
    kit.questions = []; // r1 now uncovered but coverage not updated
    expect(validateKit(kit).ok).toBe(false);
  });

  it("rejects invalid enums", () => {
    const kit: any = makeKit();
    kit.questions[0].category = "random";
    expect(validateKit(kit).ok).toBe(false);
  });
});

describe("repairKit", () => {
  it("clamps difficulty and coerces category", () => {
    const kit: any = makeKit();
    kit.questions[0].difficulty = 9;
    kit.questions[0].category = "weird";
    const result = repairKit(kit);
    expect(result.ok).toBe(true);
    expect(result.kit!.questions[0].difficulty).toBe(3);
    expect(result.kit!.questions[0].category).toBe("technical");
    expect(result.repairs.length).toBeGreaterThan(0);
    expect(validateKit(result.kit).ok).toBe(true);
  });

  it("drops dangling requirement references and recomputes coverage", () => {
    const kit: any = makeKit();
    kit.questions[0].requirement_ids = ["r1", "rGhost"];
    const result = repairKit(kit);
    expect(result.ok).toBe(true);
    expect(result.kit!.questions[0].requirement_ids).toEqual(["r1"]);
    // r2 is a nice-to-have with no question; coverage must say so honestly.
    expect(result.kit!.coverage.uncovered_requirement_ids).toEqual(["r2"]);
    expect(result.kit!.coverage.uncovered_must_requirement_ids).toEqual([]);
  });

  it("resizes a schedule to the requested day count", () => {
    const kit: any = makeKit();
    kit.schedule.days_available = 5;
    const result = repairKit(kit);
    expect(result.ok).toBe(true);
    expect(result.kit!.schedule.days.length).toBe(5);
    expect(result.kit!.schedule.days.map((d: any) => d.day)).toEqual([1, 2, 3, 4, 5]);
  });

  it("re-inserts questions missing from the schedule", () => {
    const kit: any = makeKit();
    kit.schedule.days.forEach((d: any) => (d.question_ids = []));
    const result = repairKit(kit);
    expect(result.ok).toBe(true);
    expect(result.kit!.schedule.days[0].question_ids).toContain("q1");
  });

  it("keeps user-authored state (origin/edited/pinned)", () => {
    const kit: any = makeKit();
    kit.questions[0].origin = "user";
    kit.questions[0].edited = true;
    kit.questions[0].pinned = true;
    const result = repairKit(kit);
    expect(result.kit!.questions[0].origin).toBe("user");
    expect(result.kit!.questions[0].edited).toBe(true);
    expect(result.kit!.questions[0].pinned).toBe(true);
  });

  it("infers priority from bonus-style wording when missing", () => {
    const kit: any = makeKit();
    kit.role.requirements[0].priority = undefined;
    kit.role.requirements[0].text = "Bonus points for GraphQL experience";
    const result = repairKit(kit);
    expect(result.ok).toBe(true);
    const r1 = result.kit!.role.requirements.find((r) => r.text.includes("Bonus"))!;
    expect(r1.priority).toBe("nice");
  });

  it("fails on non-objects", () => {
    expect(repairKit(null).ok).toBe(false);
    expect(repairKit("nope").ok).toBe(false);
  });
});

describe("validateOrRepair", () => {
  it("returns the direct result for valid kits", () => {
    expect(validateOrRepair(makeKit()).ok).toBe(true);
  });
  it("repairs repairable kits", () => {
    const kit: any = makeKit();
    kit.questions[0].difficulty = 99;
    const result = validateOrRepair(kit);
    expect(result.ok).toBe(true);
    expect(result.kit!.questions[0].difficulty).toBe(3);
  });
});
