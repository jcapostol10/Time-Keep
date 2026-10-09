import type { Metadata } from "next";
import Link from "next/link";

import { AuthCard } from "@/components/auth/auth-card";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { CreateWorkspaceForm } from "@/components/workspaces/create-workspace-form";
import { requireSession } from "@/server/session";

export const metadata: Metadata = { title: "New workspace" };

export default async function NewWorkspacePage() {
  await requireSession("/workspaces/new");

  return (
    <div className="flex min-h-svh flex-col bg-muted/40">
      <header className="flex items-center justify-between px-4 py-4 sm:px-8">
        <Link href="/" aria-label="TimeKeep home">
          <Logo />
        </Link>
        <ThemeToggle />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pb-12">
        <div className="w-full max-w-sm">
          <AuthCard
            title="Create a workspace"
            description="A workspace holds your team, projects and time. You can belong to several."
            footer={
              <Link href="/" className="text-foreground underline underline-offset-4">
                Back to my workspace
              </Link>
            }
          >
            <CreateWorkspaceForm />
          </AuthCard>
        </div>
      </main>
    </div>
  );
}
