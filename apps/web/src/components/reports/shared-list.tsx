"use client";

import { formatDateInZone } from "@timekeep/core";
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
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { revokeShareLinkAction } from "@/server/actions/share-links";
import type { ShareLinkDTO } from "@/server/share-links";

import { useTracker } from "../tracker/tracker-provider";

const KIND_LABELS = { summary: "Summary", detailed: "Detailed", weekly: "Weekly" } as const;
const STATUS = {
  active: { label: "Active", variant: "default" },
  expired: { label: "Expired", variant: "outline" },
  revoked: { label: "Revoked", variant: "secondary" },
} as const;

/** The share links the viewer can see, with Revoke. */
export function SharedList({ links }: { links: ShareLinkDTO[] }) {
  const { slug, viewer } = useTracker();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const date = (iso: string | null) =>
    iso ? formatDateInZone(new Date(iso), viewer.timezone, viewer.dateFormat) : "—";

  function revoke(link: ShareLinkDTO) {
    startTransition(async () => {
      const result = await revokeShareLinkAction(slug, link.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Link revoked");
      router.refresh();
    });
  }

  if (links.length === 0) {
    return (
      <p className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
        No shared links yet. Use Share on any report to create one.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Title</TableHead>
            <TableHead>Report</TableHead>
            <TableHead>Created by</TableHead>
            <TableHead>Created</TableHead>
            <TableHead>Expires</TableHead>
            <TableHead className="text-right">Opens</TableHead>
            <TableHead>Status</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {links.map((link) => (
            <TableRow key={link.id} aria-label={link.title}>
              <TableCell className="font-medium">{link.title}</TableCell>
              <TableCell>{KIND_LABELS[link.kind]}</TableCell>
              <TableCell>{link.createdBy}</TableCell>
              <TableCell className="tabular-nums">{date(link.createdAt)}</TableCell>
              <TableCell className="tabular-nums">
                {link.expiresAt ? date(link.expiresAt) : "Never"}
              </TableCell>
              <TableCell className="text-right tabular-nums">{link.openCount}</TableCell>
              <TableCell>
                <Badge variant={STATUS[link.status].variant}>{STATUS[link.status].label}</Badge>
              </TableCell>
              <TableCell className="text-right">
                {link.status === "active" && link.canRevoke ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => revoke(link)}
                  >
                    Revoke
                  </Button>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
