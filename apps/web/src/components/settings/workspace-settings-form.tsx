"use client";

import {
  DURATION_FORMATS,
  TIME_FORMATS,
  WEEK_START_DAYS,
  WEEKDAY_LABELS,
  workspaceNameSchema,
  workspaceSettingsSchema,
} from "@timekeep/core";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@timekeep/ui/components/alert-dialog";
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
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { type z } from "zod";

import { TimezoneSelect } from "@/components/settings/timezone-select";
import { updateWorkspaceSettingsAction } from "@/server/actions/workspaces";

const schema = workspaceSettingsSchema.extend({ name: workspaceNameSchema });
type Values = z.infer<typeof schema>;

const DURATION_LABELS: Record<(typeof DURATION_FORMATS)[number], string> = {
  "hh:mm:ss": "Full (1:30:00)",
  "hh:mm": "Compact (1:30)",
  decimal: "Decimal (1.50)",
};

export function WorkspaceSettingsForm({
  slug,
  defaultValues,
  readOnly,
}: {
  slug: string;
  defaultValues: Values;
  readOnly: boolean;
}) {
  const router = useRouter();
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues });

  // A new currency relabels existing rates (decision 4): the server asks first.
  const [confirmCurrency, setConfirmCurrency] = useState<{
    values: Values;
    message: string;
  } | null>(null);

  async function onSubmit(values: Values, confirmCurrencyChange = false) {
    const result = await updateWorkspaceSettingsAction(slug, { ...values, confirmCurrencyChange });
    if (!result.ok) {
      const currency = result.fieldErrors?.currency?.[0];
      if (currency && !confirmCurrencyChange) setConfirmCurrency({ values, message: currency });
      else toast.error(result.error);
      return;
    }
    toast.success("Workspace settings saved");
    form.reset(values);
    router.refresh();
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((values) => onSubmit(values))}
        className="max-w-xl space-y-6"
        noValidate
      >
        <fieldset disabled={readOnly} className="space-y-6">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Workspace name</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="timezone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Timezone</FormLabel>
                <TimezoneSelect value={field.value} onChange={field.onChange} />
                <FormDescription>Default for members who have not set their own.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="grid gap-6 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="weekStart"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Week starts on</FormLabel>
                  <Select
                    value={String(field.value)}
                    onValueChange={(v) => field.onChange(Number(v))}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
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

            <FormField
              control={form.control}
              name="timeFormat"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Time format</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
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
              name="durationFormat"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Duration format</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {DURATION_FORMATS.map((f) => (
                        <SelectItem key={f} value={f}>
                          {DURATION_LABELS[f]}
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
              name="currency"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Currency</FormLabel>
                  <FormControl>
                    <Input
                      maxLength={3}
                      className="uppercase"
                      {...field}
                      onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                    />
                  </FormControl>
                  <FormDescription>ISO 4217 code, e.g. USD or PHP.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </fieldset>

        {readOnly ? (
          <p className="text-muted-foreground text-sm">
            Only admins and the owner can change these settings.
          </p>
        ) : (
          <Button type="submit" disabled={form.formState.isSubmitting || !form.formState.isDirty}>
            {form.formState.isSubmitting ? <Loader2Icon className="animate-spin" /> : null}
            Save changes
          </Button>
        )}
      </form>
      <AlertDialog
        open={confirmCurrency !== null}
        onOpenChange={(open) => (open ? null : setConfirmCurrency(null))}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change the workspace currency?</AlertDialogTitle>
            <AlertDialogDescription>{confirmCurrency?.message}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep {defaultValues.currency}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const pending = confirmCurrency;
                setConfirmCurrency(null);
                if (pending) void onSubmit(pending.values, true);
              }}
            >
              Change currency
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Form>
  );
}
