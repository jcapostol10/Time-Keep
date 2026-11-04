"use client";

import {
  formatDuration,
  KIOSK_ACTION_LABELS,
  KIOSK_PHOTO_NOTICE,
  KIOSK_UNAVAILABLE,
  type KioskAction,
  NO_PIN,
} from "@timekeep/core";
import { Avatar, AvatarFallback, AvatarImage } from "@timekeep/ui/components/avatar";
import { Button } from "@timekeep/ui/components/button";
import { ArrowLeftIcon, QrCodeIcon } from "lucide-react";
import { useEffect, useEffectEvent, useState } from "react";

import { useHydrated } from "@/hooks/use-hydrated";
import { useNow } from "@/hooks/use-now";
import type { KioskPerson, KioskPunchDTO, KioskScreenDTO, KioskVisitDTO } from "@/lib/kiosk-types";

import { capturePhoto } from "./photo-capture";
import { PinPad } from "./pin-pad";
import { QrScanner } from "./qr-scanner";

type View =
  | { kind: "people" }
  | { kind: "pin"; person: KioskPerson }
  | { kind: "scan" }
  | { kind: "actions"; visit: KioskVisitDTO }
  | { kind: "done"; visit: KioskPunchDTO; action: KioskAction };

const CONFIRMED: Record<KioskAction, string> = {
  CLOCK_IN: "Clocked in",
  START_BREAK: "Break started",
  END_BREAK: "Back from break",
  CLOCK_OUT: "Clocked out",
};

const AGAIN = "Enter your PIN or scan your code again.";

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");

const workedLine = (seconds: number) => `Worked today: ${formatDuration(seconds, "hh:mm")}`;

/** The workspace's wall clock, from the server's time on each response (decision 17). */
function KioskClock({ offsetMs, timezone }: { offsetMs: number; timezone: string }) {
  const now = useNow();
  if (now === 0) return null;
  return (
    <p className="text-muted-foreground text-lg tabular-nums">
      {new Intl.DateTimeFormat(undefined, {
        hour: "numeric",
        minute: "2-digit",
        timeZone: timezone,
      }).format(now + offsetMs)}
    </p>
  );
}

/**
 * The kiosk device: people → PIN or QR → actions → confirmation, then back to
 * the people after the session timeout. It reads only `/api/kiosk/[token]/…`
 * and never holds a session; the ticket from identify lives in this state
 * until the visit ends.
 */
