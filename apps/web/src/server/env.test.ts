import { describe, expect, it } from "vitest";

import { parseEnv } from "./env";

const base = {
  DATABASE_URL: "postgres://x",
  BETTER_AUTH_SECRET: "0123456789abcdef0123456789abcdef",
};

describe("production mail guard", () => {
  it("refuses a production boot with a placeholder sender", () => {
    expect(() => parseEnv({ ...base, VERCEL_ENV: "production" })).toThrow(/MAIL_FROM/);
    expect(() =>
      parseEnv({ ...base, VERCEL_ENV: "production", MAIL_FROM: "TimeKeep <onboarding@resend.dev>" }),
    ).toThrow(/MAIL_FROM/);
  });

  it("accepts a verified-domain sender in production, and placeholders elsewhere", () => {
    expect(
      parseEnv({
        ...base,
        VERCEL_ENV: "production",
        MAIL_FROM: "TimeKeep <no-reply@mail.example.com>",
      }).MAIL_FROM,
    ).toBe("TimeKeep <no-reply@mail.example.com>");
    expect(parseEnv({ ...base, VERCEL_ENV: "preview" }).MAIL_FROM).toContain("timekeep.local");
    expect(parseEnv(base).MAIL_FROM).toContain("timekeep.local");
  });
});
