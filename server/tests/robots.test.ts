import { describe, it, expect } from "vitest";
import { Robots } from "../src/research/robots";

function parse(text: string): Robots {
  const r = new Robots();
  r.parse(text);
  return r;
}

describe("Robots", () => {
  it("allows everything when there are no rules for us", () => {
    const r = parse("User-agent: OtherBot\nDisallow: /");
    expect(r.isAllowed("/anything")).toBe(true);
  });

  it("honours the generic group when no group names us", () => {
    const r = parse("User-agent: *\nDisallow: /private/");
    expect(r.isAllowed("/private/secrets")).toBe(false);
    expect(r.isAllowed("/public")).toBe(true);
  });

  it("prefers our named group over the wildcard", () => {
    const r = parse(
      "User-agent: *\nDisallow: /\n\nUser-agent: AIPrepKitBot\nDisallow: /admin"
    );
    expect(r.isAllowed("/careers")).toBe(true);
    expect(r.isAllowed("/admin/x")).toBe(false);
  });

  it("longest match wins between allow and disallow", () => {
    const r = parse("User-agent: *\nDisallow: /careers\nAllow: /careers/public");
    expect(r.isAllowed("/careers/private")).toBe(false);
    expect(r.isAllowed("/careers/public/roles")).toBe(true);
  });

  it("handles wildcards", () => {
    const r = parse("User-agent: *\nDisallow: /*.pdf$\nDisallow: /tmp/*");
    expect(r.isAllowed("/docs/file.pdf")).toBe(false);
    expect(r.isAllowed("/tmp/cache/x")).toBe(false);
    expect(r.isAllowed("/docs/file.html")).toBe(true);
  });

  it("bare Disallow means allow all", () => {
    const r = parse("User-agent: *\nDisallow:");
    expect(r.isAllowed("/anything")).toBe(true);
  });

  it("exposes crawl-delay", () => {
    const r = parse("User-agent: *\nCrawl-delay: 4\nDisallow: /x");
    expect(r.crawlDelaySeconds).toBe(4);
  });

  it("ignores comments and blank lines", () => {
    const r = parse("# comment\n\nUser-agent: *\n# another\nDisallow: /nope # inline comment");
    expect(r.isAllowed("/nope")).toBe(false);
  });
});
