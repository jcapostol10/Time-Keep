"use client";

import { Button } from "@timekeep/ui/components/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@timekeep/ui/components/tooltip";
import { cn } from "@timekeep/ui/lib/utils";
import { DollarSignIcon } from "lucide-react";

export function BillableToggle({
  value,
  onChange,
  disabled = false,
}: {
  value: boolean;
  onChange: (billable: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Billable"
          aria-pressed={value}
          disabled={disabled}
          onClick={() => onChange(!value)}
          className={cn(value ? "text-primary bg-primary/10" : "text-muted-foreground")}
        >
          <DollarSignIcon />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{value ? "Billable" : "Non-billable"}</TooltipContent>
    </Tooltip>
  );
}
