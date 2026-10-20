"use client";

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

/** Search and status filter, kept in the URL so the server page renders the list. */
export function ClientsToolbar({ q, status }: { q: string; status: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [text, setText] = useState(q);

  // Quick successive changes compose on this state; it follows the props.
  const [filters, setFilters] = useState({ q, status });
  const propsKey = `${q}\u0000${status}`;
  const [seenKey, setSeenKey] = useState(propsKey);
  if (seenKey !== propsKey) {
    setSeenKey(propsKey);
    setFilters({ q, status });
  }

  function navigate(next: Partial<{ q: string; status: string }>) {
    const merged = { ...filters, ...next };
    setFilters(merged);
    const params = new URLSearchParams();
    if (merged.q) params.set("q", merged.q);
    if (merged.status !== "active") params.set("status", merged.status);
    const search = params.toString();
    router.replace(search ? `${pathname}?${search}` : pathname);
  }

  // Debounce typing; the URL (and the list) follows a moment later.
  useEffect(() => {
    if (text === q) return;
    const handle = setTimeout(() => navigate({ q: text }), 250);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- navigate is stable per render
  }, [text]);

  return (
    <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
      <Input
        type="search"
        aria-label="Search clients"
        placeholder="Search clients"
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="sm:max-w-xs"
      />
      <Select value={filters.status} onValueChange={(value) => navigate({ status: value })}>
        <SelectTrigger aria-label="Status" className="w-full sm:w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="active">Active</SelectItem>
          <SelectItem value="archived">Archived</SelectItem>
          <SelectItem value="all">All</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
