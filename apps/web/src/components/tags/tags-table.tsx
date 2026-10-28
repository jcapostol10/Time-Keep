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
import { MoreHorizontalIcon, TagIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { ColorDot } from "@/components/tracker/project-picker";
import type { TagDTO } from "@/lib/catalog-types";
import { deleteTagAction, updateTagAction } from "@/server/actions/tags";

import { TagDialog } from "./tag-dialog";

export function TagsTable({
  slug,
  tags,
  status,
  canManage,
}: {
  slug: string;
  tags: TagDTO[];
  status: string;
  /** Rename, archive and delete (admins); creators without it see the list only. */
  canManage: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [editing, setEditing] = useState<TagDTO | null>(null);
  const [deleting, setDeleting] = useState<TagDTO | null>(null);

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

  if (tags.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-16 text-center">
        <TagIcon className="text-muted-foreground mb-3 size-8" />
        <p className="font-medium">{status !== "active" ? "No tags match" : "No tags yet"}</p>
        <p className="text-muted-foreground mt-1 max-w-sm text-sm">
          {status !== "active"
            ? "Try another status."
            : "Create a tag here or from the timer bar's tag picker."}
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
              <TableHead className="text-right">Used by</TableHead>
              <TableHead className="hidden sm:table-cell">Status</TableHead>
              <TableHead className="w-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {tags.map((t) => (
              <TableRow key={t.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <ColorDot color={t.color} />
                    <span className="font-medium">{t.name}</span>
                    {t.archived ? (
                      <Badge variant="outline" className="ml-1">
                        Archived
                      </Badge>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">{t.usageCount}</TableCell>
                <TableCell className="hidden sm:table-cell">
                  <Badge variant={t.archived ? "outline" : "secondary"}>
                    {t.archived ? "Archived" : "Active"}
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
                      <DropdownMenuItem onSelect={() => setEditing(t)}>Rename</DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() =>
                          run(
                            () => updateTagAction(slug, t.id, { archived: !t.archived }),
                            t.archived ? `${t.name} unarchived` : `${t.name} archived`,
                          )
                        }
                      >
                        {t.archived ? "Unarchive" : "Archive"}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(t)}>
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
        <TagDialog
          key={editing.id}
          slug={slug}
          tag={editing}
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
        />
      ) : null}

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete tag?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.usageCount
                ? `${deleting.usageCount} ${deleting.usageCount === 1 ? "entry loses" : "entries lose"} the tag "${deleting.name}". This cannot be undone.`
                : `No entries use "${deleting?.name}". This cannot be undone.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!deleting) return;
                const target = deleting;
                setDeleting(null);
                run(() => deleteTagAction(slug, target.id), `${target.name} deleted`);
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
