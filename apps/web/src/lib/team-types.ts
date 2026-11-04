import type { Capacity, Role } from "@timekeep/core";

/** What the Team page reads: JSON-safe, shared by the server and the client. */

export type TeamStatus = "ACTIVE" | "INVITED" | "DEACTIVATED";
export type AssignableRole = Exclude<Role, "owner">;

export interface TeamRow {
  kind: "member" | "invite";
  /** membership id, or invitation id for an invite */
  id: string;
  userId: string | null;
  name: string;
  email: string;
  image: string | null;
  role: Role;
  status: TeamStatus;
  groups: { id: string; name: string }[];
  /** The member-level billable rate in force now; null without rate.view or without a rate. */
  billableRateMinor: number | null;
  /** A manager's people, groups and projects; null for other roles or without permission. */
  scope: { userIds: string[]; groupIds: string[]; projectIds: string[] } | null;
  /** Kiosk only (Phase 5c): no login; an admin sets their PIN and can convert them. */
  limited: boolean;
  /** Daily and weekly minutes and working days (Phase 5b); null for an invite. */
  capacity: Capacity | null;
}

export interface TeamFilters {
  q?: string;
  role?: Role;
  groupId?: string;
  status?: TeamStatus;
}

export interface GroupDTO {
  id: string;
  name: string;
  memberIds: string[];
}
