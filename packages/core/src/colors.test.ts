import { describe, expect, it } from "vitest";

import { hexColorSchema, pickColor, PROJECT_COLORS } from "./colors";

describe("project colours", () => {
  it("is a palette of 20 distinct hex colours", () => {
    expect(PROJECT_COLORS).toHaveLength(20);
    expect(new Set(PROJECT_COLORS).size).toBe(20);
    for (const c of PROJECT_COLORS) expect(c).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("pickColor is stable and stays inside the palette", () => {
    expect(pickColor("Website redesign")).toBe(pickColor("Website redesign"));
    expect(PROJECT_COLORS).toContain(pickColor("Website redesign"));
    expect(PROJECT_COLORS).toContain(pickColor(""));
  });

  it("hexColorSchema accepts #rrggbb only", () => {
    expect(hexColorSchema.safeParse("#1a2b3c").success).toBe(true);
    expect(hexColorSchema.safeParse("#1A2B3C").success).toBe(true);
    expect(hexColorSchema.safeParse("red").success).toBe(false);
    expect(hexColorSchema.safeParse("#abc").success).toBe(false);
  });
});
