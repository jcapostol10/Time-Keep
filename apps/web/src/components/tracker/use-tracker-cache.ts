"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import { fetchJson } from "@/lib/fetch-json";
import type { EntryTag, PickerProject, PickerTask, TimeEntryDTO } from "@/lib/tracker-types";

import {
  type EntriesData,
  insertEntry,
  patchEntry,
  removeEntries,
  replaceEntry,
} from "./entry-cache";
import { type TrackerOptions, trackerKeys, trackerUrls } from "./query-keys";

/** Picker data (projects, tags, recent descriptions) of a person; hydrated by the page. */
export function useTrackerOptions(slug: string, userId = "me") {
  return useQuery({
    queryKey: trackerKeys.options(slug, userId),
    queryFn: () => fetchJson<TrackerOptions>(trackerUrls.options(slug, userId)),
    staleTime: 30_000,
  });
}

/** Imperative cache operations shared by the provider and the entry list, per shown person. */
export function useTrackerCache(slug: string, userId = "me") {
  const qc = useQueryClient();
  return useMemo(() => {
    const entriesKey = trackerKeys.entries(slug, userId);
    const optionsKey = trackerKeys.options(slug, userId);

    // Everyone's lists, ranges and reports: a write for one person can change another's view.
    const invalidateEntries = () =>
      qc.invalidateQueries({ queryKey: trackerKeys.allEntries(slug) });
    const invalidateOptions = () =>
      qc.invalidateQueries({ queryKey: trackerKeys.allOptions(slug) });

    return {
      invalidateEntries,
      invalidateOptions,
      /** Cancels in-flight entry fetches and returns a snapshot for rollback. */
      async snapshotEntries(): Promise<EntriesData | undefined> {
        await qc.cancelQueries({ queryKey: entriesKey });
        return qc.getQueryData<EntriesData>(entriesKey);
      },
      restoreEntries(snapshot: EntriesData | undefined) {
        if (snapshot) qc.setQueryData(entriesKey, snapshot);
      },
      patchEntry(id: string, patch: Partial<TimeEntryDTO>) {
        qc.setQueryData<EntriesData>(entriesKey, (d) => (d ? patchEntry(d, id, patch) : d));
      },
      removeEntries(ids: string[]) {
        qc.setQueryData<EntriesData>(entriesKey, (d) => (d ? removeEntries(d, ids) : d));
      },
      /** Inserts or replaces an entry; refetches when no loaded week holds it. */
      upsertEntry(entry: TimeEntryDTO, mode: "insert" | "replace" = "replace") {
        let placed = true;
        qc.setQueryData<EntriesData>(entriesKey, (d) => {
          if (!d) return d;
          const result = mode === "insert" ? insertEntry(d, entry) : replaceEntry(d, entry);
          placed = result.placed;
          return result.data;
        });
        if (!placed) void invalidateEntries();
      },
      getOptions(): TrackerOptions | undefined {
        return qc.getQueryData<TrackerOptions>(optionsKey);
      },
      addProject(projectItem: PickerProject) {
        qc.setQueryData<TrackerOptions>(optionsKey, (d) =>
          d && !d.projects.some((p) => p.id === projectItem.id)
            ? {
                ...d,
                projects: [...d.projects, projectItem].sort((a, b) => a.name.localeCompare(b.name)),
              }
            : d,
        );
      },
      addTask(projectId: string, taskItem: PickerTask) {
        qc.setQueryData<TrackerOptions>(optionsKey, (d) =>
          d
            ? {
                ...d,
                projects: d.projects.map((p) =>
                  p.id === projectId ? { ...p, tasks: [...p.tasks, taskItem] } : p,
                ),
              }
            : d,
        );
      },
      addTag(tagItem: EntryTag) {
        qc.setQueryData<TrackerOptions>(optionsKey, (d) =>
          d && !d.tags.some((t) => t.id === tagItem.id)
            ? { ...d, tags: [...d.tags, tagItem].sort((a, b) => a.name.localeCompare(b.name)) }
            : d,
        );
      },
      /** Resolve project/task/tag objects for an optimistic patch from the options cache. */
      resolveDetails(patch: {
        projectId?: string | null;
        taskId?: string | null;
        tagIds?: string[];
      }): Partial<TimeEntryDTO> {
        const options = qc.getQueryData<TrackerOptions>(optionsKey);
        const resolved: Partial<TimeEntryDTO> = {};
        if (patch.projectId !== undefined) {
          const found = patch.projectId
            ? options?.projects.find((p) => p.id === patch.projectId)
            : undefined;
          resolved.project = found
            ? { id: found.id, name: found.name, color: found.color, clientName: found.clientName }
            : null;
        }
        if (patch.taskId !== undefined) {
          const found = patch.taskId
            ? options?.projects.flatMap((p) => p.tasks).find((t) => t.id === patch.taskId)
            : undefined;
          resolved.task = found ? { id: found.id, name: found.name } : null;
        }
        if (patch.tagIds !== undefined) {
          resolved.tags = patch.tagIds
            .map((id) => options?.tags.find((t) => t.id === id))
            .filter((t): t is EntryTag => Boolean(t));
        }
        return resolved;
      },
    };
  }, [qc, slug, userId]);
}
