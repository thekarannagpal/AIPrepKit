/**
 * Minimal robots.txt client: fetch once per origin, parse the group that
 * applies to our user agent (falling back to the generic group), and expose
 * isAllowed() + crawlDelay(). Fail-open on fetch errors is the standard
 * behaviour, but we fail-open only for network errors — a parsed disallow
 * always wins.
 */
import { Fetcher } from "./fetcher";

interface Rule {
  path: string;
  allow: boolean;
}

interface Group {
  agents: string[];
  rules: Rule[];
  crawlDelay?: number;
}

export class Robots {
  private groups: Group[] = [];
  private loaded = false;
  private static cache = new Map<string, Robots>();

  static async load(origin: string, fetcher: Fetcher): Promise<Robots> {
    const cached = Robots.cache.get(origin);
    if (cached) return cached;
    const robots = new Robots();
    const res = await fetcher.fetch(new URL("/robots.txt", origin).href);
    if (res.status >= 200 && res.status < 300) {
      robots.parse(res.body);
    } else if (res.status === 404 || res.status === 410) {
      robots.loaded = true; // no rules: everything allowed
    } else {
      robots.loaded = true;
      robots.parseError = res.error ?? `HTTP ${res.status}`;
    }
    Robots.cache.set(origin, robots);
    return robots;
  }

  parseError?: string;
  private ownGroup: Rule[] | null = null;
  private genericGroup: Rule[] | null = null;
  private ownDelay?: number;
  private genericDelay?: number;

  parse(text: string): void {
    const groups: Group[] = [];
    let current: Group | null = null;
    let sawAgent = false;

    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.replace(/#.*$/, "").trim();
      if (!line) continue;
      const colon = line.indexOf(":");
      if (colon < 0) continue;
      const key = line.slice(0, colon).trim().toLowerCase();
      const value = line.slice(colon + 1).trim();

      if (key === "user-agent") {
        if (!current || sawAgent) {
          current = { agents: [], rules: [] };
          groups.push(current);
          sawAgent = false;
        }
        current.agents.push(value.toLowerCase());
      } else if (key === "disallow" || key === "allow") {
        if (!current) continue;
        sawAgent = true;
        current.rules.push({ path: value, allow: key === "allow" });
      } else if (key === "crawl-delay") {
        if (!current) continue;
        const d = Number(value);
        if (Number.isFinite(d)) current.crawlDelay = d;
      }
    }
    this.groups = groups;
    this.loaded = true;

    const ua = (process.env.USER_AGENT ?? "aiprepkit").toLowerCase();
    const agentToken = ua.split("/")[0].split(/[ ()]/)[0];
    const exact = groups.find((g) => g.agents.some((a) => a === agentToken || ua.includes(a) && a !== "*"));
    const wildcard = groups.find((g) => g.agents.includes("*"));
    const chosen = exact ?? wildcard ?? null;
    this.ownGroup = chosen?.rules ?? null;
    this.ownDelay = chosen?.crawlDelay;
    this.genericGroup = null;
    this.genericDelay = undefined;
  }

  /** Longest-match semantics: the most specific matching rule wins. */
  isAllowed(userPath: string, userAgent?: string): boolean {
    const rules = this.ownGroup;
    if (!rules) return true;
    const path = userPath || "/";
    let best: Rule | null = null;
    for (const rule of rules) {
      if (rule.path === "") continue;
      if (path.startsWith(rule.path) || matchesPattern(path, rule.path)) {
        if (!best || rule.path.length > best.path.length) best = rule;
      }
    }
    // robots.txt convention: a bare "Disallow:" with empty path means allow all.
    if (!best) return true;
    return best.allow;
  }

  get crawlDelaySeconds(): number | undefined {
    return this.ownDelay ?? this.genericDelay;
  }
}

/** robots patterns can use * and $ wildcards; support the common cases. */
function matchesPattern(path: string, pattern: string): boolean {
  if (!pattern.includes("*") && !pattern.endsWith("$")) return path.startsWith(pattern);
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\$$/, "");
  return new RegExp(`^${escaped}`).test(path);
}
