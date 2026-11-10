import "server-only";

import { randomUUID } from "node:crypto";

import {
  addDaysToKey,
  type ImportGroup,
  IMPORT_GROUPS,
  invoiceLineSchema,
  localDateKey,
  type RecurringInvoiceInput,
  recurringDue,
  type RecurringSchedule,
} from "@timekeep/core";
import {
  and,
  client,
  type Database,
  type DbExecutor,
  desc,
  eq,
  invoice,
  membership,
  type RecurringInvoice,
  recurringInvoice,
} from "@timekeep/db";

import type { RecurringInvoiceDTO } from "@/lib/invoice-types";

import { loadViewer } from "../authz";
import { CatalogError, isUniqueViolation } from "../catalog/errors";
import type { Viewer } from "../catalog/viewer";
import { env } from "../env";
import { enqueueEmail } from "../outbox";
import { activeAdminEmails, recurringUnsentEmail } from "./emails";
import { importInto } from "./import";
import { createInvoiceRow, insertManualLines, recomputeTotals, sendInvoice } from "./invoices";
import { requireManage } from "./read";

/**
 * Recurring invoices (decision 27): templates the daily job turns into one
 * invoice per period. `(recurring_id, period_key)` is unique, so a second run
 * the same day, or two runs at once, create nothing more.
 */

type Executor = DbExecutor;

/** How far ahead the next run is looked for: past every monthly gap. */
const LOOKAHEAD_DAYS = 62;

export interface RecurringZone {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  currency: string;
}

function scheduleOf(t: RecurringInvoice): RecurringSchedule {
  return {
    kind: t.schedule,
    weekday: t.weekday,
    dayOfMonth: t.dayOfMonth,
    startDate: t.startDate,
    endDate: t.endDate,
  };
}

function linesOf(t: RecurringInvoice) {
  return (Array.isArray(t.lines) ? t.lines : []).flatMap((l) => {
    const parsed = invoiceLineSchema.safeParse(l);
    return parsed.success ? [parsed.data] : [];
  });
}

function groupOf(t: RecurringInvoice): ImportGroup {
  return (IMPORT_GROUPS as readonly string[]).includes(t.importGroupBy)
    ? (t.importGroupBy as ImportGroup)
    : "project";
}

/** The first day from `todayKey` the template is due for a period not yet invoiced, within the lookahead. */
export function nextRunDate(
  t: RecurringInvoice,
  todayKey: string,
  donePeriods: ReadonlySet<string>,
): string | null {
  if (!t.active) return null;
  const schedule = scheduleOf(t);
  for (let i = 0, key = todayKey; i <= LOOKAHEAD_DAYS; i++, key = addDaysToKey(key, 1)) {
    const due = recurringDue(schedule, key);
    if (due && !donePeriods.has(due.periodKey)) return key;
  }
  return null;
}

async function toDTOs(
  db: Executor,
  rows: { template: RecurringInvoice; clientName: string }[],
  todayKey: string,
): Promise<RecurringInvoiceDTO[]> {
  const out: RecurringInvoiceDTO[] = [];
  for (const { template: t, clientName } of rows) {
    const made = await db
      .select({ id: invoice.id, number: invoice.number, periodKey: invoice.periodKey })
      .from(invoice)
      .where(eq(invoice.recurringId, t.id))
      .orderBy(desc(invoice.periodKey), desc(invoice.createdAt));
    const last = made[0];
    const done = new Set(made.flatMap((m) => (m.periodKey ? [m.periodKey] : [])));
    out.push({
      id: t.id,
      clientId: t.clientId,
      clientName,
      name: t.name,
      schedule: t.schedule,
      weekday: t.weekday,
      dayOfMonth: t.dayOfMonth,
      startDate: t.startDate,
      endDate: t.endDate,
      lines: linesOf(t),
      importPeriod: t.importPeriod,
      importGroupBy: groupOf(t),
      mode: t.mode,
      active: t.active,
      lastInvoice:
        last && last.periodKey
          ? { id: last.id, number: last.number, periodKey: last.periodKey }
          : null,
      nextRunDate: nextRunDate(t, todayKey, done),
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    });
  }
  return out;
}

