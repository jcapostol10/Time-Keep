"use client";

import { GROUP_KEYS, type GroupKey } from "@timekeep/core";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@timekeep/ui/components/select";

export const GROUP_LABELS: Record<GroupKey, string> = {
  project: "Project",
  client: "Client",
  user: "Person",
  task: "Task",
  tag: "Tag",
  date: "Date",
  week: "Week",
  month: "Month",
  description: "Description",
};

const NONE = "none";

/** Up to three grouping levels; a later slot cleared drops the ones after it. */
export function GroupByControl({
  value,
  onChange,
}: {
  value: GroupKey[];
  onChange: (keys: GroupKey[]) => void;
}) {
  function setSlot(index: number, key: string) {
    if (key === NONE) {
      onChange(value.slice(0, index).length > 0 ? value.slice(0, index) : [value[0] ?? "project"]);
      return;
    }
    const next = [...value.slice(0, index), key as GroupKey, ...value.slice(index + 1)];
    onChange(next.filter((k, i) => next.indexOf(k) === i).slice(0, 3));
  }

  const slots = Math.min(value.length + 1, 3);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-muted-foreground text-sm">Group by</span>
      {Array.from({ length: slots }, (_, i) => (
        <Select key={i} value={value[i] ?? NONE} onValueChange={(key) => setSlot(i, key)}>
          <SelectTrigger size="sm" aria-label={`Group by ${i + 1}`} className="w-36">
            <SelectValue placeholder="None" />
          </SelectTrigger>
          <SelectContent>
            {i > 0 ? <SelectItem value={NONE}>None</SelectItem> : null}
            {GROUP_KEYS.filter((k) => !value.includes(k) || value[i] === k).map((k) => (
              <SelectItem key={k} value={k}>
                {GROUP_LABELS[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ))}
    </div>
  );
}
