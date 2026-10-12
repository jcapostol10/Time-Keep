import { Button } from "@timekeep/ui/components/button";
import { ShieldAlertIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { AuthCard } from "@/components/auth/auth-card";

export const metadata: Metadata = { title: "Sign-in problem" };

/**
 * Better Auth redirects here (`onAPIError.errorURL`) with `?error=<code>`
 * when an OAuth or verification flow fails. Codes come from Better Auth.
 */
const MESSAGES: Record<string, { title: string; body: string }> = {
  state_mismatch: {
    title: "That sign-in attempt expired",
    body: "The sign-in with Google took too long, or it was started from a different address or browser tab than it came back to. Start again from this page and finish within a few minutes.",
  },
  access_denied: {
    title: "Google sign-in was cancelled",
    body: "You declined the Google consent screen, so no account was linked. You can try again whenever you like.",
  },
  invalid_code: {
    title: "Google rejected the sign-in code",
    body: "The one-time code from Google could not be exchanged. This usually means the link was reused; please start the sign-in again.",
  },
  email_not_verified: {
    title: "Verify your email first",
    body: "This account's email address has not been verified yet. Check your inbox for the verification link, then sign in.",
  },
  unable_to_create_user: {
    title: "We couldn't create your account",
    body: "Google did not return an email address we could use. Try a different Google account or sign up with email and password.",
  },
  signup_disabled: {
    title: "Sign-ups are disabled",
    body: "New accounts cannot be created right now. Ask a workspace admin for an invitation.",
  },
  please_restart_the_process: {
    title: "Please start again",
    body: "Something went out of order during sign-in. Begin again from the sign-in page.",
  },
};

const FALLBACK = {
  title: "Sign-in didn't complete",
  body: "Something went wrong while signing you in. Please try again; if it keeps happening, contact your workspace admin.",
};

export default async function AuthErrorPage({ searchParams }: PageProps<"/auth-error">) {
  const params = await searchParams;
  const code = typeof params.error === "string" ? params.error : "";
  const message = MESSAGES[code] ?? FALLBACK;

  return (
    <AuthCard
      title={message.title}
      footer={code ? <span className="font-mono text-xs">error: {code}</span> : null}
    >
      <div className="flex flex-col items-center gap-4 text-center">
        <span className="bg-destructive/10 text-destructive flex size-12 items-center justify-center rounded-full">
          <ShieldAlertIcon className="size-6" />
        </span>
        <p className="text-muted-foreground text-sm">{message.body}</p>
        <Button asChild className="w-full">
          <Link href="/sign-in">Back to sign in</Link>
        </Button>
      </div>
    </AuthCard>
  );
}