async function rowsOf(db: Executor, workspaceId: string, id?: string) {
  return db
    .select({ template: recurringInvoice, clientName: client.name })
    .from(recurringInvoice)
    .innerJoin(client, eq(client.id, recurringInvoice.clientId))
    .where(
      and(
        eq(recurringInvoice.workspaceId, workspaceId),
        id ? eq(recurringInvoice.id, id) : undefined,
      ),
    )
    .orderBy(recurringInvoice.name, recurringInvoice.id);
}

async function todayOf(db: Executor, workspaceId: string, now: Date): Promise<string> {
  const row = await db.query.workspaceSettings.findFirst({
    where: (t, { eq: e }) => e(t.workspaceId, workspaceId),
    columns: { timezone: true },
  });
  return localDateKey(now, row?.timezone ?? "UTC");
}

export async function listRecurring(
  db: Executor,
  viewer: Viewer,
  now: Date = new Date(),
): Promise<RecurringInvoiceDTO[]> {
  requireManage(viewer);
  return toDTOs(
    db,
    await rowsOf(db, viewer.workspaceId),
    await todayOf(db, viewer.workspaceId, now),
  );
}

async function getRecurring(
  db: Executor,
  viewer: Viewer,
  id: string,
  now: Date,
): Promise<RecurringInvoiceDTO> {
  const [dto] = await toDTOs(
    db,
    await rowsOf(db, viewer.workspaceId, id),
    await todayOf(db, viewer.workspaceId, now),
  );
  if (!dto) throw new CatalogError("NOT_FOUND", "Recurring invoice not found.");
  return dto;
}

async function assertClient(db: Executor, workspaceId: string, clientId: string): Promise<void> {
  const [c] = await db
    .select({ archived: client.archived })
    .from(client)
    .where(and(eq(client.id, clientId), eq(client.workspaceId, workspaceId)));
  if (!c) throw new CatalogError("NOT_FOUND", "Client not found.");
  if (c.archived) throw new CatalogError("INVALID", "This client is archived.");
}

function columnsOf(input: RecurringInvoiceInput) {
  return {
    clientId: input.clientId,
    name: input.name,
    schedule: input.schedule,
    weekday: input.schedule === "WEEKLY" ? input.weekday : null,
    dayOfMonth: input.schedule === "MONTHLY" ? input.dayOfMonth : null,
    startDate: input.startDate,
    endDate: input.endDate,
    lines: input.lines,
    importPeriod: input.importPeriod,
    importGroupBy: input.importGroupBy,
    mode: input.mode,
    active: input.active,
  };
}

export async function createRecurring(
  db: Executor,
  viewer: Viewer,
  input: RecurringInvoiceInput,
  now: Date = new Date(),
): Promise<RecurringInvoiceDTO> {
  requireManage(viewer);
  await assertClient(db, viewer.workspaceId, input.clientId);
  const id = randomUUID();
  await db.insert(recurringInvoice).values({
    id,
    workspaceId: viewer.workspaceId,
    createdBy: viewer.userId,
    ...columnsOf(input),
  });
  return getRecurring(db, viewer, id, now);
}

export async function updateRecurring(
  db: Executor,
  viewer: Viewer,
  id: string,
  input: RecurringInvoiceInput,
  now: Date = new Date(),
): Promise<RecurringInvoiceDTO> {
  requireManage(viewer);
  await getRecurring(db, viewer, id, now);
  await assertClient(db, viewer.workspaceId, input.clientId);
  await db
    .update(recurringInvoice)
    .set(columnsOf(input))
    .where(and(eq(recurringInvoice.id, id), eq(recurringInvoice.workspaceId, viewer.workspaceId)));
  return getRecurring(db, viewer, id, now);
}

/** Deletes the template; its invoices stay (the foreign key clears `recurring_id`). */
export async function deleteRecurring(db: Executor, viewer: Viewer, id: string): Promise<void> {
  requireManage(viewer);
  const rows = await db
    .delete(recurringInvoice)
    .where(and(eq(recurringInvoice.id, id), eq(recurringInvoice.workspaceId, viewer.workspaceId)))
    .returning({ id: recurringInvoice.id });
  if (rows.length === 0) throw new CatalogError("NOT_FOUND", "Recurring invoice not found.");
}

