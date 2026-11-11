import { expect, test } from "@playwright/test";
import { waitForServiceWorker } from "./helpers";

test("open seed procedure offline, choose a branch, add note and highlight, reload: both persist", async ({ page, context }) => {
  await waitForServiceWorker(page);
  await context.setOffline(true);

  await page.goto("./#/p/demo-procedure", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /Demo procedure/ })).toBeVisible();

  // Choose branch B; only that branch is shown.
  await page.getByRole("button", { name: "Demo condition B" }).click();
  await expect(page.getByText("Demo row 6 trigger")).toBeVisible();
  await expect(page.getByText("Demo row 5 trigger")).toHaveCount(0);

  // Note via right-click action sheet.
  await page.locator("#row-demo-row-1").click({ button: "right" });
  await page.getByRole("button", { name: "Note", exact: true }).click();
  await page.getByLabel("Text").fill("Offline note");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator("#row-demo-row-1").getByText("1 note")).toBeVisible();

  // Highlight.
  await page.locator("#row-demo-row-1").click({ button: "right" });
  await page.getByRole("button", { name: "Highlight", exact: true }).click();
  await page.getByRole("button", { name: "green" }).click();
  await expect(page.locator("#row-demo-row-1")).toHaveClass(/hl-green/);

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("#row-demo-row-1").getByText("1 note")).toBeVisible();
  await expect(page.locator("#row-demo-row-1")).toHaveClass(/hl-green/);
  await expect(page.getByText("Demo row 6 trigger")).toBeVisible(); // branch choice remembered
  await page.locator("#row-demo-row-1").getByText("1 note").click();
  await expect(page.getByText("Offline note")).toBeVisible();
  await context.setOffline(false);
});

test("airplane-mode cold start: app opens with no network at all", async ({ page, context }) => {
  await waitForServiceWorker(page);
  await page.close();
  await context.setOffline(true);
  const fresh = await context.newPage();
  await fresh.goto("./", { waitUntil: "domcontentloaded" });
  await expect(fresh.getByRole("heading", { name: "Library" })).toBeVisible();
  await expect(fresh.getByText("Demo procedure (placeholder, not real)")).toBeVisible();
  await fresh.goto("./#/p/demo-procedure", { waitUntil: "domcontentloaded" });
  await expect(fresh.getByText("Demo row 1 trigger")).toBeVisible();
  await context.setOffline(false);
});
