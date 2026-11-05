/**
 * Keeps secrets out of the public Playwright report. A workflow runs it before
 * uploading `playwright-report` as an artifact:
 * `pnpm --filter @timekeep/web e2e:report-guard [dir]`.
 *
 * A failed assertion's diff lands in the report, so a test that compared whole
 * cookies or headers would print Vercel's protection bypass (the `_vercel_jwt`
 * cookie, or the header) or the e2e secret, and artifacts of this public repo
 * are public. The guard looks for the secrets the job holds (verbatim and
 * base64) and for anything shaped like a JWT, in every file, inside zip
 * attachments and inside the base64 zip Playwright embeds in index.html. On a
 * hit it deletes the report and exits 1, so there is nothing to upload. It
 * prints the file and the kind, never a value.
 */
import { existsSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

export type FindingKind = "secret" | "jwt";

export interface Finding {
  /** Path inside the report; `!` separates a zip from its entry. */
  file: string;
  kind: FindingKind;
}

/** The environment variables whose values the e2e job holds. */
export const SECRET_ENV_NAMES = ["VERCEL_AUTOMATION_BYPASS_SECRET", "E2E_SECRET"] as const;
const MIN_SECRET_LENGTH = 8;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/;
const EMBEDDED_ZIP = /data:application\/zip;base64,([A-Za-z0-9+/=]+)/g;

export function secretsFromEnv(env: Record<string, string | undefined> = process.env): string[] {
  return SECRET_ENV_NAMES.map((name) => env[name] ?? "").filter(
    (value) => value.length >= MIN_SECRET_LENGTH,
  );
}

/** A secret as typed, and as base64 and base64url without padding. */
function needles(secrets: readonly string[]): string[] {
  return secrets.flatMap((secret) => [
    secret,
    Buffer.from(secret).toString("base64").replace(/=+$/, ""),
    Buffer.from(secret).toString("base64url"),
  ]);
}

/** The entries of a zip, read from its central directory (stored or deflated). */
export function zipEntries(zip: Buffer): { name: string; data: Buffer }[] {
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65_535); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a zip file: no end of central directory.");
  const count = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16);
  const entries: { name: string; data: Buffer }[] = [];
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) throw new Error("Bad zip central directory.");
    const method = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const localOffset = zip.readUInt32LE(offset + 42);
    const name = zip.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    // The local header repeats the name and carries its own extra field.
    const dataStart =
      localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
    const raw = zip.subarray(dataStart, dataStart + compressedSize);
    if (method !== 0 && method !== 8) throw new Error(`Unsupported zip method ${method}.`);
    entries.push({ name, data: method === 8 ? inflateRawSync(raw) : Buffer.from(raw) });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** Findings in one file; zips and the zip embedded in an HTML page are read through. */
export function findSecrets(file: string, bytes: Buffer, secrets: readonly string[]): Finding[] {
  const text = bytes.toString("latin1");
  const findings: Finding[] = [];
  if (needles(secrets).some((needle) => text.includes(needle))) {
    findings.push({ file, kind: "secret" });
  }
  if (JWT.test(text)) findings.push({ file, kind: "jwt" });
  const lower = file.toLowerCase();
  if (lower.endsWith(".html")) {
    for (const match of text.matchAll(EMBEDDED_ZIP)) {
      for (const entry of zipEntries(Buffer.from(match[1] ?? "", "base64"))) {
        findings.push(...findSecrets(`${file}!${entry.name}`, entry.data, secrets));
      }
    }
  } else if (lower.endsWith(".zip")) {
    for (const entry of zipEntries(bytes)) {
      findings.push(...findSecrets(`${file}!${entry.name}`, entry.data, secrets));
    }
  }
  return findings;
}

export function scanReport(dir: string, secrets: readonly string[]): Finding[] {
  const findings: Finding[] = [];
  const walk = (current: string) => {
    for (const name of readdirSync(current).sort()) {
      const full = path.join(current, name);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else {
        const relative = path.relative(dir, full).split(path.sep).join("/");
        findings.push(...findSecrets(relative, readFileSync(full), secrets));
      }
    }
  };
  walk(dir);
  return findings;
}

/** Scans the report and deletes it when it carries a secret. */
export function runGuard(
  dir: string,
  secrets: readonly string[],
  log: (line: string) => void = console.info,
): { findings: Finding[]; deleted: boolean } {
  if (!existsSync(dir)) {
    log(`[report-guard] no report at ${dir}`);
    return { findings: [], deleted: false };
  }
  const findings = scanReport(dir, secrets);
  if (findings.length === 0) {
    log(`[report-guard] the report at ${dir} carries no secret`);
    return { findings, deleted: false };
  }
  for (const finding of findings) {
    log(
      `::error::The Playwright report carries a ${finding.kind === "jwt" ? "JWT" : "secret"} in ${finding.file}. A test printed a value it must not; compare names, never whole cookies or headers.`,
    );
  }
  rmSync(dir, { recursive: true, force: true });
  log(`[report-guard] deleted ${dir}; it is not uploaded`);
  return { findings, deleted: true };
}

function isMainModule(moduleUrl: string, argv1: string | undefined): boolean {
  if (!argv1) return false;
  return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(argv1);
}

if (isMainModule(import.meta.url, process.argv[1])) {
  const dir = path.resolve(process.argv[2] ?? "playwright-report");
  process.exit(runGuard(dir, secretsFromEnv()).deleted ? 1 : 0);
}
