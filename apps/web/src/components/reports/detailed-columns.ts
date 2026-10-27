"use client";

import { useCallback, useMemo } from "react";

import { useLocalStorage } from "@/hooks/use-local-storage";

/** Columns a person may hide; the description is always shown. */
export const DETAILED_COLUMNS = [
  { key: "project", label: "Project" },
  { key: "client", label: "Client" },
  { key: "user", label: "Person" },
  { key: "tags", label: "Tags" },
  { key: "billable", label: "Billable" },
  { key: "date", label: "Date" },
  { key: "time", label: "Time" },
  { key: "duration", label: "Duration" },
  /** Only when the viewer may see amounts. */
  { key: "amount", label: "Amount" },
] as const;

export type DetailedColumn = (typeof DETAILED_COLUMNS)[number]["key"];

/** The hidden columns, remembered per browser. */
export function useHiddenColumns(): {
  hidden: ReadonlySet<DetailedColumn>;
  toggle: (key: DetailedColumn) => void;
} {
  const [stored, setStored] = useLocalStorage<string>("timekeep:report:detailed:hidden", "");
  const hidden = useMemo(
    () =>
      new Set(
        stored
          .split(",")
          .filter((k): k is DetailedColumn => DETAILED_COLUMNS.some((c) => c.key === k)),
      ),
    [stored],
  );
  const toggle = useCallback(
    (key: DetailedColumn) => {
      const next = new Set(hidden);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      setStored([...next].join(","));
    },
    [hidden, setStored],
  );
  return { hidden, toggle };
}
