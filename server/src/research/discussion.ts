import { log } from "../lib/logger";
import { Fetcher } from "./fetcher";
import { extractPage } from "./html";
import type { ResearchLogEntry } from "@aiprepkit/core";

export interface DiscussionSource {
  url: string;
  title: string;
  snippet: string;
}

/**
 * Look for public discussion of the company's interview process (brief §2).
 *
 * Sources, in order of preference:
 *  1. Reddit search JSON (keyless, public)
 *  2. DuckDuckGo HTML search for the company's interview process
 *  3. Direct guesses at community hubs (r/<company>)
 *
 * All of it is best-effort: any failure is recorded in the research log and
 * the kit says "no public discussion found" rather than inventing one.
 */
export async function findPublicDiscussion(
  companyName: string,
  companyUrl: string,
  fetcher: Fetcher
): Promise<{ sources: DiscussionSource[]; log: ResearchLogEntry[] }> {
  const sources: DiscussionSource[] = [];
  const researchLog: ResearchLogEntry[] = [];
  const name = companyName.trim();
  if (!name) {
    researchLog.push({ url: "(search)", status: "skipped", note: "no company name to search for" });
    return { sources, log: researchLog };
  }

  // --- 1. Reddit ------------------------------------------------------------
  const redditQuery = encodeURIComponent(`${name} interview`);
  const redditUrls = [
    `https://www.reddit.com/search.json?q=${redditQuery}&limit=8&sort=relevance`,
    `https://old.reddit.com/search.json?q=${redditQuery}&limit=8&sort=relevance`,
  ];
  for (const url of redditUrls) {
    const res = await fetcher.fetch(url);
    if (res.error || !res.body) {
      researchLog.push({ url, status: "skipped", note: res.error ?? "empty response" });
      continue;
    }
    try {
      const data = JSON.parse(res.body) as {
        data?: { children?: { data?: Record<string, unknown> }[] };
      };
      const children = data.data?.children ?? [];
      for (const child of children) {
        const d = child.data ?? {};
        const title = String(d.title ?? "");
        const selftext = String(d.selftext ?? "").slice(0, 500);
        const permalink = String(d.permalink ?? "");
        const sub = String(d.subreddit ?? "");
        if (!/interview|hiring|process|onsite|offer/i.test(title + selftext)) continue;
        sources.push({
          url: permalink.startsWith("http") ? permalink : `https://www.reddit.com${permalink}`,
          title: `${title} (r/${sub})`,
          snippet: selftext.replace(/\s+/g, " ").trim(),
        });
      }
      researchLog.push({ url, status: "fetched", note: `${children.length} reddit results, ${sources.length} interview-relevant` });
      if (sources.length > 0) break;
    } catch {
      researchLog.push({ url, status: "skipped", note: "reddit returned unparseable JSON" });
    }
  }

  // --- 2. DuckDuckGo HTML ---------------------------------------------------
  const ddgQuery = encodeURIComponent(`"${name}" interview process hiring`);
  for (const base of ["https://html.duckduckgo.com/html/", "https://lite.duckduckgo.com/lite/"]) {
    const res = await fetcher.fetch(`${base}?q=${ddgQuery}`);
    if (res.error || !res.body) {
      researchLog.push({ url: `${base}?q=…`, status: "skipped", note: res.error ?? "empty response" });
      continue;
    }
    const found = parseSearchResults(res.body, res.url);
    const fresh = found.filter((f) => !sources.some((s) => s.url === f.url)).slice(0, 6);
    sources.push(...fresh);
    researchLog.push({ url: `${base}?q=…`, status: "fetched", note: `${fresh.length} web results` });
    if (fresh.length > 0) break;
  }

  // --- 3. Fetch the most promising discussion pages for actual content ------
  const enriched: DiscussionSource[] = [];
  for (const src of sources.slice(0, 3)) {
    const res = await fetcher.fetch(src.url);
    if (res.error || !res.body) {
      researchLog.push({ url: src.url, status: "skipped", note: res.error ?? "empty response" });
      enriched.push(src); // keep the snippet; the search result alone is honest data
      continue;
    }
    const page = extractPage(res.body, res.url);
    if (/interview|hiring|process/i.test(page.text)) {
      enriched.push({ url: page.url, title: src.title || page.title, snippet: page.text.slice(0, 1200) });
      researchLog.push({ url: page.url, status: "fetched", note: "discussion page content retrieved" });
    } else {
      researchLog.push({ url: page.url, status: "skipped", note: "page no longer mentions interviews" });
      enriched.push(src);
    }
  }

  if (enriched.length === 0) {
    researchLog.push({ url: "(search)", status: "skipped", note: "no public interview discussion found" });
  }
  log.info("discussion search complete", { sources: enriched.length });
  return { sources: enriched, log: researchLog };
}

/** Parse DuckDuckGo html/lite result pages. Tolerant of both layouts. */
export function parseSearchResults(html: string, baseUrl: string): DiscussionSource[] {
  const out: DiscussionSource[] = [];
  const seen = new Set<string>();

  // html.duckduckgo.com: <a class="result__a" href="…">title</a>
  const htmlMatches = [
    ...html.matchAll(/<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi),
  ];
  for (const [, href, title] of htmlMatches) {
    const url = ddgRedirect(href, baseUrl);
    if (!url || seen.has(url)) continue;
    if (/duckduckgo\.com/.test(url)) continue;
    seen.add(url);
    out.push({ url, title: stripTags(title), snippet: "" });
    if (out.length >= 8) break;
  }
  if (out.length > 0) return out;

  // lite.duckduckgo.com: <a rel="nofollow" href="…">title</a>
  const liteMatches = [
    ...html.matchAll(/<a[^>]+rel="[^"]*nofollow[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi),
  ];
  for (const [, href, title] of liteMatches) {
    const url = ddgRedirect(href, baseUrl);
    if (!url || seen.has(url)) continue;
    if (/duckduckgo\.com/.test(url)) continue;
    seen.add(url);
    out.push({ url, title: stripTags(title), snippet: "" });
    if (out.length >= 8) break;
  }
  return out;
}

/** DDG wraps results in /l/?uddg=<encoded>; unwrap, else take absolute URLs. */
function ddgRedirect(href: string, baseUrl: string): string | null {
  try {
    if (href.startsWith("//")) href = `https:${href}`;
    const url = new URL(href, baseUrl);
    const uddg = url.searchParams.get("uddg");
    if (uddg) return decodeURIComponent(uddg);
    if (url.protocol === "http:" || url.protocol === "https:") return url.href;
    return null;
  } catch {
    return null;
  }
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}
