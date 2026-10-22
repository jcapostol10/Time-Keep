import { describe, expect, it } from "vitest";

import { parseEnv } from "./env";

const base = {
  DATABASE_URL: "postgres://x",
  BETTER_AUTH_SECRET: "0123456789abcdef0123456789abcdef",
};

describe("parseEnv", () => {
  it("never refuses a boot over the mail sender: that is checked where mail is sent", () => {
    expect(parseEnv({ ...base, VERCEL_ENV: "production" }).MAIL_FROM).toContain("timekeep.local");
    expect(
      parseEnv({ ...base, VERCEL_ENV: "production", MAIL_FROM: "TimeKeep <x@resend.dev>" })
        .MAIL_FROM,
    ).toBe("TimeKeep <x@resend.dev>");
  });

  it("reports what is missing by name", () => {
    expect(() => parseEnv({ BETTER_AUTH_SECRET: base.BETTER_AUTH_SECRET })).toThrow(/DATABASE_URL/);
  });
});
