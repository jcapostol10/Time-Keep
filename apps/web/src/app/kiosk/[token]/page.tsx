import { getDb } from "@timekeep/db";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { KioskScreen } from "@/components/kiosk/kiosk-screen";
import type { KioskScreenDTO } from "@/lib/kiosk-types";
import { WorkspaceAccessError } from "@/server/access-error";
import { kioskScreen, resolveKiosk } from "@/server/kiosk/runtime";

export const metadata: Metadata = {
  title: "Kiosk",
  robots: { index: false, follow: false },
  // The path is a bearer token: never send it to avatar or logo hosts.
  referrer: "no-referrer",
};

/** A shared device: no session is read or set; the URL's token is the only key (decision 15). */
export default async function KioskPage({ params }: PageProps<"/kiosk/[token]">) {
  const { token } = await params;
  const db = getDb();
  let initial: KioskScreenDTO;
  try {
    initial = await kioskScreen(db, await resolveKiosk(db, token));
  } catch (error) {
    // Unknown, rotated and disabled all render the same page.
    if (error instanceof WorkspaceAccessError) notFound();
    throw error;
  }
  return <KioskScreen token={token} initial={initial} />;
}
