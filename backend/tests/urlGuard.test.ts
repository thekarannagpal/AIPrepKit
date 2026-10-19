import { describe, it, expect } from "vitest";
import { isPrivateAddress, resolveLink } from "../src/research/urlGuard";

describe("isPrivateAddress", () => {
  it("flags loopback and private IPv4 ranges", () => {
    for (const addr of ["127.0.0.1", "10.0.0.5", "192.168.1.1", "172.16.0.1", "172.31.255.255", "169.254.1.1", "0.0.0.0"]) {
      expect(isPrivateAddress(addr), addr).toBe(true);
    }
  });
  it("allows public IPv4", () => {
    for (const addr of ["8.8.8.9", "172.32.0.1", "100.63.255.255", "1.2.3.4"]) {
      expect(isPrivateAddress(addr), addr).toBe(false);
    }
  });
  it("flags IPv6 loopback and link-local", () => {
    expect(isPrivateAddress("::1")).toBe(true);
    expect(isPrivateAddress("fe80::1")).toBe(true);
    expect(isPrivateAddress("fd00::1")).toBe(true);
    expect(isPrivateAddress("::ffff:192.168.0.1")).toBe(true);
  });
  it("allows public IPv6", () => {
    expect(isPrivateAddress("2606:4700::1111")).toBe(false);
  });
});

describe("resolveLink", () => {
  it("resolves relative links", () => {
    expect(resolveLink("/about", "https://acme.test/")).toBe("https://acme.test/about");
    expect(resolveLink("careers", "https://acme.test/en/")).toBe("https://acme.test/en/careers");
    expect(resolveLink("../handbook", "https://acme.test/en/about/")).toBe("https://acme.test/en/handbook");
  });
  it("keeps absolute links", () => {
    expect(resolveLink("https://other.test/x", "https://acme.test/")).toBe("https://other.test/x");
  });
  it("returns null for junk and dangerous schemes", () => {
    // `new URL("::::", base)` actually parses as a relative path, so use
    // inputs that must never resolve: empty scheme, javascript:, mailto:.
    expect(resolveLink("http://", "https://acme.test/")).toBeNull();
    expect(resolveLink("javascript:alert(1)", "https://acme.test/")).toBeNull();
    expect(resolveLink("mailto:x@y.test", "https://acme.test/")).toBeNull();
  });
});
