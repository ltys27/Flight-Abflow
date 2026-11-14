import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

test("edit a row, reorder, export JSON, re-import as a new procedure", async ({ page }) => {
  await page.goto("./#/p/demo-procedure/edit", { waitUntil: "networkidle" });
  const trigger = page.getByLabel("Trigger").first();
  await trigger.fill("Edited trigger text");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 5000 });

  // Reorder with the keyboard: pick up row 1.1, move down one, drop.
  const handle = page.getByRole("button", { name: "Drag to reorder row 1.1" });
  await handle.focus();
  await page.keyboard.press("Space");
  await expect(page.locator("[id^=DndLiveRegion]", { hasText: "was moved over droppable area demo-row-1" })).toHaveCount(1);
  await page.keyboard.press("ArrowDown");
  await expect(page.locator("[id^=DndLiveRegion]", { hasText: "was moved over droppable area demo-row-2" })).toHaveCount(1);
  await page.keyboard.press("Space");
  await expect(page.locator("[id^=DndLiveRegion]", { hasText: "was dropped" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Drag to reorder row 1.2" })).toBeVisible();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 5000 });
  const triggers = await page.getByLabel("Trigger").evaluateAll((els) => els.map((e) => (e as HTMLTextAreaElement).value));
  expect(triggers[1]).toBe("Edited trigger text");

  // Export JSON.
  await page.getByRole("button", { name: "More", exact: true }).click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export JSON" }).click()]);
  const path = await download.path();
  const json = JSON.parse(readFileSync(path!, "utf8"));
  expect(json.id).toBe("demo-procedure");
  expect(json.version).toBe(2);
  expect(json.gates[0].rows[1].trigger).toBe("Edited trigger text");

  // Re-import as a new procedure under a different id.
  await page.goto("./#/new", { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: "Paste or import" }).click();
  await page.getByLabel("Paste here").fill(JSON.stringify(json));
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByText("already exists")).toBeVisible();
  await page.getByLabel("Import under a different id").fill("demo-copy");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page).toHaveURL(/#\/p\/demo-copy\/edit/);
  await page.goto("./#/p/demo-copy", { waitUntil: "networkidle" });
  await expect(page.getByText("Edited trigger text")).toBeVisible();
  await page.goto("./#/", { waitUntil: "networkidle" });
  await expect(page.getByText("mine")).toBeVisible();
});
