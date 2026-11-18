"use client";

import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { toast } from "sonner";

import { withNote, withNoteRetry } from "@/components/approvals/note-prompt";
import type { ActionResult } from "@/lib/action-result";
import type { ExpenseCategoryDTO, ExpenseDTO, ExpensePage } from "@/lib/expense-types";
import { fetchJson } from "@/lib/fetch-json";
import {
  createExpenseAction,
  deleteExpenseAction,
  restoreExpenseAction,
  updateExpenseAction,
} from "@/server/actions/expenses";

import { expenseKeys, expenseUrls, trackerKeys } from "../tracker/query-keys";
import type { PreparedReceipt } from "./receipt-image";

const UNDO_MS = 5_000;

/** The page's list for a serialised query, newest first, a page per cursor. */
export function useExpenses(slug: string, params: string) {
  return useInfiniteQuery({
    queryKey: expenseKeys.list(slug, params),
    queryFn: ({ pageParam }) => fetchJson<ExpensePage>(expenseUrls.list(slug, params, pageParam)),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    staleTime: 10_000,
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
  });
}

export function useExpenseCategories(slug: string, archived = false, enabled = true) {
  return useQuery({
    queryKey: expenseKeys.categories(slug, archived),
    queryFn: () => fetchJson<ExpenseCategoryDTO[]>(expenseUrls.categories(slug, archived)),
    staleTime: 60_000,
    enabled,
  });
}

/** Sends a prepared receipt; `note` goes from the start when the save before it was asked for one. */
async function uploadReceipt(
  slug: string,
  expenseId: string,
  receipt: PreparedReceipt,
  note?: string,
): Promise<ActionResult<ExpenseDTO>> {
  const send = async (withNote?: string): Promise<ActionResult<ExpenseDTO>> => {
    const form = new FormData();
    form.append("file", receipt.file, `receipt.${receipt.extension}`);
    if (receipt.thumb) form.append("thumb", receipt.thumb, "thumb.jpg");
    if (withNote) form.append("note", withNote);
    const res = await fetch(expenseUrls.receipt(slug, expenseId), { method: "POST", body: form });
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      fieldErrors?: Record<string, string[]>;
    } & Partial<ExpenseDTO>;
    if (res.ok) return { ok: true, data: body as ExpenseDTO };
    return {
      ok: false,
      error: body.error ?? "The receipt could not be uploaded.",
      fieldErrors: body.fieldErrors,
    };
  };
  return withNoteRetry(send, note);
}

/** Removes the receipt only; `note` as for `uploadReceipt`. */
async function deleteReceipt(
  slug: string,
  expenseId: string,
  note?: string,
): Promise<ActionResult<ExpenseDTO>> {
  const send = async (withNote?: string): Promise<ActionResult<ExpenseDTO>> => {
    const url = `${expenseUrls.receipt(slug, expenseId)}${withNote ? `?note=${encodeURIComponent(withNote)}` : ""}`;
    const res = await fetch(url, { method: "DELETE" });
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      fieldErrors?: Record<string, string[]>;
    };
    if (res.ok) return { ok: true, data: body as unknown as ExpenseDTO };
    return {
      ok: false,
      error: body.error ?? "The receipt could not be removed.",
      fieldErrors: body.fieldErrors,
    };
  };
  return withNoteRetry(send, note);
}

/**
 * Expense writes: each asks for a note when the server wants one, toasts on
 * failure, and refetches the lists and the reports (the Profit tab counts
 * expenses) on success.
 */
export function useExpenseWrites(slug: string) {
  const qc = useQueryClient();
  const settle = useCallback(() => {
    void qc.invalidateQueries({ queryKey: expenseKeys.all(slug) });
    void qc.invalidateQueries({ queryKey: [...trackerKeys.allEntries(slug), "report"] });
  }, [qc, slug]);

  return useMemo(() => {
    const restore = async (expenseId: string) => {
      const result = await withNoteRetry((note) => restoreExpenseAction(slug, expenseId, { note }));
      if (!result.ok) toast.error(result.error);
      else toast.success("Expense restored");
      settle();
    };
    return {
      /**
       * Saves a new or edited expense, then its receipt: a new file, or the
       * removal of the old one. The expense goes first, so a save that fails
       * has not already cost the receipt, and a note asked for by the save is
       * sent with the receipt write too (one prompt for the whole save).
       */
      async save(
        input: Record<string, unknown>,
        expenseId: string | null,
        receipt: PreparedReceipt | null,
        removeReceipt = false,
      ): Promise<ExpenseDTO | null> {
        const { result, note } = await withNote((withNote) =>
          expenseId
            ? updateExpenseAction(slug, expenseId, { ...input, note: withNote })
            : createExpenseAction(slug, { ...input, note: withNote }),
        );
        if (!result.ok) {
          toast.error(result.error);
          return null;
        }
        let saved = result.data;
        if (receipt) {
          const uploaded = await uploadReceipt(slug, saved.id, receipt, note);
          if (uploaded.ok) saved = uploaded.data;
          else toast.error("The receipt could not be uploaded.");
        } else if (removeReceipt) {
          const removed = await deleteReceipt(slug, saved.id, note);
          if (!removed.ok) toast.error(removed.error);
        }
        toast.success("Expense saved");
        settle();
        return saved;
      },
      /** Soft delete with a 5-second Undo. */
      async remove(expense: ExpenseDTO): Promise<boolean> {
        const result = await withNoteRetry((note) =>
          deleteExpenseAction(slug, expense.id, { note }),
        );
        if (!result.ok) {
          toast.error(result.error);
          return false;
        }
        settle();
        toast("Expense deleted", {
          duration: UNDO_MS,
          action: { label: "Undo", onClick: () => void restore(expense.id) },
        });
        return true;
      },
    };
  }, [slug, settle]);
}
