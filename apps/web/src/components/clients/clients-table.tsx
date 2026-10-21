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
import { Badge } from "@timekeep/ui/components/badge";
import { Button } from "@timekeep/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@timekeep/ui/components/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@timekeep/ui/components/table";
import { Building2Icon, MoreHorizontalIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import type { ClientDTO } from "@/lib/catalog-types";
import { deleteClientAction, updateClientAction } from "@/server/actions/clients";

import { ClientDialog } from "./client-dialog";

const DELETE_BLOCKED = "Move or delete its projects first";

export function ClientsTable({
  slug,
  clients,
  status,
  query,
}: {
  slug: string;
  clients: ClientDTO[];
  status: string;
  query: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [editing, setEditing] = useState<ClientDTO | null>(null);
  const [deleting, setDeleting] = useState<ClientDTO | null>(null);

  function run(action: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) toast.error(result.error ?? "Something went wrong.");
      else {
        toast.success(success);
        router.refresh();
      }
    });
  }

  if (clients.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-16 text-center">
        <Building2Icon className="text-muted-foreground mb-3 size-8" />
        <p className="font-medium">
          {query || status !== "active" ? "No clients match" : "No clients yet"}
        </p>
        <p className="text-muted-foreground mt-1 max-w-sm text-sm">
          {query || status !== "active"
            ? "Try another search or status."
            : "Add the companies you work for, then put projects under them."}
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="hidden sm:table-cell">Email</TableHead>
              <TableHead className="text-right">Projects</TableHead>
              <TableHead className="hidden sm:table-cell">Status</TableHead>
              <TableHead className="w-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {clients.map((c) => (
              <TableRow key={c.id}>
                <TableCell>
                  <p className="font-medium">{c.name}</p>
                  {c.email ? (
                    <p className="text-muted-foreground truncate text-xs sm:hidden">{c.email}</p>
                  ) : null}
                </TableCell>
                <TableCell className="text-muted-foreground hidden sm:table-cell">
                  {c.email || "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">{c.projectCount}</TableCell>
                <TableCell className="hidden sm:table-cell">
                  <Badge variant={c.archived ? "outline" : "secondary"}>
                    {c.archived ? "Archived" : "Active"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label="More actions">
                        <MoreHorizontalIcon />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setEditing(c)}>Edit</DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() =>
                          run(
                            () => updateClientAction(slug, c.id, { archived: !c.archived }),
                            c.archived ? `${c.name} unarchived` : `${c.name} archived`,
                          )
                        }
                      >
                        {c.archived ? "Unarchive" : "Archive"}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        disabled={c.projectCount > 0}
                        title={c.projectCount > 0 ? DELETE_BLOCKED : undefined}
                        onSelect={() => setDeleting(c)}
                      >
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {editing ? (
        <ClientDialog
          key={editing.id}
          slug={slug}
          client={editing}
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
        />
      ) : null}

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete client?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.name} will be removed. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!deleting) return;
                const target = deleting;
                setDeleting(null);
                run(() => deleteClientAction(slug, target.id), `${target.name} deleted`);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
