import { randomUUID } from "node:crypto";

import { kioskAttempt } from "@timekeep/db";
import { afterAll, describe, expect, it, vi } from "vitest";

const SECRET = "a-long-enough-cron-secret-for-tests";

await vi.hoisted(async () => {
  const { routesUseTestDatabase } = await import("../../../../../test/route-env");
  routesUseTestDatabase();
  process.env.CRON_SECRET = "a-long-enough-cron-secret-for-tests";
});

const { connectTestDb } = await import("../../../../../test/db");
const { frontDesk, setUpKioskCast } = await import("../../../../../test/kiosk-fixtures");
const { createKiosk } = await import("@/server/kiosk/kiosks");
const { GET } = await import("./route");

const handle = connectTestDb();
const db = handle.db;
afterAll(() => handle.close());

describe("the daily cron", () => {
  it("purges kiosk attempts older than a day", async () => {
    const cast = await setUpKioskCast(db);
    const { kiosk } = await createKiosk(db, await cast.viewer("ann"), frontDesk(cast));
    await db.insert(kioskAttempt).values({
      id: randomUUID(),
      kioskId: kiosk.id,
      method: "PIN",
      success: false,
      createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    });

    const res = await GET(
      new Request("http://localhost/api/cron/daily", {
        headers: { authorization: `Bearer ${SECRET}` },
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ kiosk: { photos: 0, attempts: 1 } });
    expect(await db.select().from(kioskAttempt)).toEqual([]);
  });
});
