"use client";

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
import { toast } from "sonner";
import { z } from "zod";

import { authClient, authErrorMessage } from "@/lib/auth-client";

const schema = z
  .object({
    password: z.string().min(8, "At least 8 characters").max(128),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords do not match" });
type Values = z.infer<typeof schema>;

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { password: "", confirm: "" },
  });

  async function onSubmit({ password }: Values) {
    const { error } = await authClient.resetPassword({ newPassword: password, token });
    if (error) {
      form.setError("password", { message: authErrorMessage(error) });
      return;
    }
    toast.success("Password updated. Sign in with your new password.");
    router.push("/sign-in");
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>New password</FormLabel>
              <FormControl>
                <Input type="password" autoComplete="new-password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="confirm"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Confirm password</FormLabel>
              <FormControl>
                <Input type="password" autoComplete="new-password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? <Loader2Icon className="animate-spin" /> : null}
          Update password
        </Button>
      </form>
    </Form>
  );
}
