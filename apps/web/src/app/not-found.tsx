import { Button } from "@timekeep/ui/components/button";
import { SearchXIcon } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/empty-state";

export default function NotFound() {
  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <div className="w-full max-w-md">
        <EmptyState
          icon={SearchXIcon}
          title="Page not found"
          description="The page you are looking for does not exist or has moved."
          action={
            <Button asChild>
              <Link href="/">Back to TimeKeep</Link>
            </Button>
          }
        />
      </div>
    </div>
  );
}
