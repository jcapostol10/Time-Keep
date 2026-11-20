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
import { MoreHorizontalIcon } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import type { ClientDTO } from "@/lib/catalog-types";
import { EmptyNote, EmptyState } from "@/components/empty-state";
import { deleteClientAction, updateClientAction } from "@/server/actions/clients";

import { ClientDialog, NewClientButton } from "./client-dialog";

const DELETE_BLOCKED = "Move or delete its projects first";

export function ClientsTable({
  slug,
  clients,
  status,
  query,
  canManage,
  workspaceCurrency,
}: {
  slug: string;
  clients: ClientDTO[];
  status: string;
  query: string;
  /** Edit, archive and delete (admins); creators without it see the list only. */
  canManage: boolean;
  /** What a client without a currency of its own is billed in. */
  workspaceCurrency: string;
}) {
  const [, startTransition] = useTransition();
  const [editing, setEditing] = useState<ClientDTO | null>(null);
  const [deleting, setDeleting] = useState<ClientDTO | null>(null);

  function run(action: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) toast.error(result.error ?? "Something went wrong.");
      else {
        toast.success(success);
      }
    });
  }

  if (clients.length === 0) {
    if (query || status !== "active") {
      return <EmptyNote>No clients match. Try another search or status.</EmptyNote>;
    }
    return (
      <EmptyState
        title="Add a client"
        description="Clients are the companies you work for. Put projects under them, and bill them later."
        action={
          <NewClientButton
            label="Add client"
            slug={slug}
            workspaceCurrency={workspaceCurrency}
            canSetCurrency={canManage}
          />
        }
      />
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
              <TableHead className="hidden sm:table-cell">Currency</TableHead>
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
                <TableCell className="hidden sm:table-cell">
                  {c.currency ?? (
                    <span className="text-muted-foreground">{workspaceCurrency} (workspace)</span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">{c.projectCount}</TableCell>
                <TableCell className="hidden sm:table-cell">
                  <Badge variant={c.archived ? "outline" : "secondary"}>
                    {c.archived ? "Archived" : "Active"}
                  </Badge>
                </TableCell>
                <TableCell>
                  {canManage ? (
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
                  ) : null}
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
          workspaceCurrency={workspaceCurrency}
          canSetCurrency={canManage}
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
