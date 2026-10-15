# Vercel deployment and e2e on preview deployments — design

Date: 2026-10-15. Status: draft for review (revision 2: Supabase instead of Neon and Blob).

## Goal

Deploy TimeKeep to Vercel on one Supabase project and run the Playwright e2e suite against Vercel preview deployments instead of the local Docker stack. People can click through any preview or the production deployment by hand.

Success means:

- Every push to GitHub produces a Vercel preview deployment, with no Docker anywhere in that path.
- `pnpm e2e` runs green against a preview deployment, both from a developer machine (`E2E_BASE_URL=<preview url> pnpm e2e`) and automatically in CI after each preview deploy.
- e2e activity stays inside its own tenants and never touches customer workspaces, even though everything shares one database.
- The production deployment works for hand testing with the seeded demo accounts.
- Local Docker keeps working unchanged as an offline fallback (`pnpm e2e` with no `E2E_BASE_URL`).

## Decisions already made

| Topic | Decision |
| --- | --- |
| Scope | Deploy to Vercel; e2e runs against preview deployments. |
| Hosting of data | One new Supabase project (in the user's existing paid organization) for production and previews alike. |
| Tenancy | A tenant is a workspace, as built: shared tables, every row tagged with `workspace_id`, every query scoped (CLAUDE.md invariant 3). Each customer is a workspace; e2e runs in its own workspaces. No schema- or database-per-tenant. |
| Database access | Postgres only, through the Supabase pooler. Supabase Auth, the client SDK and the auto-generated Data API are not used. |
| Files | Supabase Storage through its S3-compatible endpoint, in a public bucket. The existing S3 code is reused. |
| Email | Resend over SMTP using Resend's test sender (no verified domain yet). In production it delivers only to the Resend account owner's address; everyone else uses seeded demo accounts. |
| Email in tests | Preview deployments capture outgoing email in the database instead of sending it; tests read it through a secret-protected endpoint (replaces Mailpit for remote runs). |
| Worker | Not deployed. It only sends a heartbeat today; Phase 5 decides how background jobs run on Vercel. |
| Integration tests | `pnpm test` (Vitest against Postgres) stays on Docker. It truncates every table, so it must never point at the shared Supabase database. |

## Architecture

```
GitHub push to a branch
  -> Vercel preview build: next build only (no migrations, no seed)
  -> deployment_status = success (Preview)
       -> GitHub Actions "e2e-preview" (one run at a time):
            seed e2e tenant -> pnpm e2e against the deployment URL -> clean up e2e data

Push to main
  -> Vercel production build: migrate -> next build
```

### 1. Supabase project

- A new project, `timekeep`, in the user's organization, created only after the user approves the cost.
- **Lock down the Data API.** The app never uses Supabase's auto-generated REST API, so the project's Data API is turned off. As defence in depth, every table in `public` gets row-level security enabled with no policies, through a Drizzle migration. The app connects as the `postgres` role, which bypasses RLS, so app behaviour is unchanged. Supabase's security advisor must show no exposed-table warnings afterwards.
- **Connections.**
  - The app uses the Supavisor pooler in transaction mode (port 6543). node-postgres with Drizzle does not use named prepared statements, which transaction mode does not support.
  - `startTimer`'s `pg_advisory_xact_lock` is transaction-scoped, so it works in transaction mode. Its integration test is re-run against the pooler once by hand to confirm.
  - Migrations and the seed/cleanup scripts use the session pooler (port 5432).
  - The pool stays small (max 10 per instance).

### 2. Migrations

- Only production deployments run migrations. A `vercel-build` script runs `db:migrate` then `next build` when `VERCEL_ENV === "production"`, and only `next build` otherwise.
- Consequence: a preview whose branch adds a migration runs against the old schema and will fail where it depends on the change. Such branches are tested locally against Docker before merge. This is the price of one shared database, and it is documented in CLAUDE.md.

### 3. The e2e tenant and test data

- **Tenant markers.** Everything e2e creates is identifiable:
  - The seeded demo users use `@demo.test` and the demo workspace has slug `demo`.
  - Throwaway test users use `@e2e.test`, as `uniqueEmail()` already does.
  - A workspace belongs to e2e when all of its members are `@demo.test` or `@e2e.test` users.
- **Seed changes (test-first).**
  - Today `resetDemoData` deletes every workspace any demo user belongs to. In a shared database that could delete a customer's workspace if a demo user were ever invited into it.
  - It is narrowed to delete only workspaces whose members are all demo or e2e users, and the demo users themselves.
  - An integration test proves a customer workspace that contains a demo user survives a reseed.
- **Cleanup script.** `db:e2e-cleanup` runs after each remote e2e run. It deletes `@e2e.test` users, e2e-only workspaces (cascading their entries, projects, tags and invitations), and `captured_email` rows older than one day. It also gets an integration test proving it leaves customer data alone.
- **One run at a time.** The CI job uses a concurrency group, so two previews never run the suite against the shared demo tenant at once.

### 4. Vercel project

- One Vercel project linked to `jcapostol10/Time-Keep`, Root Directory `apps/web`, framework Next.js, Node 24. pnpm workspaces resolve `@timekeep/*` packages from the repo root.
- Deployment Protection (Vercel Authentication) is on for previews and production, because the repo is public and the demo password is in it. Playwright passes it with Vercel's "Protection Bypass for Automation" secret.

### 5. Environment and URLs

- `env.ts` gains a resolved app URL: `BETTER_AUTH_URL` / `NEXT_PUBLIC_APP_URL` when set (production and local), otherwise `https://${VERCEL_URL}` on Vercel previews. Auth callbacks and email links then point at the deployment being tested.
- Better Auth `trustedOrigins` includes that URL plus `https://${VERCEL_BRANCH_URL}` when present.
- `AUTH_RATE_LIMIT_ENABLED=false` on the Preview environment, because the suite signs in dozens of times. Production keeps rate limiting on.
- Vercel environment variables, set by hand:
  - **Database:** `DATABASE_URL` (transaction pooler) and `DATABASE_URL_SESSION` (session pooler, for migrations).
  - **Storage:** `S3_ENDPOINT` (`https://<ref>.storage.supabase.co/storage/v1/s3`), `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_URL` (`https://<ref>.supabase.co/storage/v1/object/public/<bucket>`).
  - **Email:** the Resend `SMTP_*` and `MAIL_FROM` values.
  - **Auth:** `BETTER_AUTH_SECRET` (production and preview get different values).
  - **Tests:** `MAIL_CAPTURE` and `E2E_SECRET`, Preview only.
- All new variables are documented in `.env.example`. They and Vercel's `VERCEL_ENV`, `VERCEL_URL` and `VERCEL_BRANCH_URL` are added to `turbo.json` `globalEnv`, because Turborepo only passes listed variables to tasks.

### 6. File storage

- `storage.ts` is unchanged in shape; only configuration differs. Object keys stay `avatars/...` and `logos/...`, so the profile e2e test's `img[src*='/avatars/']` check holds.
- The public bucket is created once in the Supabase project. Supabase Storage does not use S3 bucket policies, so `storage:init` skips its bucket-policy step when the endpoint is Supabase. Local RustFS keeps it.
- `next.config.ts` already allows images from `S3_PUBLIC_URL`'s host, which covers the Supabase public URL.

### 7. Email

- Production and previews send through Resend's SMTP endpoint (`smtp.resend.com`, port 465, user `resend`, the API key as password). `mail.ts` already uses nodemailer SMTP, so this is configuration only.
- Mail capture: when `MAIL_CAPTURE=true` (Preview environment only), `sendEmail()` stores the message in a new `captured_email` table (id, to, subject, html, text, created_at) instead of sending it.
- `GET /api/test/emails?to=<address>&subject=<regex>` returns captured messages, newest first. It responds 404 unless all three hold:
  - `MAIL_CAPTURE` is true;
  - `VERCEL_ENV` is not `production`;
  - the `x-e2e-secret` header equals `E2E_SECRET`.

  This is the only test-only code in the app, and it is inert in production twice over (the flag and the environment check).

### 8. Test runner

- `playwright.config.ts`: when `E2E_BASE_URL` is set, use it as `baseURL`, skip `webServer`, and send the `x-vercel-protection-bypass` and `x-vercel-set-bypass-cookie: true` headers. Without it, behaviour is unchanged (local `pnpm dev` + Docker).
- `e2e/helpers/mailpit.ts` becomes `e2e/helpers/mail.ts` with the same API (`waitForEmail`, `extractAppLink`, `deleteAllMessages`). It reads from Mailpit locally and from `/api/test/emails` remotely; `extractAppLink` matches the active base URL.
- Remote runs use 2 retries and a longer `expect` timeout for network latency; local settings are unchanged.

### 9. CI

- `ci.yml` keeps lint, typecheck and `pnpm test` with Docker Postgres. Its Docker-based e2e step is removed; e2e moves to the new job.
- New workflow `e2e-preview.yml` on `deployment_status` (state `success`, environment `Preview`), in a concurrency group that never runs two at once:
  1. Install, and `pnpm exec playwright install chromium`.
  2. `pnpm db:seed` to refresh the e2e tenant only.
  3. `pnpm --filter @timekeep/web e2e` with `E2E_BASE_URL` from the event.
  4. `pnpm db:e2e-cleanup`, which runs even when tests fail.
  5. Upload the Playwright report on failure.

  Secrets: `DATABASE_URL_SESSION`, `VERCEL_AUTOMATION_BYPASS_SECRET`, `E2E_SECRET`.

## Testing approach (test-first)

- **Unit (Vitest, web), written failing first:**
  - the capture guard (enabled only when the flag is on, outside production, with a matching secret);
  - app-URL resolution.
- **Integration (Vitest + Docker Postgres):**
  - `sendEmail()` writes a `captured_email` row when capture is on and not when it is off;
  - the test-email route returns 404 without the secret;
  - reseeding keeps a customer workspace that contains a demo user;
  - cleanup removes e2e users and workspaces and keeps customer ones;
  - the RLS migration enables RLS on every `public` table.
- **End to end:** the existing 18 specs are the acceptance test. They must pass unchanged against a preview deployment, still pass locally against Docker, and leave no e2e users behind after cleanup.

## Steps that need you

- Approve creating the Supabase project, since it adds compute cost to your organization. Then either:
  - let me create it and its storage bucket and keys through the Supabase tools, or
  - create them in the dashboard and paste the connection details into Vercel yourself.
- Approve provisioning Resend through the Vercel Marketplace.
- In the Vercel dashboard: generate the Protection Bypass for Automation secret (or confirm I may do it through the Vercel API).
- Add `DATABASE_URL_SESSION`, `E2E_SECRET` and the bypass secret to GitHub repository secrets.
- Push `main` to GitHub, which triggers the first deployments.
- Optional later:
  - add the production URL to Google OAuth's authorized redirect URIs;
  - verify a domain with Resend so production email reaches anyone.

## Out of scope

- Moving `pnpm test` integration tests off Docker.
- Running the pg-boss worker on Vercel.
- A custom domain.
- Supabase Branching or per-preview databases.
- The e2e coverage inventory and fixtures (designed separately; that work builds on this once remote runs are green).

## Risks

- **Previews share production's database.**
  - A bug in a preview can corrupt real data.
  - Mitigations:
    - previews never migrate;
    - e2e only touches its own tenants;
    - seed and cleanup are narrowed and tested;
    - the integration suite stays on Docker.
  - If real customers arrive, move previews to a separate project.
- **Preview URL vs auth origin.** If tests open the branch alias while emails link to the deployment URL, cookies land on the wrong origin. Mitigation: the runner always targets the deployment URL from the event, and the app URL resolves to the same.
- **Transaction-mode pooling.** Any future use of session features (named prepared statements, `SET`, session-level advisory locks) would break. Mitigation: documented in CLAUDE.md; the start-timer lock is transaction-scoped.
- **Test-only endpoint.** A mistake could expose captured emails. Mitigation: double guard (flag + non-production) plus secret, covered by tests; production never sets `MAIL_CAPTURE`.
- **Data API exposure.** A table reachable through Supabase's REST API would bypass the app's tenant checks. Mitigation: Data API off, RLS on every table, advisor check after each migration.
