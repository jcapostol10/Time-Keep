"use client";

import { ROLE_LABELS, type Role } from "@timekeep/core";
import { Button } from "@timekeep/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@timekeep/ui/components/dropdown-menu";
import { cn } from "@timekeep/ui/lib/utils";
import { CheckIcon, ChevronsUpDownIcon, PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { authClient, authErrorMessage } from "@/lib/auth-client";
import { workspaceRoutes } from "@/lib/routes";

export interface WorkspaceOption {
  id: string;
  name: string;
  slug: string;
  role: Role;
}

export function WorkspaceSwitcher({
  current,
  workspaces,
}: {
  current: WorkspaceOption;
  workspaces: WorkspaceOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  async function select(ws: WorkspaceOption) {
    setOpen(false);
    if (ws.id === current.id) return;
    const { error } = await authClient.organization.setActive({ organizationId: ws.id });
    if (error) {
      toast.error(authErrorMessage(error));
      return;
    }
    startTransition(() => {
      router.push(workspaceRoutes.tracker(ws.slug));
      router.refresh();
    });
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="h-9 max-w-56 justify-between gap-2 px-2 font-semibold"
          aria-label="Switch workspace"
          disabled={pending}
        >
          <WorkspaceAvatar name={current.name} />
          <span className="truncate">{current.name}</span>
          <ChevronsUpDownIcon className="text-muted-foreground size-4 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-muted-foreground text-xs">Workspaces</DropdownMenuLabel>
        {workspaces.map((ws) => (
          <DropdownMenuItem key={ws.id} onSelect={() => void select(ws)} className="gap-2">
            <WorkspaceAvatar name={ws.name} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm">{ws.name}</span>
              <span className="text-muted-foreground text-xs">{ROLE_LABELS[ws.role]}</span>
            </span>
            {ws.id === current.id ? <CheckIcon className="size-4" /> : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push("/workspaces/new")}>
          <PlusIcon /> Create workspace
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function WorkspaceAvatar({ name, className }: { name: string; className?: string }) {
  const initial = name.trim().charAt(0).toUpperCase() || "W";
  return (
    <span
      aria-hidden
      className={cn(
        "bg-primary text-primary-foreground flex size-6 shrink-0 items-center justify-center rounded-md text-xs font-bold",
        className,
      )}
    >
      {initial}
    </span>
  );
}
