import { describe, expect, it } from "vitest";

import { cronAuthorized, testHookAuthorized } from "./cron-auth";

const SECRET = "a-long-enough-cron-secret";

function request(authorization?: string) {
  return new Request("http://localhost/api/cron/daily", {
    headers: authorization ? { authorization } : {},
  });
}

describe("cronAuthorized", () => {
  it("refuses everything while the secret is unset or short", () => {
    expect(cronAuthorized(request(`Bearer ${SECRET}`), undefined)).toBe(false);
    expect(cronAuthorized(request("Bearer short"), "short")).toBe(false);
  });

  it("wants the bearer token to match", () => {
    expect(cronAuthorized(request(), SECRET)).toBe(false);
    expect(cronAuthorized(request(`Bearer ${SECRET}x`), SECRET)).toBe(false);
    expect(cronAuthorized(request(SECRET), SECRET)).toBe(false);
    expect(cronAuthorized(request(`Bearer ${SECRET}`), SECRET)).toBe(true);
  });
});

describe("testHookAuthorized", () => {
  it("opens on a capturing preview or a local server with the e2e secret", () => {
    expect(
      testHookAuthorized({ MAIL_CAPTURE: true, VERCEL_ENV: "preview", E2E_SECRET: SECRET }, SECRET),
    ).toBe(true);
    expect(testHookAuthorized({ E2E_SECRET: SECRET }, SECRET)).toBe(true);
  });

  it("stays shut in production, on a non-capturing deployment, or without the secret", () => {
    expect(
      testHookAuthorized(
        { MAIL_CAPTURE: true, VERCEL_ENV: "production", E2E_SECRET: SECRET },
        SECRET,
      ),
    ).toBe(false);
    expect(testHookAuthorized({ VERCEL_ENV: "preview", E2E_SECRET: SECRET }, SECRET)).toBe(false);
    expect(testHookAuthorized({ E2E_SECRET: SECRET }, "wrong")).toBe(false);
    expect(testHookAuthorized({}, null)).toBe(false);
  });
});
