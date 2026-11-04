import { getDb } from "@timekeep/db";
import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { AvatarUploader } from "@/components/account/avatar-uploader";
import { KioskCredentials } from "@/components/account/kiosk-credentials";
import { ProfileForm } from "@/components/account/profile-form";
import { TestEmailButton } from "@/components/account/test-email-button";
import { TrackerSettingsForm } from "@/components/account/tracker-settings-form";
import { credentialStatuses } from "@/server/kiosk/credentials";
import { getTrackerSettings } from "@/server/queries/user-settings";
import { requireSession } from "@/server/session";

export const metadata: Metadata = { title: "Profile settings" };

export default async function AccountPage() {
  const { user } = await requireSession("/account");
  const db = getDb();
  const [trackerSettings, kioskStatuses] = await Promise.all([
    getTrackerSettings(db, user.id),
    credentialStatuses(db, user.id),
  ]);
  const prefs = user as typeof user & {
    timezone?: string | null;
    dateFormat?: string | null;
    timeFormat?: string | null;
    weekStart?: number | null;
  };

  return (
    <>
      <PageHeader
        title="Profile settings"
        description="How you appear to your team and how dates and times are shown to you."
      />
      <div className="space-y-10">
        <section>
          <h2 className="mb-3 text-base font-semibold">Photo</h2>
          <AvatarUploader name={user.name} image={user.image ?? null} />
        </section>
        <section>
          <h2 className="mb-3 text-base font-semibold">Details and preferences</h2>
          <ProfileForm
            email={user.email}
            defaultValues={{
              name: user.name,
              timezone: prefs.timezone ?? null,
              dateFormat: (prefs.dateFormat as "MM/dd/yyyy" | null) ?? null,
              timeFormat: (prefs.timeFormat as "12h" | "24h" | null) ?? null,
              weekStart: (prefs.weekStart as 0 | 1 | 2 | 3 | 4 | 5 | 6 | null) ?? null,
            }}
          />
        </section>
        <section>
          <h2 className="mb-3 text-base font-semibold">Timer</h2>
          <TrackerSettingsForm defaultValues={trackerSettings} />
        </section>
        {kioskStatuses.length > 0 ? (
          <section aria-labelledby="kiosk-heading">
            <h2 id="kiosk-heading" className="mb-3 text-base font-semibold">
              Kiosk
            </h2>
            <KioskCredentials statuses={kioskStatuses} />
          </section>
        ) : null}
        <section>
          <h2 className="mb-3 text-base font-semibold">Email</h2>
          <TestEmailButton email={user.email} />
        </section>
      </div>
    </>
  );
}
