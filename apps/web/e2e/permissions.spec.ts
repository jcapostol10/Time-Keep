import { expect, test } from "./fixtures";

/**
 * The permission matrix as people meet it. The demo manager (seed) manages
 * member1 and the "Mobile app" project only.
 */
test.describe("permissions", () => {
  test("a manager opens a project they manage, without its Rates tab", async ({
    page,
    demoUser,
  }) => {
    await demoUser("manager");
    await page.goto("/w/demo/projects");
    await page.getByRole("link", { name: "Mobile app" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Mobile app" })).toBeVisible();
    const tabs = page.getByRole("tablist", { name: "Project sections" });
    await expect(tabs.getByRole("tab", { name: "Tasks" })).toBeVisible();
    await expect(tabs.getByRole("tab", { name: "Rates" })).toHaveCount(0);
    await expect(tabs.getByRole("tab", { name: "Budget" })).toHaveCount(0);
  });

  test("a manager gets not-found for a project they do not manage", async ({ page, demoUser }) => {
    await demoUser("manager");
    const res = await page.request.get("/api/w/demo/tracker-options");
    const { projects } = (await res.json()) as { projects: { id: string; name: string }[] };
    const website = projects.find((p) => p.name === "Website redesign");
    if (!website) throw new Error("seed has no Website redesign project");
    await page.goto(`/w/demo/projects/${website.id}`);
    await expect(page.getByRole("heading", { name: "We couldn't find that page" })).toBeVisible();
  });

  test("a member sees no Clients or Tags in the sidebar", async ({ page, demoUser }) => {
    await demoUser("member2");
    await page.goto("/w/demo/tracker");
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link", { name: "Projects" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Clients" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Tags" })).toHaveCount(0);
  });
});
