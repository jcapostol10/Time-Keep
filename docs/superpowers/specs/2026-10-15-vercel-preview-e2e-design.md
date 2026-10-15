# Vercel deployment and e2e on preview deployments — design

Date: 2026-10-15. Status: draft for review.

## Goal

Deploy TimeKeep to Vercel and run the Playwright e2e suite against Vercel preview deployments instead of the local Docker stack. People can click through any preview or the production deployment by hand.

Success means:

- Every push to GitHub produces a Vercel preview deployment with its own database, file storage and email handling, and no Docker anywhere in that path.
- `pnpm e2e` runs green against a preview deployment, both from a developer machine (`E2E_BASE_URL=<preview url> pnpm e2e`) and automatically in CI after each preview deploy.
- The production deployment works for hand testing with the seeded demo accounts.
- Local Docker keeps working unchanged as an offline fallback (`pnpm e2e` with no `E2E_BASE_URL`).

## Decisions already made

| Topic | Decision |
| --- | --- |
| Scope | Deploy to Vercel; e2e runs against preview deployments. |
| Email | Resend over SMTP using Resend's test sender (no verified domain yet). In production it delivers only to the Resend account owner's address; everyone else uses seeded demo accounts. |
| Email in tests | Preview deployments capture outgoing email in the database instead of sending it; tests read it through a secret-protected endpoint (replaces Mailpit for remote runs). |
| Database | Neon from the Vercel Marketplace, with a separate Neon branch per preview deployment. |
| Files | Vercel Blob, public store. |
| Worker | Not deployed. It only sends a heartbeat today; Phase 5 decides how background jobs run on Vercel. |
| Integration tests | `pnpm test` (Vitest against Postgres) stays on Docker for now. Moving it is a separate later step. |

## Architecture

```
GitHub push
  -> Vercel builds apps/web (Root Directory = apps/web, pnpm workspace install)
       preview:    migrate -> seed -> next build     (Neon preview branch)
       production: migrate -> next build              (Neon main branch)
  -> deployment_status = success (Preview)
       -> GitHub Actions job "e2e-preview": pnpm e2e with E2E_BASE_URL = deployment URL
```

### 1. Vercel project

- One Vercel project linked to `jcapostol10/Time-Keep`, Root Directory `apps/web`, framework Next.js, Node 24. pnpm workspaces resolve `@timekeep/*` packages from the repo root.
- A `vercel-build` script in `apps/web/package.json` runs migrations (and the seed on previews, guarded by `VERCEL_ENV === "preview"`) before `next build`. Migrations use the unpooled Neon URL.
- Deployment Protection (Vercel Authentication) is on for previews and production, because the repo is public and the demo password is in it. Playwright passes it with Vercel's "Protection Bypass for Automation" secret.

### 2. Environment and URLs

- `env.ts` gains a resolved app URL: `BETTER_AUTH_URL` / `NEXT_PUBLIC_APP_URL` when set (production and local), otherwise `https://${VERCEL_URL}` on Vercel previews, so auth callbacks and email links point at the deployment being tested.
- Better Auth `trustedOrigins` includes that URL plus `https://${VERCEL_BRANCH_URL}` when present.
- `AUTH_RATE_LIMIT_ENABLED=false` on the Preview environment (the suite signs in dozens of times). Production keeps rate limiting on.
- New variables, all documented in `.env.example` and `turbo.json` `globalEnv`: `MAIL_CAPTURE`, `E2E_SECRET`, `BLOB_READ_WRITE_TOKEN` (set by the Blob integration), `E2E_BASE_URL` and `VERCEL_AUTOMATION_BYPASS_SECRET` (test runner only). Vercel's own `VERCEL_ENV`, `VERCEL_URL` and `VERCEL_BRANCH_URL` are added to `globalEnv` too, because Turborepo only passes listed variables to tasks.

### 3. Database

- Neon via `vercel integration add neon`, configured to create a branch per preview deployment. The integration sets `DATABASE_URL` (pooled) and an unpooled URL for migrations.
- The existing `pg` + Drizzle client stays (Fluid Compute keeps instances warm); only the connection string changes. Pool size stays small (max 10 per instance) and uses the pooled endpoint.
- Production is seeded once by hand (`pnpm db:seed` with the production URL) so the demo logins exist there too.

### 4. File storage

