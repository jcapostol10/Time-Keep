"use client";

import { Button } from "@timekeep/ui/components/button";
import { Loader2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { authClient, authErrorMessage } from "@/lib/auth-client";
import { workspaceRoutes } from "@/lib/routes";

export function AcceptInviteButtons({ invitationId, slug }: { invitationId: string; slug: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"accept" | "reject" | null>(null);

  async function accept() {
    setBusy("accept");
    const { error } = await authClient.organization.acceptInvitation({ invitationId });
    if (error) {
      toast.error(authErrorMessage(error));
      setBusy(null);
      return;
    }
    toast.success("Welcome aboard!");
    router.push(slug ? workspaceRoutes.tracker(slug) : "/");
    router.refresh();
  }

  async function reject() {
    setBusy("reject");
    const { error } = await authClient.organization.rejectInvitation({ invitationId });
    if (error) {
      toast.error(authErrorMessage(error));
      setBusy(null);
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      <Button onClick={accept} disabled={busy !== null}>
        {busy === "accept" ? <Loader2Icon className="animate-spin" /> : null}
        Accept invitation
      </Button>
      <Button variant="outline" onClick={reject} disabled={busy !== null}>
        {busy === "reject" ? <Loader2Icon className="animate-spin" /> : null}
        Decline
      </Button>
    </div>
  );
}
