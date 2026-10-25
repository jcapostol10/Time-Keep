import Link from "next/link";

/** The same page for an unknown, expired or revoked link: none of them says which. */
export default function ShareNotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-xl font-semibold">This link is no longer available</h1>
      <p className="text-muted-foreground text-sm">
        It may have expired or been revoked. Ask whoever sent it for a new one.
      </p>
      <Link href="/" className="text-sm underline">
        Go to TimeKeep
      </Link>
    </main>
  );
}
