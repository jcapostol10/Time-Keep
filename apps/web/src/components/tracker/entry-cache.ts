import type { InfiniteData } from "@tanstack/react-query";

import type { EntriesPage, TimeEntryDTO } from "@/lib/tracker-types";

/**
 * Pure, immutable updates of the infinite entries cache (one page per week).
 * `placed: false` means no loaded week contains the entry; the caller should
 * invalidate so the server decides where it lives.
 */

export type EntriesData = InfiniteData<EntriesPage, string | null>;

function mapPages(data: EntriesData, fn: (page: EntriesPage) => EntriesPage): EntriesData {
  return { ...data, pages: data.pages.map(fn) };
}

function byStartDesc(a: TimeEntryDTO, b: TimeEntryDTO): number {
  return b.start.localeCompare(a.start) || b.id.localeCompare(a.id);
}

function inWeek(page: EntriesPage, start: string): boolean {
  const t = Date.parse(start);
  return t >= Date.parse(page.weekStart) && t < Date.parse(page.weekEnd);
}

export function patchEntry(
  data: EntriesData,
  id: string,
  patch: Partial<TimeEntryDTO>,
): EntriesData {
  return mapPages(data, (page) =>
    page.entries.some((e) => e.id === id)
      ? { ...page, entries: page.entries.map((e) => (e.id === id ? { ...e, ...patch } : e)) }
      : page,
  );
}

export function removeEntries(data: EntriesData, ids: readonly string[]): EntriesData {
  const drop = new Set(ids);
  return mapPages(data, (page) =>
    page.entries.some((e) => drop.has(e.id))
      ? { ...page, entries: page.entries.filter((e) => !drop.has(e.id)) }
      : page,
  );
}

export function insertEntry(
  data: EntriesData,
  entry: TimeEntryDTO,
): { data: EntriesData; placed: boolean } {
  if (data.pages.some((p) => p.entries.some((e) => e.id === entry.id))) {
    return { data, placed: true };
  }
  const index = data.pages.findIndex((p) => inWeek(p, entry.start));
  if (index === -1) return { data, placed: false };
  return {
    placed: true,
    data: {
      ...data,
      pages: data.pages.map((p, i) =>
        i === index ? { ...p, entries: [...p.entries, entry].sort(byStartDesc) } : p,
      ),
    },
  };
}

/** Swaps in the server's version of an entry, moving it if its start changed week. */
export function replaceEntry(
  data: EntriesData,
  entry: TimeEntryDTO,
): { data: EntriesData; placed: boolean } {
  return insertEntry(removeEntries(data, [entry.id]), entry);
}
