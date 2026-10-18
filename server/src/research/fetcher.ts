import { AppError } from "../lib/errors";
import { log } from "../lib/logger";
import { env } from "../config";
import { sleep, backoffDelay } from "../llm/resilience";
import { guardUrl } from "./urlGuard";

export interface FetchResult {
  url: string;
  status: number;
  contentType: string;
  body: string;
  /** Set when the fetch failed — callers record it and move on. */
  error?: string;
}

const ALLOWED_CONTENT = [/^text\/html/, /^application\/xhtml\+xml/, /^text\/plain/];

/**
 * Rate-limited, size-capped, content-type-restricted fetch with backoff.
 * Per-host politeness lives in the host queues; transient 429/503 get
 * exponential backoff, everything else returns an error FetchResult so the
 * crawler can log "skipped" instead of dying.
 */
export class Fetcher {
  private lastRequestAt = new Map<string, number>();

  async fetch(url: string, opts: { asHtml?: boolean } = {}): Promise<FetchResult> {
    let guarded;
    try {
      guarded = await guardUrl(url);
    } catch (err) {
      return { url, status: 0, contentType: "", body: "", error: describe(err) };
    }

    for (let attempt = 0; attempt <= 3; attempt++) {
      await this.pace(guarded.hostname);
      try {
        const res = await fetch(guarded.href, {
          headers: {
            "user-agent": env.crawl.userAgent,
            accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1",
          },
          redirect: "follow",
          signal: AbortSignal.timeout(env.crawl.fetchTimeoutMs),
        });

        if (res.status === 429 || res.status === 503) {
          if (attempt === 3) {
            return { url: guarded.href, status: res.status, contentType: "", body: "", error: `HTTP ${res.status} after retries` };
          }
          const delay = backoffDelay(attempt, Number(res.headers.get("retry-after")) * 1000 || undefined);
          log.warn("fetch backoff", { url: guarded.href, status: res.status, delayMs: delay });
          await sleep(delay);
          continue;
        }

        const contentType = res.headers.get("content-type") ?? "";
        if (!res.ok) {
          return { url: guarded.href, status: res.status, contentType, body: "", error: `HTTP ${res.status}` };
        }
        if (!ALLOWED_CONTENT.some((re) => re.test(contentType))) {
          return {
            url: guarded.href,
            status: res.status,
            contentType,
            body: "",
            error: `skipped: unsupported content type ${contentType.split(";")[0] || "(none)"}`,
          };
        }

        const body = await readCapped(res, env.crawl.fetchMaxBytes);
        return { url: guarded.href, status: res.status, contentType, body };
      } catch (err) {
        // Connection-level failures (refused, DNS, TLS) will not resolve by
        // retrying moments later — fail fast so an unreachable host costs
        // seconds, not a backoff ladder. Timeouts and resets still get retries.
        if (attempt === 3 || !isTransientNetworkError(err)) {
          return { url: guarded.href, status: 0, contentType: "", body: "", error: describe(err) };
        }
        await sleep(backoffDelay(attempt));
      }
    }
    return { url: guarded.href, status: 0, contentType: "", body: "", error: "unreachable" };
  }

  /** Minimum interval between requests to the same host. */
  private async pace(hostname: string): Promise<void> {
    const last = this.lastRequestAt.get(hostname) ?? 0;
    const wait = last + env.crawl.minIntervalMs - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastRequestAt.set(hostname, Date.now());
  }
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    chunks.push(value);
    if (total >= maxBytes) {
      await reader.cancel().catch(() => {});
      break;
    }
  }
  const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  return buf.toString("utf-8").slice(0, maxBytes);
}

/** Errors that are worth retrying; everything else fails fast. */
function isTransientNetworkError(err: unknown): boolean {
  if (err instanceof Error) {
    if (err.name === "TimeoutError" || err.name === "AbortError") return true;
    const code = (err as NodeJS.ErrnoException & { cause?: { code?: string } }).cause?.code ?? (err as NodeJS.ErrnoException).code;
    if (code && ["ECONNRESET", "ETIMEDOUT", "ECONNABORTED", "EAI_AGAIN", "UND_ERR_SOCKET"].includes(code)) {
      return true;
    }
    return false;
  }
  return false;
}

function describe(err: unknown): string {
  if (err instanceof AppError) return err.message;
  if (err instanceof Error) {
    if (err.name === "TimeoutError" || err.name === "AbortError") return "timed out";
    return err.message.slice(0, 200);
  }
  return String(err);
}
