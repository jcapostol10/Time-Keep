import "server-only";

import { getDb } from "@timekeep/db";
import { notFound } from "next/navigation";

import type { Viewer } from "./catalog/viewer";
import { WorkspaceAccessError } from "./access-error";
import { canWriteTimesFor, targetScope, viewerFor, writableUsers } from "./authz";

/*
 * Kept apart from authz.ts, which scripts (report:perf) load outside Next:
 * next/navigation does not load there.
 */

/** Pages: a refusal renders the not-found page, as requireWorkspacePage does. */
export async function authorizePage(check: () => Promise<Viewer>): Promise<Viewer> {
  try {
    return await check();
  } catch (error) {
    if (error instanceof WorkspaceAccessError) notFound();
    throw error;
  }
}

/**
 * Whose entries a tracker page shows: the viewer's own, or `?user=<id>` after
 * `targetScope` (not found outside the actor's scope). The target carries
 * whether its times may be typed, so the pages' inputs follow the shown
 * person rather than the viewer's own rule.
 */
export async function shownPerson(
  ctx: Parameters<typeof viewerFor>[0] & { user: { id: string } },
  raw: Record<string, string | string[] | undefined>,
) {
  const db = getDb();
  const me = await viewerFor(ctx);
  const people = await writableUsers(db, me);
  const userParam = typeof raw.user === "string" ? raw.user : null;
  if (!userParam || userParam === ctx.user.id) return { scope: me, people, target: null, key: "me" };
  const scope = await authorizePage(() => targetScope(ctx, userParam));
  const name = people.find((p) => p.id === userParam)?.name ?? "";
  return {
    scope,
    people,
    target: { userId: userParam, name, canWriteTimes: canWriteTimesFor(scope) },
    key: userParam,
  };
}
