import { describe, it, expect } from "vitest";
import { allocateSchedule, scheduleProblems, describeFocus } from "./schedule";
import { MINUTES_BY_DIFFICULTY } from "./types";
import type { Question, Requirement } from "./types";

const req = (id: string, priority: "must" | "nice" = "must"): Requirement => ({
  id,
  text: `Requirement ${id}`,
  kind: "technical",
  priority,
});

const q = (id: string, difficulty: number, reqIds: string[]): Question => ({
  id,
  requirement_ids: reqIds,
  category: "technical",
  prompt: `Question ${id}`,
  answer_outline: "outline",
  difficulty,
  origin: "generated",
  edited: false,
  pinned: false,
});

describe("allocateSchedule", () => {
  const requirements = [req("r1"), req("r2"), req("r3"), req("r4", "nice")];
  const questions = [
    q("q1", 3, ["r1"]),
    q("q2", 1, ["r2"]),
    q("q3", 2, ["r3"]),
    q("q4", 3, ["r4"]),
    q("q5", 2, ["r1"]),
    q("q6", 1, ["r2"]),
  ];

  it("creates exactly the requested number of days, numbered 1..n", () => {
    for (const days of [1, 2, 3, 5, 7, 30, 60]) {
      const schedule = allocateSchedule(questions, requirements, days);
      expect(schedule.days_available).toBe(days);
      expect(schedule.days.length).toBe(days);
      expect(schedule.days.map((d) => d.day)).toEqual(
        Array.from({ length: days }, (_, i) => i + 1)
      );
    }
  });

  it("allocates every question exactly once", () => {
    const schedule = allocateSchedule(questions, requirements, 4);
    const ids = schedule.days.flatMap((d) => d.question_ids);
    expect(ids.sort()).toEqual(questions.map((x) => x.id).sort());
    expect(new Set(ids).size).toBe(questions.length);
  });

  it("uses integer minutes derived from difficulty", () => {
    const schedule = allocateSchedule(questions, requirements, 2);
    for (const day of schedule.days) {
      expect(Number.isInteger(day.minutes)).toBe(true);
      const expected = day.question_ids.reduce((sum, id) => {
        const question = questions.find((x) => x.id === id)!;
        return sum + MINUTES_BY_DIFFICULTY[question.difficulty];
      }, 0);
      expect(day.minutes).toBe(expected);
    }
  });

  it("puts harder and higher-priority material earlier", () => {
    const schedule = allocateSchedule(questions, requirements, 3);
    // q1 (difficulty 3, must requirement) should land on day 1.
    expect(schedule.days[0].question_ids).toContain("q1");
    // The mean difficulty of day 1 >= day 2 >= ... roughly: no easy-only day
    // before a day that still holds a difficulty-3 must question.
    const firstDayIds = schedule.days[0].question_ids;
    const firstDayWeight = firstDayIds.reduce(
      (s, id) => s + questions.find((x) => x.id === id)!.difficulty,
      0
    );
    const lastDayWeight = schedule.days[schedule.days.length - 1].question_ids.reduce(
      (s, id) => s + questions.find((x) => x.id === id)!.difficulty,
      0
    );
    expect(firstDayWeight).toBeGreaterThanOrEqual(lastDayWeight);
  });

  it("keeps daily load balanced when there are many more days than questions", () => {
    const schedule = allocateSchedule(questions, requirements, 60);
    const loads = schedule.days.map((d) => d.question_ids.length);
    expect(Math.max(...loads)).toBeLessThanOrEqual(1);
    expect(loads.filter((l) => l === 1).length).toBe(questions.length);
    // Empty buffer days are labelled honestly, not fabricated.
    const emptyDay = schedule.days.find((d) => d.question_ids.length === 0)!;
    expect(emptyDay.focus).toMatch(/Consolidation/);
    expect(emptyDay.minutes).toBe(0);
  });

  it("rejects invalid day counts", () => {
    expect(() => allocateSchedule(questions, requirements, 0)).toThrow(RangeError);
    expect(() => allocateSchedule(questions, requirements, 61)).toThrow(RangeError);
    expect(() => allocateSchedule(questions, requirements, 2.5)).toThrow(RangeError);
  });

  it("handles one question over one day", () => {
    const schedule = allocateSchedule([q("q1", 2, ["r1"])], [req("r1")], 1);
    expect(schedule.days[0].question_ids).toEqual(["q1"]);
    expect(schedule.days[0].minutes).toBe(30);
    expect(describeFocus([q("q1", 2, ["r1"])], true)).toContain("technical");
  });

  it("is deterministic across runs", () => {
    const a = allocateSchedule(questions, requirements, 3);
    const b = allocateSchedule(questions, requirements, 3);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("passes its own invariant check", () => {
    const schedule = allocateSchedule(questions, requirements, 3);
    expect(scheduleProblems(schedule, questions, requirements)).toEqual([]);
  });

  it("reports problems when a must requirement is missing from the schedule", () => {
    const schedule = allocateSchedule(questions, requirements, 3);
    // r1 (must) is covered by q1 and q5 — remove both to uncover it.
    schedule.days.forEach((d) => {
      d.question_ids = d.question_ids.filter((id) => id !== "q1" && id !== "q5");
    });
    const problems = scheduleProblems(schedule, questions, requirements);
    expect(problems.some((p) => p.includes("not in the schedule"))).toBe(true);
    expect(problems.some((p) => p.includes("must-have requirement r1"))).toBe(true);
  });

  it("reports unknown question references", () => {
    const schedule = allocateSchedule(questions, requirements, 3);
    schedule.days[1].question_ids.push("q999");
    const problems = scheduleProblems(schedule, questions, requirements);
    expect(problems.some((p) => p.includes("unknown question q999"))).toBe(true);
  });
});
