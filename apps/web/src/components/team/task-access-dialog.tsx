"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@timekeep/ui/components/dialog";
import { useQuery } from "@tanstack/react-query";

import type { TaskAccessDTO } from "@/lib/catalog-types";
import { fetchJson } from "@/lib/fetch-json";

/**
 * The Team page's answers to "which tasks does this group give" and "which
 * tasks can this person see" (decision 11), read from /task-access.
 */
export function TaskAccessDialog({
  slug,
  title,
  description,
  query,
  onClose,
}: {
  slug: string;
  title: string;
  description: string;
  query: { groupId: string } | { userId: string };
  onClose: () => void;
}) {
  const params = new URLSearchParams(query).toString();
  const { data, error, isPending } = useQuery({
    queryKey: ["task-access", slug, params],
    queryFn: () => fetchJson<TaskAccessDTO>(`/api/w/${slug}/task-access?${params}`),
  });
  return (
    <Dialog open onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {isPending ? (
          <p className="text-muted-foreground text-sm">Loading…</p>
        ) : error ? (
          <p className="text-destructive text-sm">{error.message}</p>
        ) : data && data.byProject.length > 0 ? (
          <ul className="max-h-72 space-y-1 overflow-y-auto text-sm">
            {data.byProject.map((p) => (
              <li key={p.projectId}>
                <span className="font-medium">{p.projectName}:</span>{" "}
                {p.tasks.map((t) => t.name).join(", ")}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">No tasks</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
