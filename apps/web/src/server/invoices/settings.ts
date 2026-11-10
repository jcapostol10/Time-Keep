import "server-only";

import { formatInvoiceNumber, type InvoiceSettingsInput, type WeekStartDay } from "@timekeep/core";
import {
  type DbExecutor,
  eq,
  type InvoiceSettings,
  invoiceSettings,
  workspace,
  workspaceSettings,
} from "@timekeep/db";

import type { InvoiceSettingsDTO } from "@/lib/invoice-types";

import { assertCan } from "../authz";
import type { Viewer } from "../catalog/viewer";

/**
 * Numbering and branding (decisions 20 and 24): one `invoice_settings` row per
 * workspace, created with the defaults on first use; the next number is
 * taken under a row lock.
 */

type Executor = Pick<DbExecutor, "select" | "insert" | "update">;

/** What every invoice read needs of the workspace: one join. */
export interface InvoiceWorkspace {
  id: string;
  slug: string;
  name: string;
  logo: string | null;
  timezone: string;
  weekStart: WeekStartDay;
  currency: string;
}

export async function invoiceWorkspace(
  db: Pick<DbExecutor, "select">,
  workspaceId: string,
): Promise<InvoiceWorkspace> {
  const [row] = await db
    .select({
      id: workspace.id,
      slug: workspace.slug,
      name: workspace.name,
      logo: workspace.logo,
      timezone: workspaceSettings.timezone,
      weekStart: workspaceSettings.weekStart,
      currency: workspaceSettings.currency,
    })
    .from(workspace)
    .innerJoin(workspaceSettings, eq(workspaceSettings.workspaceId, workspace.id))
    .where(eq(workspace.id, workspaceId));
  if (!row) throw new Error(`Workspace ${workspaceId} has no settings`);
  return { ...row, weekStart: row.weekStart as WeekStartDay };
}

async function ensureRow(db: Executor, workspaceId: string): Promise<InvoiceSettings> {
  await db.insert(invoiceSettings).values({ workspaceId }).onConflictDoNothing();
  const [row] = await db
    .select()
    .from(invoiceSettings)
    .where(eq(invoiceSettings.workspaceId, workspaceId));
  if (!row) throw new Error(`No invoice settings for ${workspaceId}`);
  return row;
}

function toInput(row: InvoiceSettings): InvoiceSettingsInput {
  return {
    companyName: row.companyName,
    address: row.address,
    taxLine: row.taxLine,
    notes: row.notes,
    paymentTermsDays: row.paymentTermsDays,
    numberPrefix: row.numberPrefix,
    nextNumber: row.nextNumber,
    numberPadding: row.numberPadding,
    tax1Name: row.tax1Name,
    tax1Bps: row.tax1Bps,
    tax2Name: row.tax2Name,
    tax2Bps: row.tax2Bps,
  };
}

/** The settings without an authorization check, for the service's own reads (a new invoice, the PDF). */
export async function readInvoiceSettings(
  db: Executor,
  workspaceId: string,
): Promise<InvoiceSettingsInput> {
  return toInput(await ensureRow(db, workspaceId));
}

export async function getInvoiceSettings(
  db: Executor,
  viewer: Viewer,
): Promise<InvoiceSettingsDTO> {
  assertCan(viewer.actor, "invoice.manage", { kind: "none" });
  const input = await readInvoiceSettings(db, viewer.workspaceId);
  const ws = await invoiceWorkspace(db, viewer.workspaceId);
  return {
    ...input,
    logoUrl: ws.logo,
    nextNumberPreview: formatInvoiceNumber(
      input.numberPrefix,
      input.nextNumber,
      input.numberPadding,
    ),
  };
}

export async function updateInvoiceSettings(
  db: Executor,
  viewer: Viewer,
  input: InvoiceSettingsInput,
): Promise<InvoiceSettingsDTO> {
  assertCan(viewer.actor, "invoice.manage", { kind: "none" });
  await ensureRow(db, viewer.workspaceId);
  await db
    .update(invoiceSettings)
    .set({
      companyName: input.companyName,
      address: input.address,
      taxLine: input.taxLine,
      notes: input.notes,
      paymentTermsDays: input.paymentTermsDays,
      numberPrefix: input.numberPrefix,
      nextNumber: input.nextNumber,
      numberPadding: input.numberPadding,
      tax1Name: input.tax1Name,
      tax1Bps: input.tax1Bps,
      tax2Name: input.tax2Name,
      tax2Bps: input.tax2Bps,
    })
    .where(eq(invoiceSettings.workspaceId, viewer.workspaceId));
  return getInvoiceSettings(db, viewer);
}

/**
 * The next invoice number, under `SELECT … FOR UPDATE` of the settings row, so
 * two invoices created at once cannot share one; the caller's transaction
 * holds the lock until it commits.
 */
export async function takeInvoiceNumber(tx: Executor, workspaceId: string): Promise<string> {
  await ensureRow(tx, workspaceId);
  const [row] = await tx
    .select({
      prefix: invoiceSettings.numberPrefix,
      next: invoiceSettings.nextNumber,
      padding: invoiceSettings.numberPadding,
    })
    .from(invoiceSettings)
    .where(eq(invoiceSettings.workspaceId, workspaceId))
    .for("update");
  if (!row) throw new Error(`No invoice settings for ${workspaceId}`);
  await tx
    .update(invoiceSettings)
    .set({ nextNumber: row.next + 1 })
    .where(eq(invoiceSettings.workspaceId, workspaceId));
  return formatInvoiceNumber(row.prefix, row.next, row.padding);
}
