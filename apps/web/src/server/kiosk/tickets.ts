import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { KIOSK_TICKET_MS } from "@timekeep/core";

import { env } from "../env";

/**
 * A punch ticket (ruling R3): identify checks the PIN or QR code once and
 * returns this signed, short-lived proof; the punch that follows presents it.
 * It names the kiosk, the person and the kiosk's token rotation, so rotating
 * the kiosk retires every ticket issued before.
 */

interface TicketBody {
  k: string;
  u: string;
  r: number;
  e: number;
}

function key(): Buffer {
  return createHash("sha256").update(`kiosk-ticket:${env().BETTER_AUTH_SECRET}`).digest();
}

function sign(body: string): Buffer {
  return createHmac("sha256", key()).update(body).digest();
}

export function signTicket(
  input: { kioskId: string; userId: string; rotatedAt: Date },
  now: Date,
): string {
  const body: TicketBody = {
    k: input.kioskId,
    u: input.userId,
    r: input.rotatedAt.getTime(),
    e: now.getTime() + KIOSK_TICKET_MS,
  };
  const encoded = Buffer.from(JSON.stringify(body)).toString("base64url");
  return `${encoded}.${sign(encoded).toString("base64url")}`;
}

/** The ticket's claims, or null when it is malformed, tampered with or expired. */
export function readTicket(
  ticket: string,
  now: Date,
): { kioskId: string; userId: string; rotatedAt: number } | null {
  const [encoded, mac, extra] = ticket.split(".");
  if (!encoded || !mac || extra !== undefined) return null;
  const given = Buffer.from(mac, "base64url");
  const expected = sign(encoded);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let body: Partial<TicketBody>;
  try {
    body = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Partial<TicketBody>;
  } catch {
    return null;
  }
  if (
    typeof body.k !== "string" ||
    typeof body.u !== "string" ||
    typeof body.r !== "number" ||
    typeof body.e !== "number" ||
    body.e <= now.getTime()
  ) {
    return null;
  }
  return { kioskId: body.k, userId: body.u, rotatedAt: body.r };
}
