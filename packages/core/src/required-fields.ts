import type { EntryType } from "./schemas";

/**
 * Required fields (decision 5 of the Phase 4 design): checked when an entry
 * is stopped or saved, never when a timer starts. The entry service applies
 * them; the UI only marks the field the server named.
 */

export const REQUIRED_FIELDS = ["project", "task", "tag", "description"] as const;
export type RequiredField = (typeof REQUIRED_FIELDS)[number];

export const REQUIRED_FIELD_LABELS: Record<RequiredField, string> = {
  project: "Project",
  task: "Task",
  tag: "Tag",
  description: "Description",
};

/**
 * The first required field the entry lacks, in the fixed order, or null.
 * A task is required only when the project has active tasks; breaks are exempt.
 */
export function missingRequiredField(
  required: readonly RequiredField[],
  entry: {
    description: string;
    projectId: string | null;
    taskId: string | null;
    tagIds: readonly string[];
    type: EntryType;
  },
  context: { projectHasTasks: boolean },
): RequiredField | null {
  if (entry.type === "break") return null;
  const wanted = new Set(required);
  for (const field of REQUIRED_FIELDS) {
    if (!wanted.has(field)) continue;
    switch (field) {
      case "project":
        if (entry.projectId === null) return field;
        break;
      case "task":
        if (entry.taskId === null && context.projectHasTasks) return field;
        break;
      case "tag":
        if (entry.tagIds.length === 0) return field;
        break;
      case "description":
        if (entry.description.trim() === "") return field;
        break;
    }
  }
  return null;
}

export function requiredFieldMessage(field: RequiredField): string {
  return `${REQUIRED_FIELD_LABELS[field]} is required.`;
}
