"use client";

import { PROJECT_COLORS } from "@timekeep/core";
import { cn } from "@timekeep/ui/lib/utils";
import { CheckIcon } from "lucide-react";

/** The 20-colour palette as a radio group; each swatch is named by its hex value. */
export function ColorPalette({
  value,
  onChange,
  label = "Colour",
}: {
  value: string;
  onChange: (color: string) => void;
  label?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {PROJECT_COLORS.map((color) => {
        const selected = color === value;
        return (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={color}
            onClick={() => onChange(color)}
            className={cn(
              "focus-visible:ring-ring/50 flex size-7 items-center justify-center rounded-full outline-none transition-transform focus-visible:ring-[3px]",
              selected
                ? "ring-offset-background scale-110 ring-2 ring-offset-2"
                : "hover:scale-105",
            )}
            style={{
              backgroundColor: color,
              ...(selected ? { ["--tw-ring-color" as string]: color } : {}),
            }}
          >
            {selected ? <CheckIcon className="size-4 text-white" /> : null}
          </button>
        );
      })}
    </div>
  );
}
