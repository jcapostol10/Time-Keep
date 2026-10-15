# Vercel + Supabase deployment with e2e on previews — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy TimeKeep to Vercel on one Supabase project and run the Playwright suite against preview deployments, with e2e confined to its own tenants.

**Architecture:** Code changes first, each test-first (app-URL resolution, preview mail capture, narrowed seed + e2e cleanup, RLS lockdown, remote-mode Playwright). Then provisioning: Supabase project with a dedicated `timekeep_app` login role, a Vercel project in `sin1` next to the database, Resend over SMTP, deployment protection with an automation bypass, GitHub secrets, and a `deployment_status` workflow that seeds, tests and cleans up.

**Tech Stack:** Next.js 16 on Vercel (Fluid Compute, Node 24), Supabase Postgres via Supavisor + Supabase Storage S3, Drizzle, Better Auth, Resend SMTP, Playwright, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-15-vercel-preview-e2e-design.md` (revision 2)

## Global Constraints

- One Supabase project for production and previews. Tenant = workspace; e2e data is `@demo.test`, `@e2e.test` and workspaces whose members are all such users.
- Only production deployments run migrations. Previews never migrate or seed.
- The app uses the transaction pooler (port 6543); migrations, seed and cleanup use the session pooler (port 5432). No named prepared statements, no session-level features.
- The Data API must not expose any table: every `public` table has RLS enabled, and `anon`/`authenticated` have no privileges on `public`.
- `pnpm test` stays on Docker and must never point at Supabase.
- Mail capture and `/api/test/emails` are inert unless `MAIL_CAPTURE=true`, `VERCEL_ENV !== "production"`, and the `x-e2e-secret` header equals `E2E_SECRET`.
- Local `pnpm e2e` without `E2E_BASE_URL` behaves exactly as today.
- Secrets never enter git (CLAUDE.md invariant 7).

## Review Focus

- A customer workspace that contains a demo or e2e user survives reseed and cleanup (Task 3 tests).
- A table added in a future phase without RLS is caught (Task 4 test asserts RLS on *every* `public` table).
- `/api/test/emails` in production or without the secret returns 404, never data (Task 2 tests).
- On a preview, auth callbacks and email links use the deployment's own URL, not localhost (Task 1 tests).
- Remote e2e leaves no `@e2e.test` users behind, even when tests fail (Task 6 workflow runs cleanup with `if: always()`).

---

### Task 1: App URL resolution

**Files:**
- Create: `apps/web/src/server/app-url.ts`, `apps/web/src/server/app-url.test.ts`
- Modify: `apps/web/src/server/env.ts` (make `BETTER_AUTH_URL` / `NEXT_PUBLIC_APP_URL` optional, add `VERCEL_ENV`, `VERCEL_URL`, `VERCEL_BRANCH_URL`, `MAIL_CAPTURE`, `E2E_SECRET`), `apps/web/src/server/auth.ts` (baseURL, trustedOrigins, invite links)

**Interfaces:**
- Produces: `resolveAppUrl(e: AppUrlEnv): string` and `trustedOrigins(e: AppUrlEnv): string[]`, where `AppUrlEnv = { BETTER_AUTH_URL?: string; NEXT_PUBLIC_APP_URL?: string; VERCEL_ENV?: string; VERCEL_URL?: string; VERCEL_BRANCH_URL?: string }`. `env().APP_URL` holds the resolved value.

- [ ] **Step 1: Write the failing test** (`app-url.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import { resolveAppUrl, trustedOrigins } from "./app-url";

describe("resolveAppUrl", () => {
  it("uses the configured URL when set", () => {
    expect(resolveAppUrl({ BETTER_AUTH_URL: "https://timekeep.example/", VERCEL_ENV: "preview", VERCEL_URL: "x.vercel.app" })).toBe("https://timekeep.example");
  });
  it("uses the deployment URL on Vercel previews when nothing is configured", () => {
    expect(resolveAppUrl({ VERCEL_ENV: "preview", VERCEL_URL: "time-keep-abc.vercel.app" })).toBe("https://time-keep-abc.vercel.app");
  });
  it("falls back to localhost for local development", () => {
    expect(resolveAppUrl({})).toBe("http://localhost:3000");
  });
});

