"use client";

import { NONE_ID } from "@timekeep/core";
import { Input } from "@timekeep/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@timekeep/ui/components/select";
import { useEffect, useState } from "react";

import { useTracker } from "../tracker/tracker-provider";
import { DatePresetMenu } from "./date-preset-menu";
import { MultiSelectFilter } from "./multi-select-filter";
import { useReportQuery } from "./report-url";
import { useReportOptions } from "./use-report";

/** Every filter writes to the URL; the bar wraps at narrow widths. */
export function FilterBar() {
  const { slug, viewer } = useTracker();
  const { query, set } = useReportQuery();
  const { data: options } = useReportOptions(slug);
  const [text, setText] = useState(query.description);

  // Typed text reaches the URL after a pause, not on every key.
  useEffect(() => {
    if (text === query.description) return;
    const handle = setTimeout(() => set({ description: text }), 400);
    return () => clearTimeout(handle);
  }, [text, query.description, set]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <DatePresetMenu query={query} prefs={viewer} onChange={set} />
      {options?.users ? (
        <MultiSelectFilter
          label="Users"
          options={options.users}
          value={query.userIds}
          onChange={(userIds) => set({ userIds })}
        />
      ) : null}
      <MultiSelectFilter
        label="Clients"
        options={options?.clients ?? []}
        value={query.clientIds}
        onChange={(clientIds) => set({ clientIds })}
        none={{ id: NONE_ID, name: "Without client" }}
      />
      <MultiSelectFilter
        label="Projects"
        options={(options?.projects ?? []).map((p) => ({ id: p.id, name: p.name }))}
        value={query.projectIds}
        onChange={(projectIds) => set({ projectIds })}
        none={{ id: NONE_ID, name: "Without project" }}
      />
      <MultiSelectFilter
        label="Tasks"
        options={options?.tasks ?? []}
        value={query.taskIds}
        onChange={(taskIds) => set({ taskIds })}
        none={{ id: NONE_ID, name: "Without task" }}
      />
      <MultiSelectFilter
        label="Tags"
        options={options?.tags ?? []}
        value={query.tagIds}
        onChange={(tagIds) => set({ tagIds })}
        none={{ id: NONE_ID, name: "Without tag" }}
      />
      {query.tagIds.filter((id) => id !== NONE_ID).length > 1 ? (
        <Select
          value={query.tagMode}
          onValueChange={(v) => set({ tagMode: v === "and" ? "and" : "or" })}
        >
          <SelectTrigger size="sm" aria-label="Tag mode" className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="or">Any tag</SelectItem>
            <SelectItem value="and">All tags</SelectItem>
          </SelectContent>
        </Select>
      ) : null}
      <Select
        value={query.billable}
        onValueChange={(v) => set({ billable: v === "yes" ? "yes" : v === "no" ? "no" : "all" })}
      >
        <SelectTrigger size="sm" aria-label="Billable" className="w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Billable: all</SelectItem>
          <SelectItem value="yes">Billable only</SelectItem>
          <SelectItem value="no">Non-billable only</SelectItem>
        </SelectContent>
      </Select>
      <Input
        type="search"
        aria-label="Description contains"
        placeholder="Description contains…"
        className="h-8 w-48"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
    </div>
  );
}
