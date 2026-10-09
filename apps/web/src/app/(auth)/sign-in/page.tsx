import type { Metadata } from "next";
import Link from "next/link";

import { AuthCard } from "@/components/auth/auth-card";
import { SignInForm } from "@/components/auth/sign-in-form";
import { safeNextPath } from "@/lib/routes";
import { isGoogleAuthEnabled } from "@/server/env";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const params = await searchParams;
  const next = safeNextPath(params.next);

  return (
    <AuthCard
      title="Welcome back"
      description="Sign in to your TimeKeep account."
      footer={
        <span>
          New here?{" "}
          <Link
            href={next === "/" ? "/sign-up" : `/sign-up?next=${encodeURIComponent(next)}`}
            className="text-foreground underline underline-offset-4"
          >
            Create an account
          </Link>
        </span>
      }
    >
      <SignInForm googleEnabled={isGoogleAuthEnabled()} next={next} />
    </AuthCard>
  );
}
