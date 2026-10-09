import { ROLE_LABELS, type Role } from "@timekeep/core";
import { APIError } from "better-auth/api";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthCard } from "@/components/auth/auth-card";
import { AcceptInviteButtons } from "@/components/workspaces/accept-invite-buttons";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { getAuth } from "@/server/auth";
import { getSession } from "@/server/session";

export const metadata: Metadata = { title: "Invitation" };

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-muted/40 flex min-h-svh flex-col">
      <header className="flex items-center justify-between px-4 py-4 sm:px-8">
        <Link href="/" aria-label="TimeKeep home">
          <Logo />
        </Link>
        <ThemeToggle />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pb-12">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}

export default async function InvitePage({ params }: PageProps<"/invite/[id]">) {
  const { id } = await params;
  const session = await getSession();
  if (!session) {
    redirect(`/sign-in?next=${encodeURIComponent(`/invite/${id}`)}`);
  }

  let invite: Awaited<ReturnType<ReturnType<typeof getAuth>["api"]["getInvitation"]>> | null = null;
  let problem: string | null = null;
  try {
    invite = await getAuth().api.getInvitation({ headers: await headers(), query: { id } });
  } catch (error) {
    problem = error instanceof APIError ? error.message : "This invitation is not valid.";
  }

  if (!invite || problem) {
    return (
      <Frame>
        <AuthCard
          title="Invitation unavailable"
          description={problem ?? "This invitation is not valid."}
          footer={
            <Link href="/" className="text-foreground underline underline-offset-4">
              Go to my workspace
            </Link>
          }
        >
          <p className="text-muted-foreground text-sm">
            You are signed in as <strong>{session.user.email}</strong>. Invitations can only be
            accepted by the email address they were sent to.
          </p>
        </AuthCard>
      </Frame>
    );
  }

  const roleLabel = ROLE_LABELS[invite.role as Role] ?? invite.role;

  return (
    <Frame>
      <AuthCard
        title={`Join ${invite.organizationName}`}
        description={`${invite.inviterEmail} invited you to join as ${roleLabel}.`}
      >
        <AcceptInviteButtons invitationId={invite.id} slug={invite.organizationSlug} />
      </AuthCard>
    </Frame>
  );
}
