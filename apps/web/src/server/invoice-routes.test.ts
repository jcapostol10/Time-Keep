import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { addMember, connectTestDb, createTestUser } from "../../test/db";
import { type InvoiceFixture, setUpInvoiceFixture, WEEK } from "../../test/invoice-fixtures";
import { routeParams } from "../../test/route-env";
import type { AuthSession } from "./auth";
import type { Viewer } from "./catalog/viewer";

await vi.hoisted(async () => {
  const { routesUseTestDatabase } = await import("../../test/route-env");
  routesUseTestDatabase();
});

const session = vi.hoisted(() => ({ current: null as AuthSession | null }));
vi.mock("./session", () => ({ getSession: async () => session.current }));
vi.mock("next/server", async (original) => ({
  ...(await original<object>()),
  after: () => undefined,
}));

const store = vi.hoisted(() => ({
  pdf: new Uint8Array([37, 80, 68, 70, 45]),
  stored: new Map<string, Uint8Array>(),
}));
vi.mock("./storage", () => ({
  uploadExport: async (args: { key: string; body: Uint8Array }) => {
    store.stored.set(args.key, args.body);
  },
  deleteExport: async () => undefined,
  presignedExportUrl: async (key: string, ttl: number, filename: string) =>
    `https://signed.test/${key}?ttl=${ttl}&name=${encodeURIComponent(filename)}`,
  getExport: async (key: string) => store.stored.get(key) ?? new Uint8Array(),
}));
vi.mock("./invoices/pdf", async (original) => ({
  ...(await original<object>()),
  buildInvoicePdf: async () => store.pdf,
}));

const { GET: listGET } = await import("@/app/api/w/[workspaceSlug]/invoices/route");
const { GET: oneGET } = await import("@/app/api/w/[workspaceSlug]/invoices/[invoiceId]/route");
const { GET: pdfGET } = await import("@/app/api/w/[workspaceSlug]/invoices/[invoiceId]/pdf/route");
const { GET: previewGET } =
  await import("@/app/api/w/[workspaceSlug]/invoices/[invoiceId]/import-preview/route");
const { GET: settingsGET } = await import("@/app/api/w/[workspaceSlug]/invoices/settings/route");
const { GET: recurringGET } = await import("@/app/api/w/[workspaceSlug]/invoices/recurring/route");
const { GET: publicPdfGET } = await import("@/app/invoice/[token]/pdf/route");
const { addManualLine, createInvoice, sendInvoice } = await import("./invoices/invoices");

const handle = connectTestDb();
const db = handle.db;
afterAll(() => handle.close());

let f: InvoiceFixture;
let owner: Viewer;
let slug: string;

function signIn(id: string) {
  session.current = { user: { id }, session: { id: randomUUID(), userId: id } } as AuthSession;
}
const url = (path: string) => new Request(`http://localhost/api/w/${slug}/invoices${path}`);
const ctx = () => routeParams({ workspaceSlug: slug });
const ctxOf = (invoiceId: string) => routeParams({ workspaceSlug: slug, invoiceId });

beforeEach(async () => {
  store.stored.clear();
  f = await setUpInvoiceFixture(db);
  owner = await f.viewer("olga");
  const ws = await db.query.workspace.findFirst({ where: (t, { eq: e }) => e(t.id, f.wsId) });
  slug = ws!.slug;
  signIn(f.ids.olga!);
});

