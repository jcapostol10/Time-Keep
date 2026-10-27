import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";

import {
  can,
  type ReportKind,
  type ReportQuery,
  reportQuerySchema,
  type ViewerPrefs,
} from "@timekeep/core";
import {
  and,
  type Database,
  desc,
  eq,
  isNull,
  lte,
  membership,
  or,
  reportShareLink,
  sql,
  user,
  workspace,
} from "@timekeep/db";

import { CatalogError } from "./catalog/errors";
import { loadActor } from "./authz";
import type { Viewer } from "./catalog/viewer";
import { effectiveQuery } from "./reports";

/**
 * Read-only public report links. The URL carries 32 random bytes; the
 * database keeps their sha256 only. The row keeps the effective query and
 * the creator's preferences at creation, so the page renders the same for
 * whoever opens it; it reads with the creator's current role, and stops
 * working when the creator is no longer an active member.
 */

const SHARE_EXPIRY_DAYS = [7, 30, 90] as const;
export type ShareExpiryDays = (typeof SHARE_EXPIRY_DAYS)[number];

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface CreatedShareLink {
  id: string;
  token: string;
  /** Relative: the caller adds the app's origin. */
  path: string;
}

export async function createShareLink(
  db: Database,
  viewer: Viewer,
  input: {
    kind: ReportKind;
    query: ReportQuery;
    title: string;
    expiresInDays?: ShareExpiryDays;
    /** Show amounts to the link's readers (only while the creator may see them). */
    includeAmounts?: boolean;
  },
  prefs: ViewerPrefs,
  now = new Date(),
): Promise<CreatedShareLink> {
  const token = randomBytes(32).toString("base64url");
  const id = randomUUID();
  const title = input.title.trim().slice(0, 120) || "Shared report";
  await db.insert(reportShareLink).values({
    id,
    workspaceId: viewer.workspaceId,
    createdBy: viewer.userId,
    tokenHash: hashToken(token),
    kind: input.kind,
    query: effectiveQuery(input.query, viewer) as unknown as Record<string, unknown>,
    prefs: prefs as unknown as Record<string, unknown>,
    title,
    includeAmounts:
      Boolean(input.includeAmounts) && can(viewer.actor, "report.viewAmounts", { kind: "none" }),
    expiresAt: input.expiresInDays
      ? new Date(now.getTime() + input.expiresInDays * 24 * 3_600_000)
      : null,
    createdAt: now,
    updatedAt: now,
  });
  return { id, token, path: `/share/${token}` };
}

export interface ResolvedShareLink {
  id: string;
  kind: ReportKind;
  title: string;
  query: ReportQuery;
  prefs: ViewerPrefs;
  /** Reads as the creator, with their role today. */
  viewer: Viewer;
  workspaceName: string;
}

/** The report a token points to, or null when it does not (exist, any more). */
export async function resolveShareLink(
  db: Database,
  token: string,
  now = new Date(),
): Promise<ResolvedShareLink | null> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const [row] = await db
    .select({
      link: reportShareLink,
      workspaceName: workspace.name,
      role: membership.role,
      status: membership.status,
    })
    .from(reportShareLink)
    .innerJoin(workspace, eq(workspace.id, reportShareLink.workspaceId))
    .leftJoin(
      membership,
      and(
        eq(membership.workspaceId, reportShareLink.workspaceId),
        eq(membership.userId, reportShareLink.createdBy),
      ),
    )
    .where(eq(reportShareLink.tokenHash, hashToken(token)));
  if (!row) return null;
  const { link } = row;
  if (link.revokedAt || (link.expiresAt && link.expiresAt <= now)) return null;
  if (!row.role || row.status !== "ACTIVE") return null;
  const query = reportQuerySchema.safeParse(link.query);
  if (!query.success) return null;
  const viewer: Viewer = {
    workspaceId: link.workspaceId,
    userId: link.createdBy,
    role: row.role,
    actor: await loadActor(db, link.workspaceId, link.createdBy, row.role),
    // The engine still checks that the creator may see amounts today.
    hideAmounts: !link.includeAmounts,
  };
  return {
    id: link.id,
    kind: link.kind,
    title: link.title,
    // Re-apply the member rule with the creator's current role (the engine adds their scope).
    query: effectiveQuery(query.data, viewer),
    prefs: link.prefs as unknown as ViewerPrefs,
    viewer,
    workspaceName: row.workspaceName,
  };
}

