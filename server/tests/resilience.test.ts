import { describe, it, expect, vi } from "vitest";
import { callWithRetry, backoffDelay, isRetryable, RateLimiter } from "../src/llm/resilience";
import { AppError } from "../src/lib/errors";

describe("callWithRetry", () => {
  it("retries on rate-limit errors and eventually succeeds", async () => {
    let attempts = 0;
    const result = await callWithRetry(
      async () => {
        attempts++;
        if (attempts < 3) throw new AppError("LLM_RATE_LIMITED", "429", 429);
        return "ok";
      },
      { maxRetries: 5 }
    );
    expect(result).toBe("ok");
    expect(attempts).toBe(3);
  });

  it("retries on provider 5xx", async () => {
    let attempts = 0;
    await callWithRetry(
      async () => {
        attempts++;
        if (attempts < 2) throw new AppError("LLM_UNAVAILABLE", "503", 503);
        return "ok";
      },
      { maxRetries: 3 }
    );
    expect(attempts).toBe(2);
  });

  it("gives up after maxRetries", async () => {
    let attempts = 0;
    await expect(
      callWithRetry(
        async () => {
          attempts++;
          throw new AppError("LLM_RATE_LIMITED", "429", 429);
        },
        { maxRetries: 2 }
      )
    ).rejects.toThrow();
    expect(attempts).toBe(3); // initial + 2 retries
  });

  it("does NOT retry invalid-response errors", async () => {
    let attempts = 0;
    await expect(
      callWithRetry(
        async () => {
          attempts++;
          throw new AppError("LLM_INVALID_RESPONSE", "bad json", 502);
        },
        { maxRetries: 5 }
      )
    ).rejects.toThrow();
    expect(attempts).toBe(1);
  });

  it("honours Retry-After when provided", () => {
    const delay = backoffDelay(0, 2000);
    expect(delay).toBeGreaterThanOrEqual(2000);
    // Small fixed pad on top of the provider hint, but nowhere near exponential.
    expect(delay).toBeLessThanOrEqual(2400);
  });

  it("backoff grows exponentially and caps", () => {
    expect(backoffDelay(0)).toBeLessThanOrEqual(1500);
    expect(backoffDelay(3)).toBeGreaterThan(backoffDelay(1));
    expect(backoffDelay(10)).toBeLessThanOrEqual(31000);
  });
});

describe("isRetryable", () => {
  it("classifies correctly", () => {
    expect(isRetryable(new AppError("LLM_RATE_LIMITED", "x"))).toBe(true);
    expect(isRetryable(new AppError("LLM_UNAVAILABLE", "x"))).toBe(true);
    expect(isRetryable(new AppError("LLM_INVALID_RESPONSE", "x"))).toBe(false);
    expect(isRetryable(new Error("plain"))).toBe(false);
  });
});

describe("RateLimiter", () => {
  it("passes immediately under the limit", async () => {
    const limiter = new RateLimiter(10);
    const start = Date.now();
    await limiter.acquire();
    await limiter.acquire();
    expect(Date.now() - start).toBeLessThan(100);
  });

  it("blocks when the window is full, then frees up", async () => {
    // Short window so the test is real-time but fast.
    const limiter = new RateLimiter(2, 300);
    await limiter.acquire();
    await limiter.acquire();
    const start = Date.now();
    await limiter.acquire(); // must wait for the window to slide
    expect(Date.now() - start).toBeGreaterThanOrEqual(250);
  });
});
