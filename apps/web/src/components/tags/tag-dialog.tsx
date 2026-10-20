"use client";

import { pickColor, type TagInput, tagInputSchema } from "@timekeep/core";
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
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2Icon, PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { ColorPalette } from "@/components/projects/color-palette";
import type { TagDTO } from "@/lib/catalog-types";
import { createTagAction, updateTagAction } from "@/server/actions/tags";

type FormValues = z.input<typeof tagInputSchema>;

/** Create (no `tag`) or rename and recolour a tag. */
export function TagDialog({
  slug,
  tag,
  open,
  onOpenChange,
}: {
  slug: string;
  tag?: TagDTO;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const form = useForm<FormValues, unknown, TagInput>({
    resolver: zodResolver(tagInputSchema),
    defaultValues: { name: tag?.name ?? "", color: tag?.color },
  });
  const name = useWatch({ control: form.control, name: "name" }) ?? "";
  const color = useWatch({ control: form.control, name: "color" });
  const [colorPicked, setColorPicked] = useState(Boolean(tag));
  const effectiveColor = colorPicked ? (color ?? pickColor(name)) : pickColor(name);

  async function onSubmit(values: TagInput) {
    const payload = { ...values, color: effectiveColor };
    const result = tag
      ? await updateTagAction(slug, tag.id, payload)
      : await createTagAction(slug, payload);
    if (!result.ok) {
      if (/already exists/.test(result.error)) form.setError("name", { message: result.error });
      else toast.error(result.error);
      return;
    }
    toast.success(tag ? "Tag updated" : `Tag "${values.name}" created`);
    onOpenChange(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{tag ? "Rename tag" : "New tag"}</DialogTitle>
          <DialogDescription>
            {tag
              ? "Entries that carry it show the new name."
              : "Tags label entries across projects."}
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
            <FormItem>
              <FormLabel>Colour</FormLabel>
              <ColorPalette
                value={effectiveColor}
                onChange={(c) => {
                  setColorPicked(true);
                  form.setValue("color", c, { shouldDirty: true });
                }}
              />
            </FormItem>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? <Loader2Icon className="animate-spin" /> : null}
                {tag ? "Save changes" : "Create tag"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export function NewTagButton({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <PlusIcon /> New tag
      </Button>
      {open ? <TagDialog slug={slug} open={open} onOpenChange={setOpen} /> : null}
    </>
  );
}
