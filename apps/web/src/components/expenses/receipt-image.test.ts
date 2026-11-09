import { describe, expect, it } from "vitest";

import { fitWithin } from "./receipt-image";

describe("fitWithin", () => {
  it("scales a large image down to the longest side, keeping the ratio", () => {
    expect(fitWithin(4000, 3000, 2000)).toEqual({ width: 2000, height: 1500 });
    expect(fitWithin(3000, 4000, 2000)).toEqual({ width: 1500, height: 2000 });
    expect(fitWithin(4000, 3000, 320)).toEqual({ width: 320, height: 240 });
  });

  it("never enlarges a small image", () => {
    expect(fitWithin(800, 600, 2000)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(2000, 2000, 2000)).toEqual({ width: 2000, height: 2000 });
  });

  it("keeps a very thin image at least a pixel wide", () => {
    expect(fitWithin(10_000, 1, 320)).toEqual({ width: 320, height: 1 });
  });
});
