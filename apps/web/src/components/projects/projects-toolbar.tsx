"use client";

import type { ProjectListQuery } from "@timekeep/core";
import { Input } from "@timekeep/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@timekeep/ui/components/select";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export interface ClientOption {
  id: string;
  name: string;
  archived: boolean;
}

const ALL = "__all__";

const SORTS: {
  value: string;
  label: string;
  sort: ProjectListQuery["sort"];
  dir: ProjectListQuery["dir"];
}[] = [
  { value: "name-asc", label: "Name A–Z", sort: "name", dir: "asc" },
  { value: "name-desc", label: "Name Z–A", sort: "name", dir: "desc" },
  { value: "client", label: "Client", sort: "client", dir: "asc" },
  { value: "tracked", label: "Tracked time", sort: "tracked", dir: "desc" },
];

/** Filters, search and sort for the projects list, kept in the URL. */
export function ProjectsToolbar({
  query,
  clients,
}: {
  query: ProjectListQuery;
  clients: ClientOption[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [text, setText] = useState(query.q);

  // The filters a navigation is built from. Props lag the URL by a server
  // round trip, and useSearchParams lags too, so quick successive changes
  // compose on this state; it follows the props whenever they change.
  const [filters, setFilters] = useState<ProjectListQuery>(query);
  const queryKey = JSON.stringify(query);
  const [seenKey, setSeenKey] = useState(queryKey);
  if (seenKey !== queryKey) {
    setSeenKey(queryKey);
    setFilters(query);
  }

  function navigate(next: Partial<ProjectListQuery>) {
    const merged = { ...filters, ...next };
    setFilters(merged);
    const params = new URLSearchParams();
    if (merged.q) params.set("q", merged.q);
    if (merged.clientId) params.set("client", merged.clientId);
    if (merged.status !== "active") params.set("status", merged.status);
    if (merged.billing !== "all") params.set("billing", merged.billing);
    if (merged.access !== "all") params.set("access", merged.access);
    if (merged.sort !== "name") params.set("sort", merged.sort);
    if (merged.dir !== "asc") params.set("dir", merged.dir);
    const search = params.toString();
    router.replace(search ? `${pathname}?${search}` : pathname);
  }

  useEffect(() => {
    if (text === query.q) return;
    const handle = setTimeout(() => navigate({ q: text }), 250);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- navigate is stable per render
  }, [text]);

  const sortValue =
    SORTS.find((s) => s.sort === filters.sort && s.dir === filters.dir)?.value ?? "name-asc";
  const visibleClients = clients.filter((c) => !c.archived || c.id === filters.clientId);

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <Input
        type="search"
        aria-label="Search projects"
        placeholder="Search projects or clients"
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="w-full sm:w-60"
      />
      <Select
        value={filters.clientId ?? ALL}
        onValueChange={(v) => navigate({ clientId: v === ALL ? undefined : v })}
      >
        <SelectTrigger aria-label="Client" className="w-[calc(50%-0.25rem)] sm:w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All clients</SelectItem>
          {visibleClients.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={filters.status}
        onValueChange={(v) => navigate({ status: v as ProjectListQuery["status"] })}
      >
        <SelectTrigger aria-label="Status" className="w-[calc(50%-0.25rem)] sm:w-32">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="active">Active</SelectItem>
          <SelectItem value="archived">Archived</SelectItem>
          <SelectItem value="all">All</SelectItem>
        </SelectContent>
      </Select>
      <Select
        value={filters.billing}
        onValueChange={(v) => navigate({ billing: v as ProjectListQuery["billing"] })}
      >
        <SelectTrigger aria-label="Billing" className="w-[calc(50%-0.25rem)] sm:w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All billing</SelectItem>
          <SelectItem value="billable">Billable</SelectItem>
          <SelectItem value="non-billable">Non-billable</SelectItem>
        </SelectContent>
      </Select>
      <Select
        value={filters.access}
        onValueChange={(v) => navigate({ access: v as ProjectListQuery["access"] })}
      >
        <SelectTrigger aria-label="Access" className="w-[calc(50%-0.25rem)] sm:w-32">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All access</SelectItem>
          <SelectItem value="public">Public</SelectItem>
          <SelectItem value="private">Private</SelectItem>
        </SelectContent>
      </Select>
      <Select
        value={sortValue}
        onValueChange={(v) => {
          const s = SORTS.find((x) => x.value === v) ?? SORTS[0]!;
          navigate({ sort: s.sort, dir: s.dir });
        }}
      >
        <SelectTrigger aria-label="Sort" className="w-full sm:w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SORTS.map((s) => (
            <SelectItem key={s.value} value={s.value}>
              {s.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
