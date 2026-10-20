"use client";

import { Button } from "@timekeep/ui/components/button";
import { cn } from "@timekeep/ui/lib/utils";
import { StarIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";

import { setFavoriteAction } from "@/server/actions/projects";

/** Star toggle; the state flips at once and reverts if the save fails. */
export function FavoriteButton({
  slug,
  projectId,
  name,
  favorite,
}: {
  slug: string;
  projectId: string;
  name: string;
  favorite: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [shown, setShown] = useOptimistic(favorite);

  function toggle() {
    const next = !shown;
    startTransition(async () => {
      setShown(next);
      const result = await setFavoriteAction(slug, projectId, next);
      if (!result.ok) toast.error(result.error);
      router.refresh();
    });
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-pressed={shown}
      aria-label={shown ? `Unfavourite ${name}` : `Favourite ${name}`}
      disabled={pending}
      onClick={toggle}
      className="size-8"
    >
      <StarIcon className={cn("size-4", shown && "fill-amber-400 text-amber-400")} />
    </Button>
  );
}
