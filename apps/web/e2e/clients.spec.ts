import { expect, test } from "./fixtures";
import { clientRow, createClientViaUi, rowAction } from "./helpers/catalog";
import { createInvoice } from "./helpers/invoices";

/** The Clients page: admins keep the companies they work for in one list. */
test.describe("clients", () => {
  test("create and edit a client", async ({ page, freshUser }) => {
    await createClientViaUi(page, freshUser.slug, "Acme Corp", {
      email: "billing@acme.test",
      notes: "Net 30",
    });
    const row = clientRow(page, "Acme Corp");
    await expect(row).toContainText("billing@acme.test");
    await expect(row.getByRole("cell", { name: "0", exact: true })).toBeVisible();

    await rowAction(page, row, "Edit");
    const dialog = page.getByRole("dialog", { name: "Edit client" });
    await expect(dialog.getByLabel("Notes")).toHaveValue("Net 30");
    await dialog.getByLabel("Name").fill("Acme Corporation");
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog).toBeHidden();
    await expect(clientRow(page, "Acme Corporation")).toBeVisible();
    await expect(clientRow(page, "Acme Corp")).toHaveCount(0);
  });

  test("a client can be billed in any ISO currency", async ({ page, freshUser }) => {
    await page.goto(`/w/${freshUser.slug}/clients`);
    await page.getByRole("button", { name: "New client" }).click();
    const dialog = page.getByRole("dialog", { name: "New client" });
    await dialog.getByLabel("Name").fill("Dakar Studio");
    await dialog.getByRole("combobox", { name: "Currency" }).click();
    // Not one of the dozen the short list had: found by its name.
    await page.getByRole("combobox", { name: "Search currencies" }).fill("west african");
    await page.getByRole("option", { name: /^XOF\b/ }).click();
    await expect(dialog.getByRole("combobox", { name: "Currency" })).toContainText("XOF");
    await dialog.getByRole("button", { name: "Create client" }).click();
    await expect(dialog).toBeHidden();

    await rowAction(page, clientRow(page, "Dakar Studio"), "Edit");
    const edit = page.getByRole("dialog", { name: "Edit client" });
    await expect(edit.getByRole("combobox", { name: "Currency" })).toContainText("XOF");
  });

  test("a client with invoices cannot change currency", async ({ page, freshUser }) => {
    await createClientViaUi(page, freshUser.slug, "Billed Ltd");
    await createInvoice(page, freshUser.slug, "Billed Ltd");

    await page.goto(`/w/${freshUser.slug}/clients`);
    await rowAction(page, clientRow(page, "Billed Ltd"), "Edit");
    const dialog = page.getByRole("dialog", { name: "Edit client" });
    await expect(dialog.getByRole("combobox", { name: "Currency" })).toBeDisabled();
    await expect(
      dialog.getByText("This client has invoices in USD; its currency cannot change."),
    ).toBeVisible();
  });

  test("search clients", async ({ page, freshUser }) => {
    await createClientViaUi(page, freshUser.slug, "Acme Corp");
    await createClientViaUi(page, freshUser.slug, "Globex");

    await page.getByRole("searchbox", { name: "Search clients" }).fill("glo");
    await expect(clientRow(page, "Globex")).toBeVisible();
    await expect(clientRow(page, "Acme Corp")).toHaveCount(0);

    await page.getByRole("searchbox", { name: "Search clients" }).fill("");
    await expect(clientRow(page, "Acme Corp")).toBeVisible();
  });

  test("archive and unarchive a client", async ({ page, freshUser }) => {
    await createClientViaUi(page, freshUser.slug, "Old Co");

    await rowAction(page, clientRow(page, "Old Co"), "Archive");
    await expect(clientRow(page, "Old Co")).toHaveCount(0);

    await page.getByRole("combobox", { name: "Status" }).click();
    await page.getByRole("option", { name: "Archived" }).click();
    await expect(clientRow(page, "Old Co")).toContainText("Archived");

    await rowAction(page, clientRow(page, "Old Co"), "Unarchive");
    await expect(clientRow(page, "Old Co")).toHaveCount(0);

    await page.getByRole("combobox", { name: "Status" }).click();
    await page.getByRole("option", { name: "Active", exact: true }).click();
    await expect(clientRow(page, "Old Co")).toBeVisible();
  });

  test("delete an unused client", async ({ page, freshUser }) => {
    await createClientViaUi(page, freshUser.slug, "Gone Inc");

    await rowAction(page, clientRow(page, "Gone Inc"), "Delete");
    const confirm = page.getByRole("alertdialog", { name: "Delete client?" });
    await confirm.getByRole("button", { name: "Delete" }).click();
    await expect(confirm).toBeHidden();
    await expect(clientRow(page, "Gone Inc")).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole("heading", { name: "Clients" })).toBeVisible();
    await expect(clientRow(page, "Gone Inc")).toHaveCount(0);
  });

  test("members cannot open the clients page", async ({ page, demoUser }) => {
    await demoUser("member1");
    await page.goto("/w/demo/clients");
    await expect(page.getByRole("heading", { name: "We couldn't find that page" })).toBeVisible();

    await page.goto("/w/demo/tracker");
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link", { name: "Time Tracker" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Clients" })).toHaveCount(0);
  });
});
