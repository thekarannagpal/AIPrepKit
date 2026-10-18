import { describe, it, expect } from "vitest";
import { rankLink, sameSite } from "../src/research/linkRank";

describe("rankLink", () => {
  const score = (anchor: string, href: string) => rankLink(anchor, href).score;

  it("ranks a careers link above a pricing link", () => {
    expect(score("Careers", "https://acme.test/careers")).toBeGreaterThan(
      score("Pricing", "https://acme.test/pricing")
    );
  });

  it("finds hiring pages at unexpected paths", () => {
    // GitLab/PostHog-style: the process lives in a handbook, not /careers.
    expect(score("How we hire", "https://acme.test/handbook/hiring/how-we-hire")).toBeGreaterThan(0);
    expect(score("Join us", "https://acme.test/company/join")).toBeGreaterThan(0);
  });

  it("penalises asset and file links", () => {
    expect(score("Logo", "https://acme.test/assets/logo.png")).toBeLessThan(0);
    expect(score("Benefits PDF", "https://acme.test/benefits.pdf")).toBeLessThan(0);
  });

  it("penalises login and legal links", () => {
    expect(score("Log in", "https://acme.test/login")).toBeLessThan(0);
    expect(score("Privacy", "https://acme.test/privacy")).toBeLessThan(0);
  });

  it("rewards shallow hiring links", () => {
    expect(score("Jobs", "https://acme.test/jobs")).toBeGreaterThan(
      score("Jobs", "https://acme.test/archive/2020/jobs")
    );
  });

  it("weights hiring words in the anchor more than the URL alone", () => {
    expect(score("We're hiring — see open roles", "https://acme.test/x")).toBeGreaterThan(
      score("Link", "https://acme.test/x?ref=careers")
    );
  });

  it("penalises vague CTAs", () => {
    expect(score("click here", "https://acme.test/careers")).toBeLessThan(
      score("Careers", "https://acme.test/careers")
    );
  });
});

describe("sameSite", () => {
  it("accepts the same host", () => {
    expect(sameSite("https://acme.test/about", "https://acme.test/")).toBe(true);
  });
  it("normalises www", () => {
    expect(sameSite("https://www.acme.test/about", "https://acme.test/")).toBe(true);
    expect(sameSite("https://acme.test/about", "https://www.acme.test/")).toBe(true);
  });
  it("accepts subdomains of the same root", () => {
    expect(sameSite("https://blog.acme.test/post", "https://acme.test/")).toBe(true);
  });
  it("rejects other domains", () => {
    expect(sameSite("https://evil.com/", "https://acme.test/")).toBe(false);
    expect(sameSite("https://acme.test.evil.com/", "https://acme.test/")).toBe(false);
  });
  it("rejects shared-hosting suffixes", () => {
    expect(sameSite("https://acme.github.io/", "https://other.github.io/")).toBe(false);
  });
  it("rejects non-http protocols", () => {
    expect(sameSite("javascript:alert(1)", "https://acme.test/")).toBe(false);
    expect(sameSite("ftp://acme.test/", "https://acme.test/")).toBe(false);
  });
});
