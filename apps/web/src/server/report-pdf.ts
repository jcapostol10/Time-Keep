import "server-only";

import { existsSync } from "node:fs";
import { createRequire } from "node:module";

import {
  detailedColumns,
  type ExportColumn,
  flattenGroups,
  formatDuration,
  formatRangeLabel,
  NONE_ID,
  type ReportKind,
  type ReportQuery,
  resolveReportRange,
  summaryColumns,
  type ViewerPrefs,
  weeklyColumns,
} from "@timekeep/core";
import type { Database } from "@timekeep/db";

import type { SeriesPoint, SummaryReport } from "@/lib/report-types";

import type { Viewer } from "./catalog/viewer";
import { env } from "./env";
import { type ExportFile, exportFilename } from "./report-files";
import { detailedReport, summaryReport, weeklyReport } from "./reports";

type Executor = Pick<Database, "query" | "select" | "insert" | "update" | "delete" | "execute">;

/**
 * PDF exports: a self-contained HTML page (inline CSS, hand-drawn SVG
 * charts; Recharts measures the DOM and draws nothing on the server)
 * printed by headless Chromium with setContent, so the browser never
 * navigates to the deployment, which sits behind deployment protection.
 */

const COLORS = ["#1f8a8a", "#e08a3c", "#7b5cc4", "#6fae3f", "#d6457a"];
const BILLABLE = COLORS[0]!;
const NON_BILLABLE = COLORS[1]!;