export function KioskScreen({ token, initial }: { token: string; initial: KioskScreenDTO }) {
  const hydrated = useHydrated();
  const [screen, setScreen] = useState(initial);
  const [offsetMs, setOffsetMs] = useState(0);
  const [view, setView] = useState<View>({ kind: "people" });
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  async function call(path: string, init?: RequestInit) {
    const response = await fetch(`/api/kiosk/${token}${path}`, { ...init, cache: "no-store" });
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      visit?: KioskPunchDTO;
      now?: string;
    };
    if (body.now) setOffsetMs(Date.parse(body.now) - Date.now());
    return { response, body };
  }

  /** Back to the people, with a fresh list, or to "not available" when the kiosk has gone. */
  async function backToPeople(message: string | null = null): Promise<void> {
    setView({ kind: "people" });
    setPin("");
    setError(message);
    const { response, body } = await call("");
    if (response.status === 404) setUnavailable(true);
    else if (response.ok) setScreen(body as unknown as KioskScreenDTO);
  }

  const timedOut = useEffectEvent(() => void backToPeople());
  const timeoutMs = screen.sessionTimeoutSeconds * 1000;
  useEffect(() => {
    if (view.kind === "people") return;
    const timer = setTimeout(timedOut, timeoutMs);
    return () => clearTimeout(timer);
  }, [view, pin, timeoutMs]);

  async function identify(input: { userId: string; pin: string } | { qr: string }) {
    setBusy(true);
    setError(null);
    const { response, body } = await call("/identify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    setBusy(false);
    setPin("");
    if (response.ok) setView({ kind: "actions", visit: body as unknown as KioskVisitDTO });
    else if (response.status === 404) await backToPeople(body.error ?? null);
    else setError(body.error ?? "Something went wrong.");
  }

  async function punch(visit: KioskVisitDTO, action: KioskAction) {
    setBusy(true);
    setError(null);
    const photo = action === "CLOCK_IN" && screen.photo ? await capturePhoto() : null;
    const form = new FormData();
    form.set("ticket", visit.ticket);
    form.set("action", action);
    if (photo) form.set("photo", photo, "clock-in.jpg");
    const { response, body } = await call("/punch", { method: "POST", body: form });
    setBusy(false);
    if (response.ok) setView({ kind: "done", visit: body as unknown as KioskPunchDTO, action });
    // The ticket ran out, the kiosk changed, or the person is no longer allowed.
    else if (response.status === 404) await backToPeople(AGAIN);
    else {
      if (body.visit) setView({ kind: "actions", visit: { ...visit, ...body.visit } });
      setError(body.error ?? "Something went wrong.");
    }
  }

  if (unavailable) {
    return (
      <main
        data-hydrated={hydrated}
        className="flex min-h-dvh items-center justify-center p-6 text-center"
      >
        <p className="text-lg font-medium">{KIOSK_UNAVAILABLE}</p>
      </main>
    );
  }

  const alert = error ? (
    <p role="alert" className="text-destructive text-center text-lg font-medium">
      {error}
    </p>
  ) : null;

  return (
    <main
      data-hydrated={hydrated}
      className="mx-auto flex min-h-dvh w-full max-w-4xl flex-col items-center gap-6 p-4 sm:p-8"
    >
      <header className="flex w-full flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {screen.logo ? (
            <Avatar className="size-10 rounded-md">
              <AvatarImage src={screen.logo} alt="" />
            </Avatar>
          ) : null}
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold">{screen.name}</h1>
            <p className="text-muted-foreground truncate text-sm">{screen.workspaceName}</p>
          </div>
        </div>
        <KioskClock offsetMs={offsetMs} timezone={screen.timezone} />
      </header>

      {view.kind === "people" ? (
        <>
          {alert}
          <Button
            size="lg"
            variant="outline"
            className="h-14 w-full max-w-xs text-lg"
            onClick={() => {
              setError(null);
              setView({ kind: "scan" });
            }}
          >
            <QrCodeIcon />
            Scan QR code
          </Button>
          <ul aria-label="People" className="grid w-full gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {screen.people.map((person) => (
              <li key={person.userId}>
                <Button
                  variant="outline"
                  className="h-16 w-full justify-start gap-3 text-lg"
                  onClick={() => {
                    setError(person.hasPin ? null : NO_PIN);
                    setView({ kind: "pin", person });
                  }}
                >
                  <Avatar aria-hidden className="size-10">
                    {person.image ? <AvatarImage src={person.image} alt="" /> : null}
                    <AvatarFallback>{initialsOf(person.name)}</AvatarFallback>
                  </Avatar>
                  <span className="truncate">{person.name}</span>
                </Button>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {view.kind === "pin" ? (
        <>
          <p className="text-lg">{view.person.name}</p>
          {view.person.hasPin ? <h2 className="text-2xl font-semibold">Enter your PIN</h2> : null}
          {alert}
          {view.person.hasPin ? (
            <PinPad
              value={pin}
              onChange={setPin}
              disabled={busy}
              onSubmit={() => void identify({ userId: view.person.userId, pin })}
            />
          ) : null}
          <Button variant="ghost" size="lg" onClick={() => void backToPeople()}>
            <ArrowLeftIcon />
            Back
          </Button>
        </>
      ) : null}

      {view.kind === "scan" ? (
        <>
          <h2 className="text-2xl font-semibold">Scan QR code</h2>
          {alert}
          <QrScanner onScan={(qr) => void identify({ qr })} />
          <Button variant="ghost" size="lg" onClick={() => void backToPeople()}>
            <ArrowLeftIcon />
            Back
          </Button>
        </>
      ) : null}

      {view.kind === "actions" ? (
        <>
          <h2 className="text-2xl font-semibold">{view.visit.person.name}</h2>
          <p className="text-lg">{workedLine(view.visit.workedTodaySeconds)}</p>
          {screen.photo && view.visit.actions.includes("CLOCK_IN") ? (
            <p className="text-muted-foreground">{KIOSK_PHOTO_NOTICE}</p>
          ) : null}
          {alert}
          <div className="flex w-full max-w-xs flex-col gap-3">
            {view.visit.actions.map((action) => (
              <Button
                key={action}
                size="lg"
                className="h-16 text-xl"
                variant={action === "CLOCK_OUT" ? "outline" : "default"}
                disabled={busy}
                onClick={() => void punch(view.visit, action)}
              >
                {KIOSK_ACTION_LABELS[action]}
              </Button>
            ))}
          </div>
          <Button variant="ghost" size="lg" onClick={() => void backToPeople()}>
            <ArrowLeftIcon />
            Back
          </Button>
        </>
      ) : null}

      {view.kind === "done" ? (
        <>
          <div role="status" className="space-y-2 text-center">
            <h2 className="text-2xl font-semibold">
              {CONFIRMED[view.action]}, {view.visit.person.name}
            </h2>
            <p className="text-lg">{workedLine(view.visit.workedTodaySeconds)}</p>
          </div>
          <Button size="lg" className="h-14 w-full max-w-xs" onClick={() => void backToPeople()}>
            Done
          </Button>
        </>
      ) : null}
    </main>
  );
}
