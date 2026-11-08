# Phase 6 — Expenses, invoicing, budgets and profit: design

Prompt: "Phase 6 — Expenses, invoicing, budgets and profit" in `Clockify Clone — Phased Claude Code Prompt Pack.md`. Checklist: `docs/PROGRESS.md` § Phase 6. Builds on the Phase 4 rate hierarchy and its rating SQL (`packages/db/src/rates-sql.ts`), the entry service (the only writer of `time_entry`), the report engine and export pipeline, the Phase 5a approvals, locks, outbox and daily job, and the private bucket. Written from the prompt without an interview (the owner said on 2026-11-05: make the decisions for now, we can revise them later); every call the prompt does not make is the builder's and is listed first, so it can be checked while reading.

## Goal

An agency can bill its clients from tracked time and expenses, and see whether each project makes money: what the work cost, what it earned, how far a project is into its budget, what was spent on it, and an invoice the client can open, download and pay against.

The phase is the PRD's Standard tier (invoicing) and Pro tier (cost and profit, currencies, budgets, expenses). Plan limits arrive in Phase 8; here every workspace gets every feature through `planAllows`, which stays a stub returning true and gains the features `costProfit`, `multiCurrency`, `budgets`, `expenses` and `invoicing`.

## Delivery: four branches

Each is merged, deployed and e2e-tested on its own, with its own additive migration run through the Migrate shared database workflow before its preview. Each gets its own implementation plan, written when it starts against the code the previous one leaves.

- **Phase 6a — cost, profit and currencies** (Parts 1–2). Migration `0016_phase6a`.
- **Phase 6b — estimates, budgets and alerts** (Part 3). Migration `0017_phase6b`.
- **Phase 6c — expenses** (Part 4). Migration `0018_phase6c`.
- **Phase 6d — invoicing** (Part 5). Migration `0019_phase6d`.

`phase-6` is tagged after 6d's acceptance checks pass. Then the PRD's gate applies: pause, use the product, re-cut scope.

The preview e2e run is at 9.9 of its 10 minutes. Each branch measures the lane before adding to it and moves mature specs to `@nightly` first (the Phase 5 specs `approvals.spec.ts` and `time-off.spec.ts` are the first candidates), keeping the preview under 9 minutes.

## Decisions (builder's calls; check these first)

### Money in general

