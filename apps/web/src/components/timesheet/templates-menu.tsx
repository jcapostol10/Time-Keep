"use client";

import type { TimesheetRowKey } from "@timekeep/core";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@timekeep/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@timekeep/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@timekeep/ui/components/dropdown-menu";
import { Input } from "@timekeep/ui/components/input";
import { Label } from "@timekeep/ui/components/label";
import { LayoutTemplateIcon } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";

import { deleteTemplateAction, saveTemplateAction } from "@/server/actions/timesheet";

import { trackerKeys } from "../tracker/query-keys";
import { useTemplates } from "./use-timesheet";

/** Save the current rows as a template; apply or delete saved ones. */
export function TemplatesMenu({
  slug,
  currentRows,
  onApply,
}: {
  slug: string;
  currentRows: TimesheetRowKey[];
  onApply: (rows: TimesheetRowKey[]) => void;
}) {
  const qc = useQueryClient();
  const { data: templates = [] } = useTemplates(slug);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const id = useId();

  const refresh = () => qc.invalidateQueries({ queryKey: trackerKeys.templates(slug) });

  async function save() {
    setBusy(true);
    const result = await saveTemplateAction(slug, { name, rows: currentRows });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(`Template "${result.data.name}" saved`);
    setSaving(false);
    setName("");
    void refresh();
  }

  async function remove(templateId: string, templateName: string) {
    const result = await deleteTemplateAction(slug, templateId);
    if (!result.ok) toast.error(result.error);
    else toast.success(`Template "${templateName}" deleted`);
    void refresh();
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <LayoutTemplateIcon /> Templates
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={currentRows.length === 0} onSelect={() => setSaving(true)}>
            Save as template…
          </DropdownMenuItem>
          {templates.length > 0 ? <DropdownMenuSeparator /> : null}
          {templates.length > 0 ? <DropdownMenuLabel>Saved</DropdownMenuLabel> : null}
          {templates.map((t) => (
            <DropdownMenuGroup key={t.id}>
              <DropdownMenuItem onSelect={() => onApply(t.rows)}>Apply {t.name}</DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => void remove(t.id, t.name)}>
                Delete {t.name}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={saving} onOpenChange={setSaving}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Save as template</DialogTitle>
            <DialogDescription>
              Saves the {currentRows.length} {currentRows.length === 1 ? "row" : "rows"} shown, not
              their time. Saving an existing name replaces it.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor={id}>Name</Label>
              <Input id={id} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setSaving(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || !name.trim()}>
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
