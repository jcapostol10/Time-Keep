import { Button } from "@timekeep/ui/components/button";
import { SearchXIcon } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/empty-state";

/**
 * Single not-found page. Workspace access failures land here too (a layout's
 * notFound() is handled by its parent boundary), and the copy deliberately
 * does not distinguish "does not exist" from "not a member".
 */
export default function NotFound() {
  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <div className="w-full max-w-md">
        <EmptyState
          icon={SearchXIcon}
          title="We couldn't find that page"
          description="It may not exist, or you might not have access. Check the link, or ask a workspace admin to invite you."
          action={
            <Button asChild>
              <Link href="/">Go to my workspace</Link>
            </Button>
          }
        />
      </div>
    </div>
  );
}
