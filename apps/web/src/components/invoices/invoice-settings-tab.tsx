"use client";

import {
  formatBps,
  formatInvoiceNumber,
  type InvoiceSettingsInput,
  parseBps,
} from "@timekeep/core";
import { Button } from "@timekeep/ui/components/button";
import { Input } from "@timekeep/ui/components/input";
import { Label } from "@timekeep/ui/components/label";
import { Skeleton } from "@timekeep/ui/components/skeleton";
import { Textarea } from "@timekeep/ui/components/textarea";
import { useState } from "react";

import type { InvoiceSettingsDTO } from "@/lib/invoice-types";
import { updateInvoiceSettingsAction } from "@/server/actions/invoice-settings";

import { useInvoiceSettings, useInvoiceWrite } from "./use-invoices";

/** The Settings tab: what invoices say about the company, their numbering and default taxes. */
export function InvoiceSettingsTab({ slug }: { slug: string }) {
  const { data } = useInvoiceSettings(slug);
  if (!data) return <Skeleton className="h-96 w-full" />;
  return <SettingsForm key={data.nextNumberPreview} slug={slug} settings={data} />;
}

function SettingsForm({ slug, settings }: { slug: string; settings: InvoiceSettingsDTO }) {
  const write = useInvoiceWrite(slug);
  const [form, setForm] = useState({
    companyName: settings.companyName,
    address: settings.address,
    taxLine: settings.taxLine,
    notes: settings.notes,
    paymentTermsDays: String(settings.paymentTermsDays),
    numberPrefix: settings.numberPrefix,
    nextNumber: String(settings.nextNumber),
    numberPadding: String(settings.numberPadding),
    tax1Name: settings.tax1Name ?? "",
    tax1Percent: settings.tax1Bps === null ? "" : formatBps(settings.tax1Bps),
    tax2Name: settings.tax2Name ?? "",
    tax2Percent: settings.tax2Bps === null ? "" : formatBps(settings.tax2Bps),
  });
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));
  const int = (text: string) => (/^\d+$/.test(text.trim()) ? Number(text) : NaN);
  const preview = Number.isFinite(int(form.nextNumber))
    ? formatInvoiceNumber(
        form.numberPrefix.trim(),
        int(form.nextNumber),
        Math.min(int(form.numberPadding) || 0, 8),
      )
    : "—";

  async function save() {
    const percent = (text: string) => (text.trim() === "" ? null : parseBps(text));
    const tax1Bps = percent(form.tax1Percent);
    const tax2Bps = percent(form.tax2Percent);
    if (
      (form.tax1Percent.trim() && tax1Bps === null) ||
      (form.tax2Percent.trim() && tax2Bps === null)
    ) {
      setErrors({ tax: ["Enter a percent from 0 to 100, like 12 or 7.5."] });
      return;
    }
    const input: InvoiceSettingsInput = {
      companyName: form.companyName,
      address: form.address,
      taxLine: form.taxLine,
      notes: form.notes,
      paymentTermsDays: int(form.paymentTermsDays),
      numberPrefix: form.numberPrefix,
      nextNumber: int(form.nextNumber),
      numberPadding: int(form.numberPadding),
      tax1Name: form.tax1Name.trim() || null,
      tax1Bps,
      tax2Name: form.tax2Name.trim() || null,
      tax2Bps,
    };
    setBusy(true);
    try {
      const result = await write(() => updateInvoiceSettingsAction(slug, input), "Settings saved");
      setErrors(result ? {} : { form: ["Check the fields."] });
    } finally {
      setBusy(false);
    }
  }

  const field = (key: keyof typeof form, label: string, props: Record<string, unknown> = {}) => (
    <div className="space-y-2">
      <Label htmlFor={`invoice-settings-${key}`}>{label}</Label>
      <Input id={`invoice-settings-${key}`} value={form[key]} onChange={set(key)} {...props} />
    </div>
  );

  return (
    <form
      className="max-w-2xl space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Company</h2>
        {field("companyName", "Company name", { maxLength: 120 })}
        <div className="space-y-2">
          <Label htmlFor="invoice-settings-address">Address</Label>
          <Textarea
            id="invoice-settings-address"
            value={form.address}
            maxLength={500}
            rows={3}
            onChange={set("address")}
          />
        </div>
        {field("taxLine", "Tax number line", { maxLength: 120, placeholder: "VAT 123 456 789" })}
        <p className="text-muted-foreground text-sm">
          The logo is the workspace&apos;s, from Workspace settings.
        </p>
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Numbering and terms</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {field("numberPrefix", "Number prefix", { maxLength: 10 })}
          {field("nextNumber", "Next number", { inputMode: "numeric" })}
          {field("numberPadding", "Padding", { inputMode: "numeric" })}
        </div>
        <p className="text-sm">
          Next: <span className="font-medium">{preview}</span>
        </p>
        {field("paymentTermsDays", "Payment terms (days)", { inputMode: "numeric" })}
        <div className="space-y-2">
          <Label htmlFor="invoice-settings-notes">Default notes</Label>
          <Textarea
            id="invoice-settings-notes"
            value={form.notes}
            maxLength={2000}
            rows={3}
            onChange={set("notes")}
          />
        </div>
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Default taxes</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {field("tax1Name", "Tax 1 name", { maxLength: 40 })}
          {field("tax1Percent", "Tax 1 %", { inputMode: "decimal" })}
          {field("tax2Name", "Tax 2 name", { maxLength: 40 })}
          {field("tax2Percent", "Tax 2 %", { inputMode: "decimal" })}
        </div>
      </section>
      {Object.values(errors)[0] ? (
        <p className="text-destructive text-sm">{Object.values(errors)[0]![0]}</p>
      ) : null}
      <Button type="submit" disabled={busy}>
        Save settings
      </Button>
    </form>
  );
}
