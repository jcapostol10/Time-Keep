"use client";

import { Button } from "@timekeep/ui/components/button";
import { Label } from "@timekeep/ui/components/label";
import { FileTextIcon } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";

import { type PreparedReceipt, prepareReceipt } from "./receipt-image";

/**
 * The receipt field of the expense dialog: a file input, a preview of the
 * chosen image (or a file icon for a PDF), and Remove. An existing receipt
 * shows until it is replaced or removed.
 */
export function ReceiptInput({
  value,
  onChange,
  existing,
  onRemoveExisting,
  disabled,
}: {
  value: PreparedReceipt | null;
  onChange: (receipt: PreparedReceipt | null) => void;
  /** The saved receipt's thumbnail URL (null for a PDF) and whether one exists. */
  existing: { thumbUrl: string | null; isPdf: boolean } | null;
  onRemoveExisting?: () => void;
  disabled?: boolean;
}) {
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  // A blob URL for the chosen thumbnail, released when it changes or the field unmounts.
  const preview = useMemo(() => (value?.thumb ? URL.createObjectURL(value.thumb) : null), [value]);
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  async function pick(file: File | undefined) {
    setError(null);
    if (!file) return;
    try {
      onChange(await prepareReceipt(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : "This file cannot be used.");
      onChange(null);
    }
  }

  const shown = value ? { thumbUrl: preview, isPdf: value.mime === "application/pdf" } : existing;

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Receipt</Label>
      <div className="flex flex-wrap items-center gap-3">
        {shown ? (
          shown.isPdf || !shown.thumbUrl ? (
            <span className="bg-muted text-muted-foreground flex size-16 items-center justify-center rounded-md">
              <FileTextIcon aria-label="PDF receipt" />
            </span>
          ) : (
            // A preview from a blob or a presigned URL: no Next image loader applies.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={shown.thumbUrl}
              alt="Receipt preview"
              className="size-16 rounded-md object-cover"
            />
          )
        ) : null}
        <input
          id={id}
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          disabled={disabled}
          className="text-sm file:mr-3 file:rounded-md file:border file:px-3 file:py-1.5 file:text-sm"
          onChange={(e) => void pick(e.target.files?.[0])}
        />
        {shown ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={() => {
              if (value) onChange(null);
              else onRemoveExisting?.();
            }}
          >
            Remove
          </Button>
        ) : null}
      </div>
      <p className="text-muted-foreground text-xs">JPEG, PNG, WebP or PDF, up to 4 MB.</p>
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
    </div>
  );
}
