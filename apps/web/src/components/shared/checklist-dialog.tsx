"use client";

import { Button } from "@timekeep/ui/components/button";
import { Checkbox } from "@timekeep/ui/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@timekeep/ui/components/dialog";
import { Label } from "@timekeep/ui/components/label";
import { useId, useState } from "react";

/** A dialog of checkboxes saved as a whole (groups of a member, members of a group, groups of tasks). */
export function ChecklistDialog({
  title,
  description,
  note,
  options,
  initial,
  empty,
  submit = "Save",
  onClose,
  onSave,
}: {
  title: string;
  description?: string;
  /** Shown under the list, e.g. what else the choice does. */
  note?: React.ReactNode;
  options: { id: string; name: string }[];
  initial: string[];
  empty: string;
  submit?: string;
  onClose: () => void;
  onSave: (ids: string[]) => Promise<boolean>;
}) {
  const [picked, setPicked] = useState(() => new Set(initial));
  const [saving, setSaving] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <Checklist options={options} picked={picked} onChange={setPicked} empty={empty} />
        {note ? <p className="text-muted-foreground text-sm">{note}</p> : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              await onSave([...picked]);
              setSaving(false);
            }}
          >
            {submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function Checklist({
  options,
  picked,
  onChange,
  empty,
}: {
  options: { id: string; name: string }[];
  picked: Set<string>;
  onChange: (next: Set<string>) => void;
  empty: string;
}) {
  const id = useId();
  if (options.length === 0) return <p className="text-muted-foreground text-sm">{empty}</p>;
  return (
    <ul className="max-h-56 space-y-2 overflow-y-auto">
      {options.map((o) => (
        <li key={o.id} className="flex items-center gap-2">
          <Checkbox
            id={`${id}-${o.id}`}
            checked={picked.has(o.id)}
            onCheckedChange={(checked) => {
              const next = new Set(picked);
              if (checked === true) next.add(o.id);
              else next.delete(o.id);
              onChange(next);
            }}
          />
          <Label htmlFor={`${id}-${o.id}`} className="font-normal">
            {o.name}
          </Label>
        </li>
      ))}
    </ul>
  );
}
