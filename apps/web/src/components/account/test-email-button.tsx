"use client";

import { Button } from "@timekeep/ui/components/button";
import { MailIcon } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";

import { sendTestEmailAction } from "@/server/actions/profile";

/** Sends the signed-in person a message, to prove email reaches them. */
export function TestEmailButton({ email }: { email: string }) {
  const [pending, startTransition] = useTransition();

  function send() {
    startTransition(async () => {
      const result = await sendTestEmailAction();
      if (result.ok) toast.success(`Test email sent to ${email}`);
      else toast.error(result.error);
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-sm">
        Check that TimeKeep&apos;s email reaches you at{" "}
        <span className="text-foreground">{email}</span>.
      </p>
      <Button type="button" variant="outline" size="sm" disabled={pending} onClick={send}>
        <MailIcon /> Send me a test email
      </Button>
    </div>
  );
}
