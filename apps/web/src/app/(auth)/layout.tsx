import Link from "next/link";

import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-svh flex-col bg-muted/40">
      <header className="flex items-center justify-between px-4 py-4 sm:px-8">
        <Link href="/" aria-label="TimeKeep home">
          <Logo />
        </Link>
        <ThemeToggle />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pb-12">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
