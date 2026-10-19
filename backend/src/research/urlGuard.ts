import dns from "dns/promises";
import net from "net";
import { AppError } from "../lib/errors";
import { env } from "../config";

/**
 * URL validation before any fetch (brief §11).
 *
 * Rules:
 *  - only http/https
 *  - no embedded credentials
 *  - when private hosts are refused (production), the resolved address must
 *    be public — this is the SSRF guard, and it re-checks after DNS
 *    resolution rather than trusting the hostname's appearance.
 */
export interface GuardedUrl {
  href: string;
  hostname: string;
  isPrivate: boolean;
}

const PRIVATE_V4 = [
  /^0\./,
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^198\.1[89]\./,
];

export function isPrivateAddress(addr: string): boolean {
  const v = net.isIP(addr);
  if (v === 4) return PRIVATE_V4.some((re) => re.test(addr));
  if (v === 6) {
    const lower = addr.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("fe80") || lower.startsWith("fc") || lower.startsWith("fd")) return true;
    // IPv4-mapped
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return false;
  }
  return false;
}

export async function guardUrl(raw: string): Promise<GuardedUrl> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AppError("INVALID_URL", `"${raw}" is not a valid URL.`, 400);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new AppError("INVALID_URL", `Only http/https URLs are fetchable, got ${url.protocol}`, 400);
  }
  if (url.username || url.password) {
    throw new AppError("INVALID_URL", "URLs with embedded credentials are refused.", 400);
  }
  const hostname = url.hostname.toLowerCase();
  const loopback = hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "0.0.0.0";
  const literalPrivate = net.isIP(hostname) ? isPrivateAddress(hostname) : false;

  if (!env.crawl.allowPrivateHosts && (loopback || literalPrivate)) {
    throw new AppError("INVALID_URL", "Private and loopback addresses are refused.", 400);
  }

  let isPrivate = loopback || literalPrivate;
  if (!net.isIP(hostname)) {
    try {
      const records = await dns.lookup(hostname, { all: true });
      isPrivate = records.some((r) => isPrivateAddress(r.address));
      if (!env.crawl.allowPrivateHosts && isPrivate) {
        throw new AppError(
          "INVALID_URL",
          `"${hostname}" resolves to a private address and is refused.`,
          400
        );
      }
    } catch (err) {
      if (err instanceof AppError) throw err;
      // Unresolvable host: let the fetcher surface a clearer unreachable error.
      isPrivate = false;
    }
  }

  return { href: url.href, hostname, isPrivate };
}

/** Resolve a possibly-relative link against a base URL. Exported for tests. */
export function resolveLink(href: string, base: string): string | null {
  try {
    const url = new URL(href, base);
    // Only web links are ever crawlable; javascript:/mailto:/data: etc. are
    // rejected here so no caller can accidentally fetch them.
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}
