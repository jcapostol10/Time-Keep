import { describe, expect, it } from "vitest";

import { movesHorizontally } from "./grid-keys";

const caret = (start: number | null, end: number | null, length: number) => ({
  start,
  end,
  length,
});

describe("movesHorizontally", () => {
  it("moves from an empty cell", () => {
    expect(movesHorizontally("ArrowLeft", caret(0, 0, 0))).toBe(true);
    expect(movesHorizontally("ArrowRight", caret(0, 0, 0))).toBe(true);
  });

  it("moves when the whole value is selected", () => {
    expect(movesHorizontally("ArrowLeft", caret(0, 4, 4))).toBe(true);
    expect(movesHorizontally("ArrowRight", caret(0, 4, 4))).toBe(true);
  });

  it("stays when the caret is inside '1:30'", () => {
    expect(movesHorizontally("ArrowLeft", caret(2, 2, 4))).toBe(false);
    expect(movesHorizontally("ArrowRight", caret(2, 2, 4))).toBe(false);
  });

  it("moves right from the end, left from the start", () => {
    expect(movesHorizontally("ArrowRight", caret(4, 4, 4))).toBe(true);
    expect(movesHorizontally("ArrowLeft", caret(4, 4, 4))).toBe(false);
    expect(movesHorizontally("ArrowLeft", caret(0, 0, 4))).toBe(true);
    expect(movesHorizontally("ArrowRight", caret(0, 0, 4))).toBe(false);
  });

  it("moves when the selection is unknown", () => {
    expect(movesHorizontally("ArrowLeft", caret(null, null, 4))).toBe(true);
  });
});
