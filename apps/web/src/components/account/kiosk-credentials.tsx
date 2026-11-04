"use client";

import { Button } from "@timekeep/ui/components/button";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { PinDialog } from "@/components/kiosk/pin-dialog";
import { drawQrCode, QrDialog, type QrCodeImage } from "@/components/kiosk/qr-dialog";
import { useHydrated } from "@/hooks/use-hydrated";
import type { CredentialStatus } from "@/lib/kiosk-types";
import { ownQrAction, setOwnPinAction } from "@/server/actions/kiosk-credential";

/**
 * Profile → Kiosk: a PIN is per workspace, so this lists the workspaces with
 * a kiosk the person may use (ruling R8).
 */
export function KioskCredentials({ statuses }: { statuses: CredentialStatus[] }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [open, setOpen] = useState<{
    kind: "pin" | "qr";
    status: CredentialStatus;
    first?: QrCodeImage;
  } | null>(null);

  function close() {
    setOpen(null);
    router.refresh();
  }

  /** A first code is issued at once; replacing one asks first, in the dialog. */
  async function showQr(status: CredentialStatus) {
    if (status.hasQr) {
      setOpen({ kind: "qr", status });
      return;
    }
    const result = await ownQrAction(status.slug);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setOpen({ kind: "qr", status, first: await drawQrCode(result.data.payload) });
  }

  return (
    <>
      <ul data-hydrated={hydrated} className="divide-y rounded-lg border">
        {statuses.map((status) => (
          <li
            key={status.workspaceId}
            className="flex flex-wrap items-center justify-between gap-3 p-3"
          >
            <div className="min-w-0">
              <p className="truncate font-medium">{status.workspaceName}</p>
              <p className="text-muted-foreground text-sm">
                {status.hasPin ? "PIN set" : "No PIN yet"}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setOpen({ kind: "pin", status })}>
                {status.hasPin ? "Change PIN" : "Set PIN"}
              </Button>
              <Button variant="outline" size="sm" onClick={() => void showQr(status)}>
                Show QR code
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {open?.kind === "pin" ? (
        <PinDialog onSave={(input) => setOwnPinAction(open.status.slug, input)} onClose={close} />
      ) : null}
      {open?.kind === "qr" ? (
        <QrDialog
          first={open.first}
          alt="Your kiosk QR code"
          issue={() => ownQrAction(open.status.slug)}
          onClose={close}
        />
      ) : null}
    </>
  );
}
