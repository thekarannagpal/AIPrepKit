import { AppError } from "../lib/errors";
import { log } from "../lib/logger";

/**
 * Sliding-window rate limiter for LLM calls. Free tiers cap tokens/requests
 * per minute; the pipeline blocks politely instead of tripping 429s, and the
 * retry layer (callWithRetry) backs off when a 429 still arrives.
 */
export class RateLimiter {
  private stamps: number[] = [];

  constructor(private rpm: number) {}

  /** Resolves when a call slot is free. */
  async acquire(): Promise<void> {
    for (;;) {
      const now = Date.now();
      this.stamps = this.stamps.filter((s) => now - s < 60_000);
      if (this.stamps.length < this.rpm) {
        this.stamps.push(now);
        return;
      }
      const waitMs = this.stamps[0] + 60_000 - now + 10;
      await sleep(Math.min(Math.max(waitMs, 50), 5_000));
    }
  }

  /** Hard cap of LLM calls per kit keeps batch runs inside their time budget. */
  private callsThisRun = 0;
  countCall(): void {
    this.callsThisRun++;
  }
  get calls(): number {
    return this.callsThisRun;
  }
  resetRun(): void {
    this.callsThisRun = 0;
  }
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Exponential backoff with jitter; honours Retry-After when the provider sends one. */
export function backoffDelay(attempt: number, retryAfterMs?: number): number {
  if (retryAfterMs && retryAfterMs > 0) return Math.min(retryAfterMs + 250, 60_000);
  const base = Math.min(1000 * 2 ** attempt, 30_000);
  return base + Math.floor(Math.random() * 400);
}

export interface RetryOptions {
  maxRetries: number;
  /** Called before sleeping — lets callers log or emit progress. */
  onRetry?: (attempt: number, err: unknown, delayMs: number) => void;
}

/**
 * Retry on transient failures: provider rate limits (429) and 5xx. Bad
 * requests (400) and content refusals are NOT retried — repeating them just
 * burns the minute budget.
 */
export async function callWithRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const retryable = isRetryable(err);
      if (!retryable || attempt === opts.maxRetries) throw err;
      const delay = backoffDelay(attempt, retryAfterMs(err));
      opts.onRetry?.(attempt, err, delay);
      log.warn("llm retry", { attempt: attempt + 1, delayMs: delay, reason: describe(err) });
      await sleep(delay);
    }
  }
  throw lastErr;
}

export function isRetryable(err: unknown): boolean {
  if (err instanceof AppError) {
    return err.code === "LLM_RATE_LIMITED" || err.code === "LLM_UNAVAILABLE";
  }
  return false;
}

function retryAfterMs(err: unknown): number | undefined {
  if (err instanceof AppError && err.details && typeof err.details === "object") {
    const d = err.details as { retryAfterMs?: number };
    if (typeof d.retryAfterMs === "number") return d.retryAfterMs;
  }
  return undefined;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
