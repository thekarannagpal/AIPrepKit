import { repairJson } from "../lib/jsonRepair";
import type { LlmProvider, LlmRequest } from "./provider";

/**
 * Deterministic mock provider. Powers the automated tests and lets the whole
 * pipeline (including the batch command) run with no API key at all:
 *   LLM_PROVIDER=mock npm run evaluate -- --input cases.json --output kits.json
 *
 * It recognises the pipeline's step markers embedded in prompts and answers
 * with schema-valid JSON, pulling ids out of the prompt so coverage actually
 * links up. This is not a stand-in for real quality — it exists so behaviour,
 * sequencing, rate-limit handling and output shape can be tested hermetically.
 */
export class MockProvider implements LlmProvider {
  readonly name = "mock";
  readonly model = "mock-1";

  /** Lets tests assert retry behaviour by failing the first N calls. */
  public failNextCalls = 0;
  public callCount = 0;

  async complete(req: LlmRequest): Promise<string> {
    this.callCount++;
    if (this.failNextCalls > 0) {
      this.failNextCalls--;
      const { AppError } = await import("../lib/errors");
      throw new AppError("LLM_RATE_LIMITED", "mock induced 429", 429, { retryAfterMs: 10 });
    }
    const prompt = req.messages.map((m) => m.text).join("\n");
    const step = prompt.match(/\[\[STEP:([a-z_]+)\]\]/)?.[1] ?? "unknown";

    switch (step) {
      case "extract_requirements":
        return mockExtraction(prompt);
      case "company_brief":
        return JSON.stringify({
          summary: "MockCo builds developer tooling used by thousands of teams.",
          what_they_do: "MockCo sells a hosted platform for release automation.",
        });
      case "interview_intel":
        return JSON.stringify({
          process_summary:
            "Public discussion describes a phone screen, a technical interview and a values conversation.",
          stages: ["phone screen", "technical interview", "values conversation"],
          formats: ["coding", "system design", "behavioural"],
        });
      case "questions_technical":
      case "questions_behavioural":
      case "questions_system_design":
      case "questions_company_fit":
      case "questions_gap_fill":
        return mockQuestions(prompt, step);
      case "flashcards":
        return mockFlashcards(prompt);
      case "overlap":
        return JSON.stringify({ pairs: [] });
      default:
        return JSON.stringify({ ok: true });
    }
  }
}

function reqIdsIn(prompt: string): string[] {
  const matches = [...prompt.matchAll(/"id":\s*"(r\d+)"/g)].map((m) => m[1]);
  return [...new Set(matches)];
}

function mockExtraction(prompt: string): string {
  // A deliberately thin description must yield a thin kit — mirror reality.
  const jd = prompt.replace(/^[\s\S]*?<document[^>]*>/, "").replace(/<\/document>[\s\S]*$/, "");
  const lines = jd
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const requirements: { text: string; kind: string; priority: string }[] = [];
  for (const line of lines) {
    const m = line.match(/^[-•*]\s*(.+)$/) || line.match(/^([A-Z].{15,})$/);
    if (!m) continue;
    const text = m[1].trim();
    const kind = /react|node|python|javascript|typescript|java\b|sql|aws|docker|kubernetes|api|test|code|engineer|develop|architect|cloud|data\b/i.test(
      text
    )
      ? "technical"
      : /communicat|mentor|stakeholder|collaborat|lead|team|culture|values/i.test(text)
        ? "behavioural"
        : "domain";
    const priority = /bonus|nice to have|preferred|plus\b|desirable|optional/i.test(text)
      ? "nice"
      : "must";
    requirements.push({ text, kind, priority });
    if (requirements.length >= 8) break;
  }
  if (requirements.length === 0 && lines.length > 0) {
    requirements.push({ text: lines[0].slice(0, 120), kind: "technical", priority: "must" });
  }
  const titleLine = lines[0] ?? "Unknown role";
  return JSON.stringify({
    company: "MockCo",
    role: titleLine.slice(0, 80),
    location: /remote/i.test(jd) ? "Remote" : "",
    seniority: /senior|sr\./i.test(jd) ? "senior" : /junior|grad/i.test(jd) ? "junior" : "mid",
    responsibilities: lines.filter((l) => /you will|responsib|own|build|ship/i.test(l)).slice(0, 5),
    requirements,
  });
}

function mockQuestions(prompt: string, step: string): string {
  const ids = reqIdsIn(prompt);
  const category = step.replace("questions_", "").replace("_", "-");
  const questions = ids.slice(0, 6).map((rid, i) => ({
    requirement_ids: [rid],
    category: step === "questions_gap_fill" ? guessCategory(prompt) : category,
    prompt: `Mock question ${i + 1} for ${rid} (${step}): explain your experience with concrete examples.`,
    answer_outline: "- point one\n- point two\n- point three",
    difficulty: ((i % 3) + 1) as number,
  }));
  return JSON.stringify({ questions });
}

function guessCategory(prompt: string): string {
  const kind = prompt.match(/kind:\s*(technical|behavioural|domain)/)?.[1];
  return kind === "behavioural" ? "behavioural" : kind === "domain" ? "company-fit" : "technical";
}

function mockFlashcards(prompt: string): string {
  const ids = reqIdsIn(prompt);
  const cards = ids.slice(0, 6).map((rid, i) => ({
    front: `Mock card ${i + 1} (${rid})?`,
    back: `Mock answer covering ${rid}.`,
    requirement_ids: [rid],
  }));
  return JSON.stringify({ flashcards: cards });
}