/** The template's creator while they still manage invoices here, else the workspace owner. */
async function runAs(db: Database, workspaceId: string, createdBy: string | null): Promise<Viewer> {
  const candidates = createdBy ? [createdBy] : [];
  const [owner] = await db
    .select({ userId: membership.userId })
    .from(membership)
    .where(
      and(
        eq(membership.workspaceId, workspaceId),
        eq(membership.role, "owner"),
        eq(membership.status, "ACTIVE"),
      ),
    )
    .limit(1);
  if (owner) candidates.push(owner.userId);
  for (const userId of candidates) {
    try {
      const viewer = await loadViewer(db, workspaceId, userId);
      if (viewer.role === "owner" || viewer.role === "admin") return viewer;
    } catch {
      // not a member any more: try the next
    }
  }
  throw new Error(`Workspace ${workspaceId} has no active owner to run recurring invoices as`);
}

/**
 * The daily job's part: for each active template due today whose period has
 * no invoice yet, one invoice in one transaction (the fixed lines, then the
 * period's import); in SEND mode it is sent with the client's email, or left
 * as a draft while the owners and admins hear why.
 */
export async function runRecurringInvoices(
  db: Database,
  ws: RecurringZone,
  now: Date,
): Promise<{ created: number; sent: number }> {
  const today = localDateKey(now, ws.timezone);
  const templates = await db
    .select()
    .from(recurringInvoice)
    .where(and(eq(recurringInvoice.workspaceId, ws.id), eq(recurringInvoice.active, true)))
    .orderBy(recurringInvoice.createdAt, recurringInvoice.id);
  let created = 0;
  let sent = 0;
  for (const t of templates) {
    const due = recurringDue(scheduleOf(t), today);
    if (!due) continue;
    const [exists] = await db
      .select({ id: invoice.id })
      .from(invoice)
      .where(and(eq(invoice.recurringId, t.id), eq(invoice.periodKey, due.periodKey)))
      .limit(1);
    if (exists) continue;
    const viewer = await runAs(db, ws.id, t.createdBy);
    let invoiceId: string;
    try {
      invoiceId = await db.transaction(async (tx) => {
        const id = await createInvoiceRow(tx, {
          workspaceId: ws.id,
          clientId: t.clientId,
          createdBy: t.createdBy,
          issueDate: today,
          recurringId: t.id,
          periodKey: due.periodKey,
        });
        await insertManualLines(tx, id, linesOf(t));
        if (t.importPeriod) {
          await importInto(tx, viewer, id, {
            from: due.periodStart,
            to: due.periodEnd,
            projectIds: [],
            groupBy: groupOf(t),
            expenses: true,
          });
        }
        await recomputeTotals(tx, id);
        return id;
      });
    } catch (error) {
      // Another run of the same day got there first.
      if (isUniqueViolation(error, "invoice_recurring_period_uq")) continue;
      throw error;
    }
    created++;
    if (t.mode !== "SEND") continue;
    try {
      await sendInvoice(db, viewer, invoiceId, { email: true, now });
      sent++;
    } catch (error) {
      if (!(error instanceof CatalogError)) throw error;
      const [row] = await db
        .select({ number: invoice.number, clientName: client.name })
        .from(invoice)
        .innerJoin(client, eq(client.id, invoice.clientId))
        .where(eq(invoice.id, invoiceId));
      const reason = error.message.endsWith(".") ? error.message : `${error.message}.`;
      const content = recurringUnsentEmail({
        appUrl: env().APP_URL,
        slug: ws.slug,
        invoiceId,
        number: row?.number ?? "",
        templateName: t.name,
        clientName: row?.clientName ?? "",
        reason: reason.charAt(0).toLowerCase() + reason.slice(1),
      });
      for (const to of await activeAdminEmails(db, ws.id)) {
        await enqueueEmail(db, {
          workspaceId: ws.id,
          to,
          kind: `invoice.recurring-unsent:${t.id}:${due.periodKey}`,
          ...content,
        });
      }
    }
  }
  return { created, sent };
}
