import {
  type CatalogType,
  CREATOR_SETTINGS,
  type CreatorSetting,
  DEFAULT_PERMISSION_SETTINGS,
  PAGES,
  type Page,
  type PermissionSettings,
  TASK_VISIBILITY,
} from "./permissions";
import { planAllows } from "./plans";
import { REQUIRED_FIELDS, type RequiredField } from "./required-fields";
import { ROUNDING_MODES, ROUNDING_STEPS, type RoundingRule, type RoundingStep } from "./rounding";

/**
 * The workspace's rules as the `workspace_settings` row stores them. Stored
 * strings are checked against the vocabularies here, never trusted, so a
 * stale or hand-edited value falls back to the default instead of throwing.
 */
export interface WorkspaceRuleColumns {
  hiddenPages: string[];
  membersSeeTeamTime: boolean;
  projectCreators: string;
  clientCreators: string;
  tagCreators: string;
  forceTimer: boolean;
  requiredFields: string[];
  allowBreaks: boolean;
  roundingMode: string;
  roundingMinutes: number;
  /** `task_creators` is still a column but unread: tasks are admins' and project managers'. */
  taskVisibility: string;
}

function oneOf<T extends string | number>(allowed: readonly T[], value: unknown, fallback: T): T {
  return (allowed as readonly unknown[]).includes(value) ? (value as T) : fallback;
}

function known<T extends string>(allowed: readonly T[], values: readonly string[]): T[] {
  return values.filter((v): v is T => (allowed as readonly string[]).includes(v));
}

function creator(value: string, type: CatalogType): CreatorSetting {
  return oneOf(CREATOR_SETTINGS, value, DEFAULT_PERMISSION_SETTINGS.creators[type]);
}

/** The switches the permission matrix reads. */
export function permissionSettingsOf(
  row: WorkspaceRuleColumns,
  workspace: { id: string },
): PermissionSettings {
  return {
    hiddenPages: known<Page>(PAGES, row.hiddenPages),
    membersSeeTeamTime: row.membersSeeTeamTime,
    creators: {
      project: creator(row.projectCreators, "project"),
      client: creator(row.clientCreators, "client"),
      tag: creator(row.tagCreators, "tag"),
    },
    forceTimer: row.forceTimer && planAllows(workspace, "forceTimer"),
    taskVisibility: oneOf(TASK_VISIBILITY, row.taskVisibility, "EVERYONE"),
  };
}

/** The rules the entry service applies on every write. */
export function entryRulesOf(
  row: Pick<WorkspaceRuleColumns, "requiredFields" | "allowBreaks">,
): { requiredFields: RequiredField[]; allowBreaks: boolean } {
  return {
    requiredFields: known<RequiredField>(REQUIRED_FIELDS, row.requiredFields),
    allowBreaks: row.allowBreaks,
  };
}

/** The report rounding rule, or null when off or not a valid rule. */
export function roundingRuleOf(
  row: Pick<WorkspaceRuleColumns, "roundingMode" | "roundingMinutes">,
): RoundingRule | null {
  const mode = oneOf(ROUNDING_MODES, row.roundingMode, "off");
  if (mode === "off") return null;
  if (!(ROUNDING_STEPS as readonly number[]).includes(row.roundingMinutes)) return null;
  return { mode, minutes: row.roundingMinutes as RoundingStep };
}
