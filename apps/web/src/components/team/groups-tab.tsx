"use client";

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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@timekeep/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@timekeep/ui/components/dropdown-menu";
import { Input } from "@timekeep/ui/components/input";
import { Label } from "@timekeep/ui/components/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@timekeep/ui/components/table";
import { MoreHorizontalIcon, PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { toast } from "sonner";

import type { ActionResult } from "@/lib/action-result";
import type { GroupDTO } from "@/lib/team-types";
import {
  createGroupAction,
  deleteGroupAction,
  renameGroupAction,
  setGroupMembersAction,
} from "@/server/actions/groups";

import { ChecklistDialog } from "../shared/checklist-dialog";
import { TaskAccessDialog } from "./task-access-dialog";
import type { TeamContext } from "./team-view";

type Open = { group: GroupDTO; dialog: "rename" | "members" | "tasks" | "delete" } | "new" | null;

/** Groups: named sets of people for private projects, report filters and manager scope. */
export function GroupsTab({ ctx }: { ctx: TeamContext }) {
  const router = useRouter();
  const [open, setOpen] = useState<Open>(null);
  const names = new Map(ctx.people.map((p) => [p.id, p.name]));

  async function run(action: () => Promise<ActionResult<unknown>>, done: string) {
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

  return (
    <div className="space-y-3">
      {ctx.permissions.groups ? (
        <div className="flex justify-end">
          <Button variant="outline" onClick={() => setOpen("new")}>
            <PlusIcon /> New group
          </Button>
        </div>
      ) : null}
      {ctx.groups.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
          No groups yet. A group gives its members access to private projects and lets a manager
          look after a whole team.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Group</TableHead>
                <TableHead>Members</TableHead>
                {ctx.permissions.groups ? <TableHead className="w-0" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {ctx.groups.map((g) => (
                <TableRow key={g.id}>
                  <TableCell className="font-medium">{g.name}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {g.memberIds.length === 0
                      ? "Nobody yet"
                      : g.memberIds.map((m) => names.get(m) ?? "Former member").join(", ")}
                  </TableCell>
                  {ctx.permissions.groups ? (
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Actions for ${g.name}`}
                          >
                            <MoreHorizontalIcon />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onSelect={() => setOpen({ group: g, dialog: "members" })}
                          >
                            Members
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => setOpen({ group: g, dialog: "tasks" })}>
                            Tasks
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => setOpen({ group: g, dialog: "rename" })}
                          >
                            Rename
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => setOpen({ group: g, dialog: "delete" })}
                          >
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {open === "new" ? (
        <NameDialog
          title="New group"
          submit="Create group"
          onClose={() => setOpen(null)}
          onSave={(name) =>
            run(() => createGroupAction(ctx.slug, { name }), `Group "${name}" created`)
          }
        />
      ) : null}
      {open && open !== "new" && open.dialog === "rename" ? (
        <NameDialog
          title={`Rename ${open.group.name}`}
          submit="Save name"
          initial={open.group.name}
          onClose={() => setOpen(null)}
          onSave={(name) =>
            run(() => renameGroupAction(ctx.slug, open.group.id, { name }), "Group renamed")
          }
        />
      ) : null}
      {open && open !== "new" && open.dialog === "tasks" ? (
        <TaskAccessDialog
          slug={ctx.slug}
          title={`Tasks for ${open.group.name}`}
          description="The active tasks this group's members can see and track on, by project."
          query={{ groupId: open.group.id }}
          onClose={() => setOpen(null)}
        />
      ) : null}
      {open && open !== "new" && open.dialog === "members" ? (
        <ChecklistDialog
          title={`Members of ${open.group.name}`}
          options={ctx.people}
          initial={open.group.memberIds}
          empty="Nobody is in the workspace yet."
          onClose={() => setOpen(null)}
          onSave={(userIds) =>
            run(() => setGroupMembersAction(ctx.slug, open.group.id, { userIds }), "Members saved")
          }
        />
      ) : null}
      <AlertDialog
        open={Boolean(open && open !== "new" && open.dialog === "delete")}
        onOpenChange={(o) => (o ? null : setOpen(null))}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {open && open !== "new" ? open.group.name : "the group"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Its members stay in the workspace; they lose the private projects the group gave them,
              and managers who managed the group no longer see its people&apos;s time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90 text-white"
              onClick={() => {
                if (open && open !== "new") {
                  void run(() => deleteGroupAction(ctx.slug, open.group.id), "Group deleted");
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function NameDialog({
  title,
  submit,
  initial = "",
  onClose,
  onSave,
}: {
  title: string;
  submit: string;
  initial?: string;
  onClose: () => void;
  onSave: (name: string) => Promise<boolean>;
}) {
  const id = useId();
  const [name, setName] = useState(initial);
  const [saving, setSaving] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setSaving(true);
            await onSave(name.trim());
            setSaving(false);
          }}
        >
          <div className="space-y-2">
            <Label htmlFor={`${id}-name`}>Name</Label>
            <Input
              id={`${id}-name`}
              autoFocus
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !name.trim()}>
              {submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
