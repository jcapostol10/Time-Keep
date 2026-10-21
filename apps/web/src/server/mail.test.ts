import { APIError } from "better-auth/api";
import { afterEach, describe, expect, it, vi } from "vitest";

import { sendEmailOrExplain } from "./mail";

const message = { to: "a@b.co", subject: "Verify", title: "Confirm", intro: "Hi" };

describe("sendEmailOrExplain", () => {
  afterEach(() => vi.restoreAllMocks());

  it("turns a transport failure into a message the person can act on, and logs the cause", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const send = vi.fn().mockRejectedValue(new Error("550 5.7.1 Domain not verified"));
    const attempt = sendEmailOrExplain("verification email", message, send);
    await expect(attempt).rejects.toBeInstanceOf(APIError);
    await expect(attempt).rejects.toThrow(/couldn't send the verification email/);
    await attempt.catch((error: APIError) => expect(error.body?.code).toBe("EMAIL_SEND_FAILED"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("verification email"), expect.any(Error));
  });

  it("passes a successful send through", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    await expect(sendEmailOrExplain("invitation email", message, send)).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledWith(message);
  });
});
