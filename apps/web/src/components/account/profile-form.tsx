"use client";

import {
  DATE_FORMATS,
  TIME_FORMATS,
  updateProfileSchema,
  type UpdateProfileInput,
  WEEK_START_DAYS,
  WEEKDAY_LABELS,
} from "@timekeep/core";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@timekeep/ui/components/select";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { TimezoneSelect } from "@/components/settings/timezone-select";
import { updateProfileAction } from "@/server/actions/profile";

const INHERIT = "__inherit__";

export function ProfileForm({
  email,
  defaultValues,
}: {
  email: string;
  defaultValues: UpdateProfileInput;
}) {
  const router = useRouter();
  const form = useForm<UpdateProfileInput>({
    resolver: zodResolver(updateProfileSchema),
    defaultValues,
  });

  async function onSubmit(values: UpdateProfileInput) {
    const result = await updateProfileAction(values);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Profile saved");
    form.reset(values);
    router.refresh();
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="max-w-xl space-y-6" noValidate>
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Full name</FormLabel>
              <FormControl>
                <Input autoComplete="name" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormItem>
          <FormLabel>Email</FormLabel>
          <Input value={email} readOnly disabled />
          <FormDescription>Changing your email is coming in a later phase.</FormDescription>
        </FormItem>

        <FormField
          control={form.control}
          name="timezone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Timezone</FormLabel>
              <TimezoneSelect value={field.value} onChange={field.onChange} allowInherit />
              <FormDescription>
                All times are stored in UTC and shown in this timezone.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid gap-6 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="dateFormat"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Date format</FormLabel>
                <Select
                  value={field.value ?? INHERIT}
                  onValueChange={(v) => field.onChange(v === INHERIT ? null : v)}
                >
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value={INHERIT}>Use workspace default</SelectItem>
                    {DATE_FORMATS.map((f) => (
                      <SelectItem key={f} value={f}>
                        {f}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="timeFormat"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Time format</FormLabel>
                <Select
                  value={field.value ?? INHERIT}
                  onValueChange={(v) => field.onChange(v === INHERIT ? null : v)}
                >
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value={INHERIT}>Use workspace default</SelectItem>
                    {TIME_FORMATS.map((f) => (
                      <SelectItem key={f} value={f}>
                        {f === "12h" ? "12-hour (2:30 PM)" : "24-hour (14:30)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="weekStart"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Week starts on</FormLabel>
                <Select
                  value={field.value === null ? INHERIT : String(field.value)}
                  onValueChange={(v) => field.onChange(v === INHERIT ? null : Number(v))}
                >
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value={INHERIT}>Use workspace default</SelectItem>
                    {WEEK_START_DAYS.map((d) => (
                      <SelectItem key={d} value={String(d)}>
                        {WEEKDAY_LABELS[d]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <Button type="submit" disabled={form.formState.isSubmitting || !form.formState.isDirty}>
          {form.formState.isSubmitting ? <Loader2Icon className="animate-spin" /> : null}
          Save changes
        </Button>
      </form>
    </Form>
  );
}