describe("trustedOrigins", () => {
  it("includes the app URL and the branch alias", () => {
    expect(trustedOrigins({ VERCEL_ENV: "preview", VERCEL_URL: "a.vercel.app", VERCEL_BRANCH_URL: "b.vercel.app" })).toEqual(["https://a.vercel.app", "https://b.vercel.app"]);
  });
});
```

- [ ] **Step 2:** Run `pnpm --filter @timekeep/web exec dotenv -e ../../.env -- vitest run src/server/app-url.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `app-url.ts` (pure, no `server-only`): configured URL (`BETTER_AUTH_URL` then `NEXT_PUBLIC_APP_URL`) with trailing slash removed; else `https://${VERCEL_URL}` when `VERCEL_ENV` is `preview` or `production` and `VERCEL_URL` is set; else `http://localhost:3000`. `trustedOrigins` returns the unique list of the app URL plus `https://${VERCEL_BRANCH_URL}` when set. Wire into `env.ts` (`APP_URL: resolveAppUrl(process.env)`) and `auth.ts` (`baseURL: e.APP_URL`, `trustedOrigins: trustedOrigins(process.env)`, invite link uses `e.APP_URL`).
- [ ] **Step 4:** Rerun the test (PASS), then `pnpm --filter @timekeep/web lint && pnpm --filter @timekeep/web typecheck`.
- [ ] **Step 5: Commit** `deploy: resolve the app URL from Vercel on previews`.

### Task 2: Preview mail capture

**Files:**
- Create: `packages/db/src/schema/mail.ts` (`captured_email` table), migration via `pnpm db:generate --name captured_email`, `apps/web/src/server/mail-capture.ts`, `apps/web/src/server/mail-capture.test.ts`, `apps/web/src/app/api/test/emails/route.ts`
- Modify: `packages/db/src/schema/index.ts`, `apps/web/src/server/mail.ts`, `apps/web/test/db.ts` (truncate list)

**Interfaces:**
- Produces: `captureEnabled(e: { MAIL_CAPTURE?: boolean; VERCEL_ENV?: string }): boolean`; `testEndpointAuthorized(e, header: string | null): boolean` (true only when capture is enabled, `E2E_SECRET` is at least 16 characters, and the header matches it in constant time); `captureEmail(db, msg: { to: string; subject: string; html: string; text: string }): Promise<void>`; `listCapturedEmails(db, { to: string; subject?: string }): Promise<CapturedEmail[]>` (newest first, at most 20).

- [ ] **Step 1: Write failing tests** covering:
  - **Unit:** `captureEnabled` is false in production even with the flag on, and true on preview with the flag.
  - **Unit:** `testEndpointAuthorized` is false without the secret, with a wrong secret, with a short configured secret, and in production; it is true for an exact match on a preview.
  - **Integration (Docker Postgres):** `captureEmail` then `listCapturedEmails` returns the message for its recipient only, newest first, filtered by the subject regex.
- [ ] **Step 2:** Run the tests and confirm they fail because the module is missing.
- [ ] **Step 3: Implement.**
  - `captured_email`: `id text pk`, `to_address text not null` (indexed), `subject text not null`, `html text not null`, `text text not null`, `created_at timestamptz default now()`.
  - `sendEmail()` calls `captureEmail(getDb(), …)` instead of SMTP when `captureEnabled(env())`.
  - The route uses `testEndpointAuthorized` and returns `Response.json({ error: "Not found" }, { status: 404 })` otherwise, plus `Cache-Control: no-store`.
- [ ] **Step 4:** Run the tests until they pass. Then `pnpm db:migrate` locally and the full web test suite.
- [ ] **Step 5: Commit** `deploy: capture outgoing email on preview deployments`.

### Task 3: Narrowed seed reset and e2e cleanup

