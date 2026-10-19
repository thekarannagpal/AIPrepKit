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
  // Prompts list requirements as "- id=r1 [technical/must] …"; the JSON
  // shape "id": "r1" is accepted too so the mock keeps working if prompts
  // change shape.
  const ids = new Set<string>();
  for (const m of prompt.matchAll(/\bid[=:]\s*"?(r\d+)"?/g)) ids.add(m[1]);
  return [...ids];
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

let mockRotation = 0;

function parseReqMap(prompt: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of prompt.matchAll(/- id=(r\d+)\s+\[([^\]]+)\]\s+([^\n\r]+)/g)) {
    map.set(m[1], m[3].trim());
  }
  return map;
}

function cleanTopic(text: string): string {
  return text
    .replace(/^(?:Must have|Should have|Strong|Experience with|Good understanding of|Proficiency in|Hands-on experience with|Knowledge of|\d+\+?\s*years(?:\s+of)?(?:\s+experience)?(?:\s+in|\s+with|\s+operating)?)\s+/i, "")
    .replace(/[.;,]+$/, "")
    .trim() || text;
}

const TECHNICAL_TEMPLATES = [
  (t: string) => `How have you designed and maintained production systems using ${t}? Describe a specific failure scenario and how you resolved it.`,
  (t: string) => `What architectural trade-offs, bottlenecks, or performance optimizations have you encountered when working with ${t}?`,
  (t: string) => `Can you explain your approach to testing, deployment, and monitoring for services dependent on ${t}?`,
  (t: string) => `Walk us through a critical bug or outage related to ${t} in your past experience. What steps did you take to prevent recurrence?`,
  (t: string) => `How do you evaluate and establish best practices and coding standards around ${t} across an engineering team?`,
];

const BEHAVIOURAL_TEMPLATES = [
  (t: string) => `Tell me about a high-stakes project involving ${t} where requirements were ambiguous. How did you navigate the trade-offs?`,
  (t: string) => `Describe a situation where you had a technical disagreement with a team member or stakeholder regarding ${t}. How was it resolved?`,
  (t: string) => `Can you share a time you had to mentor team members or bridge a knowledge gap related to ${t}?`,
  (t: string) => `Give an example of when you had to balance delivery speed versus long-term code quality while handling ${t}.`,
];

const SYSTEM_DESIGN_TEMPLATES = [
  (t: string) => `Design a high-throughput, fault-tolerant distributed system that addresses ${t}. How do you ensure low latency and high availability?`,
  (t: string) => `Walk us through your end-to-end architecture for ${t}, including data partitioning, caching strategies, and failover mechanisms.`,
  (t: string) => `How would you scale ${t} from 10,000 to 1,000,000 daily active users while keeping infrastructure costs within budget?`,
];

const COMPANY_FIT_TEMPLATES = [
  (t: string) => `How does your background with ${t} prepare you to make an immediate impact on our platform and team culture?`,
  (t: string) => `What key technical decisions or trends in ${t} excite you most, and how do you see them benefiting our product vision?`,
  (t: string) => `How do you stay current with evolving tools and methodologies in ${t}, and how do you introduce them responsibly to your team?`,
];

const OUTLINES = [
  "- Clarify system requirements, scale, and constraints\n- Architectural overview and key component breakdown\n- In-depth trade-off analysis (consistency vs. latency, operational overhead)\n- Failure recovery, observability, and testing approach",
  "- Situation: describe context, role, and problem complexity\n- Action: explain technical decisions made and leadership demonstrated\n- Result: quantify impact, performance improvements, and retrospective takeaways",
  "- Foundational concepts and core mechanics\n- Real-world production pitfalls and antipatterns to avoid\n- Concrete debugging and monitoring techniques",
  "- Design alternatives considered\n- Performance profiling and capacity planning\n- Continuous integration and rollout strategy",
];

const FLASHCARD_FRONTS = [
  (t: string) => `What are the primary operational challenges and trade-offs when scaling ${t}?`,
  (t: string) => `How do you diagnose and mitigate latency spikes or resource bottlenecks in ${t}?`,
  (t: string) => `What key metrics, alerts, and SLOs should be monitored for ${t}?`,
  (t: string) => `What are the essential fault-tolerance and failover patterns for ${t}?`,
];

const FLASHCARD_BACKS = [
  (t: string) => `Key challenges include state management, network partitions, and backpressure. Mitigate via connection pooling, horizontal scaling, and circuit breakers.`,
  (t: string) => `Analyze profiling flamegraphs, inspect query execution plans, check I/O wait times, and introduce bounded caching or read replicas.`,
  (t: string) => `Monitor RED metrics (Rate, Errors, Duration), p99 latency, queue depth, CPU/memory saturation, and error budget consumption.`,
  (t: string) => `Use health-check probes, exponential backoff retries with jitter, dead-letter queues, and graceful degradation during partial outages.`,
];

function mockQuestions(prompt: string, step: string): string {
  const ids = reqIdsIn(prompt);
  const reqMap = parseReqMap(prompt);
  const category = step.replace("questions_", "").replace("_", "-");
  mockRotation++;

  const questions = ids.slice(0, 6).map((rid, i) => {
    const rawText = reqMap.get(rid) || `requirement ${rid}`;
    const topic = cleanTopic(rawText);
    const cat = step === "questions_gap_fill" ? guessCategory(prompt) : category;

    const templates =
      cat === "behavioural"
        ? BEHAVIOURAL_TEMPLATES
        : cat === "system-design"
        ? SYSTEM_DESIGN_TEMPLATES
        : cat === "company-fit"
        ? COMPANY_FIT_TEMPLATES
        : TECHNICAL_TEMPLATES;

    const templateFn = templates[(mockRotation + i) % templates.length];
    const outline = OUTLINES[(mockRotation + i) % OUTLINES.length];

    return {
      requirement_ids: [rid],
      category: cat as any,
      prompt: templateFn(topic),
      answer_outline: outline,
      difficulty: ((i % 3) + 1) as number,
    };
  });
  return JSON.stringify({ questions });
}

function guessCategory(prompt: string): string {
  const kind = prompt.match(/kind:\s*(technical|behavioural|domain)/)?.[1];
  return kind === "behavioural" ? "behavioural" : kind === "domain" ? "company-fit" : "technical";
}

function mockFlashcards(prompt: string): string {
  const ids = reqIdsIn(prompt);
  const reqMap = parseReqMap(prompt);
  mockRotation++;

  const cards = ids.slice(0, 6).map((rid, i) => {
    const rawText = reqMap.get(rid) || `requirement ${rid}`;
    const topic = cleanTopic(rawText);
    const frontFn = FLASHCARD_FRONTS[(mockRotation + i) % FLASHCARD_FRONTS.length];
    const backFn = FLASHCARD_BACKS[(mockRotation + i) % FLASHCARD_BACKS.length];

    return {
      front: frontFn(topic),
      back: backFn(topic),
      requirement_ids: [rid],
    };
  });
  return JSON.stringify({ flashcards: cards });
}