describe("the invoice routes", () => {
  it("answer the owner and refuse a manager and a member with 403, a stranger with 404", async () => {
    const list = await listGET(url("?status=all"), ctx());
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({ invoices: [], totals: { count: 0 } });
    expect((await settingsGET(url("/settings"), ctx())).status).toBe(200);
    expect(await (await settingsGET(url("/settings"), ctx())).json()).toMatchObject({
      nextNumberPreview: "INV-0001",
    });
    expect((await recurringGET(url("/recurring"), ctx())).status).toBe(200);
    expect((await listGET(url("?status=bogus"), ctx())).status).toBe(400);

    for (const who of ["max", "bob"]) {
      signIn(f.ids[who]!);
      expect((await listGET(url("?status=all"), ctx())).status).toBe(403);
      expect((await settingsGET(url("/settings"), ctx())).status).toBe(403);
      expect((await recurringGET(url("/recurring"), ctx())).status).toBe(403);
    }
    const stranger = await createTestUser(db, "Sam Stranger");
    signIn(stranger.id);
    expect((await listGET(url("?status=all"), ctx())).status).toBe(404);
  });

  it("render a draft's PDF live and serve the frozen file once sent", async () => {
    const inv = await createInvoice(db, owner, { clientId: f.acmeId, issueDate: "2026-10-28" });
    await addManualLine(db, owner, inv.id, {
      description: "Design",
      quantityCenti: 100,
      unitPriceMinor: 5000,
    });
    const one = await oneGET(url(`/${inv.id}`), ctxOf(inv.id));
    expect(one.status).toBe(200);
    expect(await one.json()).toMatchObject({
      number: "INV-0001",
      lines: [{ description: "Design" }],
    });

    const live = await pdfGET(url(`/${inv.id}/pdf`), ctxOf(inv.id));
    expect(live.status).toBe(200);
    expect(live.headers.get("content-type")).toBe("application/pdf");
    expect(live.headers.get("content-disposition")).toBe('inline; filename="INV-0001.pdf"');
    expect(new Uint8Array(await live.arrayBuffer())).toEqual(store.pdf);

    await sendInvoice(db, owner, inv.id, { email: false });
    store.pdf = new Uint8Array([1, 2, 3]); // a later render would differ: the frozen file is served
    const frozen = await pdfGET(url(`/${inv.id}/pdf`), ctxOf(inv.id));
    expect(frozen.status).toBe(200);
    expect(new Uint8Array(await frozen.arrayBuffer())).toEqual(
      new Uint8Array([37, 80, 68, 70, 45]),
    );

    signIn(f.ids.bob!);
    expect((await pdfGET(url(`/${inv.id}/pdf`), ctxOf(inv.id))).status).toBe(403);
    signIn(f.ids.olga!);
    const unknown = randomUUID();
    expect((await oneGET(url(`/${unknown}`), ctxOf(unknown))).status).toBe(404);
  });

  it("preview an import from the query string", async () => {
    const inv = await createInvoice(db, owner, { clientId: f.acmeId, issueDate: "2026-10-28" });
    const q = `?from=${WEEK.from}&to=${WEEK.to}&groupBy=project&expenses=1&projectIds=${f.webId}`;
    const ok = await previewGET(url(`/${inv.id}/import-preview${q}`), ctxOf(inv.id));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({
      entries: 0,
      seconds: 0,
      amountMinor: 0,
      expenses: 0,
      expenseMinor: 0,
      skipped: { otherCurrency: 0, unrated: 0, expensesOtherCurrency: 0 },
    });
    const bad = await previewGET(
      url(`/${inv.id}/import-preview?from=2026-13-01&to=x`),
      ctxOf(inv.id),
    );
    expect(bad.status).toBe(400);
    const otherClient = await previewGET(
      url(`/${inv.id}/import-preview?from=${WEEK.from}&to=${WEEK.to}&projectIds=${f.portalId}`),
      ctxOf(inv.id),
    );
    expect(otherClient.status).toBe(400);
  });
});

describe("the public PDF route", () => {
  it("answers 404 without a sent invoice, redirects to the file, and limits downloads", async () => {
    const inv = await createInvoice(db, owner, { clientId: f.acmeId, issueDate: "2026-10-28" });
    await addManualLine(db, owner, inv.id, {
      description: "Design",
      quantityCenti: 100,
      unitPriceMinor: 5000,
    });
    const publicUrl = (token: string) => new Request(`http://localhost/invoice/${token}/pdf`);
    expect(
      (await publicPdfGET(publicUrl("a".repeat(43)), routeParams({ token: "a".repeat(43) })))
        .status,
    ).toBe(404);

    const sent = await sendInvoice(db, owner, inv.id, { email: false });
    const token = sent.publicPath!.slice("/invoice/".length);
    const first = await publicPdfGET(publicUrl(token), routeParams({ token }));
    expect(first.status).toBe(302);
    expect(first.headers.get("location")).toBe(
      `https://signed.test/invoices/${f.wsId}/${inv.id}.pdf?ttl=300&name=INV-0001.pdf`,
    );
    expect(first.headers.get("x-robots-tag")).toBe("noindex");
    const second = await publicPdfGET(publicUrl(token), routeParams({ token }));
    expect(second.status).toBe(429);
    expect(second.headers.get("retry-after")).toBe("10");
    // No session is read: a member's session changes nothing.
    await addMember(db, f.wsId, (await createTestUser(db, "Nobody")).id, "member");
    session.current = null;
    expect((await publicPdfGET(publicUrl(token), routeParams({ token }))).status).toBe(429);
  });
});
