# TimeKeep — guide for engineers and AI agents

TimeKeep is a web-based time tracking and timesheet SaaS for teams (functionally comparable to Clockify; **never** copy its brand, text or assets). It is built in ten phases, one Claude Code session per phase, following `docs/PRD.md` and `docs/PROGRESS.md`.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm install` | Install everything (pnpm 10, Node 22+) |
| `cp .env.example .env` | One root `.env`; every app/package loads it via `dotenv -e ../../.env` |
| `docker compose up -d --wait` | Postgres 16 (`:5432`), Mailpit (`:8025` UI, `:1025` SMTP), RustFS S3 (`:9000` API, `:9001` console) |
| `pnpm storage:init` | Create the bucket + public-read policy for `avatars/*`, `logos/*` (any S3-compatible backend) |
| `pnpm db:migrate` / `pnpm db:generate` / `pnpm db:seed` / `pnpm db:studio` | Drizzle migrations, generate from schema, demo data, studio |
| `pnpm bootstrap` | compose up + storage:init + migrate + seed (not `setup`: that is a pnpm built-in and silently shadows package scripts) |
| `pnpm dev` | Web (`http://localhost:3000`) and worker, via Turborepo |
| `pnpm lint && pnpm typecheck && pnpm test && pnpm e2e` | The full gate. Run it before saying a phase is done |
| `pnpm --filter @timekeep/web e2e -- --ui` | Playwright UI mode |

Demo login after seeding: `owner@demo.test` / `password123` (also `admin@`, `manager@`, `member1@`, `member2@` — same password). Demo workspace slug: `demo`.

## Layout

```
apps/web/            Next.js 16 App Router (React 19, TS strict, Tailwind v4 + shadcn/ui)
  src/app/           routes: (auth)/*, /w/[workspaceSlug]/*, /account, /workspaces/new, /invite/[id], /api/auth
  src/app/api/w/[workspaceSlug]/*   JSON GET route handlers for client reads (tracker entries, running, options)
  src/server/        server-only code: auth.ts (Better Auth), env.ts, mail.ts, storage.ts (S3),
                     session.ts, workspace-access.ts, workspaces.ts, time-entries.ts (entry service),
                     actions/* (server actions), queries/*
  src/components/    UI; shell/* is the app frame, tracker/*, auth/*, team/*, settings/*, account/*
  src/hooks/         client hooks (use-now: shared 1s clock; use-local-storage)
  src/lib/           isomorphic helpers: auth-client.ts, permissions.ts, routes.ts, action-result.ts,
                     tracker-types.ts (DTOs), fetch-json.ts, notifications.ts
  src/proxy.ts       Next 16 "proxy" (was middleware): optimistic cookie check only
  e2e/               Playwright specs + Mailpit helper;  test/ has Vitest DB helpers
apps/worker/         pg-boss job runner (Node, tsx)
packages/db/         Drizzle schema (src/schema/*), client.ts, migrate.ts, seed.ts, migrations/
packages/core/       Pure domain code: roles, zod schemas, slugs, duration + timezone helpers,
                     entry grouping/editing, tracker rules. Unit tested. No I/O
packages/ui/         shadcn/ui components (`@timekeep/ui/components/*`) and the theme (src/styles/globals.css)
packages/config/     Shared ESLint flat configs and tsconfig presets
docs/                PRD.md, DATA_MODEL.md, PROGRESS.md
```

## Invariants (do not break these)

1. **Timestamps are UTC.** Every column is `timestamptz`; render in the viewer's timezone (`user.timezone` → `workspace_settings.timezone` → UTC).
2. **Money is integer minor units + ISO 4217 currency code.** Never floats. (From Phase 4.)
3. **Every query is scoped by `workspaceId` and role-checked.** Server actions and route handlers call `requireWorkspaceAccess(slug, minRole)` from `apps/web/src/server/workspace-access.ts` first; pages/layouts use `requireWorkspacePage`. Cross-tenant access must render not-found, never leak existence.
4. **At most one running timer per user per workspace**, enforced by the partial unique index `time_entry_one_running_uq` (`WHERE "end" IS NULL AND deleted_at IS NULL`) plus a per-user advisory lock in `startTimer`. Starting a timer stops the running one in the same transaction.
5. **Rates are snapshotted on the entry** so historical reports never shift. (Phase 4.)
6. **No feature merges without tests.** Pure logic → Vitest in `packages/core`; DB behaviour → Vitest integration tests in `apps/web/src/**/*.test.ts` against `TEST_DATABASE_URL`; user flows → Playwright in `apps/web/e2e`.
7. **Secrets never enter git.** The repo is public. `.env` is ignored; `.env.example` documents every variable.

## Conventions

- TypeScript strict, `noUncheckedIndexedAccess` on. Prefer `import type` / inline `type` imports (lint enforces it).
- Server code imports `server-only`. Server actions live in `src/server/actions/*.ts` with `"use server"` at the top and return `ActionResult<T>` (`src/lib/action-result.ts`) instead of throwing to the client.
- Validation: zod schemas live in `packages/core/src/schemas.ts` and are shared by forms (react-hook-form + `zodResolver`) and server actions. Validate on both sides.
- Database access goes through Drizzle (`@timekeep/db`). `getDb()` is a lazy singleton; tests create their own client with `createDb(TEST_DATABASE_URL)`.
- Auth is Better Auth. Its organization plugin is renamed: `organization → workspace`, `member → membership` (+ `status`), `invitation`, `session.activeOrganizationId → activeWorkspaceId`. Roles are stored lowercase (`owner | admin | manager | member`); `packages/core/src/roles.ts` is the single source of truth for ranking.
- Workspaces are created only through `createWorkspace()` in `apps/web/src/server/workspaces.ts` (row + settings + owner membership in one transaction). Pending invites live in `invitation`; a `membership` row appears on acceptance.
- Email goes through `sendEmail()` in `apps/web/src/server/mail.ts` (SMTP; Mailpit locally). Phase 5 moves sending into the worker.
- Files go to S3-compatible storage via `apps/web/src/server/storage.ts` (RustFS locally — MinIO stopped publishing community images; the API is identical). `apps/web/scripts/storage-init.ts` creates the bucket and makes `avatars/*` and `logos/*` public-read. Validate MIME + magic bytes + size before uploading.
- **Time entries are written only through `apps/web/src/server/time-entries.ts`** (db-injected functions, scoped to one workspace + user). Server actions in `actions/time-entries.ts` wrap it. Later phases add rate snapshots, locks and approvals there, so never insert or update `time_entry` anywhere else.
- **Date, time and duration maths only via `packages/core`**: `parseDuration` / `formatDuration` / `formatClock`, `localDateKey`, `zonedDateTimeToInstant`, `addDaysInZone`, `weekBounds`, `formatTimeOfDay`, `parseTimeOfDay`, and `entry-edit.ts` for row edits. They are DST-safe (built on `@date-fns/tz`); never add `n * 86_400_000` to an instant. Viewer preferences come from `resolveViewerPrefs(user, workspaceSettings)`.
- Bare numbers typed as durations are hours (`1.5` = 1:30:00); `1:30`, `90m`, `1h30m` also work.
- Tracker data flow: the page SSRs the first week into react-query (`HydrationBoundary`); later pages and refetches use the `/api/w/[slug]/...` route handlers; writes are server actions followed by cache updates (`components/tracker/entry-cache.ts`). Everything crossing the boundary is JSON with ISO strings (`lib/tracker-types.ts`), never `Date`.
- `TrackerProvider` (in the workspace layout) owns the running timer on every workspace page: tab title, S / N / Esc shortcuts, cross-tab sync (BroadcastChannel + refetch on focus), idle detection, Pomodoro and reminders. Components that need the ticking clock use `useTrackerClock()`; everything else uses `useTracker()` so rows do not re-render every second.
- `react-hooks` v7 lint rules are on: no `Date.now()` or other impure calls during render, no synchronous `setState` in effects (use `useSyncExternalStore`, `useEffectEvent`, or derive state), and `useWatch` instead of `form.watch`.
- e2e specs that type into the tracker wait for `section[aria-label="Timer"][data-hydrated="true"]` first; tracker specs use a fresh signed-up user so seeded data stays stable.
- UI: shadcn/ui components from `@timekeep/ui/components/*`, icons from `lucide-react`, toasts via `sonner`. Theme tokens are in `packages/ui/src/styles/globals.css` (our own teal palette; light + dark via `.dark` class and `next-themes`). Every page must work at 375px.
- Next.js: `cacheComponents` is **off** (all pages are dynamic and auth-gated). `PageProps<"/route">` / `LayoutProps<"/route">` global types come from `next typegen` (run by `pnpm typecheck`).
- Commit after each numbered part of a phase prompt; message body explains what and why. Tag `phase-N` when a phase's acceptance checks pass.

## Working on a phase

1. Read `docs/PRD.md`, `docs/DATA_MODEL.md` and the phase checklist in `docs/PROGRESS.md`.
2. Plan first (folder tree, schema changes, file list), then build part by part.
3. Add a migration with `pnpm db:generate` for every schema change; never edit applied migrations.
4. Finish with `pnpm lint && pnpm typecheck && pnpm test && pnpm e2e`, update `docs/DATA_MODEL.md` and `docs/PROGRESS.md`, update this file if conventions changed, commit, tag.
