"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@timekeep/ui/components/select";
import { usePathname, useRouter } from "next/navigation";

/** Status filter, kept in the URL so the server page renders the list. */
export function TagsToolbar({ status }: { status: string }) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <div className="mb-4">
      <Select
        value={status}
        onValueChange={(value) =>
          router.replace(value === "active" ? pathname : `${pathname}?status=${value}`)
        }
      >
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
