"use client";

import { signUpSchema, type SignUpInput } from "@timekeep/core";
import { Button } from "@timekeep/ui/components/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@timekeep/ui/components/form";
import { Input } from "@timekeep/ui/components/input";
import { Separator } from "@timekeep/ui/components/separator";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";

import { authClient, authErrorMessage } from "@/lib/auth-client";

import { GoogleButton } from "./google-button";

export function SignUpForm({ googleEnabled, next }: { googleEnabled: boolean; next: string }) {
  const router = useRouter();
  const form = useForm<SignUpInput>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { name: "", email: "", password: "" },
  });

  async function onSubmit(values: SignUpInput) {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const { error } = await authClient.signUp.email({
      ...values,
      timezone,
      callbackURL: next,
    });
    if (error) {
      const field = error.code === "USER_ALREADY_EXISTS" ? "email" : "password";
      form.setError(field, { message: authErrorMessage(error) });
      return;
    }
    router.push(`/check-email?type=verify&email=${encodeURIComponent(values.email)}`);
  }

  const { isSubmitting } = form.formState;

  return (
    <div className="space-y-4">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Full name</FormLabel>
                <FormControl>
                  <Input autoComplete="name" placeholder="Ada Lovelace" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
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
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Password</FormLabel>
                <FormControl>
                  <Input type="password" autoComplete="new-password" {...field} />
                </FormControl>
                <FormDescription>At least 8 characters.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? <Loader2Icon className="animate-spin" /> : null}
            Create account
          </Button>
        </form>
      </Form>

      {googleEnabled ? (
        <>
          <div className="relative">
            <Separator />
            <span className="absolute inset-x-0 -top-2.5 mx-auto w-fit bg-card px-2 text-xs text-muted-foreground">
              or
            </span>
          </div>
          <GoogleButton callbackURL={next} />
        </>
      ) : null}
    </div>
  );
}
