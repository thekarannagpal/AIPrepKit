/**
 * Link ranking for the crawl frontier (brief §2: "Finding the hiring page is
 * the interesting half of this"). Companies bury it in different places —
 * /careers, /jobs, a handbook, an engineering blog — so the path can never be
 * hard-coded. Instead every link gets a score from its anchor text, URL path
 * tokens and query, with penalties for dead weight (pricing, legal, assets).
 * The crawler walks the frontier highest-score-first within its budget.
 */

const HIRING_POSITIVE = [
  "careers", "career", "jobs", "job", "hiring", "recruiting", "recruitment",
  "interview", "interviewing", "join", "join-us", "join us", "work-with",
  "work with us", "open-roles", "open roles", "open positions", "positions",
  "people", "team", "teams", "life", "culture", "values", "handbook",
  "manual", "how we hire", "how-we-hire", "talent", "apply", "apply-now",
];

const ABOUT_POSITIVE = [
  "about", "who-we-are", "who we are", "story", "company", "mission",
  "what we do", "what-we-do", "faq", "press", "leaders", "founders",
];

const ENGINEERING_POSITIVE = [
  "engineering", "engineering-blog", "tech", "tech-blog", "blog", "dev",
  "developers", "docs", "documentation", "product", "products", "platform",
];

const NEGATIVE = [
  "pricing", "price", "plans", "checkout", "cart", "shop", "store",
  "login", "log-in", "sign-in", "signin", "signup", "sign-up", "register",
  "privacy", "terms", "legal", "cookie", "cookies", "gdpr", "security",
  "support", "help", "contact", "status", "download", "cdn", "assets",
  "static", "favicon", "logo", "brand", "press-kit", "media-kit",
  "settings", "admin", "dashboard", "app.",
];

const FILE_PENALTY = /\.(pdf|zip|dmg|exe|png|jpe?g|gif|svg|webp|mp4|mp3|css|js|ico|woff2?)(\?|$)/i;

export interface RankedLink {
  href: string;
  anchor: string;
  score: number;
  signals: string[];
}

export function rankLink(anchor: string, href: string): RankedLink {
  const signals: string[] = [];
  let score = 0;

  const anchorText = anchor.toLowerCase();
  const url = safeParse(href);
  const path = (url?.pathname ?? href).toLowerCase();
  const haystack = `${anchorText} ${path} ${(url?.search ?? "").toLowerCase()}`;

  const countMatches = (words: string[]) =>
    words.filter((w) => haystack.includes(w)).length;

  const hiringHits = countMatches(HIRING_POSITIVE);
  if (hiringHits > 0) {
    score += 10 * hiringHits;
    signals.push(`hiring:${hiringHits}`);
  }
  const aboutHits = countMatches(ABOUT_POSITIVE);
  if (aboutHits > 0) {
    score += 6 * aboutHits;
    signals.push(`about:${aboutHits}`);
  }
  const engHits = countMatches(ENGINEERING_POSITIVE);
  if (engHits > 0) {
    score += 4 * engHits;
    signals.push(`eng:${engHits}`);
  }

  // Depth-ish penalty: deep paths are rarely the canonical hiring page.
  const depth = path.split("/").filter(Boolean).length;
  if (depth > 3) {
    score -= 3 * (depth - 3);
    signals.push(`deep:${depth}`);
  }
  if (depth === 1) {
    score += 2;
    signals.push("shallow");
  }

  const negHits = countMatches(NEGATIVE);
  if (negHits > 0) {
    score -= 8 * negHits;
    signals.push(`neg:${negHits}`);
  }
  if (FILE_PENALTY.test(path)) {
    score -= 12;
    signals.push("file");
  }

  // Anchors that look like CTAs are weaker signals of content.
  if (/^(click here|here|more|learn more|read more|→|>|\+)$/i.test(anchorText.trim())) {
    score -= 3;
    signals.push("cta");
  }

  // A hiring word in the anchor is stronger than in the URL alone.
  if (hiringHits > 0 && HIRING_POSITIVE.some((w) => anchorText.includes(w))) {
    score += 5;
    signals.push("anchor-hiring");
  }

  return { href, anchor, score, signals };
}

function safeParse(href: string): URL | null {
  try {
    return new URL(href);
  } catch {
    return null;
  }
}

/**
 * Same-origin check for the site crawl. We stay on the site's host (and its
 * www./non-www twin) so one crawl cannot wander the open web; subdomains are
 * allowed only when they share the registrable label, which keeps
 * blog.company.com reachable while refusing evil.com.
 */
export function sameSite(link: string, origin: string): boolean {
  const a = safeParse(link);
  const b = safeParse(origin);
  if (!a || !b) return false;
  if (a.protocol !== "http:" && a.protocol !== "https:") return false;
  const ha = a.hostname.toLowerCase().replace(/^www\./, "");
  const hb = b.hostname.toLowerCase().replace(/^www\./, "");
  if (ha === hb) return true;
  // Allow subdomains of the same root (blog.company.com vs company.com).
  const parts = hb.split(".");
  if (parts.length >= 2) {
    const root = parts.slice(-2).join(".");
    if (ha === root || ha.endsWith(`.${root}`)) {
      // ...but not shared-hosting suffixes like github.io or vercel.app.
      const shared = new Set(["github.io", "vercel.app", "netlify.app", "herokuapp.com", "web.app", "pages.dev"]);
      if (!shared.has(root)) return true;
    }
  }
  return false;
}
