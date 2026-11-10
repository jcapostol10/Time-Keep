import { getDb } from "@timekeep/db";

import { claimInvoiceDownload, publicPdfUrl, resolvePublicInvoice } from "@/server/invoices/public";

const HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };

/**
 * The public invoice's frozen PDF (Phase 6d, decision 25): no session; a
 * draft, a void invoice and an unknown token are the same 404; one download
 * per invoice every 10 seconds; a redirect to a five-minute signed link.
 */
export async function GET(_request: Request, ctx: RouteContext<"/invoice/[token]/pdf">) {
  const { token } = await ctx.params;
  const db = getDb();
  try {
    const ref = await resolvePublicInvoice(db, token);
    if (!ref)
      return new Response("This invoice is not available.", { status: 404, headers: HEADERS });
    if (!(await claimInvoiceDownload(db, ref.invoiceId))) {
      return new Response("This invoice was just downloaded. Try again in a few seconds.", {
        status: 429,
        headers: { ...HEADERS, "Retry-After": "10" },
      });
    }
    return new Response(null, {
      status: 302,
      headers: { ...HEADERS, Location: await publicPdfUrl(db, ref.invoiceId) },
    });
  } catch (error) {
    console.error("[invoice] public download failed", error);
    return new Response("Something went wrong.", { status: 500, headers: HEADERS });
  }
}
