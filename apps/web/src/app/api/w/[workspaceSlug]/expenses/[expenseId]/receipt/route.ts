import { entryNoteSchema, RECEIPT_MAX_BYTES } from "@timekeep/core";
import { getDb } from "@timekeep/db";

import { authorize } from "@/server/authz";
import { ReceiptError, receiptUrl, removeReceipt, saveReceipt } from "@/server/expense-receipts";
import { TimeEntryError } from "@/server/time-entries";
import {
  BadRequestError,
  requireWorkspaceAccess,
  routeErrorResponse,
  type WorkspaceContext,
} from "@/server/workspace-access";

/**
 * An expense's receipt (Phase 6c decision 15). GET redirects to a 5-minute
 * presigned URL (`?thumb=1` for the thumbnail) for whoever may read the
 * expense; POST (multipart `file`, optional `thumb` and `note`) and DELETE
 * (`?note=`) write it for whoever may write the expense, through the
 * approval guard. A route handler, not an action: the file may be 4 MB.
 */

type Ctx = RouteContext<"/api/w/[workspaceSlug]/expenses/[expenseId]/receipt">;

async function viewerOf(access: WorkspaceContext) {
  return authorize(access, "expense.read", {
    kind: "entry",
    userId: access.user.id,
    projectId: null,
  });
}

function noteOf(raw: FormDataEntryValue | string | null): string | undefined {
  if (typeof raw !== "string" || raw === "") return undefined;
  const parsed = entryNoteSchema.safeParse(raw);
  if (!parsed.success) throw new BadRequestError("Say why (3 to 500 characters).");
  return parsed.data;
}

function writeError(error: unknown): Response | null {
  if (error instanceof ReceiptError) {
    return Response.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof TimeEntryError && error.code !== "NOT_FOUND") {
    return Response.json(
      {
        error: error.message,
        ...(error.code === "NOTE_REQUIRED" ? { fieldErrors: { note: [error.message] } } : {}),
      },
      { status: 400 },
    );
  }
  return null;
}

export async function GET(request: Request, ctx: Ctx) {
  try {
    const { workspaceSlug, expenseId } = await ctx.params;
    const access = await requireWorkspaceAccess(workspaceSlug);
    const viewer = await viewerOf(access);
    const thumb = new URL(request.url).searchParams.get("thumb") === "1";
    const url = await receiptUrl(getDb(), viewer, expenseId, { thumb });
    return new Response(null, {
      status: 302,
      headers: { Location: url, "Cache-Control": "no-store" },
    });
  } catch (error) {
    return routeErrorResponse(error, "receipts");
  }
}

export async function POST(request: Request, ctx: Ctx) {
  try {
    const { workspaceSlug, expenseId } = await ctx.params;
    const access = await requireWorkspaceAccess(workspaceSlug);
    const viewer = await viewerOf(access);
    // Refuse an oversized upload before reading it: the receipt, a thumbnail and the framing.
    const length = Number(request.headers.get("content-length") ?? 0);
    if (length > RECEIPT_MAX_BYTES + 512 * 1024) {
      return Response.json({ error: "A receipt is at most 4 MB." }, { status: 413 });
    }
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new BadRequestError("Choose a receipt.");
    const thumb = form.get("thumb");
    const saved = await saveReceipt(
      getDb(),
      viewer,
      expenseId,
      {
        bytes: new Uint8Array(await file.arrayBuffer()),
        mime: file.type,
        thumb: thumb instanceof File ? new Uint8Array(await thumb.arrayBuffer()) : null,
      },
      { note: noteOf(form.get("note")) },
    );
    return Response.json(saved, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return writeError(error) ?? routeErrorResponse(error, "receipts");
  }
}

export async function DELETE(request: Request, ctx: Ctx) {
  try {
    const { workspaceSlug, expenseId } = await ctx.params;
    const access = await requireWorkspaceAccess(workspaceSlug);
    const viewer = await viewerOf(access);
    const note = noteOf(new URL(request.url).searchParams.get("note"));
    const removed = await removeReceipt(getDb(), viewer, expenseId, { note });
    return Response.json(removed, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return writeError(error) ?? routeErrorResponse(error, "receipts");
  }
}
