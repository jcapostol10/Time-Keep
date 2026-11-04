"use client";

import { Button } from "@timekeep/ui/components/button";
import { DeleteIcon } from "lucide-react";

const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
const MAX_DIGITS = 6;
const KEY = "h-16 text-2xl";

/** Digits, Delete and OK with 64 px targets; the screen shows dots, never the digits. */
export function PinPad({
  value,
  onChange,
  onSubmit,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  disabled: boolean;
}) {
  const press = (digit: string) => {
    if (value.length < MAX_DIGITS) onChange(value + digit);
  };
  return (
    <div className="w-full max-w-xs space-y-3">
      <p
        aria-label={`${value.length} digits entered`}
        className="h-8 text-center text-2xl tracking-[0.5em]"
      >
        {"•".repeat(value.length)}
      </p>
      <div className="grid grid-cols-3 gap-2">
        {DIGITS.map((d) => (
          <Button
            key={d}
            type="button"
            variant="outline"
            className={KEY}
            disabled={disabled}
            onClick={() => press(d)}
          >
            {d}
          </Button>
        ))}
        <Button
          type="button"
          variant="outline"
          className={KEY}
          aria-label="Delete"
          disabled={disabled}
          onClick={() => onChange(value.slice(0, -1))}
        >
          <DeleteIcon className="size-6" />
        </Button>
        <Button
          type="button"
          variant="outline"
          className={KEY}
          disabled={disabled}
          onClick={() => press("0")}
        >
          0
        </Button>
        <Button
          type="button"
          className={KEY}
          disabled={disabled || value.length < 4}
          onClick={onSubmit}
        >
          OK
        </Button>
      </div>
    </div>
  );
}
