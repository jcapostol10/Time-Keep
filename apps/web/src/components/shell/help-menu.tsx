"use client";

import { Button } from "@timekeep/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@timekeep/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@timekeep/ui/components/dropdown-menu";
import { BookOpenIcon, CircleHelpIcon, KeyboardIcon, MessageSquareIcon } from "lucide-react";
import { useState } from "react";

const SHORTCUTS = [
  { keys: "S", action: "Start or stop the timer" },
  { keys: "N", action: "Focus the description of a new entry" },
  { keys: "Esc", action: "Leave the current field" },
] as const;

export function HelpMenu() {
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Help">
            <CircleHelpIcon className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="text-muted-foreground text-xs">Help</DropdownMenuLabel>
          <DropdownMenuItem asChild>
            <a
              href="https://github.com/jcapostol10/Time-Keep#readme"
              target="_blank"
              rel="noreferrer"
            >
              <BookOpenIcon /> Documentation
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setShortcutsOpen(true)}>
            <KeyboardIcon /> Keyboard shortcuts
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <a
              href="https://github.com/jcapostol10/Time-Keep/issues"
              target="_blank"
              rel="noreferrer"
            >
              <MessageSquareIcon /> Send feedback
            </a>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
            <DialogDescription>Work anywhere in a workspace, except while typing.</DialogDescription>
          </DialogHeader>
          <dl className="space-y-2 text-sm">
            {SHORTCUTS.map((s) => (
              <div key={s.keys} className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">{s.action}</dt>
                <dd>
                  <kbd className="bg-muted rounded border px-1.5 py-0.5 font-mono text-xs">
                    {s.keys}
                  </kbd>
                </dd>
              </div>
            ))}
          </dl>
        </DialogContent>
      </Dialog>
    </>
  );
}
