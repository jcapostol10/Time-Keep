"use client";

import { AVATAR_MAX_BYTES, AVATAR_MIME_TYPES } from "@timekeep/core";
import { Avatar, AvatarFallback, AvatarImage } from "@timekeep/ui/components/avatar";
import { Button } from "@timekeep/ui/components/button";
import { Loader2Icon, Trash2Icon, UploadIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { initials } from "@/components/shell/user-menu";
import { removeAvatarAction, uploadAvatarAction } from "@/server/actions/profile";

export function AvatarUploader({ name, image }: { name: string; image: string | null }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(image);
  const [busy, setBusy] = useState(false);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    if (file.size > AVATAR_MAX_BYTES) {
      toast.error("Images must be 2 MB or smaller.");
      return;
    }
    setBusy(true);
    const formData = new FormData();
    formData.set("avatar", file);
    const result = await uploadAvatarAction(formData);
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setPreview(result.data.url);
    toast.success("Photo updated");
    router.refresh();
  }

  async function handleRemove() {
    setBusy(true);
    const result = await removeAvatarAction();
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setPreview(null);
    toast.success("Photo removed");
    router.refresh();
  }

  return (
    <div className="flex items-center gap-5">
      <Avatar className="size-20 text-xl">
        {preview ? <AvatarImage src={preview} alt="" /> : null}
        <AvatarFallback>{initials(name)}</AvatarFallback>
      </Avatar>
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? <Loader2Icon className="animate-spin" /> : <UploadIcon />}
            Upload photo
          </Button>
          {preview ? (
            <Button type="button" variant="ghost" disabled={busy} onClick={handleRemove}>
              <Trash2Icon /> Remove
            </Button>
          ) : null}
        </div>
        <p className="text-muted-foreground text-xs">PNG, JPEG, WebP or GIF up to 2 MB.</p>
        <input
          ref={inputRef}
          type="file"
          accept={AVATAR_MIME_TYPES.join(",")}
          className="sr-only"
          aria-label="Choose a profile photo"
          onChange={(e) => {
            void handleFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}
