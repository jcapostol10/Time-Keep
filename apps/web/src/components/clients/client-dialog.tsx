"use client";

import { type ClientInput, clientInputSchema, COMMON_CURRENCIES } from "@timekeep/core";
import { Button } from "@timekeep/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@timekeep/ui/components/dialog";
import {
  Form,
  FormControl,
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
import { Textarea } from "@timekeep/ui/components/textarea";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2Icon, PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import type { ClientDTO } from "@/lib/catalog-types";
import { createClientAction, updateClientAction } from "@/server/actions/clients";

const NO_CURRENCY = "__none__";

/** What the fields hold (defaults optional) vs what the schema produces. */
type FormValues = z.input<typeof clientInputSchema>;

/** Create (no `client`) or edit a client. Controlled so the table can open it per row. */
export function ClientDialog({
  slug,
  client,
  open,
  onOpenChange,
}: {
  slug: string;
  client?: ClientDTO;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const form = useForm<FormValues, unknown, ClientInput>({
    resolver: zodResolver(clientInputSchema),
    defaultValues: {
      name: client?.name ?? "",
      address: client?.address ?? "",
      email: client?.email ?? "",
      notes: client?.notes ?? "",
      currency: client?.currency ?? null,
    },
  });

  async function onSubmit(values: ClientInput) {
    const result = client
      ? await updateClientAction(slug, client.id, values)
      : await createClientAction(slug, values);
    if (!result.ok) {
      const nameError = result.fieldErrors?.name?.[0];
      if (nameError) form.setError("name", { message: nameError });
      else if (/already exists/.test(result.error)) form.setError("name", { message: result.error });
      else toast.error(result.error);
      return;
    }
    toast.success(client ? "Client updated" : `Client "${values.name}" created`);
    onOpenChange(false);
    form.reset();
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{client ? "Edit client" : "New client"}</DialogTitle>
          <DialogDescription>
            {client
              ? "Change the client's details. Its projects are not affected."
              : "A client groups projects and, later, receives invoices."}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input autoFocus {...field} />
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
                    <Input type="email" placeholder="billing@company.com" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="address"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Address</FormLabel>
                  <FormControl>
                    <Textarea rows={2} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea rows={3} {...field} />
                  </FormControl>
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
                  <Select
                    value={field.value ?? NO_CURRENCY}
                    onValueChange={(value) => field.onChange(value === NO_CURRENCY ? null : value)}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={NO_CURRENCY}>Workspace default</SelectItem>
                      {COMMON_CURRENCIES.map((c) => (
                        <SelectItem key={c.code} value={c.code}>
                          {c.code} · {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-muted-foreground text-xs">Used for invoicing in a later phase.</p>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? <Loader2Icon className="animate-spin" /> : null}
                {client ? "Save changes" : "Create client"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export function NewClientButton({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <PlusIcon /> New client
      </Button>
      {open ? <ClientDialog slug={slug} open={open} onOpenChange={setOpen} /> : null}
    </>
  );
}
