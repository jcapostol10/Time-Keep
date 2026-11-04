import { describe, expect, it } from "vitest";

import { readTicket, signTicket } from "./tickets";

const now = new Date("2026-11-04T08:00:00Z");
const rotatedAt = new Date("2026-11-01T00:00:00Z");
const input = { kioskId: "k1", userId: "u1", rotatedAt };

describe("punch tickets", () => {
  it("round-trip", () => {
    expect(readTicket(signTicket(input, now), now)).toEqual({
      kioskId: "k1",
      userId: "u1",
      rotatedAt: rotatedAt.getTime(),
    });
  });

  it("refuse a ticket with a changed byte", () => {
    const ticket = signTicket(input, now);
    const [body = "", mac = ""] = ticket.split(".");
    const other = signTicket({ ...input, userId: "u2" }, now).split(".")[0] ?? "";
    expect(readTicket(`${other}.${mac}`, now)).toBeNull();
    const flipped = `${body.slice(0, -1)}${body.endsWith("A") ? "B" : "A"}.${mac}`;
    expect(readTicket(flipped, now)).toBeNull();
    expect(readTicket("garbage", now)).toBeNull();
  });

  it("expire after 120 seconds", () => {
    const ticket = signTicket(input, now);
    expect(readTicket(ticket, new Date(now.getTime() + 119_000))).not.toBeNull();
    expect(readTicket(ticket, new Date(now.getTime() + 120_000))).toBeNull();
  });
});
