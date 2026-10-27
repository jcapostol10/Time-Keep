import { expect, type Locator, type Page } from "@playwright/test";

/** Opens the rate dialog from `opener`, fills it and saves. */
export async function setRateIn(
  page: Page,
  opener: Locator,
  opts: {
    amount: string;
    apply: "New entries only" | "Entries from a date" | "All entries, past and future";
    from?: string;
  },
) {
  await opener.click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: /^Hourly rate/ }).fill(opts.amount);
  await dialog.getByRole("radio", { name: opts.apply }).click();
  if (opts.from) await dialog.getByLabel("From", { exact: true }).fill(opts.from);
  await dialog.getByRole("button", { name: "Save rate" }).click();
  await expect(dialog).toBeHidden();
}

/** Waits for the "apply to past entries" banner to report the job finished. */
export async function waitForRecalc(page: Page) {
  await expect(page.getByRole("status").filter({ hasText: "Entries updated" })).toBeVisible({
    timeout: 30_000,
  });
}
