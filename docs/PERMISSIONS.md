# Permissions

<!-- Generated from packages/core/src/permissions.ts by `pnpm permissions:doc`. Do not edit. -->

Owners and admins see and manage everything (only the owner transfers ownership).
A manager's **scope** is the people they manage, directly or through groups, and the projects
they manage; a manager with no assignments reads only their own time. Nobody may change the
role of, deactivate or remove the owner, or deactivate or remove themselves.
A refusal that depends on the role or a workspace setting is a 403; one that depends on the
resource (outside the scope, a private project) is a 404, so its existence is not revealed.

## Workspace

| Action | Owner | Admin | Manager | Member |
| --- | --- | --- | --- | --- |
| `workspace.update` | yes | yes | — | — |
| `workspace.transferOwnership` | yes | — | — | — |

## Members

| Action | Owner | Admin | Manager | Member |
| --- | --- | --- | --- | --- |
| `member.invite` | yes | yes | — | — |
| `member.changeRole` | yes | yes | — | — |
| `member.deactivate` | yes | yes | — | — |
| `member.remove` | yes | yes | — | — |
| `member.assignScope` | yes | yes | — | — |

## Groups

| Action | Owner | Admin | Manager | Member |
| --- | --- | --- | --- | --- |
| `group.manage` | yes | yes | — | — |

## Pages

| Action | Owner | Admin | Manager | Member |
| --- | --- | --- | --- | --- |
| `page.view` | yes | yes | yes | unless the workspace hides it |

## Clients

| Action | Owner | Admin | Manager | Member |
| --- | --- | --- | --- | --- |
| `client.create` | yes | yes | if the workspace allows | if the workspace allows |
| `client.update` | yes | yes | — | — |

## Projects

| Action | Owner | Admin | Manager | Member |
| --- | --- | --- | --- | --- |
| `project.create` | yes | yes | if the workspace allows | if the workspace allows |
| `project.view` | yes | yes | public, private ones they are on, or manage | public, private ones they are on, or manage |
| `project.update` | yes | yes | projects they manage | — |
| `project.delete` | yes | yes | — | — |
| `project.manageMembers` | yes | yes | projects they manage | — |

## Tasks

| Action | Owner | Admin | Manager | Member |
| --- | --- | --- | --- | --- |
| `task.create` | yes | yes | if the workspace allows | if the workspace allows |
| `task.update` | yes | yes | projects they manage | — |

## Tags

| Action | Owner | Admin | Manager | Member |
| --- | --- | --- | --- | --- |
| `tag.create` | yes | yes | if the workspace allows | if the workspace allows |
| `tag.update` | yes | yes | — | — |

## Rates

| Action | Owner | Admin | Manager | Member |
| --- | --- | --- | --- | --- |
| `rate.view` | yes | yes | — | — |
| `rate.set` | yes | yes | — | — |
| `rate.recalculate` | yes | yes | — | — |

## Time entries

| Action | Owner | Admin | Manager | Member |
| --- | --- | --- | --- | --- |
| `entry.read` | yes | yes | their scope | their own (everyone's if the workspace allows) |
| `entry.write` | yes | yes | themselves and people they manage | their own |

## Reports

| Action | Owner | Admin | Manager | Member |
| --- | --- | --- | --- | --- |
| `report.readTeam` | yes | yes | yes | if the workspace allows |
| `report.viewAmounts` | yes | yes | yes | — |

## Share links

| Action | Owner | Admin | Manager | Member |
| --- | --- | --- | --- | --- |
| `shareLink.manage` | yes | yes | their own | their own |

## Import

| Action | Owner | Admin | Manager | Member |
| --- | --- | --- | --- | --- |
| `import.users` | yes | yes | — | — |
