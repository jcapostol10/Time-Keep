"use client";

import { formatDuration, type ProjectListQuery } from "@timekeep/core";
import { Badge } from "@timekeep/ui/components/badge";
import { Button } from "@timekeep/ui/components/button";
import { Checkbox } from "@timekeep/ui/components/checkbox";
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
import { FolderKanbanIcon, MoreHorizontalIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { ColorDot } from "@/components/tracker/project-picker";
import type { ProjectListItem } from "@/lib/catalog-types";
import { workspaceRoutes } from "@/lib/routes";
import {
  archiveProjectsAction,
  updateProjectAction,
  copyProjectAction,
} from "@/server/actions/projects";

import { DeleteProjectDialog } from "./delete-project-dialog";
import { FavoriteButton } from "./favorite-button";
import { ProjectDialog } from "./project-dialog";
import type { ClientOption } from "./projects-toolbar";

export function ProjectsTable({
  slug,
  projects,
  clients,
  query,
  canManage,
  editableIds = [],
}: {
  slug: string;
  projects: ProjectListItem[];
  clients: ClientOption[];
  query: ProjectListQuery;
  canManage: boolean;
  /** Projects the viewer manages without being an admin: their names link to the detail page. */
  editableIds?: string[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<ProjectListItem | null>(null);
  const [deleting, setDeleting] = useState<ProjectListItem | null>(null);

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

  const filtered =
    query.q ||
    query.clientId ||
    query.status !== "active" ||
    query.billing !== "all" ||
    query.access !== "all";
  const archivedView = query.status === "archived";
  const allSelected = projects.length > 0 && projects.every((p) => selected.has(p.id));
  const selectedIds = projects.filter((p) => selected.has(p.id)).map((p) => p.id);

  if (projects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-16 text-center">
        <FolderKanbanIcon className="text-muted-foreground mb-3 size-8" />
        <p className="font-medium">{filtered ? "No projects match" : "No projects yet"}</p>
        <p className="text-muted-foreground mt-1 max-w-sm text-sm">
          {filtered
            ? "Try another search or filter."
            : canManage
              ? "Create a project, or type a new name in the timer bar's project picker."
              : "Ask an admin to create projects or add you to private ones."}
        </p>
      </div>
    );
  }

  return (
    <>
      {canManage && selectedIds.length > 0 ? (
        <div className="bg-muted mb-2 flex items-center gap-3 rounded-md px-3 py-2 text-sm">
          <span>{selectedIds.length} selected</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              run(
                () => archiveProjectsAction(slug, { ids: selectedIds }, !archivedView),
                archivedView ? "Projects unarchived" : "Projects archived",
              )
            }
          >
            {archivedView ? "Unarchive" : "Archive"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              {canManage ? (
                <TableHead className="w-0">
                  <Checkbox
                    aria-label="Select all"
                    checked={allSelected}
                    onCheckedChange={(checked) =>
                      setSelected(checked ? new Set(projects.map((p) => p.id)) : new Set())
                    }
                  />
                </TableHead>
              ) : null}
              <TableHead className="w-0" />
              <TableHead>Name</TableHead>
              <TableHead className="hidden sm:table-cell">Client</TableHead>
              <TableHead className="text-right">{canManage ? "Tracked" : "Your time"}</TableHead>
              <TableHead className="hidden md:table-cell">Progress</TableHead>
              <TableHead className="hidden sm:table-cell">Access</TableHead>
              {canManage ? <TableHead className="w-0" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {projects.map((p) => (
              <TableRow key={p.id} data-state={selected.has(p.id) ? "selected" : undefined}>
                {canManage ? (
                  <TableCell>
                    <Checkbox
                      aria-label={`Select ${p.name}`}
                      checked={selected.has(p.id)}
                      onCheckedChange={(checked) =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (checked) next.add(p.id);
                          else next.delete(p.id);
                          return next;
                        })
                      }
                    />
                  </TableCell>
                ) : null}
                <TableCell>
                  <FavoriteButton
                    slug={slug}
                    projectId={p.id}
                    name={p.name}
                    favorite={p.favorite}
                  />
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <ColorDot color={p.color} />
                    {canManage || editableIds.includes(p.id) ? (
                      <Link
                        href={workspaceRoutes.project(slug, p.id)}
                        className="font-medium hover:underline"
                      >
                        {p.name}
                      </Link>
                    ) : (
                      <span className="font-medium">{p.name}</span>
                    )}
                    {p.archived ? (
                      <Badge variant="outline" className="ml-1">
                        Archived
                      </Badge>
                    ) : null}
                  </div>
                  {p.clientName ? (
                    <p className="text-muted-foreground text-xs sm:hidden">{p.clientName}</p>
                  ) : null}
                </TableCell>
                <TableCell className="text-muted-foreground hidden sm:table-cell">
                  {p.clientName ?? "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatDuration(p.trackedSeconds, "hh:mm:ss")}
                </TableCell>
                <TableCell className="text-muted-foreground hidden md:table-cell">
                  <span title="Estimates arrive in Phase 6">—</span>
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  <Badge variant={p.visibility === "PRIVATE" ? "default" : "secondary"}>
                    {p.visibility === "PRIVATE" ? "Private" : "Public"}
                  </Badge>
                </TableCell>
                {canManage ? (
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label="More actions">
                          <MoreHorizontalIcon />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setEditing(p)}>Edit</DropdownMenuItem>
                        {p.isTemplate ? null : (
                          <DropdownMenuItem
                            onSelect={() =>
                              run(
                                () =>
                                  copyProjectAction(slug, {
                                    sourceId: p.id,
                                    name: `${p.name} template`,
                                    clientId: p.clientId,
                                    isTemplate: true,
                                  }),
                                `${p.name} saved as the template “${p.name} template”`,
                              )
                            }
                          >
                            Save as template
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          onSelect={() =>
                            run(
                              () => updateProjectAction(slug, p.id, { archived: !p.archived }),
                              p.archived ? `${p.name} unarchived` : `${p.name} archived`,
                            )
                          }
                        >
                          {p.archived ? "Unarchive" : "Archive"}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(p)}>
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

      {editing ? (
        <ProjectDialog
          key={editing.id}
          slug={slug}
          clients={clients}
          project={editing}
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
        />
      ) : null}

      <DeleteProjectDialog
        key={deleting?.id ?? "none"}
        slug={slug}
        project={deleting}
        others={projects.filter((p) => !p.archived && p.id !== deleting?.id)}
        onClose={() => setDeleting(null)}
        onDeleted={() => {
          setDeleting(null);
          router.refresh();
        }}
      />
    </>
  );
}
