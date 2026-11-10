import { formatDateKey } from "@timekeep/core";

import type { EmailContent } from "../mail";

/** The invoice emails (Phase 6d), sent through the outbox. */

type Email = { subject: string } & EmailContent;

/** To the client, with the PDF attached (decision 24). */
export function invoiceSentEmail(b: {
  appUrl: string;
  number: string;
  companyName: string;
  /** Formatted: "₱1,562.40". */
  totalText: string;
  dueDate: string;
  publicPath: string;
}): Email {
  return {
    subject: `Invoice ${b.number} from ${b.companyName}`,
    title: `Invoice ${b.number}`,
    intro: `${b.companyName} sent you invoice ${b.number} for ${b.totalText}, due ${formatDateKey(b.dueDate)}. The PDF is attached.`,
    cta: { label: "View invoice", url: `${b.appUrl}${b.publicPath}` },
  };
}

/** To the owners and admins, once per invoice, by the daily job (decision 21). */
export function invoiceOverdueEmail(b: {
  appUrl: string;
  slug: string;
  invoiceId: string;
  number: string;
  clientName: string;
  balanceText: string;
  dueDate: string;
}): Email {
  return {
    subject: `Invoice ${b.number} is overdue`,
    title: `${b.number} is overdue`,
    intro: `${b.clientName}'s invoice ${b.number} was due ${formatDateKey(b.dueDate)}; ${b.balanceText} is still outstanding.`,
    cta: { label: "Open invoice", url: `${b.appUrl}/w/${b.slug}/invoices/${b.invoiceId}` },
  };
}

/** To the owners and admins when a recurring template set to send had no client email (decision 27). */
export function recurringUnsentEmail(b: {
  appUrl: string;
  slug: string;
  invoiceId: string;
  number: string;
  templateName: string;
  clientName: string;
}): Email {
  return {
    subject: `${b.templateName}: ${b.number} needs sending`,
    title: `${b.number} is waiting as a draft`,
    intro: `The recurring invoice "${b.templateName}" created ${b.number} for ${b.clientName} but could not send it: the client has no email address. Add one, or send the draft by hand.`,
    cta: { label: "Open invoice", url: `${b.appUrl}/w/${b.slug}/invoices/${b.invoiceId}` },
  };
}
