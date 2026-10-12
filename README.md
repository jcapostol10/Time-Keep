# TimeKeep

Web-based time tracking and timesheets for teams: start a timer, land hours on a project, and turn them into reports, approvals and invoices.

> Phase 0 (foundation) is in progress. See [docs/PROGRESS.md](docs/PROGRESS.md) for the roadmap and status.

## Stack

| Layer    | Choice                                                                 |
| -------- | ---------------------------------------------------------------------- |
| Monorepo | pnpm workspaces + Turborepo                                            |
| Web      | Next.js (App Router) · React · TypeScript strict · Tailwind + shadcn/ui |
| Database | PostgreSQL 16 · Drizzle ORM                                            |
| Auth     | Better Auth (email/password, magic link, Google) · organization plugin |
| Jobs     | pg-boss (`apps/worker`)                                                |
| Email    | SMTP (Mailpit locally)                                                 |
| Files    | S3-compatible storage (RustFS locally, a MinIO drop-in)               |
| Tests    | Vitest · Playwright                                                    |

## One-command local setup

Prerequisites: Node 22+ (`.nvmrc` says 24), [pnpm](https://pnpm.io) 10, Docker Desktop.

```bash
git clone https://github.com/jcapostol10/Time-Keep.git && cd Time-Keep
pnpm install
cp .env.example .env            # then set BETTER_AUTH_SECRET (openssl rand -base64 32)
pnpm bootstrap                  # docker compose up, create bucket, migrate, seed demo workspace
pnpm dev                        # web on http://localhost:3000, worker alongside
```

Local services started by `docker compose`:

| Service  | URL                                          | Credentials            |
| -------- | -------------------------------------------- | ---------------------- |
| Postgres | `postgres://timekeep:timekeep@localhost:5432/timekeep` | timekeep / timekeep |
| Mailpit  | http://localhost:8025 (all outgoing email)   | —                      |
| RustFS   | http://localhost:9001 (console), :9000 (S3)  | rustfsadmin / rustfsadmin |

Demo login after seeding: `owner@demo.test` / `password123` (plus admin, manager and two members — see `packages/db/src/seed.ts`).

### Google sign-in (optional)

1. In [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials), create an **OAuth client ID** of type **Web application** (configure the OAuth consent screen first if prompted; External + your email as a test user is enough for development).
2. Authorized JavaScript origin: `http://localhost:3000`. Authorized redirect URI: `http://localhost:3000/api/auth/callback/google`. For production add the same two entries with your real domain.
3. Put the client ID and secret in `.env` as `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` and restart `pnpm dev`. The "Continue with Google" button appears on the sign-in and sign-up pages. A Google login with the same address as an existing verified email/password account links to it; brand-new Google users get a personal workspace just like email sign-ups.

## Scripts

| Command           | What it does                                           |
| ----------------- | ------------------------------------------------------ |
| `pnpm dev`        | Run web + worker in watch mode                         |
| `pnpm build`      | Build every app                                        |
| `pnpm lint`       | ESLint across the monorepo                             |
| `pnpm typecheck`  | `tsc --noEmit` across the monorepo                     |
| `pnpm test`       | Unit + integration tests (needs Postgres running)      |
| `pnpm e2e`        | Playwright end-to-end tests (needs the full stack)     |
| `pnpm storage:init`| Create the S3 bucket and public-read policy (idempotent) |
| `pnpm db:generate`| Generate a Drizzle migration from schema changes       |
| `pnpm db:migrate` | Apply migrations                                       |
| `pnpm db:seed`    | Create / refresh the demo workspace                    |
| `pnpm db:studio`  | Open Drizzle Studio                                    |

## Layout

```
apps/web        Next.js app (UI, server actions, route handlers, e2e tests)
apps/worker     pg-boss job runner
packages/db     Drizzle schema, migrations, DB client, seed
packages/core   Domain logic: roles, zod schemas, pure helpers (unit-tested)
packages/ui     shadcn/ui components and Tailwind theme
packages/config Shared ESLint and tsconfig presets
docs/           PRD, data model, progress checklist
```

Conventions and invariants for contributors (and AI agents) live in [CLAUDE.md](CLAUDE.md).
