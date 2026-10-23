"use client";

import { Button } from "@timekeep/ui/components/button";
import { useTransition } from "react";
import { toast } from "sonner";

import { authClient, authErrorMessage } from "@/lib/auth-client";

/**
 * Nothing arrived? Resending from here reports a refused send, which sign-up
 * itself cannot (Better Auth sends that first message in the background).
 */
export function ResendVerification({ email }: { email: string }) {
  const [pending, startTransition] = useTransition();

  function resend() {
    startTransition(async () => {
      const { error } = await authClient.sendVerificationEmail({ email, callbackURL: "/" });
      if (error) toast.error(authErrorMessage(error));
      else toast.success("Verification email sent again");
    });
  }

  return (
    <Button type="button" variant="outline" size="sm" disabled={pending} onClick={resend}>
      Resend verification email
    </Button>
  );
}