**Files:**
- Create: `packages/db/src/e2e-tenant.ts` (`isE2eEmail`, `e2eOnlyWorkspaceIds`, `cleanupE2eData`), `packages/db/src/e2e-cleanup.ts` (CLI entry), `apps/web/src/server/e2e-tenant.test.ts`
- Modify: `packages/db/src/seed.ts` (`resetDemoData` uses `e2eOnlyWorkspaceIds`; export it), `packages/db/package.json` (`db:e2e-cleanup` script + `./e2e-tenant` export), root `package.json` (`db:e2e-cleanup`)

**Interfaces:**
- Produces:
  - `isE2eEmail(email: string): boolean` matches `@demo.test` and `@e2e.test`.
  - `e2eOnlyWorkspaceIds(db): Promise<string[]>` returns workspaces with at least one member where every member is an e2e email.
  - `cleanupE2eData(db, { olderThan?: Date }): Promise<{ users: number; workspaces: number; emails: number }>` deletes `@e2e.test` users, e2e-only workspaces among their workspaces, and captured emails older than one day.
  - `resetDemoData(db)` is exported.

- [ ] **Step 1: Write failing integration tests:**
  - Reseeding keeps a customer workspace that has a demo member: the workspace survives and only the demo membership goes.
  - Cleanup removes an `@e2e.test` user with their personal workspace and time entries.
  - Cleanup keeps a customer workspace that an e2e user joined, and keeps the customer user.
  - Cleanup keeps demo users and the `demo` workspace.
