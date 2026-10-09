"use client";

import { emailSchema } from "@timekeep/core";
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
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { authClient, authErrorMessage } from "@/lib/auth-client";

const schema = z.object({ email: emailSchema });
type Values = z.infer<typeof schema>;

export function ForgotPasswordForm() {
  const router = useRouter();
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: "" } });

  async function onSubmit({ email }: Values) {
    const { error } = await authClient.requestPasswordReset({
      email,
      redirectTo: "/reset-password",
    });
    if (error) {
      form.setError("email", { message: authErrorMessage(error) });
      return;
    }
    router.push(`/check-email?type=reset&email=${encodeURIComponent(email)}`);
  }

  return (
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
            </FormItem>
          )}
        />
        <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? <Loader2Icon className="animate-spin" /> : null}
          Send reset link
        </Button>
      </form>
    </Form>
  );
}
