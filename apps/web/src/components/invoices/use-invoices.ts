"use client";

import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback } from "react";
import { toast } from "sonner";

import type { ActionResult } from "@/lib/action-result";
import { fetchJson } from "@/lib/fetch-json";
import type {
  ImportPreviewDTO,
  InvoiceDTO,
  InvoiceListPage,
  InvoiceSettingsDTO,
  RecurringInvoiceDTO,
} from "@/lib/invoice-types";

import { invoiceKeys, invoiceUrls, trackerKeys } from "../tracker/query-keys";

/** The Invoices list for a serialised filter, newest issue date first, a page per cursor. */
export function useInvoiceList(slug: string, params: string) {
  return useInfiniteQuery({
    queryKey: invoiceKeys.list(slug, params),
    queryFn: ({ pageParam }) =>
      fetchJson<InvoiceListPage>(invoiceUrls.list(slug, params, pageParam)),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    staleTime: 10_000,
    placeholderData: keepPreviousData,
  });
}

export function useInvoice(slug: string, id: string) {
  return useQuery({
    queryKey: invoiceKeys.one(slug, id),
    queryFn: () => fetchJson<InvoiceDTO>(invoiceUrls.one(slug, id)),
    staleTime: 10_000,
  });
}

export function useInvoiceSettings(slug: string) {
  return useQuery({
    queryKey: invoiceKeys.settings(slug),
    queryFn: () => fetchJson<InvoiceSettingsDTO>(invoiceUrls.settings(slug)),
    staleTime: 60_000,
  });
}

export function useRecurringInvoices(slug: string) {
  return useQuery({
    queryKey: invoiceKeys.recurring(slug),
    queryFn: () => fetchJson<RecurringInvoiceDTO[]>(invoiceUrls.recurring(slug)),
    staleTime: 30_000,
  });
}

export function useImportPreview(slug: string, id: string, params: string, enabled: boolean) {
  return useQuery({
    queryKey: invoiceKeys.importPreview(slug, id, params),
    queryFn: () => fetchJson<ImportPreviewDTO>(invoiceUrls.importPreview(slug, id, params)),
    enabled,
    staleTime: 5_000,
    placeholderData: keepPreviousData,
  });
}

/**
 * Runs an invoice action: a refusal toasts its message; success stores the
 * answered invoice and refetches the lists and the tracker's entries (an
 * import or a void changes which entries are locked).
 */
export function useInvoiceWrite(slug: string) {
  const qc = useQueryClient();
  return useCallback(
    async <T>(run: () => Promise<ActionResult<T>>, success?: string): Promise<T | null> => {
      const result = await run();
      if (!result.ok) {
        toast.error(result.error);
        return null;
      }
      const data = result.data;
      if (data && typeof data === "object" && "lines" in data && "id" in data) {
        const invoice = data as unknown as InvoiceDTO;
        qc.setQueryData(invoiceKeys.one(slug, invoice.id), invoice);
      }
      void qc.invalidateQueries({ queryKey: invoiceKeys.all(slug) });
      void qc.invalidateQueries({ queryKey: trackerKeys.allEntries(slug) });
      if (success) toast.success(success);
      return data;
    },
    [qc, slug],
  );
}
