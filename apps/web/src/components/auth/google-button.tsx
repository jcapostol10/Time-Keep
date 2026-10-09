"use client";

import { Button } from "@timekeep/ui/components/button";
import { useState } from "react";
import { toast } from "sonner";

import { authClient, authErrorMessage } from "@/lib/auth-client";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path
        fill="#EA4335"
        d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.8-5.5 3.8-3.3 0-6-2.7-6-6s2.7-6 6-6c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.3 14.6 2.3 12 2.3 6.6 2.3 2.3 6.6 2.3 12s4.3 9.7 9.7 9.7c5.6 0 9.3-3.9 9.3-9.5 0-.6-.1-1.1-.2-1.6H12z"
      />
    </svg>
  );
}

export function GoogleButton({ callbackURL = "/" }: { callbackURL?: string }) {
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    const { error } = await authClient.signIn.social({ provider: "google", callbackURL });
    if (error) {
      toast.error(authErrorMessage(error));
      setLoading(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      className="w-full"
      onClick={handleClick}
      disabled={loading}
    >
      <GoogleIcon />
      Continue with Google
    </Button>
  );
}
