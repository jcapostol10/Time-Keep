import { describe, expect, it } from "vitest";

import { resolveAppUrl, trustedOrigins } from "./app-url";

describe("resolveAppUrl", () => {
  it("uses the configured URL when set, without a trailing slash", () => {
    expect(
      resolveAppUrl({
        BETTER_AUTH_URL: "https://timekeep.example/",
        VERCEL_ENV: "preview",
        VERCEL_URL: "x.vercel.app",
      }),
    ).toBe("https://timekeep.example");
    expect(resolveAppUrl({ NEXT_PUBLIC_APP_URL: "http://localhost:3000" })).toBe(
      "http://localhost:3000",
    );
  });

  it("uses the deployment URL on Vercel when nothing is configured", () => {
    expect(resolveAppUrl({ VERCEL_ENV: "preview", VERCEL_URL: "time-keep-abc.vercel.app" })).toBe(
      "https://time-keep-abc.vercel.app",
    );
  });

  it("uses the production domain on production deployments", () => {
    expect(
      resolveAppUrl({
        VERCEL_ENV: "production",
        VERCEL_URL: "time-keep-abc123.vercel.app",
        VERCEL_PROJECT_PRODUCTION_URL: "time-keep.vercel.app",
      }),
    ).toBe("https://time-keep.vercel.app");
  });

  it("ignores blank configured values", () => {
    expect(
      resolveAppUrl({ BETTER_AUTH_URL: " ", VERCEL_ENV: "preview", VERCEL_URL: "a.vercel.app" }),
    ).toBe("https://a.vercel.app");
  });

  it("falls back to localhost for local development", () => {
    expect(resolveAppUrl({})).toBe("http://localhost:3000");
  });
});

describe("trustedOrigins", () => {
  it("includes the app URL and the branch alias, once each", () => {
    expect(
      trustedOrigins({
        VERCEL_ENV: "preview",
        VERCEL_URL: "a.vercel.app",
        VERCEL_BRANCH_URL: "b.vercel.app",
      }),
    ).toEqual(["https://a.vercel.app", "https://b.vercel.app"]);
    expect(trustedOrigins({ NEXT_PUBLIC_APP_URL: "http://localhost:3000" })).toEqual([
      "http://localhost:3000",
    ]);
  });
});
