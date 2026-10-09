"use client";

import { signInSchema, type SignInInput } from "@timekeep/core";
import { Button } from "@timekeep/ui/components/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@timekeep/ui/components/form";
import { Input } from "@timekeep/ui/components/input";
import { Separator } from "@timekeep/ui/components/separator";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2Icon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { authClient, authErrorMessage } from "@/lib/auth-client";

import { GoogleButton } from "./google-button";

export function SignInForm({ googleEnabled, next }: { googleEnabled: boolean; next: string }) {
  const router = useRouter();
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);
  const [magicLoading, setMagicLoading] = useState(false);

  const form = useForm<SignInInput>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: "", password: "" },
  });

  async function onSubmit(values: SignInInput) {
    setUnverifiedEmail(null);
    const { error } = await authClient.signIn.email({ ...values, callbackURL: next });
    if (error) {
      if (error.status === 403) {
        setUnverifiedEmail(values.email);
        form.setError("email", { message: "Please verify your email address first." });
        return;
      }
      form.setError("password", { message: authErrorMessage(error) });
      return;
    }
    router.push(next);
    router.refresh();
  }

  async function resendVerification() {
    if (!unverifiedEmail) return;
    const { error } = await authClient.sendVerificationEmail({
      email: unverifiedEmail,
      callbackURL: next,
    });
    if (error) toast.error(authErrorMessage(error));
    else toast.success("Verification email sent. Check your inbox.");
  }

  async function sendMagicLink() {
    const email = form.getValues("email").trim().toLowerCase();
    const parsed = signInSchema.shape.email.safeParse(email);
    if (!parsed.success) {
      form.setError("email", { message: "Enter your email to receive a sign-in link." });
      return;
    }
    setMagicLoading(true);
    const { error } = await authClient.signIn.magicLink({ email: parsed.data, callbackURL: next });
    setMagicLoading(false);
    if (error) {
      toast.error(authErrorMessage(error));
      return;
    }
    router.push(`/check-email?type=magic&email=${encodeURIComponent(parsed.data)}`);
  }

  const { isSubmitting } = form.formState;

  return (
    <div className="space-y-4">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <Input type="email" autoComplete="email" placeholder="you@company.com" {...field} />
                </FormControl>
                <FormMessage />
                {unverifiedEmail ? (
                  <Button type="button" variant="link" className="h-auto p-0" onClick={resendVerification}>
                    Resend verification email
                  </Button>
                ) : null}
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <div className="flex items-center justify-between">
                  <FormLabel>Password</FormLabel>
                  <Link href="/forgot-password" className="text-xs text-muted-foreground hover:text-foreground">
                    Forgot password?
                  </Link>
                </div>
                <FormControl>
                  <Input type="password" autoComplete="current-password" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? <Loader2Icon className="animate-spin" /> : null}
            Sign in
          </Button>
        </form>
      </Form>

      <div className="relative">
        <Separator />
        <span className="absolute inset-x-0 -top-2.5 mx-auto w-fit bg-card px-2 text-xs text-muted-foreground">
          or
        </span>
      </div>

      <div className="space-y-2">
        <Button type="button" variant="outline" className="w-full" onClick={sendMagicLink} disabled={magicLoading}>
          {magicLoading ? <Loader2Icon className="animate-spin" /> : null}
          Email me a sign-in link
        </Button>
        {googleEnabled ? <GoogleButton callbackURL={next} /> : null}
      </div>
    </div>
  );
}