- [ ] **Step 2:** Run them and confirm they fail (functions missing; the reseed test fails on today's code).
- [ ] **Step 3: Implement.**
  - Express "every member is e2e" in SQL: `bool_and(lower(u.email) like '%@demo.test' or lower(u.email) like '%@e2e.test')` grouped by workspace.
  - Delete users after workspaces, relying on cascades.
  - `e2e-cleanup.ts` reads `DATABASE_URL_SESSION ?? DATABASE_URL` and prints the counts.
  - `seed.ts` likewise prefers `DATABASE_URL_SESSION`.
- [ ] **Step 4:** Run the tests until they pass, then the full web suite.
- [ ] **Step 5: Commit** `deploy: confine seeding and cleanup to e2e tenants`.

### Task 4: RLS lockdown migration

**Files:**
- Create: custom migration via `pnpm --filter @timekeep/db exec dotenv -e ../../.env -- drizzle-kit generate --custom --name lock_down_data_api`, `apps/web/src/server/rls.test.ts`
- Modify: `CLAUDE.md` (new tables must enable RLS in their migration)

- [ ] **Step 1: Write the failing test.** It queries `select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity` and expects an empty list.
- [ ] **Step 2:** Run it and confirm it fails, listing every table.
- [ ] **Step 3: Write the migration SQL.**

```sql
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
  END IF;
END $$;
```

  Also add `.enableRLS()` to every `pgTable` in the Drizzle schema, so later `db:generate` runs keep RLS in the snapshot and new tables get it.
- [ ] **Step 4:** Run `pnpm db:migrate`, then the test and the full web suite, which still connects as the table owner. Expected: PASS.
- [ ] **Step 5: Commit** `deploy: enable RLS on every table and revoke Data API roles`.

### Task 5: Build, storage and config for Vercel

**Files:**
- Create: `apps/web/vercel.json` (`{"regions": ["sin1"]}`), `apps/web/scripts/vercel-build.ts`
- Modify: `apps/web/package.json` (`"vercel-build": "tsx scripts/vercel-build.ts"`), `apps/web/scripts/storage-init.ts` (skip bucket policy when the endpoint host ends with `.supabase.co`), `packages/db/src/migrate.ts` (prefer `DATABASE_URL_SESSION`), `turbo.json` `globalEnv`, `.env.example`

- [ ] **Step 1:** `vercel-build.ts` runs `pnpm --filter @timekeep/db db:migrate` only when `VERCEL_ENV === "production"`, then `next build`. Both are spawned with inherited stdio, and the script exits non-zero on failure.
- [ ] **Step 2:** Verify locally:
  - `VERCEL_ENV=preview pnpm --filter @timekeep/web vercel-build` builds without migrating.
  - `pnpm build`, `pnpm lint` and `pnpm typecheck` stay green.
- [ ] **Step 3: Commit** `deploy: Vercel build script, region and environment docs`.

### Task 6: Remote-mode Playwright and the preview e2e workflow

**Files:**
- Create: `apps/web/e2e/helpers/mail.ts` (replaces `mailpit.ts`), `.github/workflows/e2e-preview.yml`
- Modify: `apps/web/playwright.config.ts`, the specs and helpers that import `./helpers/mailpit`, `.github/workflows/ci.yml` (drop the Docker e2e step)

- [ ] **Step 1: Playwright config.** When `E2E_BASE_URL` is set, use it as `baseURL`, drop `webServer`, set `extraHTTPHeaders` to `{ "x-vercel-protection-bypass": BYPASS, "x-vercel-set-bypass-cookie": "true" }`, `retries: 2` and `expect.timeout: 20_000`.
- [ ] **Step 2: Mail helper.** `mail.ts` keeps `waitForEmail`, `extractAppLink` and `deleteAllMessages`. Remote mode polls `${E2E_BASE_URL}/api/test/emails?to=…&subject=…` with the `x-e2e-secret` and bypass headers. `extractAppLink` matches the active base URL.
- [ ] **Step 3:** Run the full local `pnpm e2e` against Docker. Expected: 18 passed, unchanged.
- [ ] **Step 4: Workflow.** `e2e-preview.yml` runs on `deployment_status` when `github.event.deployment_status.state == 'success'` and the environment starts with `Preview`, with `concurrency: e2e-preview`. Steps: checkout of the deployment sha, pnpm, node, install, playwright chromium, `pnpm db:seed`, `pnpm --filter @timekeep/web e2e`, `pnpm db:e2e-cleanup` (`if: always()`), and an upload of the report on failure. Env comes from the secrets `DATABASE_URL_SESSION`, `VERCEL_AUTOMATION_BYPASS_SECRET` and `E2E_SECRET`, plus `E2E_BASE_URL: ${{ github.event.deployment_status.environment_url }}`.
- [ ] **Step 5: Commit** `deploy: run the e2e suite against Vercel previews`.

### Task 7: Provision and verify

- [ ] **Supabase.**
  - Create project `timekeep` in organization `pjeltvycnqacqktwqgzu`, region `ap-southeast-1`.
  - Create role `timekeep_app` (LOGIN, a generated password, CREATE on database `postgres`, ownership rights in `public`).
  - Create the public bucket `timekeep`.
- [ ] **Migrate and seed.** Run `pnpm db:migrate` and `pnpm db:seed` against the session pooler as `timekeep_app.<ref>`. Run the security advisor and expect no RLS or exposed-table findings.
- [ ] **Vercel project.**
  - Create the `time-keep` project with Root Directory `apps/web`, link it to GitHub, Node 24, protection on.
  - Generate the Automation Bypass secret.
  - Provision `resend/resend-email`.
  - Set the environment variables for Production and Preview (Preview-only: `MAIL_CAPTURE=true`, `E2E_SECRET`, `AUTH_RATE_LIMIT_ENABLED=false`).
- [ ] **GitHub.** Set the secrets `DATABASE_URL_SESSION`, `VERCEL_AUTOMATION_BYPASS_SECRET` and `E2E_SECRET`.
- [ ] **Deploy.** Push `main`, and push a branch to get a preview.
- [ ] **Verify.**
  - Production login with `owner@demo.test` works.
  - `e2e-preview` runs green on the preview.
  - Cleanup leaves no `@e2e.test` users.
- [ ] **Blocked on the user:** Supabase Storage S3 access keys can only be generated in the dashboard. Until then avatar upload is unconfigured on Vercel and the profile spec is expected to fail remotely.
- [ ] **Docs.** Update `CLAUDE.md` (deployment section, transaction-mode rule, RLS rule, previews never migrate), `docs/PROGRESS.md` and `.env.example`. Commit `docs: Vercel and Supabase deployment`.
