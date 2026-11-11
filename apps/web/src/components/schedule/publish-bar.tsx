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
  AlertDialogTrigger,
} from "@timekeep/ui/components/alert-dialog";
import { Button } from "@timekeep/ui/components/button";

import { useScheduleWrites } from "./use-schedule";

/** "N unpublished changes" with Publish and Discard while the viewer's scope has drafts. */
export function PublishBar({
  slug,
  draftCount,
  lastPublishedAt,
}: {
  slug: string;
  draftCount: number;
  lastPublishedAt: string | null;
}) {
  const writes = useScheduleWrites(slug);
  if (draftCount === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        {lastPublishedAt
          ? `Published ${new Date(lastPublishedAt).toLocaleString()}`
          : "Nothing to publish"}
      </p>
    );
  }
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm dark:border-amber-700 dark:bg-amber-950"
    >
      <span>
        {draftCount} unpublished {draftCount === 1 ? "change" : "changes"}
      </span>
      <Button size="sm" disabled={writes.busy} onClick={() => void writes.publish()}>
        Publish
      </Button>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button size="sm" variant="outline" disabled={writes.busy}>
            Discard
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard your unpublished changes?</AlertDialogTitle>
            <AlertDialogDescription>
              The changes you made go back to the published schedule. Changes other planners made
              stay until they publish or discard them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep them</AlertDialogCancel>
            <AlertDialogAction onClick={() => void writes.discard()}>Discard</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
