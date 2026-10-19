import { AppError } from "../lib/errors";
import { log } from "../lib/logger";
import { repairJson } from "../lib/jsonRepair";
import { env } from "../config";
import { RateLimiter, callWithRetry } from "./resilience";
import type { LlmProvider, ChatMessage } from "./provider";
import { GeminiProvider } from "./gemini";
import { OpenAiCompatProvider } from "./openai";
import { MockProvider } from "./mock";

let sharedLimiter: RateLimiter | null = null;

/** One limiter for the process — the free-tier budget is global, not per-kit. */
export function getLimiter(): RateLimiter {
  if (!sharedLimiter) sharedLimiter = new RateLimiter(env.llm.rpm);
  return sharedLimiter;
}

export function createProvider(): LlmProvider {
  switch (env.llm.provider) {
    case "mock":
      return new MockProvider();
    case "openai":
      return new OpenAiCompatProvider(
        env.llm.openaiApiKey,
        env.llm.openaiBaseUrl,
        env.llm.openaiModel
      );
    case "gemini":
    default:
      return new GeminiProvider(env.llm.geminiApiKey, env.llm.geminiModel);
  }
}

export interface LlmClientOptions {
  provider?: LlmProvider;
  maxCalls?: number;
  temperature?: number;
}

/**
 * Per-run client. Tracks the LLM call budget for one kit so a pathological
 * case cannot eat the whole batch's time; every call goes through the shared
 * rate limiter and the retry layer, so transient 429s and 5xx never kill a
 * step on the first bounce.
 */
export class LlmClient {
  private calls = 0;
  readonly provider: LlmProvider;
  private readonly maxCalls: number;
  private readonly temperature: number;

  constructor(opts: LlmClientOptions = {}) {
    this.provider = opts.provider ?? createProvider();
    this.maxCalls = opts.maxCalls ?? env.llm.maxCallsPerKit;
    this.temperature = opts.temperature ?? env.llm.temperature;
  }

  get callCount(): number {
    return this.calls;
  }
  get remainingBudget(): number {
    return Math.max(0, this.maxCalls - this.calls);
  }

  async text(messages: ChatMessage[], opts: { temperature?: number; maxTokens?: number } = {}): Promise<string> {
    return this.run(messages, false, opts);
  }

  /**
   * JSON completion with a single repair-then-retry cycle. If the model
   * returns prose or broken JSON we repair; if that fails we retry once with
   * the parse error quoted back. Never more — a model that fails twice is
   * wasting the minute budget, and the caller records an honest gap instead.
   */
  async json<T = unknown>(messages: ChatMessage[], opts: { temperature?: number; maxTokens?: number } = {}): Promise<T> {
    const first = await this.run(messages, true, opts);
    const repaired = repairJson(first);
    if (repaired !== null) return repaired as T;

    log.warn("llm returned unparseable json, retrying once");
    const second = await this.run(
      [
        ...messages,
        {
          role: "user",
          text: "Your previous reply was not valid JSON. Respond with ONLY a valid JSON object — no prose, no code fences.",
        },
      ],
      true,
      opts
    );
    const repaired2 = repairJson(second);
    if (repaired2 !== null) return repaired2 as T;
    throw new AppError(
      "LLM_INVALID_RESPONSE",
      "Model failed to return valid JSON after a retry.",
      502
    );
  }

  private async run(
    messages: ChatMessage[],
    json: boolean,
    opts: { temperature?: number; maxTokens?: number }
  ): Promise<string> {
    if (this.calls >= this.maxCalls) {
      throw new AppError(
        "LLM_BUDGET_EXCEEDED",
        `LLM call budget exhausted for this kit (${this.maxCalls} calls).`,
        502
      );
    }
    this.calls++;
    // The mock provider is offline: throttling would only slow local runs and
    // the batch evaluator, with no real API budget to protect.
    const limiter = this.provider instanceof MockProvider ? null : getLimiter();
    return callWithRetry(
      async () => {
        if (limiter) await limiter.acquire();
        return this.provider.complete({
          messages,
          json,
          temperature: opts.temperature ?? this.temperature,
          maxOutputTokens: opts.maxTokens,
        });
      },
      { maxRetries: env.llm.maxRetries }
    );
  }
}
