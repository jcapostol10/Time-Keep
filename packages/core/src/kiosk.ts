/**
 * Kiosk rules (Phase 5c): the PIN throttles, the punch state machine, the
 * personal QR payload and the kiosk's copy. Pure; the server reads attempts
 * and running entries and asks here.
 */

/** A lock lasts this long, and failures count within this window. */
export const KIOSK_LOCK_MS = 15 * 60_000;
/** Wrong PINs for one person on one kiosk before that person is locked there. */
export const PERSON_MAX_FAILURES = 5;
/** Failures on one kiosk before its PIN entry pauses (QR stays open). */
export const KIOSK_MAX_FAILURES = 30;
/** How long a punch ticket from identify stays valid. */
export const KIOSK_TICKET_MS = 120_000;
/** Clock-in photos are deleted after this many days. */
export const KIOSK_PHOTO_DAYS = 90;
/** Attempts are deleted after this many days. */
export const KIOSK_ATTEMPT_DAYS = 1;
export const QR_PREFIX = "tkq1.";

export interface ThrottleRule {
  max: number;
  windowMs: number;
  lockMs: number;
}

/**
 * The end of the latest lock still in force, or null. `failures` are newest
 * first. A run of `max` failures within `windowMs` of each other locks for
 * `lockMs` from the last failure of the run.
 */
export function throttleUntil(
  failures: readonly Date[],
  rule: ThrottleRule,
  now: Date,
): Date | null {
  for (let i = 0; i + rule.max - 1 < failures.length; i++) {
    const newest = failures[i]!.getTime();
    const oldest = failures[i + rule.max - 1]!.getTime();
    if (newest - oldest > rule.windowMs) continue;
    const until = newest + rule.lockMs;
    // Newest first: the first run found ends the latest lock.
    return until > now.getTime() ? new Date(until) : null;
  }
  return null;
}

export const KIOSK_STATES = ["OUT", "IN", "BREAK"] as const;
export type KioskState = (typeof KIOSK_STATES)[number];

export const KIOSK_ACTIONS = ["CLOCK_IN", "START_BREAK", "END_BREAK", "CLOCK_OUT"] as const;
export type KioskAction = (typeof KIOSK_ACTIONS)[number];

export const KIOSK_ACTION_LABELS: Record<KioskAction, string> = {
  CLOCK_IN: "Clock in",
  START_BREAK: "Start break",
  END_BREAK: "End break",
  CLOCK_OUT: "Clock out",
};

export function kioskState(running: { type: "work" | "break" } | null): KioskState {
  if (running === null) return "OUT";
  return running.type === "break" ? "BREAK" : "IN";
}

export function kioskActions(state: KioskState, breaksAllowed: boolean): KioskAction[] {
  switch (state) {
    case "OUT":
      return ["CLOCK_IN"];
    case "IN":
      return breaksAllowed ? ["START_BREAK", "CLOCK_OUT"] : ["CLOCK_OUT"];
    case "BREAK":
      return ["END_BREAK", "CLOCK_OUT"];
  }
}

const QR_TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** The text a personal QR code carries. */
export function qrPayload(token: string): string {
  return `${QR_PREFIX}${token}`;
}

/** The token in a scanned code, or null for anything that is not ours. */
export function parseQrPayload(text: string): string | null {
  if (!text.startsWith(QR_PREFIX)) return null;
  const token = text.slice(QR_PREFIX.length);
  return QR_TOKEN.test(token) ? token : null;
}

export const WRONG_PIN = "Wrong PIN.";
export const PERSON_LOCKED = "Too many wrong PINs. Try again in 15 minutes.";
export const KIOSK_PIN_LOCKED = "PIN entry is paused for 15 minutes. Scan your QR code instead.";
export const QR_INVALID = "This QR code is not valid on this kiosk.";
export const NO_PIN = "No PIN set. Set one in your profile, or ask an admin.";
export const KIOSK_UNAVAILABLE = "This kiosk is not available.";
export const PIN_STRENGTH_NOTE =
  "Five wrong tries lock your PIN for 15 minutes. A 6-digit PIN is harder to guess.";
export const LIMITED_EMAIL_TAKEN = "This address already has an account; invite it instead.";
export const KIOSK_PHOTO_NOTICE = "This kiosk takes a photo when you clock in.";
export const QR_REISSUE_NOTE =
  "Showing a new code: printed copies of the old one stop working.";
