import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";

import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserMenu } from "@/components/shell/user-menu";
import { requireSession } from "@/server/session";

export default async function AccountLayout({ children }: LayoutProps<"/account">) {
  const session = await requireSession("/account");

  return (
    <div className="flex min-h-svh flex-col">
      <header className="bg-background/95 sticky top-0 z-30 flex h-14 items-center gap-3 border-b px-4 backdrop-blur sm:px-6">
        <Link href="/" aria-label="TimeKeep home">
          <Logo />
        </Link>
        <Link
          href="/"
          className="text-muted-foreground hover:text-foreground ml-2 hidden items-center gap-1 text-sm sm:inline-flex"
        >
          <ArrowLeftIcon className="size-4" /> Back to workspace
        </Link>
        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
          <UserMenu
            user={{
              name: session.user.name,
              email: session.user.email,
              image: session.user.image ?? null,
            }}
          />
        </div>
      </header>
      <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto w-full max-w-3xl">{children}</div>
      </main>
    </div>
  );
}
