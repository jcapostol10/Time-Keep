import { describe, expect, it } from "vitest";

import { activeIdlePrompt } from "./idle-prompt";

const since = new Date("2026-03-11T02:00:00Z");

describe("activeIdlePrompt", () => {
  it("shows the prompt for the timer it was raised for", () => {
    expect(activeIdlePrompt({ entryId: "a", since }, { id: "a" })).toEqual({
      entryId: "a",
      since,
    });
  });

  it("drops the prompt when that timer stopped or another one started", () => {
    expect(activeIdlePrompt({ entryId: "a", since }, null)).toBeNull();
    expect(activeIdlePrompt({ entryId: "a", since }, { id: "b" })).toBeNull();
  });

  it("is null when there is no prompt", () => {
    expect(activeIdlePrompt(null, { id: "a" })).toBeNull();
  });
});
