"use client";

import { ROLE_LABELS, type UserImportRow, type UserImportStatus } from "@timekeep/core";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@timekeep/ui/components/table";
import { FileUpIcon, Loader2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { toast } from "sonner";

import { importUsersAction, importUsersPreviewAction } from "@/server/actions/team";

const STATUS_LABELS: Record<UserImportStatus, string> = {
  ok: "Ready",
  "invalid-email": "Not a valid address",
  "unknown-role": "Unknown role",
  "owner-role": "Owners cannot be imported",
  member: "Already a member",
  invited: "Already invited",
  duplicate: "Duplicate",
};

/** A CSV of email, role and groups: preview every row, then invite the ready ones. */
export function ImportUsersDialog({ slug }: { slug: string }) {
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [csv, setCsv] = useState<string | null>(null);
  const [rows, setRows] = useState<UserImportRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ready = rows?.filter((r) => r.status === "ok").length ?? 0;

  function reset(next: boolean) {
    setOpen(next);
    if (!next) {
      setCsv(null);
      setRows(null);
      setError(null);
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    const text = await file.text();
    const result = await importUsersPreviewAction(slug, text);
    setBusy(false);
    if (!result.ok) return setError(result.error);
    if (result.data.error) return setError(result.data.error);
    setCsv(text);
    setRows(result.data.rows);
  }

  async function invite() {
    if (!csv) return;
    setBusy(true);
    const result = await importUsersAction(slug, csv);
    setBusy(false);
    if (!result.ok) return setError(result.error);
    toast.success(
      result.data.invited === 1 ? "1 invitation sent" : `${result.data.invited} invitations sent`,
    );
    reset(false);
    router.refresh();
  }

  return (
    <>
      <Button variant="outline" onClick={() => reset(true)}>
        <FileUpIcon /> Import from CSV
      </Button>
      <Dialog open={open} onOpenChange={reset}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Import people</DialogTitle>
            <DialogDescription>
              A CSV with an <code>email</code> column, and optionally <code>role</code> (admin,
              manager or member) and <code>groups</code> (names separated by semicolons). Nothing is
              sent until you confirm.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={`${id}-file`}>CSV file</Label>
            <Input
              id={`${id}-file`}
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
            {error ? <p className="text-destructive text-sm">{error}</p> : null}
          </div>
          {rows ? (
            <div className="overflow-x-auto rounded-lg border">
              <Table aria-label="Import preview">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">Line</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Groups</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.line}>
                      <TableCell className="text-muted-foreground tabular-nums">{r.line}</TableCell>
                      <TableCell className="max-w-48 truncate">{r.email || "—"}</TableCell>
                      <TableCell>{ROLE_LABELS[r.role]}</TableCell>
                      <TableCell className="text-sm">
                        {r.groups.map((g) => (g.id ? g.name : `${g.name} (new)`)).join(", ") || "—"}
                      </TableCell>
                      <TableCell
                        className={r.status === "ok" ? "font-medium" : "text-muted-foreground"}
                      >
                        {STATUS_LABELS[r.status]}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => reset(false)}>
              Cancel
            </Button>
            <Button disabled={busy || ready === 0} onClick={() => void invite()}>
              {busy ? <Loader2Icon className="animate-spin" /> : null}
              {ready === 1 ? "Invite 1 person" : `Invite ${ready} people`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
