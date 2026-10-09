"use client";

import { Button } from "@timekeep/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@timekeep/ui/components/dropdown-menu";
import { BookOpenIcon, CircleHelpIcon, KeyboardIcon, MessageSquareIcon } from "lucide-react";

export function HelpMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Help">
          <CircleHelpIcon className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Help</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <a href="https://github.com/jcapostol10/Time-Keep#readme" target="_blank" rel="noreferrer">
            <BookOpenIcon /> Documentation
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem disabled>
          <KeyboardIcon /> Keyboard shortcuts
          <span className="ml-auto text-xs text-muted-foreground">soon</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a href="https://github.com/jcapostol10/Time-Keep/issues" target="_blank" rel="noreferrer">
            <MessageSquareIcon /> Send feedback
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
