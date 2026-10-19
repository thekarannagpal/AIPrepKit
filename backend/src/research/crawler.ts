import { log } from "../lib/logger";
import { env } from "../config";
import { Fetcher } from "./fetcher";
import { Robots } from "./robots";
import { extractPage, type PageContent } from "./html";
import { rankLink, sameSite, type RankedLink } from "./linkRank";
import type { ResearchLogEntry } from "@aiprepkit/core";

export interface CrawlResult {
  pages: PageContent[];
  log: ResearchLogEntry[];
  /** Pages that look like hiring/process pages, best first. */
  hiringPages: PageContent[];
  /** Pages that look like about/company pages, best first. */
  aboutPages: PageContent[];
  foundHiringPage: boolean;
}

/**
 * Budgeted BFS over a company site, highest-ranked links first.
 *
 *  1. fetch the homepage (recorded, never fatal on failure)
 *  2. rank every same-site link by anchor/path signals
 *  3. fetch the best candidates within page/depth budgets, respecting
 *     robots.txt and the per-host rate limit
 *  4. classify fetched pages so later steps can pick hiring/about content
 *
 * Every skipped or failed source is recorded in the research log — the kit
 * reports what could not be retrieved instead of failing the run (brief §2).
 */
export async function crawlSite(startUrl: string, fetcher: Fetcher): Promise<CrawlResult> {
  const pages: PageContent[] = [];
  const researchLog: ResearchLogEntry[] = [];
  const origin = new URL(startUrl).origin;

  const robots = await Robots.load(origin, fetcher);
  if (robots.parseError) {
    researchLog.push({ url: new URL("/robots.txt", origin).href, status: "error", note: `robots.txt ${robots.parseError}; proceeding with caution` });
  }

  const canFetch = (url: string): boolean => {
    try {
      const u = new URL(url);
      return robots.isAllowed(u.pathname + u.search);
    } catch {
      return false;
    }
  };

  // --- homepage -------------------------------------------------------------
  const home = await fetcher.fetch(startUrl);
  if (home.error || !home.body) {
    researchLog.push({ url: startUrl, status: "error", note: home.error ?? "empty response" });
    return { pages, log: researchLog, hiringPages: [], aboutPages: [], foundHiringPage: false };
  }
  const homePage = extractPage(home.body, home.url);
  pages.push(homePage);
  researchLog.push({
    url: home.url,
    status: "fetched",
    note: `homepage${homePage.title ? ` — ${homePage.title}` : ""}`,
  });

  // --- rank and filter the frontier -----------------------------------------
  const queued = new Map<string, RankedLink>();
  for (const link of homePage.links) {
    if (!sameSite(link.href, origin)) continue;
    if (/\.(jpg|jpeg|png|gif|svg|webp|ico|css|js|pdf|zip)(\?|$)/i.test(link.href)) continue;
    const ranked = rankLink(link.text, link.href);
    if (ranked.score <= 0) continue;
    if (!queued.has(link.href) || queued.get(link.href)!.score < ranked.score) {
      queued.set(link.href, ranked);
    }
  }

  const frontier: RankedLink[] = [];
  const seen = new Set<string>([homePage.url]);
  // Robots pre-filter: every disallowed candidate is recorded up front so the
  // research log stays honest even when the crawl stops before reaching it.
  for (const c of [...queued.values()].sort((a, b) => b.score - a.score)) {
    if (seen.has(c.href)) continue;
    if (!canFetch(c.href)) {
      researchLog.push({ url: c.href, status: "skipped", note: "disallowed by robots.txt" });
      seen.add(c.href);
      continue;
    }
    frontier.push(c);
  }
  const crawlDelayMs = robots.crawlDelaySeconds
    ? Math.max(env.crawl.minIntervalMs, robots.crawlDelaySeconds * 1000)
    : env.crawl.minIntervalMs;

  let attempts = 0;
  for (const candidate of frontier) {
    if (pages.length >= env.crawl.maxPages || attempts >= env.crawl.maxPages * 2) break;
    if (seen.has(candidate.href)) continue;
    attempts++;

    if (!canFetch(candidate.href)) {
      researchLog.push({ url: candidate.href, status: "skipped", note: "disallowed by robots.txt" });
      seen.add(candidate.href);
      continue;
    }

    await sleep(crawlDelayMs - env.crawl.minIntervalMs); // robots' own delay, if stricter
    const res = await fetcher.fetch(candidate.href);
    seen.add(candidate.href);

    if (res.error || !res.body) {
      researchLog.push({ url: candidate.href, status: "skipped", note: res.error ?? "empty response" });
      continue;
    }

    const page = extractPage(res.body, res.url);
    pages.push(page);
    researchLog.push({
      url: page.url,
      status: "fetched",
      note: `${page.title || "(untitled)"} [score ${candidate.score}: ${candidate.signals.join(", ")}]`,
    });

    // One hop deep: harvest links from promising pages, still same-site.
    for (const link of page.links) {
      if (seen.has(link.href) || !sameSite(link.href, origin)) continue;
      if (queued.has(link.href)) continue;
      const ranked = rankLink(link.text, link.href);
      if (ranked.score > 0 && frontier.length < env.crawl.maxPages * 4) {
        frontier.push(ranked);
        queued.set(link.href, ranked);
      }
    }

    // Once we have two hiring-ish pages, stop early — depth costs minutes.
    if (classify(pages).hiring.length >= 2) break;
  }

  const { hiring, about } = classify(pages);
  researchLog.push({
    url: origin,
    status: hiring.length ? "fetched" : "skipped",
    note: hiring.length
      ? `hiring/process content found at ${hiring.length} page(s)`
      : "no hiring or interview page discovered on the site",
  });

  log.info("crawl complete", { pages: pages.length, hiring: hiring.length, logged: researchLog.length });
  return {
    pages,
    log: researchLog,
    hiringPages: hiring.map((h) => h.page),
    aboutPages: about.map((a) => a.page),
    foundHiringPage: hiring.length > 0,
  };
}

interface Scored {
  page: PageContent;
  score: number;
}

/**
 * Classify fetched pages by content, not just URL: a careers page that lives
 * at /handbook/how-we-hire still counts. Words in the title/headings weigh
 * more than the same words buried in prose.
 */
export function classify(pages: PageContent[]): { hiring: Scored[]; about: Scored[] } {
  const hiringWords = [
    "hiring", "interview", "interviews", "recruiting", "recruitment", "careers",
    "apply", "candidate", "candidates", "job opening", "open roles", "we're hiring",
    "process", "onsite", "take-home", "take home", "salary band", "offer",
  ];
  const aboutWords = [
    "about us", "our story", "who we are", "our mission", "founded",
    "headquarters", "our team", "leadership", "what we do", "our values",
  ];

  const score = (page: PageContent, words: string[]): number => {
    const head = `${page.title} ${page.text.slice(0, 600)}`.toLowerCase();
    const body = page.text.toLowerCase();
    let s = 0;
    for (const w of words) {
      if (head.includes(w)) s += 3;
      if (body.includes(w)) s += 1;
    }
    return s;
  };

  const hiring = pages
    .map((page) => ({ page, score: score(page, hiringWords) }))
    .filter((s) => s.score >= 4)
    .sort((a, b) => b.score - a.score);

  const hiringUrls = new Set(hiring.map((h) => h.page.url));
  const about = pages
    .map((page) => ({ page, score: score(page, aboutWords) }))
    .filter((s) => s.score >= 4 && !hiringUrls.has(s.page.url))
    .sort((a, b) => b.score - a.score);

  return { hiring, about };
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
}