1. **No currency conversion, anywhere (the prompt's rule).** Money in two currencies is never added together. The cost side (cost rates, expenses) is always in the workspace currency, because it is what the company pays; the revenue side (billable amounts, invoices) is in the client's currency. Profit is therefore only computed where both sides are in the workspace currency (decision 7).

### Part 1 — cost and profit (6a)

2. **Cost rates use the existing `rate` table with `kind = 'cost'`** (reserved since Phase 4), at two levels, most specific first: project member, then member (the prompt's list). History works as for billable rates: rows are never edited, a change adds a row with `effective_from`, a null amount means "no cost at this level from this date". Owners and admins set them: a member's cost rate on the Team page (the column hidden since Phase 4 appears), a person's cost on one project on the project's Access tab. The dialog offers the same "New entries only / Entries from a date / All entries", and the existing recalculation job re-rates both kinds in one pass. *Cost if wrong:* a workspace-level default cost is one more level in the same SQL.

3. **Cost is snapshotted on every work entry**, billable or not, never on breaks: `cost_rate_minor`, `cost_rate_source`, `cost_amount_minor`. Same life as the billable snapshot: rated at creation with the cost rate in force at the entry's start; an edit keeps the rate and recomputes the amount; a change of person or project re-rates. `rateEntriesSql` sets both snapshots in one statement, so they cannot drift. Entries saved before a workspace has cost rates have no cost until an admin applies a rate to past entries; nothing is backfilled.

4. **Profit = billable amount − cost; margin = profit ÷ amount.** An entry without a cost rate counts as zero cost and is counted in `uncostedCount`, shown as "12 entries have no cost rate", as unrated entries are today. Margin shows "—" when the amount is zero.

5. **Cost and profit are for owners and admins, and for managers only when the workspace says so.** A new matrix action `report.viewCosts`: owners and admins always; a manager, within their scope, when the new setting "Managers see cost and profit" (`managers_see_costs`, default off) is on; members never. For everyone else cost is zeroed on the server and the columns do not exist, exactly as amounts are handled. Cost rate rows themselves (`rate.view` for cost) stay owner and admin only. The setting's help text says what it means: a manager who sees cost can work out what their people are paid.

6. **Where they show.** Summary and Detailed gain Cost and Profit columns for viewers who may see them; the project Status tab gains the two numbers; the exports gain the columns for the same viewers. A new Reports tab **Profit** is the Summary engine with a fixed set of measures (time, billable time, amount, cost, profit, margin), grouped by project, client or user, sorted by profit, with a bar per group. **Share links never carry cost or profit**: a shared report is for clients. Weekly and the dashboard get no cost or profit.

### Part 2 — currencies (6a)

7. **An entry's currency is its project's: the client's currency, or the workspace's when the project has no client or the client has none set.** A client's currency is chosen in the client dialog from the ISO 4217 list (empty means "the workspace currency", and follows it).

   **A rate applies only to entries in its own currency.** `rate.currency` already exists. Project, task and project-member billable rates are created in the project's currency; member and workspace rates are in the workspace currency. So on a project billed in another currency only the project's own rates apply, and without one the entry is unrated and counted as such. The alternative (using a member's number as is in the client's currency, as some trackers do) silently turns ₱2,500 an hour into $2,500 an hour, so it is refused. The rate dialog names the currency, and a project billed in another currency with no project rate shows a notice on its Access tab ("Set a project rate: member rates are in PHP and are not converted").

   **Profit covers the workspace currency only.** Cost is shown for everything. Profit and margin are computed over entries whose currency is the workspace's; a row or total that also holds entries billed in another currency says "Profit leaves out 14 entries billed in USD (no conversion)".

8. **Changing a currency relabels, after a confirmation, and never converts** (the rule the workspace currency already follows). Changing a client's currency relabels the rates of its projects and the saved amounts of their entries; moving a project to a client with another currency does the same for that project; changing the workspace currency relabels member, workspace and cost rates and the entries that took the workspace currency. From 6d, a client with an invoice that is not void cannot change currency.

9. **Reports list amounts per currency.** The engine groups by the entry's currency as a hidden key, and every row and total carries `amounts: { currency, amountMinor }[]` (workspace currency first) in place of one `amountMinor`. A table cell prints one line per currency, the totals bar lists each, a column sort by amount uses the workspace currency's amount, and a chart that plots money gets a currency selector that appears only when the range holds more than one. Exports: Detailed keeps Amount and Currency per entry; Summary, Weekly and Profit get one amount column per currency present ("Amount (USD)", "Amount (PHP)").

### Part 3 — estimates, budgets and alerts (6b)

10. **A project has one estimate**: none, by time (hours) or by money (the project's currency), for the whole project or reset every calendar month in the workspace timezone. A time estimate measures all work time on the project, billable or not; a money estimate measures the billable amount. Raw time: report rounding never applies. Tasks can carry their own optional time estimate, shown on the Tasks tab; they do not add up into the project's. *Cost if wrong:* "billable time only" and "sum of the tasks" are options on the same columns.

11. **Progress is computed, never stored**: one aggregate (`projectProgress`) for the current period, used wherever a bar shows: the projects table, the project header, the dashboard's top projects and Summary rows grouped by project. Not in pickers or entry rows. Who sees it: owners, admins and the project's managers; members only when "members see the team's time" is on, and only for time estimates; a money bar needs `report.viewAmounts`.

12. **A Budget tab on the project page**: the estimate's settings (admins and the project's managers), the bar, a chart of cumulative tracked against the estimate over the period, and the per-task table when tasks have estimates.

13. **Alerts are checked once a day by the daily job** and go through the outbox to the project's managers and the workspace's owners and admins. Thresholds are a workspace setting (default 50, 80 and 100 percent; up to five values from 1 to 200). Each fires once per project, threshold and period: the outbox `kind` is `budget:<project>:<threshold>:<period>`, the mechanism target emails use. A project can switch its alerts off. The settings copy says "checked once a day", so an alert can arrive the morning after.

### Part 4 — expenses (6c)

14. **Expenses are on the cost side: always in the workspace currency** (decision 1). A category is a fixed amount or unit-based (a unit name and a price per unit, e.g. km), with a billable default, and can be archived. An expense has a person, a project (required), a category, a date (a local date, no time), an amount or a quantity in hundredths with the unit price snapshotted, billable, a note and an optional receipt.

15. **Receipts are private and capped at 4 MB.** JPEG, PNG, WebP or PDF, checked by MIME type and magic bytes, stored in the private bucket under `receipts/<workspace>/<expense>`, opened through a 5-minute presigned URL. The browser scales a photo down to 2,000 px and makes the 320 px thumbnail before upload, so phone photos fit under Vercel's request limit and the server needs no image library; a PDF shows a file icon.

16. **Who.** Everyone records their own expenses; owners and admins, and managers within their scope, read and edit their people's and can add for others, by the rule entries follow. Categories are for owners and admins.

17. **Expenses join approvals and locks.** An expense belongs to the period that holds its date. One guard (`assertExpenseWritable`) applies the same lock date and the same PENDING or APPROVED lookup as entries; owners and admins edit with a note, logged as `ADMIN_EDIT`. A submitted request includes the period's expenses: it records their count and total, and the per-person period view lists them.

18. **Expenses page and Expense report.** The page lists and filters (dates, person, project, category, billable, invoiced). A Reports tab **Expenses** totals by category, project or person with CSV, Excel and PDF. "Download receipts" is always an export job: a zip in the export bucket, downloaded and emailed like a large export.

19. **Profit counts expenses once they exist.** The Profit tab gains Expenses (all of them, a cost) and Billable expenses (revenue), and profit becomes amount + billable expenses − cost − expenses, workspace currency only.

### Part 5 — invoicing (6d)

20. **An invoice belongs to one client and takes that client's currency when it is created**, fixed from then on. Its number comes from a workspace sequence (prefix, next number, padding; default `INV-0001`), taken under a row lock, editable while the invoice is a draft, unique per workspace.

21. **Stored status is DRAFT, SENT or VOID; the rest is computed.** PAID, PARTIALLY_PAID and OVERDUE come from the total, the payments and today's date in the workspace timezone, by one core function the list, the page and the SQL filter share, so a status can never be stale. The daily job does not mark anything; it sends the "invoice overdue" email once per invoice. *Cost if wrong:* a stored column the job writes.

22. **Importing time uses the report engine, so the invoice equals the report by construction.** "Import time and expenses" takes a date range and the client's projects and runs the Summary engine (billable entries, the workspace's rounding rule), grouped by project, task, person or entry. A line's amount is the engine's amount for that group; hours are shown to two decimals, and the unit price only when every entry in the line has one rate. Manual lines are quantity (hundredths) × unit price, rounded half up **per line**. Then: subtotal = the lines; discount = a percent of the subtotal; each of up to two named taxes = a percent of (subtotal − discount), not compounded; total = subtotal − discount + taxes. Percents are stored as hundredths of a percent.

23. **Time and expenses are invoiced once.** `time_entry.invoice_id` and `expense.invoice_id`. An import takes only stopped, billable, rated entries in the invoice's currency with no invoice, under a per-client advisory lock, and checks that it marked exactly what it selected. Removing a line, deleting a draft or voiding an invoice releases them. The entry service is still the only writer (`markInvoiced`, `releaseInvoiced`). An invoiced entry is read-only for everyone (the message names the invoice), the rate job skips it, and Detailed shows an "Invoiced" badge and gets an invoiced filter. Billable expenses in the workspace currency import the same way; for a client billed in another currency they are listed as not importable (decision 1).

24. **Sending freezes a PDF.** The PDF is the report renderer with an invoice template. "Send" renders it, stores it in the private bucket, and enqueues the email to the client with the file attached (the outbox gains an attachment key) and a link to the public view. "Mark as sent" does the same without the email. Branding lives in `invoice_settings`: the workspace logo, company name and address, a tax number line, default notes, payment terms in days (default 30), default tax names and percents.

25. **The public view is a token link like a shared report**: `/invoice/<token>`, only the sha256 stored, no session, a Download PDF button with the share export's rate limit. A draft or void invoice, an unknown or revoked token: the same 404.

26. **Payments** are a date, an amount and a note on a sent invoice; the balance is the total less the payments; an overpayment is refused.

27. **Recurring invoices are templates the daily job runs.** A schedule (weekly on a weekday, or monthly on a day from 1 to 31, clamped to the month's last day), a start and an optional end, fixed lines and optionally "import the period just ended", and a mode: create a draft, or create and send. One invoice per template and period (a unique key), so a second run creates nothing. Auto-send without a client email leaves a draft and tells the admins.

28. **Invoices are for owners and admins** (`invoice.manage`); managers and members do not see the page. The accounting hook is an `external_ref` column and a typed, empty adapter registry (`server/invoices/sync.ts`); nothing calls out.

## Part 1 and 2 — what is built in 6a

- **Team page**: a Cost rate column and "Set cost rate" in the row menu (owners and admins). **Project → Access**: a cost rate per member, and the notice of decision 7.
- **Clients**: Currency in the client dialog and a column in the list.
- **Rate dialogs** name the currency they are in.
- **Settings**: "Managers see cost and profit".
- **Reports**: Cost and Profit columns in Summary and Detailed, the Profit tab, amounts per currency everywhere money shows (tables, totals bar, charts' selector, exports, PDF, share links, the dashboard, the project Status tab).
- **Seed**: cost rates for the demo members, and one demo client billed in USD with a project rate (the workspace is in PHP).

## Data model

Migration `0016_phase6a` (additive):

- `time_entry`: `cost_rate_minor bigint null`, `cost_rate_source rate_level null`, `cost_amount_minor bigint null`.
- `workspace_settings`: `managers_see_costs boolean default false`.
- No new table: cost rates are `rate` rows with `kind = 'cost'`, and `client.currency` already exists.

Migration `0017_phase6b`: `project.estimate_kind enum (NONE, TIME, MONEY) default NONE`, `estimate_seconds bigint null`, `estimate_minor bigint null`, `estimate_reset enum (NONE, MONTHLY) default NONE`, `estimate_alerts boolean default true`; `task.estimate_seconds bigint null`; `workspace_settings.budget_thresholds smallint[] default {50,80,100}`.

Migration `0018_phase6c`: `expense_category` (`id`, `workspace_id`, `name` unique per workspace, `kind enum (FIXED, UNIT)`, `unit_name?`, `unit_price_minor?`, `billable_default`, `archived`); `expense` (`id`, `workspace_id`, `user_id`, `project_id`, `category_id`, `date date`, `amount_minor bigint`, `quantity_centi int?`, `unit_price_minor bigint?`, `billable`, `note`, `receipt_key?`, `receipt_thumb_key?`, `receipt_mime?`, `invoice_id?` (the foreign key arrives in 0019), `created_by`, `deleted_at?`); `approval_request.expense_count int default 0`, `expense_minor bigint default 0`. Indexes on (workspace, user, date) and (workspace, project, date).

Migration `0019_phase6d`: `invoice_settings` (one row per workspace); `invoice` (`id`, `workspace_id`, `client_id`, `number` unique per workspace, `issue_date`, `due_date`, `currency`, `status enum (DRAFT, SENT, VOID)`, `discount_bps`, `tax1_name?`, `tax1_bps?`, `tax2_name?`, `tax2_bps?`, `notes`, the stored totals `subtotal_minor`, `total_minor`, `sent_at?`, `pdf_key?`, `public_token_hash?`, `recurring_id?`, `period_key?`, `external_ref?`, `created_by`); `invoice_item` (`id`, `invoice_id`, `position`, `kind enum (TIME, EXPENSE, MANUAL)`, `description`, `quantity_centi`, `unit_price_minor?`, `amount_minor`); `payment` (`id`, `invoice_id`, `date`, `amount_minor`, `note`, `created_by`); `recurring_invoice`; `time_entry.invoice_id text null` and the foreign key on `expense.invoice_id` (both `ON DELETE SET NULL`), with a partial index on `time_entry (workspace_id, invoice_id) WHERE invoice_id IS NOT NULL` built by the large-table rule in CLAUDE.md; `email_outbox.attachment_key?`, `attachment_name?`.

Every new table enables RLS; `docs/DATA_MODEL.md` gains them and moves them out of "Planned".

## Access rules (summary; the full table is generated into `docs/PERMISSIONS.md`)

| | Owner | Admin | Manager | Member |
| --- | --- | --- | --- | --- |
| Set cost rates; see cost rate rows | yes | yes | no | no |
| See cost and profit in reports | yes | yes | their scope, when the setting is on | no |
| Set a client's currency | yes | yes | no | no |
| Set a project's estimate | yes | yes | their projects | no |
| See a project's progress | yes | yes | their projects | time estimates, when members see the team's time |
| Record own expenses | yes | yes | yes | yes |
| Read and edit others' expenses | yes | yes | their scope | no |
| Expense categories, budget thresholds | yes | yes | no | no |
| Invoices, payments, recurring invoices, branding | yes | yes | no | no |

## Tests

- **Core**: cost resolution at both levels with history and fall-through; currency of an entry and "a rate applies only in its own currency"; profit and margin with uncosted and other-currency entries; amounts-per-currency totals (`addTotals`, sorting); progress for total and monthly estimates across a month boundary in Manila and New York; threshold crossings; expense amounts (fixed and unit, half-up); invoice maths (per-line rounding, discount, two taxes, the hundredths-of-a-percent edges); computed invoice status on each side of the due date; recurring dates across month ends (the 31st in February and in 30-day months, leap years) and weekly schedules.
- **Web integration**: `rateEntriesSql` agrees with core for both kinds; an edit recomputes cost, a move re-rates it; the recalculation job covers cost and skips approved (and, in 6d, invoiced) periods; `report.viewCosts` zeroes cost for everyone else on every engine entry point, including exports and share links; a member rate does not rate an entry on a project in another currency; the relabels; alerts fire exactly once per threshold and period over repeated daily runs; `assertExpenseWritable` on every expense write for a pending, approved and locked period; receipt validation; double-invoicing under two concurrent imports; void and line removal release entries; the public invoice link's 404s; the recurring job's idempotence.
- **E2E** (lines added to `docs/E2E_COVERAGE.md` before code, failing first):
  - The acceptance checks: an invoice built from last month's billable time for one client equals the Amount total in the Summary report filtered the same way; marking it paid updates status and balance.
  - Plus, per branch: set a cost rate and see Cost and Profit in Summary as an admin and not as a manager or member; a USD client's project shows USD amounts beside PHP ones; set an estimate and see the bar and the Budget tab; a budget alert email after the daily job; add an expense with a receipt, submit the period, the member cannot edit it; the Expense report and its CSV; send an invoice (the email in Mailpit with its PDF), open the public link, record a partial payment; an entry on an invoice is read-only and badged; a recurring invoice appears after the daily job.
- **Perf**: the one-year Summary over the perf seed stays under one second with the cost measures and the currency key (`report:perf`); the Profit view under the same budget.

## Out of scope (later phases)

- Currency conversion and exchange rates, so profit across currencies.
- Cost-based budgets, budgets counting expenses, and estimates that add up from tasks.
- Online payment (a pay button), credit notes, partial invoicing of an entry, per-line taxes, invoice templates and languages.
- QuickBooks and Xero sync (the hook only).
- Plan limits (Phase 8; `planAllows` is a stub). Forecast against estimates (Phase 7).

## Risks

- **The report engine's totals change shape** (`amountMinor` to amounts per currency). Every consumer changes in 6a: tables, charts, exports, PDF, share links, the dashboard, the Status tab. Mitigation: the type changes, so the compiler finds them, and the existing amount e2e tests must stay green.
- **Cost is salary data.** One leak path is enough. Mitigation: cost is zeroed in the engine, not in the views, with one integration test per entry point; share links never carry it.
- **Relabelling changes history's label.** It follows the precedent of the workspace currency, asks first, and from 6d is refused once an invoice exists.
- **Invoiced time must not move.** As with approvals: one guard in the entry service and a coverage test over every writer.
- **Chromium for invoice PDFs** must be traced into the new routes (`next.config.ts`), or the PDF works locally and fails on Vercel.
- **Shared database.** Four additive migrations, each through the migrate workflow before its preview; the one index on `time_entry` is built concurrently by hand first.
- **The preview's ten minutes.** Specs move to nightly before new ones are added.
