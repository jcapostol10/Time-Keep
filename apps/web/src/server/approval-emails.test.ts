import { describe, expect, it } from "vitest";

import { approvedEmail, rejectedEmail, reopenedEmail } from "./approval-emails";

const base = {
  appUrl: "https://app.test",
  slug: "acme",
  workspaceName: "Acme",
  period: { start: "2026-10-19", end: "2026-10-25" },
  requestId: "req-1",
};

describe("decision emails", () => {
  it("link an approval to its period", () => {
    expect(approvedEmail(base).cta?.url).toBe("https://app.test/w/acme/approvals/req-1");
  });

  it("link a rejection or a reopening to the timesheet week where it is corrected", () => {
    expect(rejectedEmail({ ...base, note: "Fix Monday" }).cta?.url).toBe(
      "https://app.test/w/acme/timesheet?week=2026-10-19",
    );
    expect(reopenedEmail({ ...base, note: "Fix Monday" }).cta?.url).toBe(
      "https://app.test/w/acme/timesheet?week=2026-10-19",
    );
  });
});
