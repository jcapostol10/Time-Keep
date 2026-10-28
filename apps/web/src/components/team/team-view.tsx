"use client";

import { formatMoney, ROLE_LABELS, ROLES } from "@timekeep/core";
import { Avatar, AvatarFallback, AvatarImage } from "@timekeep/ui/components/avatar";
import { Badge } from "@timekeep/ui/components/badge";
import { Input } from "@timekeep/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@timekeep/ui/components/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@timekeep/ui/components/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@timekeep/ui/components/tabs";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { initials } from "@/lib/initials";
import type { GroupDTO, TeamRow } from "@/lib/team-types";

import { GroupsTab } from "./groups-tab";
import { ImportUsersDialog } from "./import-users-dialog";
import { InviteDialog } from "./invite-dialog";
import { MemberActions } from "./member-actions";

export interface TeamPermissions {
  /** invite, change roles, deactivate, remove, assign scope */
  manage: boolean;
  groups: boolean;
  import: boolean;
  rates: boolean;
  transfer: boolean;
}

export interface TeamContext {
  slug: string;
  workspaceName: string;
  meId: string;
  groups: GroupDTO[];
  people: { id: string; name: string }[];
  projects: { id: string; name: string }[];
  permissions: TeamPermissions;
  currency: string;
  timezone: string;
}

const STATUS_LABELS = { ACTIVE: "Active", INVITED: "Invited", DEACTIVATED: "Deactivated" } as const;
const ANY = "__any__";

interface Filters {
  q: string;
  role: string;
  group: string;
  status: string;
}
const filterKey = (f: Filters) => JSON.stringify([f.q, f.role, f.group, f.status]);

/** Members and Groups tabs; the members' filters live in the URL. */
export function TeamView({
  rows,
  filters,
  ...ctx
}: TeamContext & {
  rows: TeamRow[];
  filters: Filters;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [, startTransition] = useTransition();
  // The filters last asked for. A change builds on them, not on the props: on a slow
  // connection the props still carry the previous URL while the next change is made,
  // and the change before it would be lost. The props win once they arrive.
  const [requested, setRequested] = useState(filters);
  const [syncedFilters, setSyncedFilters] = useState(filters);
  if (filterKey(syncedFilters) !== filterKey(filters)) {
    setSyncedFilters(filters);
    setRequested(filters);
  }
  const [q, setQ] = useState(filters.q);
  const [shownQ, setShownQ] = useState(filters.q);
  if (shownQ !== filters.q) {
    setShownQ(filters.q);
    setQ(filters.q);
  }

  function setFilter(patch: Partial<Filters>) {
    const next = { ...requested, ...patch };
    setRequested(next);
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) if (v) params.set(k, v);
    startTransition(() => router.replace(`${pathname}${params.size ? `?${params}` : ""}`));
  }

  useEffect(() => {
    if (q === filters.q) return;
    const handle = setTimeout(() => setFilter({ q }), 300);
    return () => clearTimeout(handle);
  });

  // Without a status filter: everyone but the deactivated.
  const shown = filters.status ? rows : rows.filter((r) => r.status !== "DEACTIVATED");

  return (
    <Tabs defaultValue="members">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <TabsList>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="groups">Groups</TabsTrigger>
        </TabsList>
        {ctx.permissions.manage ? (
          <div className="flex flex-wrap gap-2">
            {ctx.permissions.import ? <ImportUsersDialog slug={ctx.slug} /> : null}
            <InviteDialog slug={ctx.slug} groups={ctx.groups} />
          </div>
        ) : null}
      </div>

      <TabsContent value="members" className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="search"
            aria-label="Search members"
            placeholder="Search by name or email…"
            className="h-9 w-full sm:w-56"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <Select
            value={requested.role || ANY}
            onValueChange={(v) => setFilter({ role: v === ANY ? "" : v })}
          >
            <SelectTrigger size="sm" aria-label="Role" className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any role</SelectItem>
              {ROLES.map((r) => (
                <SelectItem key={r} value={r}>
                  {ROLE_LABELS[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={requested.group || ANY}
            onValueChange={(v) => setFilter({ group: v === ANY ? "" : v })}
          >
            <SelectTrigger size="sm" aria-label="Group" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any group</SelectItem>
              {ctx.groups.map((g) => (
                <SelectItem key={g.id} value={g.id}>
                  {g.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={requested.status || ANY}
            onValueChange={(v) => setFilter({ status: v === ANY ? "" : v.toLowerCase() })}
          >
            <SelectTrigger size="sm" aria-label="Status" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Active and invited</SelectItem>
              <SelectItem value="ACTIVE">Active</SelectItem>
              <SelectItem value="INVITED">Invited</SelectItem>
              <SelectItem value="DEACTIVATED">Deactivated</SelectItem>
              <SelectItem value="all">Everyone</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <MembersTable rows={shown} ctx={ctx} />
      </TabsContent>

      <TabsContent value="groups">
        <GroupsTab ctx={ctx} />
      </TabsContent>
    </Tabs>
  );
}

function MembersTable({ rows, ctx }: { rows: TeamRow[]; ctx: TeamContext }) {
  const { permissions } = ctx;
  if (rows.length === 0) {
    return (
      <p className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
        Nobody matches these filters.
      </p>
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Member</TableHead>
            <TableHead className="hidden md:table-cell">Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead className="hidden lg:table-cell">Groups</TableHead>
            {permissions.rates ? (
              <TableHead className="hidden text-right sm:table-cell">Billable rate</TableHead>
            ) : null}
            <TableHead className="hidden sm:table-cell">Status</TableHead>
            {permissions.manage ? <TableHead className="w-0" /> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={`${r.kind}:${r.id}`}>
              <TableCell>
                <div className="flex items-center gap-3">
                  <Avatar className="size-8">
                    {r.image ? <AvatarImage src={r.image} alt="" /> : null}
                    <AvatarFallback className="text-xs">{initials(r.name)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      <span>{r.name}</span>
                      {r.userId === ctx.meId ? (
                        <span className="text-muted-foreground ml-1 text-xs">(you)</span>
                      ) : null}
                    </p>
                    {r.kind === "member" ? (
                      <p className="text-muted-foreground truncate text-xs md:hidden">{r.email}</p>
                    ) : null}
                    <p className="text-muted-foreground text-xs sm:hidden">
                      {STATUS_LABELS[r.status]}
                    </p>
                  </div>
                </div>
              </TableCell>
              <TableCell className="text-muted-foreground hidden md:table-cell">
                {r.kind === "member" ? r.email : "—"}
              </TableCell>
              <TableCell>
                <Badge variant={r.role === "owner" ? "default" : "secondary"}>
                  {ROLE_LABELS[r.role]}
                </Badge>
              </TableCell>
              <TableCell className="hidden lg:table-cell">
                <span className="text-muted-foreground text-sm">
                  {r.groups.map((g) => g.name).join(", ") || "—"}
                </span>
              </TableCell>
              {permissions.rates ? (
                <TableCell className="hidden text-right tabular-nums sm:table-cell">
                  {r.billableRateMinor === null
                    ? "—"
                    : `${formatMoney(r.billableRateMinor, ctx.currency)} / h`}
                </TableCell>
              ) : null}
              <TableCell className="hidden sm:table-cell">
                <Badge variant={r.status === "ACTIVE" ? "outline" : "secondary"}>
                  {STATUS_LABELS[r.status]}
                </Badge>
              </TableCell>
              {permissions.manage ? (
                <TableCell>
                  <MemberActions row={r} ctx={ctx} />
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
