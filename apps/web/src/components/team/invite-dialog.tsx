"use client";

import { ROLE_LABELS } from "@timekeep/core";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@timekeep/ui/components/select";
import { Textarea } from "@timekeep/ui/components/textarea";
import { Loader2Icon, UserPlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { toast } from "sonner";

import type { AssignableRole, GroupDTO } from "@/lib/team-types";
import type { InviteResult } from "@/server/invites";
import { inviteMembersAction } from "@/server/actions/team";

const INVITABLE: AssignableRole[] = ["member", "manager", "admin"];

export const INVITE_RESULT_LABELS: Record<InviteResult["result"], string> = {
  invited: "Invited",
  member: "Already a member",
  "invited-already": "Already invited",
  invalid: "Not a valid address",
  failed: "Not sent",
};

/** One or many addresses, one role and optional groups for all of them. */
export function InviteDialog({ slug, groups }: { slug: string; groups: GroupDTO[] }) {
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [emails, setEmails] = useState("");
  const [role, setRole] = useState<AssignableRole>("member");
  const [groupIds, setGroupIds] = useState<Set<string>>(() => new Set());
  const [results, setResults] = useState<InviteResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      if (results) router.refresh();
      setEmails("");
      setRole("member");
      setGroupIds(new Set());
      setResults(null);
      setError(null);
    }
  }

  async function send() {
    setSending(true);
    setError(null);
    const result = await inviteMembersAction(slug, { emails, role, groupIds: [...groupIds] });
    setSending(false);
    if (!result.ok) {
      setError(result.fieldErrors?.emails?.[0] ?? result.error);
      return;
    }
    setResults(result.data);
    const sent = result.data.filter((r) => r.result === "invited").length;
    if (sent > 0) toast.success(sent === 1 ? "Invitation sent" : `${sent} invitations sent`);
  }

  return (
    <>
      <Button onClick={() => onOpenChange(true)}>
        <UserPlusIcon /> Invite members
      </Button>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Invite members</DialogTitle>
            <DialogDescription>
              Each address gets an email with a link to join. Paste up to 100, separated by commas
              or new lines.
            </DialogDescription>
          </DialogHeader>
          {results ? (
            <ul
              aria-label="Invitation results"
              className="max-h-64 space-y-1 overflow-y-auto text-sm"
            >
              {results.map((r) => (
                <li key={r.email} className="flex flex-wrap justify-between gap-x-3">
                  <span className="truncate">{r.email}</span>
                  <span
                    className={r.result === "invited" ? "text-foreground" : "text-muted-foreground"}
                  >
                    {INVITE_RESULT_LABELS[r.result]}
                    {r.error ? `: ${r.error}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor={`${id}-emails`}>Email addresses</Label>
                <Textarea
                  id={`${id}-emails`}
                  rows={4}
                  autoFocus
                  placeholder="ana@company.com, ben@company.com"
                  value={emails}
                  onChange={(e) => setEmails(e.target.value)}
                  aria-invalid={error ? true : undefined}
                />
                {error ? <p className="text-destructive text-sm">{error}</p> : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${id}-role`}>Role</Label>
                <Select value={role} onValueChange={(v) => setRole(v as AssignableRole)}>
                  <SelectTrigger id={`${id}-role`} aria-label="Role" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INVITABLE.map((r) => (
                      <SelectItem key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {groups.length > 0 ? (
                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium">Groups</legend>
                  {groups.map((g) => (
                    <div key={g.id} className="flex items-center gap-2">
                      <Checkbox
                        id={`${id}-g-${g.id}`}
                        checked={groupIds.has(g.id)}
                        onCheckedChange={(checked) => {
                          const next = new Set(groupIds);
                          if (checked === true) next.add(g.id);
                          else next.delete(g.id);
                          setGroupIds(next);
                        }}
                      />
                      <Label htmlFor={`${id}-g-${g.id}`} className="font-normal">
                        {g.name}
                      </Label>
                    </div>
                  ))}
                </fieldset>
              ) : null}
            </div>
          )}
          <DialogFooter>
            {results ? (
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button disabled={sending || !emails.trim()} onClick={() => void send()}>
                  {sending ? <Loader2Icon className="animate-spin" /> : null}
                  Send invitations
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