function esc(text: string | number | null | undefined): string {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function barChart(series: SeriesPoint[], durationFormat: ViewerPrefs["durationFormat"]): string {
  const width = 720;
  const height = 200;
  const bottom = 24;
  const max = Math.max(1, ...series.map((p) => p.billableSeconds + p.nonBillableSeconds));
  const slot = width / Math.max(series.length, 1);
  const bar = Math.max(2, Math.min(36, slot * 0.7));
  const scale = (seconds: number) => (seconds / max) * (height - bottom - 8);
  const every = Math.ceil(series.length / 14);
  const bars = series
    .map((p, i) => {
      const x = i * slot + (slot - bar) / 2;
      const nb = scale(p.nonBillableSeconds);
      const b = scale(p.billableSeconds);
      const base = height - bottom;
      const label =
        i % every === 0
          ? `<text x="${x + bar / 2}" y="${height - 6}" text-anchor="middle">${esc(p.label)}</text>`
          : "";
      return `<rect x="${x}" y="${base - nb}" width="${bar}" height="${nb}" fill="${NON_BILLABLE}"/><rect x="${x}" y="${base - nb - b}" width="${bar}" height="${b}" fill="${BILLABLE}" rx="2"/>${label}`;
    })
    .join("");
  return `<svg class="bars" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Time per ${esc(series.length > 0 ? "bucket" : "day")}"><line x1="0" x2="${width}" y1="${height - bottom}" y2="${height - bottom}" stroke="#d6dde3"/>${bars}<text x="0" y="12" class="max">${esc(formatDuration(max, durationFormat))}</text></svg>`;
}

function donut(slices: { label: string; value: number }[]): string {
  const size = 200;
  const r = 80;
  const inner = 48;
  const total = slices.reduce((n, s) => n + s.value, 0);
  if (total === 0)
    return `<svg class="donut" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"></svg>`;
  let angle = -Math.PI / 2;
  const point = (a: number, radius: number) =>
    `${size / 2 + radius * Math.cos(a)} ${size / 2 + radius * Math.sin(a)}`;
  const paths = slices
    .map((s, i) => {
      const sweep = (s.value / total) * Math.PI * 2;
      const end = angle + Math.min(sweep, Math.PI * 2 - 1e-4);
      const large = sweep > Math.PI ? 1 : 0;
      const d = `M ${point(angle, r)} A ${r} ${r} 0 ${large} 1 ${point(end, r)} L ${point(end, inner)} A ${inner} ${inner} 0 ${large} 0 ${point(angle, inner)} Z`;
      angle += sweep;
      return `<path d="${d}" fill="${COLORS[i % COLORS.length]}"/>`;
    })
    .join("");
  const legend = slices
    .map(
      (s, i) =>
        `<li><span style="background:${COLORS[i % COLORS.length]}"></span>${esc(s.label)}</li>`,
    )
    .join("");
  return `<div class="donut-wrap"><svg class="donut" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="Share by group">${paths}</svg><ul>${legend}</ul></div>`;
}

function table<T>(rows: T[], columns: ExportColumn<T>[]): string {
  const head = columns.map((c) => `<th>${esc(c.header)}</th>`).join("");
  const body = rows
    .map((r) => `<tr>${columns.map((c) => `<td>${esc(c.value(r))}</td>`).join("")}</tr>`)
    .join("");
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

/** One line describing the filters a report was run with. */
export function filtersSummary(q: ReportQuery): string {
  const parts: string[] = [];
  const count = (ids: string[], one: string, many: string, none: string) => {
    const real = ids.filter((id) => id !== NONE_ID).length;
    const words: string[] = [];
    if (real > 0) words.push(`${real} ${real === 1 ? one : many}`);
    if (ids.includes(NONE_ID)) words.push(none);
    if (words.length > 0) parts.push(words.join(" or "));
  };
  count(q.userIds, "person", "people", "nobody");
  count(q.clientIds, "client", "clients", "without client");
  count(q.projectIds, "project", "projects", "without project");
  count(q.taskIds, "task", "tasks", "without task");
  count(q.tagIds, "tag", "tags", "without tag");
  if (q.tagIds.filter((id) => id !== NONE_ID).length > 1) {
    parts.push(q.tagMode === "and" ? "all tags" : "any tag");
  }
  if (q.billable === "yes") parts.push("Billable only");
  if (q.billable === "no") parts.push("Non-billable only");
  if (q.description.trim()) parts.push(`description contains “${q.description.trim()}”`);
  return parts.length > 0 ? parts.join(" · ") : "All time entries";
}

const CSS = `
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1c2430; font-size: 11px; }
  header { border-bottom: 2px solid ${BILLABLE}; padding-bottom: 10px; margin-bottom: 14px; }
  .brand { color: ${BILLABLE}; font-weight: 700; letter-spacing: .02em; font-size: 10px; text-transform: uppercase; }
  h1 { font-size: 20px; margin: 4px 0 2px; }
  .meta { color: #5b6672; }
  .total { font-size: 26px; font-weight: 700; margin: 4px 0 12px; font-variant-numeric: tabular-nums; }
  .charts { display: flex; gap: 16px; align-items: flex-start; margin-bottom: 14px; }
  svg text { font-size: 9px; fill: #5b6672; }
  .donut-wrap { display: flex; gap: 8px; align-items: center; }
  .donut-wrap ul { list-style: none; padding: 0; margin: 0; }
  .donut-wrap li { display: flex; align-items: center; gap: 6px; margin: 2px 0; }
  .donut-wrap li span { width: 8px; height: 8px; border-radius: 2px; display: inline-block; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; background: #f1f4f6; font-weight: 600; }
  th, td { padding: 4px 6px; border-bottom: 1px solid #e3e8ec; vertical-align: top; }
  td:last-child, th:last-child { text-align: right; }
  tr { page-break-inside: avoid; }
`;

function page(args: {
  title: string;
  workspaceName: string;
  rangeLabel: string;
  filters: string;
  total: string;
  body: string;
}): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(args.title)}</title><style>${CSS}</style></head><body><header><div class="brand">TimeKeep · ${esc(args.workspaceName)}</div><h1>${esc(args.title)}</h1><div class="meta">${esc(args.rangeLabel)} · ${esc(args.filters)}</div></header><div class="total">${esc(args.total)}</div>${args.body}</body></html>`;
}

function slicesOf(report: SummaryReport) {
  const sorted = [...report.groups].sort(
    (a, b) => b.totals.durationSeconds - a.totals.durationSeconds,
  );
  const top = sorted.slice(0, 8).map((g) => ({ label: g.label, value: g.totals.durationSeconds }));
  const rest = sorted.slice(8).reduce((n, g) => n + g.totals.durationSeconds, 0);
  return rest > 0 ? [...top, { label: "Other", value: rest }] : top;
}

export interface PdfRequest {
  report: ReportKind;
  query: ReportQuery;
  prefs: ViewerPrefs;
  workspaceName: string;
  title?: string;
  now?: Date;
}

const TITLES: Record<ReportKind, string> = {
  summary: "Summary report",
  detailed: "Detailed report",
  weekly: "Weekly report",
};

/** The report as one self-contained HTML page, and how many rows its table has. */
export async function renderReportHtml(
  db: Executor,
  viewer: Viewer,
  req: PdfRequest,
): Promise<{ html: string; rowCount: number }> {
  const now = req.now ?? new Date();
  const range = resolveReportRange(req.query, req.prefs, now);
  const rangeLabel = formatRangeLabel(range.from, range.to, req.prefs.timezone);
  const title = req.title ?? TITLES[req.report];
  const filters = filtersSummary(req.query);
  const fmt = (s: number) => formatDuration(s, req.prefs.durationFormat);

  if (req.report === "summary") {
    const report = await summaryReport(db, viewer, req.query, req.prefs, now);
    const rows = flattenGroups(report.groups, report.groupBy);
    const body = `<div class="charts">${barChart(report.series, req.prefs.durationFormat)}${donut(slicesOf(report))}</div>${table(rows, summaryColumns(report.groupBy, req.prefs))}`;
    const html = page({
      title,
      workspaceName: req.workspaceName,
      rangeLabel,
      filters,
      total: fmt(report.totals.durationSeconds),
      body,
    });
    return { html, rowCount: rows.length };
  }
  if (req.report === "weekly") {
    const report = await weeklyReport(db, viewer, req.query, req.prefs, now);
    const html = page({
      title,
      workspaceName: req.workspaceName,
      rangeLabel,
      filters,
      total: fmt(report.total),
      body: table(report.rows, weeklyColumns(report.dayKeys, req.prefs)),
    });
    return { html, rowCount: report.rows.length };
  }
  const entries = [];
  let cursor: { value: string; id: string } | undefined;
  let totals = { durationSeconds: 0 };
  do {
    const p = await detailedReport(
      db,
      viewer,
      req.query,
      req.prefs,
      { cursor, sort: "start", dir: "desc", limit: 200 },
      now,
    );
    entries.push(...p.entries);
    if (p.totals) totals = p.totals;
    cursor = p.nextCursor ?? undefined;
  } while (cursor);
  const html = page({
    title,
    workspaceName: req.workspaceName,
    rangeLabel,
    filters,
    total: fmt(totals.durationSeconds),
    body: table(entries, detailedColumns(req.prefs)),
  });
  return { html, rowCount: entries.length };
}

/** A Chrome binary for local PDFs: CHROME_PATH, else Playwright's Chromium; null when none. */
export function localChromePath(): string | null {
  const configured = process.env.CHROME_PATH;
  if (configured && existsSync(configured)) return configured;
  try {
    const require = createRequire(import.meta.url);
    const { chromium } = require("playwright-core") as { chromium: { executablePath(): string } };
    const path = chromium.executablePath();
    return existsSync(path) ? path : null;
  } catch {
    return null;
  }
}

/** Prints self-contained HTML to an A4 PDF. */
export async function htmlToPdf(html: string): Promise<Uint8Array> {
  const puppeteer = await import("puppeteer-core");
  let executablePath: string;
  let args: string[] = [];
  if (process.env.VERCEL) {
    const chromium = (await import("@sparticuz/chromium")).default;
    executablePath = await chromium.executablePath();
    args = chromium.args;
  } else {
    const local = env().CHROME_PATH ?? localChromePath();
    if (!local)
      throw new Error(
        "No Chrome for PDF exports: set CHROME_PATH or install Playwright's Chromium",
      );
    executablePath = local;
  }
  const browser = await puppeteer.launch({ executablePath, args, headless: true });
  try {
    const tab = await browser.newPage();
    await tab.setContent(html, { waitUntil: "load" });
    const pdf = await tab.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "16mm", bottom: "16mm", left: "12mm", right: "12mm" },
    });
    return new Uint8Array(pdf);
  } finally {
    await browser.close();
  }
}

export async function buildPdfExport(
  db: Executor,
  viewer: Viewer,
  req: PdfRequest,
): Promise<ExportFile> {
  const now = req.now ?? new Date();
  const range = resolveReportRange(req.query, req.prefs, now);
  const { html, rowCount } = await renderReportHtml(db, viewer, { ...req, now });
  return {
    filename: exportFilename(req.report, range, req.prefs.timezone, "pdf"),
    contentType: "application/pdf",
    body: await htmlToPdf(html),
    rowCount,
  };
}
