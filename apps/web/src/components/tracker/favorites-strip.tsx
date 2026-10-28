"use client";

import { Button } from "@timekeep/ui/components/button";
import { PlayIcon, StarIcon, XIcon } from "lucide-react";

import type { FavoriteDTO } from "@/lib/favorite-types";

import { useTracker } from "./tracker-provider";
import { useFavorites } from "./use-favorites";

function favoriteName(f: FavoriteDTO): string {
  return f.description || f.project?.name || "Untitled";
}

/**
 * The viewer's favourites above the entry list: Start runs a timer with the
 * pinned details; a favourite that cannot start (archived project, done task,
 * a project no longer visible) keeps its reason on the disabled button.
 */
export function FavoritesStrip() {
  const tracker = useTracker();
  const { favorites, unpin } = useFavorites();
  if (favorites.length === 0) return null;

  return (
    <section aria-label="Favourites" className="flex flex-wrap items-center gap-2">
      <StarIcon className="text-muted-foreground size-4" aria-hidden />
      {favorites.map((f) => {
        const name = favoriteName(f);
        return (
          <div
            key={f.id}
            className="bg-card flex items-center gap-1 rounded-full border py-0.5 pr-0.5 pl-3 text-sm"
          >
            {f.project ? (
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: f.project.color }}
              />
            ) : null}
            <span className="max-w-48 truncate">{name}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={`Start ${name}`}
              title={f.blocked ?? `Start ${name}`}
              disabled={Boolean(f.blocked) || tracker.pending}
              onClick={() =>
                void tracker.start({
                  description: f.description,
                  projectId: f.projectId,
                  taskId: f.taskId,
                  tagIds: f.tagIds,
                  billable: f.billable,
                  type: "work",
                })
              }
            >
              <PlayIcon />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={`Unpin ${name}`}
              onClick={() => void unpin(f.id)}
            >
              <XIcon />
            </Button>
          </div>
        );
      })}
    </section>
  );
}
