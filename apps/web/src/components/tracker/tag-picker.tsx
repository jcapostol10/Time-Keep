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
import { useRef, useState } from "react";
import { toast } from "sonner";

import { createTagAction } from "@/server/actions/time-entries";

import { trackDraftWrite } from "./draft-writes";
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
  // Mirrors of state that async tag creation reads after it resolves.
  const selectionRef = useRef<string[]>(value);
  const openRef = useRef(false);
  const [creating, setCreating] = useState(false);
  const trimmed = query.trim();
  const canCreate =
    trimmed.length > 0 && !tags.some((t) => t.name.toLowerCase() === trimmed.toLowerCase());
  const selectedTags = tags.filter((t) => value.includes(t.id));

  function commit(next: string[]) {
    const changed = next.length !== value.length || next.some((id) => !value.includes(id));
    if (changed) onChange(next);
  }

  function updateSelection(next: string[]) {
    selectionRef.current = next;
    setSelection(next);
  }

  function toggle(id: string) {
    const current = selectionRef.current;
    updateSelection(current.includes(id) ? current.filter((x) => x !== id) : [...current, id]);
  }

  async function create() {
    const name = trimmed;
    setCreating(true);
    const result = await createTagAction(slug, { name });
    setCreating(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    cache.addTag(result.data);
    const current = selectionRef.current;
    const next = current.includes(result.data.id) ? current : [...current, result.data.id];
    updateSelection(next);
    // Keep whatever the user has typed since; only clear the name just created.
    setQuery((q) => (q.trim() === name ? "" : q));
    // Closed while the tag was being created: apply it now, or it would be lost.
    if (!openRef.current) commit(next);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        openRef.current = next;
        if (next) updateSelection(value);
        else {
          commit(selectionRef.current);
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
                  onSelect={() => void trackDraftWrite(create())}
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
