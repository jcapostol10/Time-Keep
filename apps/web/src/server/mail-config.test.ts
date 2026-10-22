import { describe, expect, it } from "vitest";

import { mailSenderProblem } from "./mail-config";

describe("mailSenderProblem", () => {
  it("names a placeholder sender in production", () => {
    expect(
      mailSenderProblem({
        VERCEL_ENV: "production",
        MAIL_FROM: "TimeKeep <onboarding@resend.dev>",
      }),
    ).toMatch(/MAIL_FROM/);
    expect(
      mailSenderProblem({
        VERCEL_ENV: "production",
        MAIL_FROM: "TimeKeep <no-reply@timekeep.local>",
      }),
    ).toMatch(/verified domain/);
  });

  it("is quiet for a verified domain, and everywhere but production", () => {
    expect(
      mailSenderProblem({
        VERCEL_ENV: "production",
        MAIL_FROM: "TimeKeep <no-reply@mail.example.com>",
      }),
    ).toBeNull();
    expect(mailSenderProblem({ VERCEL_ENV: "preview", MAIL_FROM: "x@resend.dev" })).toBeNull();
    expect(mailSenderProblem({ MAIL_FROM: "x@timekeep.local" })).toBeNull();
  });
});
