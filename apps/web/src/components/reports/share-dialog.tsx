"use client";

import { type ReportKind, resolveReportRange } from "@timekeep/core";
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
import { Input } from "@timekeep/ui/components/input";
import { Label } from "@timekeep/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@timekeep/ui/components/select";
import { CopyIcon, Share2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { createShareLinkAction } from "@/server/actions/share-links";

import { useTracker } from "../tracker/tracker-provider";
import { useReportQuery } from "./report-url";

const KIND_TITLES: Record<ReportKind, string> = {
  summary: "Summary report",
  detailed: "Detailed report",
  weekly: "Weekly report",
};

/** Creates a read-only public link to the report as it is now, filters included. */
export function ShareDialog({ kind }: { kind: ReportKind }) {
  const { slug, viewer, canSeeAmounts } = useTracker();
  const [includeAmounts, setIncludeAmounts] = useState(false);
  const { query, params } = useReportQuery();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(KIND_TITLES[kind]);
  const [expiry, setExpiry] = useState("never");
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      // The report and the range it shows now ("Summary report · This week").
      const range = resolveReportRange(query, viewer, new Date());
      setTitle(`${KIND_TITLES[kind]} · ${range.label}`);
    } else {
      setUrl(null);
      setTitle(KIND_TITLES[kind]);
      setExpiry("never");
      setIncludeAmounts(false);
    }
  }

  async function create() {
    setBusy(true);
    const result = await createShareLinkAction(slug, {
      kind,
      params,
      title,
      expiresInDays: expiry === "never" ? null : Number(expiry),
      includeAmounts: canSeeAmounts && includeAmounts,
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setUrl(result.data.url);
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied");
    } catch {
      toast.error("Copy failed; select the link and copy it.");
    }
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(true)}>
        <Share2Icon /> Share
      </Button>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Share this report</DialogTitle>
            <DialogDescription>
              Anyone with the link can see this report, with its filters, without signing in. Names
              are included. You can revoke it under Reports → Shared.
            </DialogDescription>
          </DialogHeader>
          {url ? (
            <div className="space-y-2">
              <Label htmlFor="share-url">Share link</Label>
              <div className="flex gap-2">
                <Input
                  id="share-url"
                  aria-label="Share link"
                  readOnly
                  value={url}
                  onFocus={(e) => e.currentTarget.select()}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Copy link"
                  onClick={() => void copy()}
                >
                  <CopyIcon />
                </Button>
              </div>
              <p className="text-muted-foreground text-xs">
                Copy it now: for safety, TimeKeep keeps only a fingerprint of the link.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="share-title">Title</Label>
                <Input
                  id="share-title"
                  value={title}
                  maxLength={120}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="share-expiry">Expires</Label>
                <Select value={expiry} onValueChange={setExpiry}>
                  <SelectTrigger id="share-expiry" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="never">Never</SelectItem>
                    <SelectItem value="7">In 7 days</SelectItem>
                    <SelectItem value="30">In 30 days</SelectItem>
                    <SelectItem value="90">In 90 days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {canSeeAmounts ? (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="share-amounts"
                    checked={includeAmounts}
                    onCheckedChange={(checked) => setIncludeAmounts(checked === true)}
                  />
                  <Label htmlFor="share-amounts" className="font-normal">
                    Include amounts
                  </Label>
                </div>
              ) : null}
            </div>
          )}
          <DialogFooter>
            {url ? (
              <Button type="button" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            ) : (
              <Button type="button" disabled={busy || !title.trim()} onClick={() => void create()}>
                Create link
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
