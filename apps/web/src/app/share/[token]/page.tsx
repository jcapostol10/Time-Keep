import { resolveReportRange } from "@timekeep/core";
import { getDb } from "@timekeep/db";
import { Button } from "@timekeep/ui/components/button";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { type SharedReportData, SharedReport } from "@/components/reports/shared-report";
import { detailedReport, summaryReport, weeklyReport } from "@/server/reports";
import { recordShareOpen, resolveShareLink } from "@/server/share-links";

export const metadata: Metadata = {
  title: "Shared report",
  // A shared link is for its recipients, not for search engines.
  robots: { index: false, follow: false },
};

const DETAILED_ROWS = 200;

/** A report shared by link: no session, read-only, as its creator saw it. */
export default async function SharedReportPage({ params }: PageProps<"/share/[token]">) {
  const { token } = await params;
  const db = getDb();
  const link = await resolveShareLink(db, token);
  // Unknown, expired and revoked all render the same not-found page.
  if (!link) notFound();
  await recordShareOpen(db, link.id);

  const now = new Date();
  const range = resolveReportRange(link.query, link.prefs, now);
  let data: SharedReportData;
  if (link.kind === "summary") {
    data = {
      kind: "summary",
      report: await summaryReport(db, link.viewer, link.query, link.prefs, now),
    };
  } else if (link.kind === "weekly") {
    data = {
      kind: "weekly",
      report: await weeklyReport(db, link.viewer, link.query, link.prefs, "project", now),
    };
  } else {
    const page = await detailedReport(
      db,
      link.viewer,
      link.query,
      link.prefs,
      { sort: "start", dir: "desc", limit: DETAILED_ROWS },
      now,
    );
    data = {
      kind: "detailed",
      entries: page.entries,
      totalSeconds: page.totals.durationSeconds,
      more: page.nextCursor !== null,
    };
  }

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <div className="flex justify-end gap-2">
        <Button asChild variant="outline" size="sm">
          <a href={`/share/${token}/export?format=csv`} download>
            Download CSV
          </a>
        </Button>
        <Button asChild variant="outline" size="sm">
          <a href={`/share/${token}/export?format=pdf`} download>
            Download PDF
          </a>
        </Button>
      </div>
      <SharedReport link={link} data={data} range={range} />
      <footer className="text-muted-foreground border-t pt-4 text-center text-xs">
        Shared from{" "}
        <Link href="/" className="underline">
          TimeKeep
        </Link>
      </footer>
    </main>
  );
}
