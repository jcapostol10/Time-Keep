import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { connectTestDb, truncateAll } from "../../test/db";
import {
  captureEmail,
  captureEnabled,
  listCapturedEmails,
  testEndpointAuthorized,
} from "./mail-capture";

const SECRET = "a-long-enough-e2e-secret";

describe("captureEnabled", () => {
  it("is on only when the flag is set outside production", () => {
    expect(captureEnabled({ MAIL_CAPTURE: true, VERCEL_ENV: "preview" })).toBe(true);
    expect(captureEnabled({ MAIL_CAPTURE: true })).toBe(true);
    expect(captureEnabled({ MAIL_CAPTURE: true, VERCEL_ENV: "production" })).toBe(false);
    expect(captureEnabled({ MAIL_CAPTURE: false, VERCEL_ENV: "preview" })).toBe(false);
  });
});

describe("testEndpointAuthorized", () => {
  const preview = { MAIL_CAPTURE: true, VERCEL_ENV: "preview", E2E_SECRET: SECRET };

  it("accepts the exact secret on a capturing preview", () => {
    expect(testEndpointAuthorized(preview, SECRET)).toBe(true);
  });

  it("rejects a missing or wrong secret", () => {
    expect(testEndpointAuthorized(preview, null)).toBe(false);
    expect(testEndpointAuthorized(preview, "")).toBe(false);
    expect(testEndpointAuthorized(preview, `${SECRET}x`)).toBe(false);
    expect(testEndpointAuthorized(preview, SECRET.slice(0, -1))).toBe(false);
  });

  it("rejects when no usable secret is configured", () => {
    expect(testEndpointAuthorized({ ...preview, E2E_SECRET: undefined }, "")).toBe(false);
    expect(testEndpointAuthorized({ ...preview, E2E_SECRET: "short" }, "short")).toBe(false);
  });

  it("never authorizes in production or without capture", () => {
    expect(testEndpointAuthorized({ ...preview, VERCEL_ENV: "production" }, SECRET)).toBe(false);
    expect(testEndpointAuthorized({ ...preview, MAIL_CAPTURE: false }, SECRET)).toBe(false);
  });
});

describe("captured email store", () => {
  const handle = connectTestDb();
  const db = handle.db;
  beforeEach(async () => truncateAll(db));
  afterAll(async () => handle.close());

  it("returns a recipient's messages newest first, filtered by subject", async () => {
    await captureEmail(db, {
      to: "a@e2e.test",
      subject: "Verify your email",
      html: "<p>1</p>",
      text: "1",
    });
    await new Promise((r) => setTimeout(r, 15));
    await captureEmail(db, {
      to: "A@e2e.test",
      subject: "Reset your password",
      html: "<p>2</p>",
      text: "2",
    });
    await captureEmail(db, {
      to: "b@e2e.test",
      subject: "Verify your email",
      html: "<p>3</p>",
      text: "3",
    });

    const all = await listCapturedEmails(db, { to: "a@e2e.test" });
    expect(all.map((m) => m.text)).toEqual(["2", "1"]);

    const verify = await listCapturedEmails(db, { to: "a@e2e.test", subject: "verify" });
    expect(verify.map((m) => m.text)).toEqual(["1"]);
    expect(verify[0]).toMatchObject({
      to: "a@e2e.test",
      subject: "Verify your email",
      html: "<p>1</p>",
    });
  });
});
