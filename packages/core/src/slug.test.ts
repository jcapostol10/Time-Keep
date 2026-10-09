import { describe, expect, it } from "vitest";

import { personalWorkspaceName, slugify, uniqueSlug } from "./slug";

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Acme Design Studio")).toBe("acme-design-studio");
  });
  it("strips diacritics and symbols", () => {
    expect(slugify("José's Café & Co.")).toBe("jose-s-cafe-co");
  });
  it("collapses repeated separators and trims hyphens", () => {
    expect(slugify("--hello   world!!")).toBe("hello-world");
  });
  it("never returns an empty slug", () => {
    expect(slugify("!!!")).toBe("workspace");
  });
  it("caps length at 48", () => {
    expect(slugify("a".repeat(100)).length).toBe(48);
  });
});

describe("uniqueSlug", () => {
  it("returns the base when free", () => {
    expect(uniqueSlug("Acme", () => false)).toBe("acme");
  });
  it("appends -2, -3 … until free", () => {
    const taken = new Set(["acme", "acme-2"]);
    expect(uniqueSlug("Acme", (s) => taken.has(s))).toBe("acme-3");
  });
  it("keeps the suffixed slug within the length cap", () => {
    const taken = new Set(["a".repeat(48)]);
    const result = uniqueSlug("a".repeat(100), (s) => taken.has(s));
    expect(result.length).toBeLessThanOrEqual(48);
    expect(result.endsWith("-2")).toBe(true);
  });
});

describe("personalWorkspaceName", () => {
  it("uses the first name", () => {
    expect(personalWorkspaceName("Ada Lovelace")).toBe("Ada's workspace");
  });
  it("handles single names and extra whitespace", () => {
    expect(personalWorkspaceName("  Grace  ")).toBe("Grace's workspace");
  });
  it("falls back when the name is empty", () => {
    expect(personalWorkspaceName("")).toBe("My workspace");
    expect(personalWorkspaceName(null)).toBe("My workspace");
  });
});
