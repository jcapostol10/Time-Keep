import { APIError } from "better-auth/api";
import { afterEach, describe, expect, it, vi } from "vitest";

import { invitationEmail, isTransportError, sendEmailOrExplain, withoutAddresses } from "./mail";

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
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("verification email"),
      expect.any(Error),
    );
  });

  it("passes a successful send through", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    await expect(sendEmailOrExplain("invitation email", message, send)).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledWith(message);
  });
});

describe("invitationEmail", () => {
  it("addresses the invitee with the inviter, workspace, role and the accept link", () => {
    const mail = invitationEmail({
      id: "inv_1",
      appUrl: "https://app.example",
      email: "new@b.co",
      workspaceName: "Acme",
      inviterName: "Ada",
      inviterEmail: "ada@b.co",
      role: "member",
    });
    expect(mail.to).toBe("new@b.co");
    expect(mail.subject).toBe("Ada invited you to Acme on TimeKeep");
    expect(mail.intro).toContain('"Acme" as member');
    expect(mail.cta).toEqual({
      label: "Accept invitation",
      url: "https://app.example/invite/inv_1",
    });
  });
});

describe("transport errors shown to the person who asked for a test email", () => {
  it("recognises nodemailer's errors and nothing else", () => {
    expect(isTransportError(Object.assign(new Error("x"), { code: "ECONNECTION" }))).toBe(true);
    expect(isTransportError(Object.assign(new Error("x"), { responseCode: 550 }))).toBe(true);
    expect(isTransportError(new Error("Failed query: insert ..."))).toBe(false);
  });

  it("strips addresses and ports from the message", () => {
    expect(withoutAddresses("connect ECONNREFUSED 10.1.2.3:587")).toBe(
      "connect ECONNREFUSED <host>",
    );
    expect(withoutAddresses("550 5.7.1 Domain not verified")).toBe("550 5.7.1 Domain not verified");
  });
});
