import {
  MINUTES_BY_DIFFICULTY,
  MIN_DAYS,
  MAX_DAYS,
  type Question,
  type Requirement,
  type Schedule,
  type ScheduleDay,
} from "./types";

export interface ScheduleOptions {
  /** Minimum minutes a buffer day (no questions left) gets. 0 = honest empty day. */
  bufferDayMinutes?: number;
}

/**
 * Deterministic schedule allocation (brief §8) — arithmetic and allocation in
 * code, never in a prompt.
 *
 * Rules enforced:
 *  - exactly `days` day entries, numbered 1..days
 *  - every question is allocated to exactly one day
 *  - every must-have requirement appears in the schedule (its questions do)
 *  - harder, higher-priority material lands on earlier days
 *  - every day's `minutes` is the integer sum of its questions' minutes
 *
 * Algorithm: score each question (difficulty x priority weight), sort
 * descending, then deal the questions round-robin across the days. Dealing in
 * score order puts the heaviest item on day 1 while round-robin keeps daily
 * load balanced — both properties hold simultaneously.
 */
export function allocateSchedule(
  questions: Question[],
  requirements: Requirement[],
  days: number,
  _options: ScheduleOptions = {}
): Schedule {
  if (!Number.isInteger(days) || days < MIN_DAYS || days > MAX_DAYS) {
    throw new RangeError(`days must be an integer between ${MIN_DAYS} and ${MAX_DAYS}, got ${days}`);
  }

  const priorityByReq = new Map(requirements.map((r) => [r.id, r.priority]));

  const weight = (q: Question): number => {
    const anyMust = q.requirement_ids.some((rid) => priorityByReq.get(rid) === "must");
    return q.difficulty * (anyMust ? 2 : 1);
  };

  // Stable ordering: score desc, then existing order — deterministic output.
  const ordered = questions
    .map((q, index) => ({ q, index }))
    .sort((a, b) => weight(b.q) - weight(a.q) || a.index - b.index);

  const slots: Question[][] = Array.from({ length: days }, () => []);
  ordered.forEach(({ q }, i) => {
    slots[i % days].push(q);
  });

  const days_out: ScheduleDay[] = slots.map((dayQuestions, i) => ({
    day: i + 1,
    focus: describeFocus(dayQuestions, i === 0),
    question_ids: dayQuestions.map((q) => q.id),
    minutes: dayQuestions.reduce(
      (sum, q) => sum + (MINUTES_BY_DIFFICULTY[q.difficulty] ?? 30),
      0
    ),
  }));

  return { days_available: days, days: days_out };
}

/**
 * Human-readable focus line built deterministically from what the day
 * actually contains. Days past the material say so honestly instead of
 * inventing work.
 */
export function describeFocus(questions: Question[], isFirstDay: boolean): string {
  if (questions.length === 0) {
    return "Consolidation — revisit flashcards and any day that felt weak; no new questions allocated.";
  }
  const counts = new Map<string, number>();
  for (const q of questions) counts.set(q.category, (counts.get(q.category) ?? 0) + 1);
  const parts = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([cat, n]) => `${n} ${cat}`);
  const minutes = questions.reduce((s, q) => s + (MINUTES_BY_DIFFICULTY[q.difficulty] ?? 30), 0);
  const head = isFirstDay ? "Start strong:" : "Continue:";
  return `${head} ${parts.join(", ")} — ${questions.length} question${questions.length === 1 ? "" : "s"}, ~${minutes} min.`;
}

/**
 * Post-allocation invariant check. Used by the validator and the tests so a
 * schedule that violates the brief's rules can never be saved silently.
 */
export function scheduleProblems(
  schedule: Schedule,
  questions: Question[],
  requirements: Requirement[]
): string[] {
  const problems: string[] = [];
  if (schedule.days.length !== schedule.days_available) {
    problems.push(
      `schedule has ${schedule.days.length} day entries but days_available is ${schedule.days_available}`
    );
  }
  const dayNumbers = schedule.days.map((d) => d.day);
  for (let i = 0; i < schedule.days_available; i++) {
    if (dayNumbers[i] !== i + 1) {
      problems.push(`day numbering broken at index ${i}: expected ${i + 1}, got ${dayNumbers[i]}`);
      break;
    }
  }

  const known = new Set(questions.map((q) => q.id));
  const seen = new Set<string>();
  for (const day of schedule.days) {
    if (!Number.isInteger(day.minutes) || day.minutes < 0) {
      problems.push(`day ${day.day} has non-integer minutes: ${day.minutes}`);
    }
    for (const qid of day.question_ids) {
      if (!known.has(qid)) problems.push(`day ${day.day} references unknown question ${qid}`);
      if (seen.has(qid)) problems.push(`question ${qid} appears in more than one day`);
      seen.add(qid);
    }
  }

  for (const q of questions) {
    if (!seen.has(q.id)) problems.push(`question ${q.id} is not in the schedule`);
  }

  // Every must-have requirement must appear via its questions.
  const scheduledQs = questions.filter((q) => seen.has(q.id));
  const covered = new Set(scheduledQs.flatMap((q) => q.requirement_ids));
  for (const req of requirements) {
    if (req.priority === "must" && !covered.has(req.id)) {
      problems.push(`must-have requirement ${req.id} does not appear in the schedule`);
    }
  }

  return problems;
}
