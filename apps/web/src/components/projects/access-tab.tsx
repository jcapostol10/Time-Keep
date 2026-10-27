"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@timekeep/ui/components/avatar";
import { Button } from "@timekeep/ui/components/button";
import { Checkbox } from "@timekeep/ui/components/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@timekeep/ui/components/command";
import { Label } from "@timekeep/ui/components/label";
import { Switch } from "@timekeep/ui/components/switch";
import { XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import type { ProjectDetail } from "@/lib/catalog-types";
import { initials } from "@/lib/initials";
import {
  setProjectGroupsAction,
  setProjectMembersAction,
  updateProjectAction,
} from "@/server/actions/projects";

interface Member {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

/** Public or private, and who is on a private project. */
export function AccessTab({
  slug,
  project,
  members,
  groups,
  groupIds,
}: {
  slug: string;
  project: ProjectDetail;
  members: Member[];
  /** The workspace's groups, and those with access to this project. */
  groups: { id: string; name: string }[];
  groupIds: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // The ticks follow a click at once, then the server's list once it refreshes.
  const [checkedGroups, setCheckedGroups] = useState(groupIds);
  const [shownGroups, setShownGroups] = useState(groupIds);
  if (shownGroups !== groupIds) {
    setShownGroups(groupIds);
    setCheckedGroups(groupIds);
  }
  const isPrivate = project.visibility === "PRIVATE";
  const onProject = members.filter((m) => project.memberIds.includes(m.id));
  const available = members.filter((m) => !project.memberIds.includes(m.id));

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) toast.error(result.error ?? "Something went wrong.");
      router.refresh();
    });
  }

  function setMembers(userIds: string[]) {
    run(() => setProjectMembersAction(slug, project.id, { userIds }));
  }

  return (
    <div className="max-w-xl space-y-6">
      <div className="flex items-center justify-between rounded-md border px-4 py-3">
        <div>
          <p className="text-sm font-medium">Private project</p>
          <p className="text-muted-foreground text-xs">
            {isPrivate
              ? "Only admins and the people below can see it and track time on it."
              : "Every member can see it and track time on it."}
          </p>
        </div>
        <Switch
          aria-label="Private project"
          checked={isPrivate}
          disabled={pending}
          onCheckedChange={(checked) =>
            run(() =>
              updateProjectAction(slug, project.id, { visibility: checked ? "PRIVATE" : "PUBLIC" }),
            )
          }
        />
      </div>

      {isPrivate ? (
        <section className="space-y-3">
          <h2 className="text-base font-semibold">People on this project</h2>
          {onProject.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Nobody yet. Admins can always see it; add the members who should.
            </p>
          ) : (
            <ul className="divide-y rounded-md border">
              {onProject.map((m) => (
                <li key={m.id} className="flex items-center gap-3 px-3 py-2">
                  <Avatar className="size-7">
                    {m.image ? <AvatarImage src={m.image} alt="" /> : null}
                    <AvatarFallback className="text-[10px]">{initials(m.name)}</AvatarFallback>
                  </Avatar>
                  <span className="flex-1 truncate text-sm">
                    {m.name} <span className="text-muted-foreground text-xs">{m.email}</span>
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${m.name}`}
                    disabled={pending}
                    onClick={() => setMembers(project.memberIds.filter((id) => id !== m.id))}
                  >
                    <XIcon />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className="rounded-md border">
            <Command>
              <CommandInput aria-label="Search members" placeholder="Add a member…" />
              <CommandList>
                <CommandEmpty>No members match.</CommandEmpty>
                <CommandGroup>
                  {available.map((m) => (
                    <CommandItem
                      key={m.id}
                      value={`${m.name} ${m.email}`}
                      onSelect={() => setMembers([...project.memberIds, m.id])}
                    >
                      {m.name} <span className="text-muted-foreground text-xs">{m.email}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </div>
        </section>
      ) : null}
      {isPrivate ? (
        <section className="space-y-3">
          <h2 className="text-base font-semibold">Groups on this project</h2>
          {groups.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No groups yet: create them on the Team page to give a whole team access at once.
            </p>
          ) : (
            <ul className="space-y-2">
              {groups.map((g) => (
                <li key={g.id} className="flex items-center gap-2">
                  <Checkbox
                    id={`project-group-${g.id}`}
                    checked={checkedGroups.includes(g.id)}
                    disabled={pending}
                    onCheckedChange={(checked) => {
                      const next =
                        checked === true
                          ? [...checkedGroups, g.id]
                          : checkedGroups.filter((id) => id !== g.id);
                      setCheckedGroups(next);
                      run(() => setProjectGroupsAction(slug, project.id, { groupIds: next }));
                    }}
                  />
                  <Label htmlFor={`project-group-${g.id}`} className="font-normal">
                    {g.name}
                  </Label>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
