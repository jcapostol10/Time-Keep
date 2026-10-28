import {
  can,
  DEFAULT_WORKSPACE_SETTINGS,
  type WorkspaceSettingsInput,
  workspaceSettingsSchema,
} from "@timekeep/core";
import { getDb, type WorkspaceSettings } from "@timekeep/db";
import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { RateCell } from "@/components/rates/rate-cell";
import { RecalcBanner } from "@/components/rates/recalc-banner";
import { WorkspaceSettingsForm } from "@/components/settings/workspace-settings-form";
import { viewerFor } from "@/server/authz";
import { currentRate } from "@/server/rates";
import { requireWorkspacePage } from "@/server/workspace-access";

export const metadata: Metadata = { title: "Settings" };

/**
 * The form's values from the settings row. A stored value outside the
 * vocabularies (a hand-edited rule) falls back to the defaults for the rules
 * rather than failing the page; the general fields are always valid.
 */
function settingsValues(row: WorkspaceSettings): WorkspaceSettingsInput {
  const parsed = workspaceSettingsSchema.safeParse(row);
  if (parsed.success) return parsed.data;
  return {
    ...DEFAULT_WORKSPACE_SETTINGS,
    timezone: row.timezone,
    weekStart: row.weekStart as WorkspaceSettingsInput["weekStart"],
    timeFormat: row.timeFormat,
    durationFormat: row.durationFormat,
    currency: row.currency,
  };
}

export default async function SettingsPage({ params }: PageProps<"/w/[workspaceSlug]/settings">) {
  const { workspaceSlug } = await params;
  const ctx = await requireWorkspacePage(workspaceSlug);
  const viewer = await viewerFor(ctx);
  const showRates = can(viewer.actor, "rate.view", { kind: "none" });
  const workspaceRate = showRates
    ? await currentRate(getDb(), viewer, { level: "workspace" })
    : null;

  return (
    <>
      <PageHeader
        title="Workspace settings"
        description="Name, timezone and how times and durations are shown across the workspace."
      />
      {showRates ? <RecalcBanner slug={workspaceSlug} /> : null}
      <WorkspaceSettingsForm
        slug={workspaceSlug}
        readOnly={!can(viewer.actor, "workspace.update", { kind: "workspace" })}
        defaultValues={{ name: ctx.workspace.name, ...settingsValues(ctx.settings) }}
      />
      {showRates ? (
        <section aria-labelledby="billable-rate" className="mt-10 max-w-xl space-y-2">
          <h2 id="billable-rate" className="text-lg font-semibold">
            Billable rate
          </h2>
          <p className="text-muted-foreground text-sm">
            The workspace default. A member, project, project member or task rate takes precedence.
          </p>
          <RateCell
            slug={workspaceSlug}
            target={{ level: "workspace" }}
            title="Workspace billable rate"
            currency={ctx.settings.currency}
            timezone={ctx.settings.timezone}
            current={workspaceRate?.amountMinor ?? null}
          />
        </section>
      ) : null}
    </>
  );
}
