import * as cheerio from "cheerio";

/**
 * Turn an untrusted HTML page into bounded plain text plus outbound links.
 * Everything script/hidden is stripped before the text can reach a model —
 * fetched pages are content to process, never instructions to follow
 * (brief §11). Size caps keep one page from eating the context window.
 */
export interface PageContent {
  url: string;
  title: string;
  text: string;
  links: { href: string; text: string; rel: string }[];
  truncated: boolean;
}

const MAX_TEXT_CHARS = 6000;
const MAX_LINKS = 120;

export function extractPage(html: string, pageUrl: string): PageContent {
  const $ = cheerio.load(html);

  // Remove elements that are never prose.
  $(
    "script, style, noscript, template, iframe, svg, canvas, form, " +
      "nav, header, footer, aside, [aria-hidden='true'], [hidden], [role='navigation']"
  ).remove();

  const title =
    ($("title").first().text() || $("h1").first().text() || "").replace(/\s+/g, " ").trim().slice(0, 200);

  // Prefer a main-content region when the page marks one; otherwise whole body.
  const root = $("main, article, [role='main']").first();
  const scope = root.length ? root : $("body");
  let text = scope.text();
  text = text.replace(/ /g, " ").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();

  const truncated = text.length > MAX_TEXT_CHARS;
  if (truncated) text = text.slice(0, MAX_TEXT_CHARS);

  const seen = new Set<string>();
  const links: { href: string; text: string; rel: string }[] = [];
  $("a[href]").each((_, el) => {
    if (links.length >= MAX_LINKS) return false;
    const href = $(el).attr("href") ?? "";
    const rel = ($(el).attr("rel") ?? "").toLowerCase();
    const linkText = $(el).text().replace(/\s+/g, " ").trim().slice(0, 120);
    const resolved = safeResolve(href, pageUrl);
    if (!resolved) return;
    if (seen.has(resolved)) return;
    seen.add(resolved);
    links.push({ href: resolved, text: linkText, rel });
    return undefined;
  });

  return { url: pageUrl, title, text, links, truncated };
}

function safeResolve(href: string, base: string): string | null {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("mailto:") || trimmed.startsWith("tel:")) {
    return null;
  }
  try {
    const url = new URL(trimmed, base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

/**
 * Wrap untrusted text for the model with a fence it cannot casually close:
 * the delimiter is mangled inside the payload, and the system prompt states
 * that document contents are data, not instructions.
 */
export function asUntrustedDocument(text: string, source: string): string {
  const safe = text.replace(/<[/\\]?document/gi, "<doc");
  const capped = safe.length > 12_000 ? safe.slice(0, 12_000) + "\n[truncated]" : safe;
  return `<document source="${source.replace(/[<>"]/g, "")}">\n${capped}\n</document>`;
}
