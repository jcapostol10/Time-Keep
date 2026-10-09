"use client";

import { ROLE_LABELS, type Role } from "@timekeep/core";
import { Badge } from "@timekeep/ui/components/badge";
import { Button } from "@timekeep/ui/components/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@timekeep/ui/components/table";
import { MailIcon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { cancelInvitationAction, resendInvitationAction } from "@/server/actions/team";

export interface PendingInvite {
  id: string;
  email: string;
  role: string;
  inviterName: string;
  expiresAt: string | null;
}

export function PendingInvites({
  slug,
  invites,
  canManage,
}: {
  slug: string;
  invites: PendingInvite[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) toast.error(result.error ?? "Something went wrong.");
      else {
        toast.success(success);
        router.refresh();
      }
    });
  }

  if (invites.length === 0) return null;

  return (
    <section className="mt-8">
      <h2 className="mb-3 text-base font-semibold">Pending invitations</h2>
      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="hidden sm:table-cell">Invited by</TableHead>
              <TableHead className="hidden sm:table-cell">Expires</TableHead>
              {canManage ? <TableHead className="w-0" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {invites.map((invite) => (
              <TableRow key={invite.id}>
                <TableCell className="font-medium">{invite.email}</TableCell>
                <TableCell>
                  <Badge variant="secondary">
                    {ROLE_LABELS[invite.role as Role] ?? invite.role}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground hidden sm:table-cell">
                  {invite.inviterName}
                </TableCell>
                <TableCell className="text-muted-foreground hidden sm:table-cell">
                  {invite.expiresAt ? new Date(invite.expiresAt).toLocaleDateString() : "—"}
                </TableCell>
                {canManage ? (
                  <TableCell className="whitespace-nowrap">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      onClick={() =>
                        run(() => resendInvitationAction(slug, invite.id), "Invitation re-sent")
                      }
                    >
                      <MailIcon /> Resend
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      aria-label={`Cancel invitation for ${invite.email}`}
                      onClick={() =>
                        run(() => cancelInvitationAction(slug, invite.id), "Invitation cancelled")
                      }
                    >
                      <XIcon />
                    </Button>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
