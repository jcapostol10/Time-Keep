import "server-only";

import { randomUUID } from "node:crypto";

import {
  addDaysInZone,
  KIOSK_LOCK_MS,
  KIOSK_MAX_FAILURES,
  KIOSK_PIN_LOCKED,
  KIOSK_UNAVAILABLE,
  type KioskAction,
  kioskActions,
  type KioskIdentifyInput,
  kioskState,
  NO_PIN,
  parseQrPayload,
  PERSON_LOCKED,
  PERSON_MAX_FAILURES,
  QR_INVALID,
  startOfDayInZone,
  throttleUntil,
  WRONG_PIN,
} from "@timekeep/core";
import {
  and,
  asc,
  type Database,
  type DbExecutor,
  desc,
  eq,
  gt,
  gte,
  isNull,
  kiosk,
  kioskAttempt,
  kioskCredential,
  lt,
  membership,
  project,
  sql,
  timeEntry,
  user,
  workspace,
  workspaceSettings,
} from "@timekeep/db";
import { verifyPassword } from "better-auth/crypto";

import type { KioskPerson, KioskPunchDTO, KioskVisitDTO } from "@/lib/kiosk-types";

import { WorkspaceAccessError } from "../access-error";
import { loadViewer } from "../authz";
import { TimeEntryError } from "../entry-error";
import { startTimer, stopTimer } from "../time-entries";
import { hashQrToken } from "./credentials";
import { hashKioskToken, kioskAllows } from "./kiosks";
import { assertKioskPhoto, KioskPhotoError, savePunchPhoto } from "./photos";
import { readTicket, signTicket } from "./tickets";

/**
 * The kiosk device (Phase 5c): every `/api/kiosk/[token]/…` route resolves
 * the kiosk from its token, never from a session (decision 15). Identify
 * proves the person once and returns a punch ticket (ruling R3); a punch is
 * the entry service under the person's own viewer, at the server's time
 * (decision 17).
 */

export type KioskErrorCode =
  "WRONG_PIN" | "PERSON_LOCKED" | "KIOSK_PIN_LOCKED" | "NO_PIN" | "QR_INVALID" | "WRONG_STATE";

const STATUS: Record<KioskErrorCode, number> = {
  WRONG_PIN: 401,
  PERSON_LOCKED: 423,
  KIOSK_PIN_LOCKED: 423,
  NO_PIN: 409,
  QR_INVALID: 401,
  WRONG_STATE: 409,
};

export class KioskError extends Error {
  readonly status: number;
  constructor(
    public readonly code: KioskErrorCode,
    message: string,
    public readonly extra: { until?: Date; visit?: KioskPunchDTO } = {},
  ) {
    super(message);
    this.name = "KioskError";
    this.status = STATUS[code];
  }
}

export interface ResolvedKiosk {
  id: string;
  workspaceId: string;
  name: string;
  tokenRotatedAt: Date;
  projectId: string | null;
  taskId: string | null;
  sessionTimeoutSeconds: number;
  showLogo: boolean;
  photo: boolean;
  workspaceName: string;
  logo: string | null;
  timezone: string;
  allowBreaks: boolean;
}

/** The active kiosk the token names, or the one 404 for unknown, rotated and disabled. */
export async function resolveKiosk(db: Database, token: string): Promise<ResolvedKiosk> {
  const [k] = token
    ? await db
        .select({
          id: kiosk.id,
          workspaceId: kiosk.workspaceId,
          name: kiosk.name,
          tokenRotatedAt: kiosk.tokenRotatedAt,
          projectId: kiosk.projectId,
          taskId: kiosk.taskId,
          sessionTimeoutSeconds: kiosk.sessionTimeoutSeconds,
          showLogo: kiosk.showLogo,
          photo: kiosk.photo,
          workspaceName: workspace.name,
          logo: workspace.logo,
          timezone: workspaceSettings.timezone,
          allowBreaks: workspaceSettings.allowBreaks,
        })
        .from(kiosk)
        .innerJoin(workspace, eq(workspace.id, kiosk.workspaceId))
        .innerJoin(workspaceSettings, eq(workspaceSettings.workspaceId, kiosk.workspaceId))
        .where(and(eq(kiosk.tokenHash, hashKioskToken(token)), isNull(kiosk.disabledAt)))
    : [];
  if (!k) throw new WorkspaceAccessError(404, KIOSK_UNAVAILABLE);
  return k;
}

