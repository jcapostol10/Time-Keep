"use client";

import { limitedUserSchema } from "@timekeep/core";
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
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { toast } from "sonner";

import { addLimitedUserAction } from "@/server/actions/team";

/** Adds a kiosk-only member: a name, no email and no login (decision 18). */
export function LimitedUserDialog({ slug }: { slug: string }) {
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  async function add() {
    const parsed = limitedUserSchema.safeParse({ name });
    if (!parsed.success) return;
    setSaving(true);
    const result = await addLimitedUserAction(slug, parsed.data);
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(`${parsed.data.name} added`);
    setOpen(false);
    setName("");
    router.refresh();
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Add limited user
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Add limited user</DialogTitle>
            <DialogDescription>
              They clock in on a kiosk with a PIN or QR code. They have no email or login until you
              convert them to a member.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor={id}>Name</Label>
            <Input id={id} value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={saving || name.trim() === ""} onClick={() => void add()}>
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
