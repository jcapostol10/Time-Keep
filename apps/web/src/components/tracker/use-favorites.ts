"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { toast } from "sonner";

import type { FavoriteDTO } from "@/lib/favorite-types";
import { fetchJson } from "@/lib/fetch-json";
import type { EntryDraft } from "@/lib/tracker-types";
import { pinFavoriteAction, unpinFavoriteAction } from "@/server/actions/favorites";

import { trackerKeys, trackerUrls } from "./query-keys";
import { trackSave } from "./saving-store";
import { useTracker } from "./tracker-provider";

/** The viewer's favourites (hydrated by the tracker page), with pin and unpin. */
export function useFavorites() {
  const { slug } = useTracker();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: trackerKeys.favorites(slug),
    queryFn: async () =>
      (await fetchJson<{ favorites: FavoriteDTO[] }>(trackerUrls.favorites(slug))).favorites,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
  const refresh = useCallback(
    () => qc.invalidateQueries({ queryKey: trackerKeys.favorites(slug) }),
    [qc, slug],
  );

  const pin = useCallback(
    async (details: Omit<EntryDraft, "type">) => {
      const result = await trackSave(() => pinFavoriteAction(slug, details));
      if (!result.ok) {
        toast.error(result.error);
        return false;
      }
      await refresh();
      toast.success("Pinned to favourites");
      return true;
    },
    [slug, refresh],
  );

  const unpin = useCallback(
    async (id: string) => {
      const result = await trackSave(() => unpinFavoriteAction(slug, id));
      if (!result.ok) {
        toast.error(result.error);
        return false;
      }
      await refresh();
      return true;
    },
    [slug, refresh],
  );

  return { favorites: query.data ?? [], pin, unpin };
}
