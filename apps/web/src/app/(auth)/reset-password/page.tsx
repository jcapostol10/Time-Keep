import type { Metadata } from "next";
import Link from "next/link";

import { AuthCard } from "@/components/auth/auth-card";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export const metadata: Metadata = { title: "Reset password" };

export default async function ResetPasswordPage({ searchParams }: PageProps<"/reset-password">) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : "";
  const error = typeof params.error === "string" ? params.error : "";

  if (!token || error) {
    return (
      <AuthCard
        title="This link is not valid"
        description="Password reset links expire after one hour and can only be used once."
        footer={
          <Link href="/forgot-password" className="text-foreground underline underline-offset-4">
            Request a new link
          </Link>
        }
      >
        <p className="text-muted-foreground text-sm">
          Ask for a fresh link and try again. If the problem persists, contact your workspace admin.
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Choose a new password" description="Use at least 8 characters.">
      <ResetPasswordForm token={token} />
    </AuthCard>
  );
}
