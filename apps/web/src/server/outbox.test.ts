import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { emailOutbox, eq } from "@timekeep/db";

import { connectTestDb, truncateAll } from "../../test/db";
import { drainAll, drainOutbox, enqueueEmail, outboxAudience, type RenderedEmail } from "./outbox";

const h = connectTestDb();
const db = h.db;

afterAll(() => h.close());
beforeEach(() => truncateAll(db));

const T0 = new Date("2026-11-02T00:00:00Z");
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);

function mail(to: string) {
  return {
    workspaceId: null,
    to,
    subject: `Hello ${to}`,
    kind: "test",
    title: "Hello",
    intro: "A test message.",
  };
}

function recorder(delayMs = 0) {
  const sent: RenderedEmail[] = [];
  const send = async (msg: RenderedEmail) => {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    sent.push(msg);
    return "sent" as const;
  };
  return { sent, send };
}

async function rows() {
  return db.select().from(emailOutbox).orderBy(emailOutbox.toAddress);
}

describe("enqueueEmail", () => {
  it("writes nothing when its transaction rolls back", async () => {
    await expect(
      db.transaction(async (tx) => {
        await enqueueEmail(tx, mail("ann@test.local"));
        throw new Error("the cause failed");
      }),
    ).rejects.toThrow("the cause failed");
    expect(await rows()).toEqual([]);
  });

  it("renders the message when it is enqueued", async () => {
    await enqueueEmail(db, mail("ann@test.local"));
    const [row] = await rows();
    expect(row).toMatchObject({ status: "PENDING", attempts: 0, subject: "Hello ann@test.local" });
    expect(row?.html).toContain("A test message.");
    expect(row?.text).toContain("A test message.");
  });

  it("stores a .invalid address as skipped, never to be sent", async () => {
    await enqueueEmail(db, mail("kiosk-7@limited.invalid"));
    const { sent, send } = recorder();
    expect(await drainOutbox(db, { send, now: minutes(1) })).toEqual({ sent: 0, failed: 0 });
    expect(sent).toEqual([]);
    expect((await rows())[0]?.status).toBe("SKIPPED");
  });
});

describe("drainOutbox", () => {
  it("sends once and marks the row sent", async () => {
    await enqueueEmail(db, mail("ann@test.local"));
    const { sent, send } = recorder();
    expect(await drainOutbox(db, { send, now: minutes(1) })).toEqual({ sent: 1, failed: 0 });
    expect(await drainOutbox(db, { send, now: minutes(2) })).toEqual({ sent: 0, failed: 0 });
    expect(sent.map((m) => m.to)).toEqual(["ann@test.local"]);
    const [row] = await rows();
    expect(row).toMatchObject({ status: "SENT", attempts: 1 });
    expect(row?.sentAt).not.toBeNull();
  });

  it("does not send a row before it is due", async () => {
    await enqueueEmail(db, mail("ann@test.local"));
    await db
      .update(emailOutbox)
      .set({ nextAttemptAt: minutes(30) })
      .where(eq(emailOutbox.toAddress, "ann@test.local"));
    const { sent, send } = recorder();
    await drainOutbox(db, { send, now: minutes(1) });
    expect(sent).toEqual([]);
  });

  it("sends each email once when two drains run at the same time", async () => {
    for (const to of ["a@test.local", "b@test.local", "c@test.local"]) {
      await enqueueEmail(db, mail(to));
    }
    const other = connectTestDb();
    try {
      const { sent, send } = recorder(50);
      const [one, two] = await Promise.all([
        drainOutbox(db, { send, now: minutes(1) }),
        drainOutbox(other.db, { send, now: minutes(1) }),
      ]);
      expect(one.sent + two.sent).toBe(3);
      expect(sent.map((m) => m.to).sort()).toEqual([
        "a@test.local",
        "b@test.local",
        "c@test.local",
      ]);
    } finally {
      await other.close();
    }
  });

  it("retries a failure with backoff, then gives up after five attempts", async () => {
    await enqueueEmail(db, mail("ann@test.local"));
    let calls = 0;
    const send = async () => {
      calls++;
      throw new Error("SMTP is down");
    };
    // Attempts at +1, then 1, 5, 30 and 120 minutes after each failure.
    const at = [1, 2, 7, 37, 157];
    for (const [i, m] of at.entries()) {
      // Just before it is due, nothing is tried.
      if (i > 0) {
        await drainOutbox(db, { send, now: minutes(m - 0.5) });
        expect(calls).toBe(i);
      }
      expect(await drainOutbox(db, { send, now: minutes(m) })).toEqual({ sent: 0, failed: 1 });
      expect(calls).toBe(i + 1);
    }
    const [row] = await rows();
    expect(row).toMatchObject({ status: "FAILED", attempts: 5, lastError: "SMTP is down" });
    await drainOutbox(db, { send, now: minutes(10_000) });
    expect(calls).toBe(5);
  });
});

describe("one outbox shared by production and previews", () => {
  it("knows which mail each environment owns", () => {
    expect(outboxAudience({ VERCEL_ENV: "production", MAIL_CAPTURE: true })).toBe("real");
    expect(outboxAudience({ VERCEL_ENV: "preview", MAIL_CAPTURE: true })).toBe("e2e");
    expect(outboxAudience({ VERCEL_ENV: "preview" })).toBe("e2e");
    expect(outboxAudience({})).toBe("all");
  });

  it("a preview never claims a customer's email, and production never claims e2e mail", async () => {
    await enqueueEmail(db, mail("boss@customer.com"));
    await enqueueEmail(db, mail("tina@e2e.test"));
    await enqueueEmail(db, mail("member1@demo.test"));
    const preview = recorder();
    expect(await drainOutbox(db, { send: preview.send, now: minutes(1), audience: "e2e" })).toEqual(
      {
        sent: 2,
        failed: 0,
      },
    );
    expect(preview.sent.map((m) => m.to).sort()).toEqual(["member1@demo.test", "tina@e2e.test"]);
    const production = recorder();
    await drainOutbox(db, { send: production.send, now: minutes(2), audience: "real" });
    expect(production.sent.map((m) => m.to)).toEqual(["boss@customer.com"]);
  });

  it("production stores mail for e2e and demo addresses as skipped, a preview a customer's", async () => {
    await enqueueEmail(db, mail("member1@demo.test"), { audience: "real" });
    await enqueueEmail(db, mail("boss@customer.com"), { audience: "e2e" });
    await enqueueEmail(db, mail("ann@test.local"), { audience: "real" });
    const byTo = Object.fromEntries((await rows()).map((r) => [r.toAddress, r.status]));
    expect(byTo).toEqual({
      "member1@demo.test": "SKIPPED",
      "boss@customer.com": "SKIPPED",
      "ann@test.local": "PENDING",
    });
  });
});

describe("drainAll", () => {
  it("keeps draining full batches until the outbox is empty", async () => {
    for (let i = 0; i < 7; i++) await enqueueEmail(db, mail(`p${i}@test.local`));
    const { sent, send } = recorder();
    expect(await drainAll(db, { send, limit: 3, now: minutes(1) })).toEqual({ sent: 7, failed: 0 });
    expect(sent).toHaveLength(7);
  });
});

describe("clocks", () => {
  it("a row is due by the database's clock, even when the app's clock is behind it", async () => {
    await enqueueEmail(db, mail("ann@test.local"));
    // The app server's clock a minute slow (the Docker VM's clock drifts).
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.now() - 60_000));
    try {
      const { sent, send } = recorder();
      expect(await drainOutbox(db, { send })).toEqual({ sent: 1, failed: 0 });
      expect(sent).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