- `storage.ts` keeps one interface (`uploadObject`, `deleteObject`, `objectKeyFromUrl`) with two backends: Vercel Blob when `BLOB_READ_WRITE_TOKEN` is set, S3/RustFS otherwise. Object keys stay `avatars/...` and `logos/...`, so the profile e2e test's `img[src*='/avatars/']` check holds.
- `next.config.ts` allows images from the Blob public host (`*.public.blob.vercel-storage.com`) as well as `S3_PUBLIC_URL`.
- `storage:init` is skipped when Blob is active (Blob stores need no bucket policy).

### 5. Email

- Production and previews send through Resend's SMTP endpoint (`smtp.resend.com`, port 465, user `resend`, the API key as password). `mail.ts` already uses nodemailer SMTP, so this is configuration only.
- Mail capture: when `MAIL_CAPTURE=true` (Preview environment only), `sendEmail()` stores the message in a new `captured_email` table (id, to, subject, html, text, created_at) instead of sending it.
- `GET /api/test/emails?to=<address>&subject=<regex>` returns captured messages, newest first. It responds 404 unless `MAIL_CAPTURE` is true, `VERCEL_ENV` is not `production`, and the `x-e2e-secret` header equals `E2E_SECRET`. This is the only test-only code in the app, and it is inert in production twice over (the flag and the environment check).

### 6. Test runner

- `playwright.config.ts`: when `E2E_BASE_URL` is set, use it as `baseURL`, skip `webServer`, and send `x-vercel-protection-bypass` + `x-vercel-set-bypass-cookie: true` headers. Without it, behaviour is unchanged (local `pnpm dev` + Docker).
- `e2e/helpers/mailpit.ts` becomes `e2e/helpers/mail.ts` with the same API (`waitForEmail`, `extractAppLink`, `deleteAllMessages`). It reads from Mailpit locally and from `/api/test/emails` remotely; `extractAppLink` matches the active base URL.
- Remote runs use 2 retries and a longer `expect` timeout for network latency; local settings are unchanged.
- The suite relies on seeded demo data, which each preview's fresh Neon branch provides. Specs that mutate demo data already restore it (profile) or use fresh users (tracker, workspace).

### 7. CI

- `ci.yml` keeps lint, typecheck and `pnpm test` with Docker Postgres. Its Docker-based e2e step is removed; e2e moves to the new job.
- New workflow `e2e-preview.yml` on `deployment_status` (state `success`, environment `Preview`): install, `pnpm exec playwright install chromium`, run `pnpm --filter @timekeep/web e2e` with `E2E_BASE_URL` from the event, `VERCEL_AUTOMATION_BYPASS_SECRET` and `E2E_SECRET` from GitHub secrets. Uploads the Playwright report on failure.

## Testing approach (test-first)

- Unit (Vitest, web): the capture guard (enabled only when flag on, non-production, matching secret) and the app-URL resolution, written failing first.
- Integration (Vitest + Postgres): `sendEmail()` writes a `captured_email` row when capture is on and does not when off; the route returns 404 without the secret.
- Storage backend selection: unit test that picks Blob or S3 from the environment.
- End to end: the existing 18 specs are the acceptance test. They must pass unchanged against a preview deployment and still pass locally against Docker.

## Steps that need you

- Approve each Marketplace provisioning step (Neon, Resend, Blob), since they create billed resources on your Vercel team.
- In the Vercel dashboard: generate the Protection Bypass for Automation secret (or confirm I may do it through the Vercel API) and add `E2E_SECRET` and the bypass secret to GitHub repository secrets.
- Push `main` to GitHub, which triggers the first deployments.
- Optional later: add the production URL to Google OAuth's authorized redirect URIs, and verify a domain with Resend so production email reaches anyone.

## Out of scope

- Moving `pnpm test` integration tests off Docker.
- Running the pg-boss worker on Vercel.
- A custom domain.
- The e2e coverage inventory and fixtures (designed separately; that work builds on this once remote runs are green).

## Risks

- **Preview URL vs auth origin.** If tests open the branch alias while emails link to the deployment URL, cookies land on the wrong origin. Mitigation: the runner always targets the deployment URL from the event, and the app URL resolves to the same.
- **Seeding time and cold starts.** Seeding every preview adds build time; first requests may be slower. Mitigation: seed is small; remote runs get retries and longer timeouts.
- **Neon branch limits** on the free plan. Mitigation: the integration deletes preview branches when deployments are removed; check limits when provisioning.
- **Test-only endpoint.** A mistake could expose captured emails. Mitigation: double guard (flag + non-production) plus secret, covered by tests; production never sets `MAIL_CAPTURE`.