export async function recordShareOpen(db: Database, id: string, now = new Date()) {
  await db
    .update(reportShareLink)
    .set({ openCount: sql`${reportShareLink.openCount} + 1`, lastOpenedAt: now })
    .where(eq(reportShareLink.id, id));
}

/** Seconds between exports from one public link: each PDF launches Chromium. */
export const SHARE_EXPORT_INTERVAL_MS = 10_000;

/**
 * Claims the link's export slot: true at most once per SHARE_EXPORT_INTERVAL_MS. One
 * conditional UPDATE, so two requests at the same moment cannot both win.
 */
export async function claimShareExport(
  db: Database,
  id: string,
  now = new Date(),
): Promise<boolean> {
  const cutoff = new Date(now.getTime() - SHARE_EXPORT_INTERVAL_MS);
  const rows = await db
    .update(reportShareLink)
    .set({ lastExportAt: now })
    .where(
      and(
        eq(reportShareLink.id, id),
        or(isNull(reportShareLink.lastExportAt), lte(reportShareLink.lastExportAt, cutoff)),
      ),
    )
    .returning({ id: reportShareLink.id });
  return rows.length > 0;
}

export interface ShareLinkDTO {
  id: string;
  kind: ReportKind;
  title: string;
  createdBy: string;
  createdAt: string;
  expiresAt: string | null;
  openCount: number;
  lastOpenedAt: string | null;
  status: "active" | "expired" | "revoked";
  /** The viewer created it, or reads the whole team: they may revoke it. */
  canRevoke: boolean;
}

/** Whether the viewer manages everyone's links (owners, admins) or only their own. */
function managesAll(viewer: Viewer): boolean {
  return can(viewer.actor, "shareLink.manage", { kind: "shareLink", createdBy: "" });
}

/** Owners and admins see every link of the workspace; everyone else their own. */
export async function listShareLinks(db: Database, viewer: Viewer, now = new Date()) {
  const team = managesAll(viewer);
  const rows = await db
    .select({ link: reportShareLink, createdBy: user.name })
    .from(reportShareLink)
    .innerJoin(user, eq(user.id, reportShareLink.createdBy))
    .where(
      and(
        eq(reportShareLink.workspaceId, viewer.workspaceId),
        team ? undefined : eq(reportShareLink.createdBy, viewer.userId),
      ),
    )
    .orderBy(desc(reportShareLink.createdAt))
    .limit(100);
  return rows.map(({ link, createdBy }): ShareLinkDTO => ({
    id: link.id,
    kind: link.kind,
    title: link.title,
    createdBy,
    createdAt: link.createdAt.toISOString(),
    expiresAt: link.expiresAt?.toISOString() ?? null,
    openCount: link.openCount,
    lastOpenedAt: link.lastOpenedAt?.toISOString() ?? null,
    status: link.revokedAt
      ? "revoked"
      : link.expiresAt && link.expiresAt <= now
        ? "expired"
        : "active",
    canRevoke: team || link.createdBy === viewer.userId,
  }));
}

export async function revokeShareLink(db: Database, viewer: Viewer, id: string, now = new Date()) {
  const team = managesAll(viewer);
  const [row] = await db
    .update(reportShareLink)
    .set({ revokedAt: now, updatedAt: now })
    .where(
      and(
        eq(reportShareLink.id, id),
        eq(reportShareLink.workspaceId, viewer.workspaceId),
        team ? undefined : eq(reportShareLink.createdBy, viewer.userId),
      ),
    )
    .returning({ id: reportShareLink.id });
  if (!row) throw new CatalogError("NOT_FOUND", "Share link not found.");
}

export function isShareExpiry(value: unknown): value is ShareExpiryDays {
  return SHARE_EXPIRY_DAYS.includes(value as ShareExpiryDays);
}