const allowedMember = (k: ResolvedKiosk) =>
  and(
    eq(membership.workspaceId, k.workspaceId),
    eq(membership.status, "ACTIVE"),
    kioskAllows(k.id, membership.userId),
  );

/** The kiosk's allowed, active members by name (ruling R7). */
export async function kioskPeople(db: Database, k: ResolvedKiosk): Promise<KioskPerson[]> {
  const rows = await db
    .select({
      userId: user.id,
      name: user.name,
      image: user.image,
      pinHash: kioskCredential.pinHash,
    })
    .from(membership)
    .innerJoin(user, eq(user.id, membership.userId))
    .leftJoin(
      kioskCredential,
      and(
        eq(kioskCredential.workspaceId, membership.workspaceId),
        eq(kioskCredential.userId, membership.userId),
      ),
    )
    .where(allowedMember(k))
    .orderBy(asc(user.name), asc(user.id));
  return rows.map((r) => ({
    userId: r.userId,
    name: r.name,
    image: r.image,
    hasPin: r.pinHash !== null,
  }));
}

/** The allowed person's name and timezone, or the 404 for anyone else. */
async function allowedPerson(db: DbExecutor, k: ResolvedKiosk, userId: string) {
  const [p] = await db
    .select({ userId: user.id, name: user.name, timezone: user.timezone })
    .from(membership)
    .innerJoin(user, eq(user.id, membership.userId))
    .where(and(allowedMember(k), eq(membership.userId, userId)));
  if (!p) throw new WorkspaceAccessError(404, "Not found");
  return p;
}

async function running(db: DbExecutor, workspaceId: string, userId: string) {
  const [r] = await db
    .select({ id: timeEntry.id, type: timeEntry.type })
    .from(timeEntry)
    .where(
      and(
        eq(timeEntry.workspaceId, workspaceId),
        eq(timeEntry.userId, userId),
        isNull(timeEntry.end),
        isNull(timeEntry.deletedAt),
      ),
    );
  return r ?? null;
}

/** Work started on the person's own local day, the running entry counted up to now. */
export async function workedToday(
  db: DbExecutor,
  workspaceId: string,
  userId: string,
  tz: string,
  now: Date,
): Promise<number> {
  const dayStart = startOfDayInZone(now, tz);
  const dayEnd = addDaysInZone(dayStart, 1, tz);
  const [row] = await db
    .select({
      seconds: sql<number>`coalesce(sum(coalesce(${timeEntry.durationSeconds},
        greatest(0, extract(epoch from (${now.toISOString()}::timestamptz - ${timeEntry.start})))::int)), 0)::bigint`.mapWith(
        Number,
      ),
    })
    .from(timeEntry)
    .where(
      and(
        eq(timeEntry.workspaceId, workspaceId),
        eq(timeEntry.userId, userId),
        eq(timeEntry.type, "work"),
        isNull(timeEntry.deletedAt),
        gte(timeEntry.start, dayStart),
        lt(timeEntry.start, dayEnd),
      ),
    );
  return row?.seconds ?? 0;
}

async function visitOf(
  db: DbExecutor,
  k: ResolvedKiosk,
  person: { userId: string; name: string; timezone: string | null },
  now: Date,
): Promise<KioskPunchDTO> {
  const current = await running(db, k.workspaceId, person.userId);
  const state = kioskState(current);
  return {
    person: { userId: person.userId, name: person.name },
    state,
    actions: kioskActions(state, k.allowBreaks),
    workedTodaySeconds: await workedToday(
      db,
      k.workspaceId,
      person.userId,
      person.timezone ?? k.timezone,
      now,
    ),
    now: now.toISOString(),
  };
}

const LOOKBACK_MS = KIOSK_LOCK_MS * 2;
const PERSON_RULE = { max: PERSON_MAX_FAILURES, windowMs: KIOSK_LOCK_MS, lockMs: KIOSK_LOCK_MS };
const KIOSK_RULE = { max: KIOSK_MAX_FAILURES, windowMs: KIOSK_LOCK_MS, lockMs: KIOSK_LOCK_MS };

