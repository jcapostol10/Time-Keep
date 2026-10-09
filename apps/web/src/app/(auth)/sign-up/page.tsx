import type { Metadata } from "next";
import Link from "next/link";

import { AuthCard } from "@/components/auth/auth-card";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { safeNextPath } from "@/lib/routes";
import { isGoogleAuthEnabled } from "@/server/env";

export const metadata: Metadata = { title: "Create account" };

export default async function SignUpPage({ searchParams }: PageProps<"/sign-up">) {
  const params = await searchParams;
  const next = safeNextPath(params.next);

  return (
    <AuthCard
      title="Create your account"
      description="Start tracking time in under a minute."
      footer={
        <span>
          Already have an account?{" "}
          <Link
            href={next === "/" ? "/sign-in" : `/sign-in?next=${encodeURIComponent(next)}`}
            className="text-foreground underline underline-offset-4"
          >
            Sign in
          </Link>
        </span>
      }
    >
      <SignUpForm googleEnabled={isGoogleAuthEnabled()} next={next} />
    </AuthCard>
  );
}
