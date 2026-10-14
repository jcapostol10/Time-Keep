"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { setTimezoneIfUnsetAction } from "@/server/actions/profile";

const FLAG = "timekeep:tz-detected";

/** Saves the browser timezone once per session for users who have none (e.g. Google sign-up). */
export function TimezoneDetector({ hasTimezone }: { hasTimezone: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (hasTimezone) return;
    try {
      if (window.sessionStorage.getItem(FLAG)) return;
      window.sessionStorage.setItem(FLAG, "1");
    } catch {
      // storage unavailable: still try once per mount
    }
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!timezone) return;
    void setTimezoneIfUnsetAction(timezone).then((result) => {
      if (result.ok && result.data.updated) router.refresh();
    });
  }, [hasTimezone, router]);
  return null;
}
