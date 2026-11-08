"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@timekeep/ui/components/alert-dialog";

/**
 * The question a currency change asks first (Phase 6 design, decision 8):
 * rates and saved amounts are relabelled, never converted. The server says
 * what will change (`fieldErrors.confirmCurrencyChange`); confirming resends
 * the same change with the confirmation.
 */
export function CurrencyConfirm({
  message,
  onConfirm,
  onCancel,
}: {
  /** The server's sentence; null keeps the dialog closed. */
  message: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <AlertDialog open={message !== null} onOpenChange={(open) => (open ? null : onCancel())}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Change the currency?</AlertDialogTitle>
          <AlertDialogDescription>{message}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep the currency</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Change currency</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
