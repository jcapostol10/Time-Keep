/**
 * Workspace roles, ordered from most to least privileged.
 * Stored lowercase because that is how Better Auth's organization plugin persists them.
 */
export const ROLES = ["owner", "admin", "manager", "member"] as const;
export type Role = (typeof ROLES)[number];

const RANK: Record<Role, number> = { owner: 4, admin: 3, manager: 2, member: 1 };

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function roleRank(role: Role): number {
  return RANK[role];
}

/** True when `actual` is at least as privileged as `min`. */
export function hasMinRole(actual: Role, min: Role): boolean {
  return RANK[actual] >= RANK[min];
}

/** Roles a user with `actor` role may assign to someone else (never owner; owner is transferred). */
export function assignableRoles(actor: Role): Role[] {
  if (actor === "owner") return ["admin", "manager", "member"];
  if (actor === "admin") return ["admin", "manager", "member"];
  return [];
}

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
  member: "Member",
};

export const MEMBERSHIP_STATUSES = ["ACTIVE", "INVITED", "DEACTIVATED"] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];
