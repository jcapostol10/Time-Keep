import { createAccessControl } from "better-auth/plugins/access";
import {
  adminAc,
  defaultStatements,
  memberAc,
  ownerAc,
} from "better-auth/plugins/organization/access";

/**
 * Better Auth access-control statements. Shared by the server plugin and the
 * browser client so both agree on what each role may do. Phase 4 replaces this
 * with a fuller matrix in packages/core/permissions.ts; for now it covers
 * workspace administration only.
 */
const statement = {
  ...defaultStatements,
  workspaceSettings: ["read", "update"],
} as const;

export const ac = createAccessControl(statement);

export const owner = ac.newRole({
  ...ownerAc.statements,
  workspaceSettings: ["read", "update"],
});

export const admin = ac.newRole({
  ...adminAc.statements,
  workspaceSettings: ["read", "update"],
});

/** Managers gain delegated scope in Phase 4; today they match members. */
export const manager = ac.newRole({
  ...memberAc.statements,
  workspaceSettings: ["read"],
});

export const member = ac.newRole({
  ...memberAc.statements,
  workspaceSettings: ["read"],
});

export const roles = { owner, admin, manager, member };
