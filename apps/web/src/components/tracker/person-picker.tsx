"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@timekeep/ui/components/select";
import { useQuery } from "@tanstack/react-query";
import { UserIcon } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { fetchJson } from "@/lib/fetch-json";

import { trackerKeys, trackerUrls } from "./query-keys";
import { useTarget } from "./target-context";
import { useTracker } from "./tracker-provider";

export interface Person {
  id: string;
  name: string;
}

/**
 * Whose entries the page shows: the viewer, or someone they may add time for.
 * Hidden when there is nobody else. Changes go through the URL (`?user=`),
 * so the page loads that person's week and keys.
 */
export function PersonPicker() {
  const { slug } = useTracker();
  const target = useTarget();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const { data } = useQuery({
    queryKey: trackerKeys.people(slug),
    queryFn: async () => (await fetchJson<{ people: Person[] }>(trackerUrls.people(slug))).people,
    staleTime: 60_000,
  });
  const people = data ?? [];
  const me = people[0];
  if (!me || people.length < 2) return null;

  function show(id: string) {
    const params = new URLSearchParams(search.toString());
    if (id === me!.id) params.delete("user");
    else params.set("user", id);
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  return (
    <Select value={target?.userId ?? me.id} onValueChange={show}>
      <SelectTrigger size="sm" aria-label="Person" className="w-52">
        <UserIcon />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {people.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
