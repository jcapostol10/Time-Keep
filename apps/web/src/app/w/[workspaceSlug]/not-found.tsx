import { Button } from "@timekeep/ui/components/button";
import { SearchXIcon } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/empty-state";

export default function WorkspaceNotFound() {
  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <div className="w-full max-w-md">
        <EmptyState
          icon={SearchXIcon}
          title="We couldn't find that workspace"
          description="It may not exist, or you might not be a member. Check the link or ask an admin to invite you."
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
