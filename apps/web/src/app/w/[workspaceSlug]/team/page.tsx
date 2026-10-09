import { hasMinRole, ROLE_LABELS } from "@timekeep/core";
import { getDb } from "@timekeep/db";
import { Avatar, AvatarFallback, AvatarImage } from "@timekeep/ui/components/avatar";
import { Badge } from "@timekeep/ui/components/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@timekeep/ui/components/table";
import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { initials } from "@/lib/initials";
import { InviteDialog } from "@/components/team/invite-dialog";
import { PendingInvites } from "@/components/team/pending-invites";
import { listMembers, listPendingInvitations } from "@/server/queries/team";
import { requireWorkspacePage } from "@/server/workspace-access";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage({ params }: PageProps<"/w/[workspaceSlug]/team">) {
  const { workspaceSlug } = await params;
  const ctx = await requireWorkspacePage(workspaceSlug);
  const canManage = hasMinRole(ctx.role, "admin");

  const db = getDb();
  const [members, invites] = await Promise.all([
    listMembers(db, ctx.workspace.id),
    canManage ? listPendingInvitations(db, ctx.workspace.id) : Promise.resolve([]),
  ]);

  return (
    <>
      <PageHeader
        title="Team"
        description={`${members.length} ${members.length === 1 ? "member" : "members"} in ${ctx.workspace.name}`}
        actions={canManage ? <InviteDialog slug={workspaceSlug} /> : null}
      />

      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Member</TableHead>
              <TableHead className="hidden sm:table-cell">Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="hidden sm:table-cell">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((m) => (
              <TableRow key={m.membershipId}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <Avatar className="size-8">
                      {m.image ? <AvatarImage src={m.image} alt="" /> : null}
                      <AvatarFallback className="text-xs">{initials(m.name)}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {m.name}
                        {m.userId === ctx.user.id ? (
                          <span className="text-muted-foreground ml-1 text-xs">(you)</span>
                        ) : null}
                      </p>
                      <p className="text-muted-foreground truncate text-xs sm:hidden">{m.email}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground hidden sm:table-cell">
                  {m.email}
                </TableCell>
                <TableCell>
                  <Badge variant={m.role === "owner" ? "default" : "secondary"}>
                    {ROLE_LABELS[m.role]}
                  </Badge>
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  <Badge variant="outline" className="capitalize">
                    {m.status.toLowerCase()}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <PendingInvites
        slug={workspaceSlug}
        canManage={canManage}
        invites={invites.map((i) => ({
          id: i.id,
          email: i.email,
          role: i.role,
          inviterName: i.inviterName,
          expiresAt: i.expiresAt ? i.expiresAt.toISOString() : null,
        }))}
      />
    </>
  );
}
