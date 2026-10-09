# TimeKeep — Product Requirements

## Vision

A web-first time tracker and timesheet product with the same job-to-be-done as Clockify: teams log hours against clients, projects and tasks, then turn those hours into reports, approvals, payroll data and invoices. We match the core loop first and differentiate later on price, local-currency / Philippine payroll exports and a better UX.

- **Target users:** agencies, consultancies, dev shops and SMBs with 2–200 people. Freelancers are the free-tier wedge.
- **Core loop:** start timer → stop → entry lands on a project → manager sees it in a report → it gets approved, paid or invoiced.
- **MVP line:** Phases 0–3 are a usable free product. Phases 4–6 are what people pay for. Phases 7–9 are expansion.
- **Guardrail:** clone the feature set and workflows, not the brand. Own name, logo, colours, copy and illustrations. Never reuse Clockify assets, text or screenshots.

## Non-negotiable rules

- All timestamps stored in UTC, rendered in the viewer's timezone.
- At most one running timer per user per workspace (partial unique index).
- Money as integer minor units with an ISO 4217 currency code.
- Rates snapshotted on the entry; historical reports never shift silently.
- Every query filtered by `workspaceId` and checked against the caller's role.

## Roles

| Role | Scope |
| --- | --- |
| Owner | One per workspace, transferable. Everything. |
| Admin | Workspace administration: members, invites, settings, all data. |
| Manager | Delegated scope (Phase 4): the projects they manage and/or the users/groups they manage. |
| Member | Own time; sees what the workspace settings allow. |

## Phases

| # | Phase | Delivers |
| --- | --- | --- |
| 0 | Foundation | Monorepo, schema, auth (email/password, magic link, Google), workspaces, invites, app shell, profile, seed, docs, CI |
| 1 | Time tracker | Timer bar, manual mode, entry list grouped by day, inline edit, continue/duplicate/delete, idle detection, Pomodoro, reminders |
| 2 | Projects, clients, tasks, tags, timesheet, calendar | Full entities with access rules; weekly grid with templates; day/week calendar with drag to create/move/resize |
| 3 | Reports and dashboard | Report engine in SQL; Summary, Detailed, Weekly; CSV/Excel/PDF; shared links; dashboard with team activity |
| 4 | Team, roles, rates, admin controls | Permission matrix, groups, billable rate hierarchy with history, rounding, required fields, bulk edit, import |
| 5 | Approvals, time off, attendance, reminders, kiosk | Submit/approve/lock periods, policies and holidays, overtime report, targets, shared-device kiosk with PIN/QR |
| 6 | Expenses, invoicing, budgets, profit | Cost rates and profit, multi-currency, estimates and alerts, expenses with receipts, invoices with payments and recurrence |
| 7 | Scheduling and forecasting | Assignments on a timeline, capacity, publishing, forecast vs estimate, assignments report |
| 8 | Platform | Plans and feature flags, billing (Stripe + local adapter), public REST API + OpenAPI, webhooks, SSO/SCIM, audit log, ops |
| 9 | Apps | Browser extension, mobile PWA with offline queue, desktop tray app with local auto tracker |

Gates: after Phase 3 and after Phase 6, pause, use the product, and re-cut scope.

## Tier mapping (what customers pay for)

| Capability | Minimum tier |
| --- | --- |
| Timer, projects, timesheet, calendar, basic reports (1-month range, PDF), dashboard, up to 5 users | Free |
| Billable rates, decimal format, rounding, add time for others, required fields, bulk edit, import, private projects | Basic |
| Manager role, groups, task rates, approvals and locks, time off, attendance, targets, invoicing | Standard |
| Expenses, budgets and alerts, cost and profit, multiple currencies, custom fields, scheduling, kiosk extras | Pro |
| SSO, SCIM, custom subdomain, audit log, control accounts, data region | Enterprise |

## Deliberately deferred

Activity monitoring agents, screenshots and GPS, 80+ third-party integrations, multi-region hosting, Google/Outlook calendar sync (extension point only), native iOS/Android apps, localisation, AI features.
