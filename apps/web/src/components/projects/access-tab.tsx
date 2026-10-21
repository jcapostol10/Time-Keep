"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@timekeep/ui/components/avatar";
import { Button } from "@timekeep/ui/components/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@timekeep/ui/components/command";
import { Switch } from "@timekeep/ui/components/switch";
import { XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import type { ProjectDetail } from "@/lib/catalog-types";
import { initials } from "@/lib/initials";
import { setProjectMembersAction, updateProjectAction } from "@/server/actions/projects";

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
}: {
  slug: string;
  project: ProjectDetail;
  members: Member[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
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
          <p className="text-muted-foreground text-xs">Groups arrive in Phase 4.</p>
        </section>
      ) : null}
    </div>
  );
}
