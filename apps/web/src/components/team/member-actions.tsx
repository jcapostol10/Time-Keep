"use client";

import { ROLE_LABELS } from "@timekeep/core";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@timekeep/ui/components/alert-dialog";
import { Button } from "@timekeep/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@timekeep/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@timekeep/ui/components/dropdown-menu";
import { Input } from "@timekeep/ui/components/input";
import { Label } from "@timekeep/ui/components/label";
import { RadioGroup, RadioGroupItem } from "@timekeep/ui/components/radio-group";
import { MoreHorizontalIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { toast } from "sonner";

import type { ActionResult } from "@/lib/action-result";
import type { AssignableRole, TeamRow } from "@/lib/team-types";
import { setMemberGroupsAction } from "@/server/actions/groups";
import {
  cancelInvitationAction,
  changeRoleAction,
  removeMemberAction,
  resendInvitationAction,
  setManagerScopeAction,
  setMemberStatusAction,
  transferOwnershipAction,
} from "@/server/actions/team";

import { RateDialog } from "../rates/rate-dialog";
import { Checklist, ChecklistDialog } from "../shared/checklist-dialog";
import { TaskAccessDialog } from "./task-access-dialog";
import type { TeamContext } from "./team-view";

type Open =
  | "role"
  | "groups"
  | "tasks"
  | "rate"
  | "scope"
  | "deactivate"
  | "remove"
  | "transfer"
  | null;

/** The row menu on the Team page and the dialogs it opens. */
export function MemberActions({ row, ctx }: { row: TeamRow; ctx: TeamContext }) {
  const router = useRouter();
  const [open, setOpen] = useState<Open>(null);
  const { permissions } = ctx;

  async function run(action: () => Promise<ActionResult>, done: string) {
    const result = await action();
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    toast.success(done);
    setOpen(null);
    router.refresh();
    return true;
  }

  if (row.kind === "invite") {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${row.name}`}>
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={() =>
              void run(() => resendInvitationAction(ctx.slug, row.id), "Invitation sent again")
            }
          >
            Resend invitation
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onSelect={() =>
              void run(() => cancelInvitationAction(ctx.slug, row.id), "Invitation cancelled")
            }
          >
            Cancel invitation
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  const userId = row.userId!;
  const isOwner = row.role === "owner";
  const isMe = userId === ctx.meId;
  const changeable = !isOwner && !isMe;
  const items = [
    changeable ? "role" : null,
    permissions.groups ? "groups" : null,
    permissions.groups ? "tasks" : null,
    permissions.rates ? "rate" : null,
    row.role === "manager" ? "scope" : null,
    permissions.transfer && row.role === "admin" && row.status === "ACTIVE" ? "transfer" : null,
  ].filter(Boolean);
  if (items.length === 0 && !changeable) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${row.name}`}>
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {changeable ? (
            <DropdownMenuItem onSelect={() => setOpen("role")}>Change role</DropdownMenuItem>
          ) : null}
          {permissions.groups ? (
            <DropdownMenuItem onSelect={() => setOpen("groups")}>Groups</DropdownMenuItem>
          ) : null}
          {permissions.groups ? (
            <DropdownMenuItem onSelect={() => setOpen("tasks")}>Tasks available</DropdownMenuItem>
          ) : null}
          {permissions.rates ? (
            <DropdownMenuItem onSelect={() => setOpen("rate")}>Billable rate</DropdownMenuItem>
          ) : null}
          {row.role === "manager" ? (
            <DropdownMenuItem onSelect={() => setOpen("scope")}>
              People and projects
            </DropdownMenuItem>
          ) : null}
          {permissions.transfer && row.role === "admin" && row.status === "ACTIVE" ? (
            <DropdownMenuItem onSelect={() => setOpen("transfer")}>
              Transfer ownership
            </DropdownMenuItem>
          ) : null}
          {changeable ? (
            <>
              <DropdownMenuSeparator />
              {row.status === "DEACTIVATED" ? (
                <DropdownMenuItem
                  onSelect={() =>
                    void run(
                      () => setMemberStatusAction(ctx.slug, { userId, status: "ACTIVE" }),
                      `${row.name} is active again`,
                    )
                  }
                >
                  Reactivate
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={() => setOpen("deactivate")}>
                  Deactivate
                </DropdownMenuItem>
              )}
              <DropdownMenuItem variant="destructive" onSelect={() => setOpen("remove")}>
                Remove
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {open === "role" ? (
        <RoleDialog
          row={row}
          onClose={() => setOpen(null)}
          onSave={(role) => run(() => changeRoleAction(ctx.slug, { userId, role }), "Role changed")}
        />
      ) : null}
      {open === "groups" ? (
        <ChecklistDialog
          title={`Groups for ${row.name}`}
          description="Groups give access to private projects and appear in report filters."
          options={ctx.groups.map((g) => ({ id: g.id, name: g.name }))}
          initial={row.groups.map((g) => g.id)}
          empty="No groups yet: create one in the Groups tab."
          onClose={() => setOpen(null)}
          onSave={(groupIds) =>
            run(() => setMemberGroupsAction(ctx.slug, { userId, groupIds }), "Groups saved")
          }
        />
      ) : null}
      {open === "tasks" ? (
        <TaskAccessDialog
          slug={ctx.slug}
          title={`Tasks available to ${row.name}`}
          description="The active tasks this person can see and track on, through their groups, by project."
          query={{ userId }}
          onClose={() => setOpen(null)}
        />
      ) : null}
      {open === "rate" ? (
        <RateDialog
          slug={ctx.slug}
          target={{ level: "member", userId }}
          title={`${row.name}'s billable rate`}
          currency={ctx.currency}
          timezone={ctx.timezone}
          open
          onOpenChange={(o) => (o ? null : setOpen(null))}
        />
      ) : null}
      {open === "scope" && row.scope ? (
        <ScopeDialog
          row={row}
          ctx={ctx}
          onClose={() => setOpen(null)}
          onSave={(scope) =>
            run(
              () => setManagerScopeAction(ctx.slug, { managerId: userId, ...scope }),
              "Scope saved",
            )
          }
        />
      ) : null}
      <AlertDialog open={open === "deactivate"} onOpenChange={(o) => (o ? null : setOpen(null))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate {row.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Their running timer stops and they can no longer open this workspace. Their time,
              groups, projects and rates stay, so you can reactivate them later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep active</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                void run(
                  () => setMemberStatusAction(ctx.slug, { userId, status: "DEACTIVATED" }),
                  `${row.name} is deactivated`,
                )
              }
            >
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={open === "remove"} onOpenChange={(o) => (o ? null : setOpen(null))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {row.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              They leave the workspace with their groups, project access and rates. Their time stays
              in reports, under their name as a former member.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90 text-white"
              onClick={() =>
                void run(() => removeMemberAction(ctx.slug, userId), `${row.name} removed`)
              }
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {open === "transfer" ? (
        <TransferDialog
          row={row}
          workspaceName={ctx.workspaceName}
          onClose={() => setOpen(null)}
          onTransfer={(confirmName) => transferOwnershipAction(ctx.slug, { userId, confirmName })}
          onDone={() => {
            toast.success(`${row.name} now owns the workspace`);
            setOpen(null);
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}

function RoleDialog({
  row,
  onClose,
  onSave,
}: {
  row: TeamRow;
  onClose: () => void;
  onSave: (role: AssignableRole) => Promise<boolean>;
}) {
  const id = useId();
  const [role, setRole] = useState<AssignableRole>(row.role === "owner" ? "admin" : row.role);
  const [saving, setSaving] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Change role</DialogTitle>
          <DialogDescription>{row.name}</DialogDescription>
        </DialogHeader>
        <RadioGroup value={role} onValueChange={(v) => setRole(v as AssignableRole)}>
          {(["admin", "manager", "member"] as const).map((r) => (
            <div key={r} className="flex items-center gap-2">
              <RadioGroupItem value={r} id={`${id}-${r}`} />
              <Label htmlFor={`${id}-${r}`} className="font-normal">
                {ROLE_LABELS[r]}
              </Label>
            </div>
          ))}
        </RadioGroup>
        {row.role === "manager" && role !== "manager" ? (
          <p className="text-muted-foreground text-sm">
            The people and projects they manage are cleared.
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              await onSave(role);
              setSaving(false);
            }}
          >
            Save role
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ScopeDialog({
  row,
  ctx,
  onClose,
  onSave,
}: {
  row: TeamRow;
  ctx: TeamContext;
  onClose: () => void;
  onSave: (scope: {
    userIds: string[];
    groupIds: string[];
    projectIds: string[];
  }) => Promise<boolean>;
}) {
  const [people, setPeople] = useState(() => new Set(row.scope?.userIds ?? []));
  const [groups, setGroups] = useState(() => new Set(row.scope?.groupIds ?? []));
  const [projects, setProjects] = useState(() => new Set(row.scope?.projectIds ?? []));
  const [saving, setSaving] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>People and projects {row.name} manages</DialogTitle>
          <DialogDescription>
            They see and edit the time of the people they manage, see everyone&apos;s time on the
            projects they manage, and edit those projects.
          </DialogDescription>
        </DialogHeader>
        <section className="space-y-2">
          <h3 className="text-sm font-medium">People</h3>
          <Checklist
            options={ctx.people.filter((p) => p.id !== row.userId)}
            picked={people}
            onChange={setPeople}
            empty="Nobody else is in the workspace yet."
          />
        </section>
        <section className="space-y-2">
          <h3 className="text-sm font-medium">Groups</h3>
          <Checklist
            options={ctx.groups}
            picked={groups}
            onChange={setGroups}
            empty="No groups yet."
          />
        </section>
        <section className="space-y-2">
          <h3 className="text-sm font-medium">Projects</h3>
          <Checklist
            options={ctx.projects}
            picked={projects}
            onChange={setProjects}
            empty="No projects yet."
          />
        </section>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              await onSave({
                userIds: [...people],
                groupIds: [...groups],
                projectIds: [...projects],
              });
              setSaving(false);
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TransferDialog({
  row,
  workspaceName,
  onClose,
  onTransfer,
  onDone,
}: {
  row: TeamRow;
  workspaceName: string;
  onClose: () => void;
  onTransfer: (confirmName: string) => Promise<ActionResult>;
  onDone: () => void;
}) {
  const id = useId();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Transfer ownership</DialogTitle>
          <DialogDescription>
            {row.name} becomes the owner of the workspace and you become an admin. Type{" "}
            <strong data-testid="workspace-name">{workspaceName}</strong> to confirm.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor={`${id}-name`}>Workspace name</Label>
          <Input id={`${id}-name`} value={name} onChange={(e) => setName(e.target.value)} />
          {error ? <p className="text-destructive text-sm">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              const result = await onTransfer(name);
              setSaving(false);
              if (result.ok) onDone();
              else setError(result.error);
            }}
          >
            Transfer ownership
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
