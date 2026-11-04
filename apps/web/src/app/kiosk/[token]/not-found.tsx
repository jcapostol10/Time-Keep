import { KIOSK_UNAVAILABLE } from "@timekeep/core";

/** The one answer for an unknown, rotated or disabled kiosk. */
export default function KioskNotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6 text-center">
      <p className="text-lg font-medium">{KIOSK_UNAVAILABLE}</p>
    </main>
  );
}
