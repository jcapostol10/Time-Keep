"use client";

import { Button } from "@timekeep/ui/components/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@timekeep/ui/components/command";
import { Popover, PopoverContent, PopoverTrigger } from "@timekeep/ui/components/popover";
import { cn } from "@timekeep/ui/lib/utils";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { useState } from "react";

export interface FilterOption {
  id: string;
  name: string;
}

/** A filter that holds several ids; its button says what is chosen. */
export function MultiSelectFilter({
  label,
  options,
  value,
  onChange,
  /** An extra first option meaning "without one" (its id is NONE_ID). */
  none,
}: {
  label: string;
  options: FilterOption[];
  value: string[];
  onChange: (ids: string[]) => void;
  none?: FilterOption;
}) {
  const [open, setOpen] = useState(false);
  const all = none ? [none, ...options] : options;
  const chosen = all.filter((o) => value.includes(o.id));
  const summary =
    chosen.length === 0
      ? "All"
      : chosen.length === 1
        ? chosen[0]!.name
        : `${chosen.length} selected`;

  function toggle(id: string) {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant={chosen.length > 0 ? "secondary" : "outline"}
          size="sm"
          aria-label={`${label}: ${summary}`}
          className="max-w-56"
        >
          <span className="truncate">
            {label}: {summary}
          </span>
          <ChevronDownIcon className="text-muted-foreground size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput aria-label={`Search ${label.toLowerCase()}`} placeholder="Search…" />
          <CommandList>
            <CommandEmpty>Nothing found.</CommandEmpty>
            <CommandGroup>
              {all.map((o) => {
                const selected = value.includes(o.id);
                return (
                  <CommandItem key={o.id} value={o.name} onSelect={() => toggle(o.id)}>
                    <CheckIcon
                      className={cn("size-4", selected ? "opacity-100" : "opacity-0")}
                      aria-hidden
                    />
                    <span className="truncate">{o.name}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
