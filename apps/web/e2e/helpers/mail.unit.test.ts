import { randomUUID } from "node:crypto";

import nodemailer from "nodemailer";
import { describe, expect, it } from "vitest";

import { deleteMessagesTo, waitForEmail } from "./mail";

/** Against the local Mailpit (`docker compose up`), as the e2e suite runs it. */
describe("deleteMessagesTo", () => {
  it("removes one recipient's mail and leaves everyone else's", async () => {
    // Other workers wait for their own verification emails while a test clears its
    // own inbox; clearing all of Mailpit made them time out.
    const mine = `mine-${randomUUID()}@e2e.test`;
    const theirs = `theirs-${randomUUID()}@e2e.test`;
    const smtp = nodemailer.createTransport({
      host: process.env.SMTP_HOST ?? "localhost",
      port: Number(process.env.SMTP_PORT ?? 1025),
      secure: false,
    });
    for (const to of [mine, theirs]) {
      await smtp.sendMail({ from: "test@e2e.test", to, subject: "Verify", text: "x" });
    }
    await waitForEmail(mine);
    await waitForEmail(theirs);

    await deleteMessagesTo(mine);
    await expect(waitForEmail(mine, { timeoutMs: 1_000 })).rejects.toThrow(/No email/);
    await expect(waitForEmail(theirs, { timeoutMs: 1_000 })).resolves.toMatchObject({
      Subject: "Verify",
    });
    await deleteMessagesTo(theirs);
  });
});
