import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { emailOutbox, eq } from "@timekeep/db";

import { connectTestDb, truncateAll } from "../../test/db";
import { drainOutbox, enqueueEmail, type RenderedEmail } from "./outbox";

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