async function failuresSince(db: DbExecutor, kioskId: string, since: Date, userId?: string) {
  const rows = await db
    .select({ at: kioskAttempt.createdAt })
    .from(kioskAttempt)
    .where(
      and(
        eq(kioskAttempt.kioskId, kioskId),
        eq(kioskAttempt.success, false),
        gt(kioskAttempt.createdAt, since),
        userId === undefined ? undefined : eq(kioskAttempt.userId, userId),
      ),
    )
    .orderBy(desc(kioskAttempt.createdAt))
    .limit(1000);
  return rows.map((r) => r.at);
}

async function record(
  db: DbExecutor,
  kioskId: string,
  userId: string | null,
  method: "PIN" | "QR",
  success: boolean,
  now: Date,
) {
  await db
    .insert(kioskAttempt)
    .values({ id: randomUUID(), kioskId, userId, method, success, createdAt: now });
}

type PinOutcome = { ok: true } | { ok: false; error: KioskError };

/**
 * One PIN check under the person's kiosk lock, so parallel guesses count one
 * by one. The attempt is committed before a refusal is thrown.
 */
async function checkPin(
  db: Database,
  k: ResolvedKiosk,
  userId: string,
  pin: string,
  now: Date,
): Promise<PinOutcome> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`kiosk:${k.id}:${userId}`}))`);
    const since = new Date(now.getTime() - LOOKBACK_MS);
    const kioskUntil = throttleUntil(await failuresSince(tx, k.id, since), KIOSK_RULE, now);
    if (kioskUntil) {
      return {
        ok: false,
        error: new KioskError("KIOSK_PIN_LOCKED", KIOSK_PIN_LOCKED, { until: kioskUntil }),
      };
    }
    // Only failures since the person's last success count.
    const [last] = await tx
      .select({ at: kioskAttempt.createdAt })
      .from(kioskAttempt)
      .where(
        and(
          eq(kioskAttempt.kioskId, k.id),
          eq(kioskAttempt.userId, userId),
          eq(kioskAttempt.success, true),
        ),
      )
      .orderBy(desc(kioskAttempt.createdAt))
      .limit(1);
    const personSince = last && last.at > since ? last.at : since;
    const personUntil = throttleUntil(
      await failuresSince(tx, k.id, personSince, userId),
      PERSON_RULE,
      now,
    );
    if (personUntil) {
      return {
        ok: false,
        error: new KioskError("PERSON_LOCKED", PERSON_LOCKED, { until: personUntil }),
      };
    }
    const [cred] = await tx
      .select({ pinHash: kioskCredential.pinHash })
      .from(kioskCredential)
      .where(
        and(eq(kioskCredential.workspaceId, k.workspaceId), eq(kioskCredential.userId, userId)),
      );
    if (!cred?.pinHash) return { ok: false, error: new KioskError("NO_PIN", NO_PIN) };
    const right =
      /^\d{4,6}$/.test(pin) && (await verifyPassword({ hash: cred.pinHash, password: pin }));
    await record(tx, k.id, userId, "PIN", right, now);
    return right ? { ok: true } : { ok: false, error: new KioskError("WRONG_PIN", WRONG_PIN) };
  });
}

/** Proves who is at the kiosk, by PIN or by QR code, and returns their punch ticket. */
export async function identify(
  db: Database,
  k: ResolvedKiosk,
  input: KioskIdentifyInput,
  now = new Date(),
): Promise<KioskVisitDTO> {
  let userId: string;
  if ("qr" in input) {
    const token = parseQrPayload(input.qr);
    // Not one of ours (a URL, a product code): ignored, not counted.
    if (token === null) throw new KioskError("QR_INVALID", QR_INVALID);
    const [cred] = await db
      .select({ userId: kioskCredential.userId })
      .from(kioskCredential)
      .where(
        and(
          eq(kioskCredential.qrTokenHash, hashQrToken(token)),
          eq(kioskCredential.workspaceId, k.workspaceId),
        ),
      );
    const allowed = cred
      ? await allowedPerson(db, k, cred.userId).then(
          () => true,
          () => false,
        )
      : false;
    await record(db, k.id, allowed && cred ? cred.userId : null, "QR", allowed, now);
    if (!allowed || !cred) throw new KioskError("QR_INVALID", QR_INVALID);
    userId = cred.userId;
  } else {
    await allowedPerson(db, k, input.userId);
    const outcome = await checkPin(db, k, input.userId, input.pin, now);
    if (!outcome.ok) throw outcome.error;
    userId = input.userId;
  }
  const person = await allowedPerson(db, k, userId);
  const visit = await visitOf(db, k, person, now);
  return {
    ...visit,
    ticket: signTicket({ kioskId: k.id, userId, rotatedAt: k.tokenRotatedAt }, now),
  };
}

/** The kiosk's defaults: `Kiosk: <name>`, its project and task, the project's billable default. */
async function workDetails(db: DbExecutor, k: ResolvedKiosk) {
  let billable = false;
  if (k.projectId) {
    const [p] = await db
      .select({ billable: project.billable })
      .from(project)
      .where(eq(project.id, k.projectId));
    billable = p?.billable ?? false;
  }
  return {
    description: `Kiosk: ${k.name}`,
    projectId: k.projectId,
    taskId: k.taskId,
    tagIds: [],
    billable,
    type: "work" as const,
  };
}

/** Applies one punch (decision 17) for the ticket's person, at the server's `now`. */
export async function punch(
  db: Database,
  k: ResolvedKiosk,
  input: { ticket: string; action: KioskAction },
  photo: Uint8Array | null,
  now = new Date(),
): Promise<KioskPunchDTO> {
  const claims = readTicket(input.ticket, now);
  if (!claims || claims.kioskId !== k.id || claims.rotatedAt !== k.tokenRotatedAt.getTime()) {
    throw new WorkspaceAccessError(404, KIOSK_UNAVAILABLE);
  }
  const person = await allowedPerson(db, k, claims.userId);
  const scope = await loadViewer(db, k.workspaceId, person.userId);
  const before = await visitOf(db, k, person, now);
  if (!before.actions.includes(input.action)) {
    throw new KioskError("WRONG_STATE", "That does not fit right now.", { visit: before });
  }
  const takePhoto = input.action === "CLOCK_IN" && k.photo && photo !== null;
  if (takePhoto) assertKioskPhoto(photo);

  switch (input.action) {
    case "CLOCK_IN":
    case "END_BREAK": {
      const { started } = await startTimer(db, scope, await workDetails(db, k), now);
      if (takePhoto) {
        // Ruling R5: the photo is optional; a storage failure never undoes the punch.
        await savePunchPhoto(
          db,
          { workspaceId: k.workspaceId, entryId: started.id, bytes: photo },
          now,
        ).catch((error: unknown) => console.error("[kiosk] photo upload failed", error));
      }
      break;
    }
    case "START_BREAK":
      await startTimer(
        db,
        scope,
        {
          description: "",
          projectId: null,
          taskId: null,
          tagIds: [],
          billable: false,
          type: "break",
        },
        now,
      );
      break;
    case "CLOCK_OUT": {
      const current = await running(db, k.workspaceId, person.userId);
      if (current) await stopTimer(db, scope, { entryId: current.id }, now);
      break;
    }
  }
  return visitOf(db, k, person, now);
}

const NO_STORE = { "Cache-Control": "no-store" };

export function kioskJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

/** The kiosk routes' answer for a refusal: its status and message, never a session's. */
export function kioskErrorResponse(error: unknown): Response {
  if (error instanceof KioskError) {
    return kioskJson(
      {
        error: error.message,
        code: error.code,
        until: error.extra.until?.toISOString(),
        visit: error.extra.visit,
      },
      error.status,
    );
  }
  if (error instanceof WorkspaceAccessError) {
    return kioskJson({ error: error.message }, error.status);
  }
  if (error instanceof KioskPhotoError) return kioskJson({ error: error.message }, 400);
  if (error instanceof TimeEntryError) {
    const status = error.code === "INVALID" ? 400 : error.code === "NOT_FOUND" ? 404 : 409;
    return kioskJson({ error: error.message }, status);
  }
  console.error("[kiosk] request failed", error);
  return kioskJson({ error: "Something went wrong." }, 500);
}
