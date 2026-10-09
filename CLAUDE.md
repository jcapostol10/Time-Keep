# TimeKeep — guide for engineers and AI agents

TimeKeep is a web-based time tracking and timesheet SaaS for teams (functionally comparable to Clockify; **never** copy its brand, text or assets). It is built in ten phases, one Claude Code session per phase, following `docs/PRD.md` and `docs/PROGRESS.md`.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm install` | Install everything (pnpm 10, Node 22+) |
| `cp .env.example .env` | One root `.env`; every app/package loads it via `dotenv -e ../../.env` |
| `docker compose up -d --wait` | Postgres 16 (`:5432`), Mailpit (`:8025` UI, `:1025` SMTP), MinIO (`:9000` S3, `:9001` console) |
| `pnpm db:migrate` / `pnpm db:generate` / `pnpm db:seed` / `pnpm db:studio` | Drizzle migrations, generate from schema, demo data, studio |
| `pnpm setup` | compose up + migrate + seed |
| `pnpm dev` | Web (`http://localhost:3000`) and worker, via Turborepo |
| `pnpm lint && pnpm typecheck && pnpm test && pnpm e2e` | The full gate. Run it before saying a phase is done |
| `pnpm --filter @timekeep/web e2e -- --ui` | Playwright UI mode |

Demo login after seeding: `owner@demo.test` / `password123` (also `admin@`, `manager@`, `member1@`, `member2@` — same password). Demo workspace slug: `demo`.

## Layout

```
apps/web/            Next.js 16 App Router (React 19, TS strict, Tailwind v4 + shadcn/ui)
  src/app/           routes: (auth)/*, /w/[workspaceSlug]/*, /account, /workspaces/new, /invite/[id], /api/auth
  src/server/        server-only code: auth.ts (Better Auth), env.ts, mail.ts, storage.ts (S3),
                     session.ts, workspace-access.ts, workspaces.ts, actions/* (server actions), queries/*
  src/components/    UI; shell/* is the app frame, auth/*, team/*, settings/*, account/*
  src/lib/           isomorphic helpers: auth-client.ts, permissions.ts, routes.ts, action-result.ts
  src/proxy.ts       Next 16 "proxy" (was middleware): optimistic cookie check only
  e2e/               Playwright specs + Mailpit helper;  test/ has Vitest DB helpers
apps/worker/         pg-boss job runner (Node, tsx)
packages/db/         Drizzle schema (src/schema/*), client.ts, migrate.ts, seed.ts, migrations/
packages/core/       Pure domain code: roles, zod schemas, slug helpers. Unit tested. No I/O
packages/ui/         shadcn/ui components (`@timekeep/ui/components/*`) and the theme (src/styles/globals.css)
packages/config/     Shared ESLint flat configs and tsconfig presets
docs/                PRD.md, DATA_MODEL.md, PROGRESS.md
```

## Invariants (do not break these)

1. **Timestamps are UTC.** Every column is `timestamptz`; render in the viewer's timezone (`user.timezone` → `workspace_settings.timezone` → UTC).
2. **Money is integer minor units + ISO 4217 currency code.** Never floats. (From Phase 4.)
3. **Every query is scoped by `workspaceId` and role-checked.** Server actions and route handlers call `requireWorkspaceAccess(slug, minRole)` from `apps/web/src/server/workspace-access.ts` first; pages/layouts use `requireWorkspacePage`. Cross-tenant access must render not-found, never leak existence.
4. **At most one running timer per user per workspace**, enforced by a partial unique index. (Phase 1.)
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
- Files go to S3-compatible storage via `apps/web/src/server/storage.ts`; the local bucket `timekeep` is public-read for avatars/logos. Validate MIME + magic bytes + size before uploading.
- UI: shadcn/ui components from `@timekeep/ui/components/*`, icons from `lucide-react`, toasts via `sonner`. Theme tokens are in `packages/ui/src/styles/globals.css` (our own teal palette; light + dark via `.dark` class and `next-themes`). Every page must work at 375px.
- Next.js: `cacheComponents` is **off** (all pages are dynamic and auth-gated). `PageProps<"/route">` / `LayoutProps<"/route">` global types come from `next typegen` (run by `pnpm typecheck`).
- Commit after each numbered part of a phase prompt; message body explains what and why. Tag `phase-N` when a phase's acceptance checks pass.

## Working on a phase

1. Read `docs/PRD.md`, `docs/DATA_MODEL.md` and the phase checklist in `docs/PROGRESS.md`.
2. Plan first (folder tree, schema changes, file list), then build part by part.
3. Add a migration with `pnpm db:generate` for every schema change; never edit applied migrations.
4. Finish with `pnpm lint && pnpm typecheck && pnpm test && pnpm e2e`, update `docs/DATA_MODEL.md` and `docs/PROGRESS.md`, update this file if conventions changed, commit, tag.
