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
import { CheckIcon, PlusIcon, TagIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { createTagAction } from "@/server/actions/time-entries";

import { useTrackerCache, useTrackerOptions } from "./use-tracker-cache";

/**
 * Multi-select of tags. Changes are reported when the popover closes, so an
 * entry row saves once per edit instead of once per click.
 */
export function TagPicker({
  slug,
  value,
  onChange,
  disabled = false,
}: {
  slug: string;
  value: string[];
  onChange: (tagIds: string[]) => void;
  disabled?: boolean;
}) {
  const { data } = useTrackerOptions(slug);
  const cache = useTrackerCache(slug);
  const tags = data?.tags ?? [];
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState<string[]>(value);
  const [creating, setCreating] = useState(false);
  const trimmed = query.trim();
  const canCreate =
    trimmed.length > 0 && !tags.some((t) => t.name.toLowerCase() === trimmed.toLowerCase());
  const selectedTags = tags.filter((t) => value.includes(t.id));

  function commit(next: string[]) {
    const changed = next.length !== value.length || next.some((id) => !value.includes(id));
    if (changed) onChange(next);
  }

  function toggle(id: string) {
    setSelection((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  async function create() {
    setCreating(true);
    const result = await createTagAction(slug, { name: trimmed });
    setCreating(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    cache.addTag(result.data);
    setSelection((s) => (s.includes(result.data.id) ? s : [...s, result.data.id]));
    setQuery("");
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setSelection(value);
        else {
          commit(selection);
          setQuery("");
        }
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          aria-label={`Tags: ${selectedTags.map((t) => t.name).join(", ") || "none"}`}
          className={cn(
            "max-w-48 justify-start",
            selectedTags.length === 0 && "text-muted-foreground",
          )}
        >
          <TagIcon />
          {selectedTags.length > 0 ? (
            <span className="truncate">{selectedTags.map((t) => t.name).join(", ")}</span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-60 p-0" align="start">
        <Command>
          <CommandInput
            aria-label="Search tags"
            placeholder="Search or create tag"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>No tags found.</CommandEmpty>
            <CommandGroup>
              {tags.map((t) => {
                const checked = selection.includes(t.id);
                return (
                  <CommandItem
                    key={t.id}
                    value={t.name}
                    onSelect={() => toggle(t.id)}
                    data-checked={checked}
                  >
                    <span
                      className={cn(
                        "flex size-4 items-center justify-center rounded-[4px] border",
                        checked && "bg-primary border-primary text-primary-foreground",
                      )}
                    >
                      {checked ? <CheckIcon className="size-3 text-current" /> : null}
                    </span>
                    <span className="truncate">{t.name}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
            {canCreate ? (
              <CommandGroup>
                <CommandItem
                  value={`__create__ ${trimmed}`}
                  disabled={creating}
                  onSelect={() => void create()}
                >
                  <PlusIcon />
                  <span className="truncate">Create tag &ldquo;{trimmed}&rdquo;</span>
                </CommandItem>
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
