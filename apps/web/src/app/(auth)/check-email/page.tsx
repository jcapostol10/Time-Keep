import { MailCheckIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { AuthCard } from "@/components/auth/auth-card";
import { ResendVerification } from "@/components/auth/resend-verification";

export const metadata: Metadata = { title: "Check your email" };

const COPY = {
  verify: {
    title: "Verify your email",
    body: "We sent a verification link to",
    hint: "Open it to activate your account. The link expires in 1 hour.",
  },
  magic: {
    title: "Check your inbox",
    body: "We sent a sign-in link to",
    hint: "Open it on this device to sign in. The link expires in 15 minutes.",
  },
  reset: {
    title: "Check your inbox",
    body: "If an account exists, we sent a password reset link to",
    hint: "The link expires in 1 hour.",
  },
} as const;

export default async function CheckEmailPage({ searchParams }: PageProps<"/check-email">) {
  const params = await searchParams;
  const type = (
    typeof params.type === "string" && params.type in COPY ? params.type : "verify"
  ) as keyof typeof COPY;
  const email = typeof params.email === "string" ? params.email : "";
  const copy = COPY[type];

  return (
    <AuthCard
      title={copy.title}
      footer={
        <Link href="/sign-in" className="text-foreground underline underline-offset-4">
          Back to sign in
        </Link>
      }
    >
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="bg-accent text-accent-foreground flex size-12 items-center justify-center rounded-full">
          <MailCheckIcon className="size-6" />
        </span>
        <p className="text-sm">
          {copy.body}{" "}
          {email ? <strong className="font-medium">{email}</strong> : "your email address"}.
        </p>
        <p className="text-muted-foreground text-sm">{copy.hint}</p>
        {type === "verify" && email ? <ResendVerification email={email} /> : null}
        {process.env.NODE_ENV !== "production" ? (
          <p className="text-muted-foreground text-xs">
            Local dev: emails land in{" "}
            <a href="http://localhost:8025" target="_blank" rel="noreferrer" className="underline">
              Mailpit
            </a>
            .
          </p>
        ) : null}
      </div>
    </AuthCard>
  );
}
