import { describe, expect, it } from "vitest";

import { copyWeekMessage } from "./copy-message";

describe("copyWeekMessage", () => {
  it("counts what was copied", () => {
    expect(copyWeekMessage({ created: 1, duplicates: 0, unusable: [] })).toBe("1 entry copied");
    expect(copyWeekMessage({ created: 3, duplicates: 0, unusable: [] })).toBe("3 entries copied");
  });

  it("says what it skipped and why", () => {
    expect(
      copyWeekMessage({
        created: 2,
        duplicates: 2,
        unusable: [
          { description: "Design", reason: "This project is archived." },
          { description: "", reason: "This task is done." },
          { description: "Call", reason: "This task is done." },
        ],
      }),
    ).toBe(
      "2 entries copied. 2 already there. Skipped “Design”: This project is archived. (and 2 more)",
    );
    expect(
      copyWeekMessage({
        created: 0,
        duplicates: 0,
        unusable: [{ description: "", reason: "This task is done." }],
      }),
    ).toBe("0 entries copied. Skipped “(no description)”: This task is done.");
  });
});
