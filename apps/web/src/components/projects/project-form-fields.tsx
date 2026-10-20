"use client";

import type { ProjectInput, projectInputSchema } from "@timekeep/core";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@timekeep/ui/components/form";
import { Input } from "@timekeep/ui/components/input";
import { RadioGroup, RadioGroupItem } from "@timekeep/ui/components/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@timekeep/ui/components/select";
import { Switch } from "@timekeep/ui/components/switch";
import { Textarea } from "@timekeep/ui/components/textarea";
import type { UseFormReturn } from "react-hook-form";
import type { z } from "zod";

import { ColorPalette } from "./color-palette";
import type { ClientOption } from "./projects-toolbar";

const NO_CLIENT = "__none__";

export type ProjectFormValues = z.input<typeof projectInputSchema>;

/** The project fields shared by the create/edit dialog and the Settings tab. */
export function ProjectFormFields({
  form,
  clients,
  color,
  onColorChange,
}: {
  form: UseFormReturn<ProjectFormValues, unknown, ProjectInput>;
  clients: ClientOption[];
  color: string;
  onColorChange: (color: string) => void;
}) {
  return (
    <>
      <FormField
        control={form.control}
        name="name"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Name</FormLabel>
            <FormControl>
              <Input {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="clientId"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Client</FormLabel>
            <Select
              value={field.value ?? NO_CLIENT}
              onValueChange={(v) => field.onChange(v === NO_CLIENT ? null : v)}
            >
              <FormControl>
                <SelectTrigger className="w-full" aria-label="Client">
                  <SelectValue />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                <SelectItem value={NO_CLIENT}>No client</SelectItem>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormItem>
        <FormLabel>Colour</FormLabel>
        <ColorPalette value={color} onChange={onColorChange} />
      </FormItem>
      <FormField
        control={form.control}
        name="billable"
        render={({ field }) => (
          <FormItem className="flex items-center justify-between rounded-md border px-3 py-2">
            <div>
              <FormLabel>Billable by default</FormLabel>
              <p className="text-muted-foreground text-xs">
                New entries on this project start billable.
              </p>
            </div>
            <FormControl>
              <Switch
                aria-label="Billable by default"
                checked={field.value ?? true}
                onCheckedChange={field.onChange}
              />
            </FormControl>
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="visibility"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Visibility</FormLabel>
            <FormControl>
              <RadioGroup
                aria-label="Visibility"
                value={field.value ?? "PUBLIC"}
                onValueChange={field.onChange}
                className="gap-2"
              >
                <label className="flex items-start gap-3 rounded-md border px-3 py-2">
                  <RadioGroupItem value="PUBLIC" aria-label="Public" className="mt-0.5" />
                  <span>
                    <span className="block text-sm font-medium">Public</span>
                    <span className="text-muted-foreground block text-xs">
                      Every member can see it and track time on it.
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-3 rounded-md border px-3 py-2">
                  <RadioGroupItem value="PRIVATE" aria-label="Private" className="mt-0.5" />
                  <span>
                    <span className="block text-sm font-medium">Private</span>
                    <span className="text-muted-foreground block text-xs">
                      Only admins and the people on its Access tab.
                    </span>
                  </span>
                </label>
              </RadioGroup>
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="note"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Note</FormLabel>
            <FormControl>
              <Textarea rows={2} {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </>
  );
}
