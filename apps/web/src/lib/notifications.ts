"use client";

import { toast } from "sonner";

export function notificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

/** Ask for notification permission. Call from a user gesture (a click or toggle). */
export async function ensureNotificationPermission(): Promise<
  NotificationPermission | "unsupported"
> {
  if (!notificationsSupported()) return "unsupported";
  if (Notification.permission !== "default") return Notification.permission;
  return Notification.requestPermission();
}

/** Ask for idle-detection permission (Chromium only). Call from a user gesture. */
export async function ensureIdlePermission(): Promise<"granted" | "denied" | "unsupported"> {
  if (typeof window === "undefined" || !window.IdleDetector) return "unsupported";
  try {
    return await window.IdleDetector.requestPermission();
  } catch {
    return "denied";
  }
}

/**
 * A system notification when permitted, otherwise an in-app toast. `tag`
 * replaces an earlier notification of the same kind instead of stacking.
 */
export function notify(title: string, opts: { body?: string; tag: string; onClick?: () => void }) {
  if (notificationsSupported() && Notification.permission === "granted") {
    try {
      const n = new Notification(title, { body: opts.body, tag: opts.tag });
      n.onclick = () => {
        window.focus();
        opts.onClick?.();
        n.close();
      };
      return;
    } catch {
      // Some platforms only allow notifications from a service worker; fall through.
    }
  }
  toast(title, {
    id: opts.tag,
    description: opts.body,
    duration: 10_000,
    ...(opts.onClick ? { action: { label: "Open", onClick: opts.onClick } } : {}),
  });
}
