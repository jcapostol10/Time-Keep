import Link from "next/link";

/** The same page for a draft, a void invoice or an unknown link: none of them says which. */
export default function InvoiceNotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-xl font-semibold">This invoice is not available</h1>
      <p className="text-muted-foreground text-sm">
        The link may be wrong, or the invoice was withdrawn. Ask whoever sent it for a new one.
      </p>
      <Link href="/" className="text-sm underline">
        Go to TimeKeep
      </Link>
    </main>
  );
}
