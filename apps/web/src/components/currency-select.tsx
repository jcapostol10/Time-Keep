"use client";

import { CURRENCIES } from "@timekeep/core";
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
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";
import { useState } from "react";

/**
 * Every ISO 4217 currency, searchable by code or name. `none` adds a first
 * option that stands for "no currency of its own" (the value is null).
 */
export function CurrencySelect({
  value,
  onChange,
  none,
  disabled,
  ...trigger
}: {
  value: string | null;
  onChange: (code: string | null) => void;
  /** The label of the "no own currency" option; left out, a currency is required. */
  none?: string;
  disabled?: boolean;
} & Omit<React.ComponentProps<typeof Button>, "value" | "onChange">) {
  const [open, setOpen] = useState(false);
  const current = CURRENCIES.find((c) => c.code === value);
  const label = current
    ? `${current.code} · ${current.name}`
    : (value ?? none ?? "Pick a currency");

  function pick(code: string | null) {
    onChange(code);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          {...trigger}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span className="truncate">{label}</span>
          <ChevronsUpDownIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command>
          <CommandInput aria-label="Search currencies" placeholder="Search by code or name…" />
          <CommandList>
            <CommandEmpty>No currency found.</CommandEmpty>
            <CommandGroup>
              {none ? (
                <CommandItem value={none} onSelect={() => pick(null)}>
                  <CheckIcon
                    className={cn("size-4", value === null ? "opacity-100" : "opacity-0")}
                    aria-hidden
                  />
                  {none}
                </CommandItem>
              ) : null}
              {CURRENCIES.map((c) => (
                <CommandItem
                  key={c.code}
                  value={`${c.code} ${c.name}`}
                  onSelect={() => pick(c.code)}
                >
                  <CheckIcon
                    className={cn("size-4", value === c.code ? "opacity-100" : "opacity-0")}
                    aria-hidden
                  />
                  {c.code} · {c.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
