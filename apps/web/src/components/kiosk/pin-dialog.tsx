"use client";

import { PIN_STRENGTH_NOTE, pinSchema } from "@timekeep/core";
import { Button } from "@timekeep/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@timekeep/ui/components/dialog";
import { Input } from "@timekeep/ui/components/input";
import { Label } from "@timekeep/ui/components/label";
import { useId, useState } from "react";
import { toast } from "sonner";

import type { ActionResult } from "@/lib/action-result";

/** Sets a kiosk PIN: the person's own on the profile, or a limited user's on the Team page. */
export function PinDialog({
  onSave,
  onClose,
}: {
  onSave: (input: { pin: string }) => Promise<ActionResult>;
  onClose: () => void;
}) {
  const id = useId();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    const parsed = pinSchema.safeParse({ pin });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Enter a PIN.");
      return;
    }
    setSaving(true);
    const result = await onSave(parsed.data);
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast.success("PIN saved");
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Kiosk PIN</DialogTitle>
          <DialogDescription>{PIN_STRENGTH_NOTE}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor={id}>PIN</Label>
          <Input
            id={id}
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            value={pin}
            aria-invalid={error !== null}
            onChange={(e) => {
              setPin(e.target.value);
              setError(null);
            }}
          />
          {error ? <p className="text-destructive text-sm">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={saving} onClick={() => void save()}>
            Save PIN
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
