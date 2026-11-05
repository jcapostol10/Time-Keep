import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { deflateRawSync } from "node:zlib";

import { afterEach, describe, expect, it } from "vitest";

import { runGuard, scanReport, secretsFromEnv, zipEntries } from "./report-guard";

const SECRET = "bypass-secret-0123456789abcdef";
// Three base64url parts, as Vercel's `_vercel_jwt` cookie.
const JWT =
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0IiwiYnlwYXNzIjoiYWJjZGVmIn0.c2lnbmF0dXJlLXNpZ25hdHVyZQ";

/** A zip with stored or deflated entries, as Playwright embeds its report. */
function makeZip(entries: { name: string; data: string; deflate?: boolean }[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const raw = Buffer.from(entry.data);
    const data = entry.deflate ? deflateRawSync(raw) : raw;
    const method = entry.deflate ? 8 : 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(method, 10);
    dir.writeUInt32LE(data.length, 20);
    dir.writeUInt32LE(raw.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(offset, 42);
    parts.push(local, name, data);
    central.push(dir, name);
    offset += local.length + name.length + data.length;
  }
  const centralSize = central.reduce((n, b) => n + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, ...central, eocd]);
}

function reportHtml(zip: Buffer): string {
  return `<!DOCTYPE html><html><script>window.playwrightReportBase64 = "data:application/zip;base64,${zip.toString("base64")}";</script></html>`;
}

const dirs: string[] = [];

function makeReport(files: Record<string, Buffer | string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "report-guard-"));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs.length = 0;
});

describe("zipEntries", () => {
  it("reads stored and deflated entries", () => {
    const zip = makeZip([
      { name: "a.txt", data: "hello" },
      { name: "dir/b.json", data: '{"x":1}', deflate: true },
    ]);
    expect(zipEntries(zip).map((e) => [e.name, e.data.toString()])).toEqual([
      ["a.txt", "hello"],
      ["dir/b.json", '{"x":1}'],
    ]);
  });
});

describe("scanReport", () => {
  it("passes a clean report", () => {
    const zip = makeZip([
      { name: "report.json", data: '{"errors":["expected 200"]}', deflate: true },
    ]);
    const dir = makeReport({
      "index.html": reportHtml(zip),
      "data/ctx.md": '# Error context\n\n- button "Start"',
    });
    expect(scanReport(dir, [SECRET])).toEqual([]);
  });

  it("finds a secret in an attachment, without repeating it", () => {
    const dir = makeReport({ "data/abc.md": `Received: x-vercel-protection-bypass: ${SECRET}` });
    const findings = scanReport(dir, [SECRET]);
    expect(findings).toEqual([{ file: "data/abc.md", kind: "secret" }]);
    expect(JSON.stringify(findings)).not.toContain(SECRET);
  });

  it("finds a secret's base64 form", () => {
    const dir = makeReport({ "data/x.md": `Bearer ${Buffer.from(SECRET).toString("base64")}` });
    expect(scanReport(dir, [SECRET])).toEqual([{ file: "data/x.md", kind: "secret" }]);
  });

  it("finds a JWT inside the zip embedded in index.html", () => {
    const zip = makeZip([
      { name: "report.json", data: `{"error":"- _vercel_jwt=${JWT}"}`, deflate: true },
    ]);
    const dir = makeReport({ "index.html": reportHtml(zip) });
    expect(scanReport(dir, [])).toEqual([{ file: "index.html!report.json", kind: "jwt" }]);
  });

  it("finds a secret inside a zip attachment", () => {
    const zip = makeZip([
      { name: "trace/0-trace.network", data: `header ${SECRET}`, deflate: true },
    ]);
    const dir = makeReport({ "data/trace.zip": zip });
    expect(scanReport(dir, [SECRET])).toEqual([
      { file: "data/trace.zip!trace/0-trace.network", kind: "secret" },
    ]);
  });
});

describe("runGuard", () => {
  it("deletes a report that carries a secret and names the file only", () => {
    const dir = makeReport({ "data/abc.md": SECRET });
    const lines: string[] = [];
    const result = runGuard(dir, [SECRET], (line) => lines.push(line));
    expect(result).toEqual({ findings: [{ file: "data/abc.md", kind: "secret" }], deleted: true });
    expect(existsSync(dir)).toBe(false);
    expect(lines.join("\n")).toContain("data/abc.md");
    expect(lines.join("\n")).not.toContain(SECRET);
  });

  it("keeps a clean report", () => {
    const dir = makeReport({ "index.html": "<html></html>" });
    expect(runGuard(dir, [SECRET], () => {})).toEqual({ findings: [], deleted: false });
    expect(existsSync(dir)).toBe(true);
  });

  it("accepts a missing report", () => {
    const dir = path.join(makeReport({}), "none");
    expect(runGuard(dir, [SECRET], () => {})).toEqual({ findings: [], deleted: false });
  });
});

describe("secretsFromEnv", () => {
  it("reads the job's secrets and ignores unset or short ones", () => {
    expect(
      secretsFromEnv({ VERCEL_AUTOMATION_BYPASS_SECRET: SECRET, E2E_SECRET: "short" }),
    ).toEqual([SECRET]);
    expect(secretsFromEnv({})).toEqual([]);
  });
});
