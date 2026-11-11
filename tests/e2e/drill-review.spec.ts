import { expect, test } from "@playwright/test";
import { readReviewItems } from "./helpers";

test("role-play drill, grade, item appears with a future due date in the review queue", async ({ page }) => {
  await page.goto("./#/p/demo-procedure/drill", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Role play" }).click();
  await page.getByRole("button", { name: "PF", exact: true }).click();
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByText("you are")).toBeVisible();
  const before = Date.now();
  await page.getByRole("button", { name: /Reveal/ }).click();
  await page.getByRole("button", { name: /^Good/ }).click();
  await expect(page.getByText("2 / 4")).toBeVisible();

  const items = await readReviewItems(page);
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({ procedureId: "demo-procedure", rowId: "demo-row-1", role: "PF" });
  expect(new Date(items[0]!.due).getTime()).toBeGreaterThan(before);

  await page.goto("./#/review", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Upcoming" })).toBeVisible();
  await expect(page.locator("ul.small li", { hasText: "Demo row 1 trigger (PF)" })).toBeVisible();
  // The remaining PF items are offered as new, under the daily limit.
  await expect(page.getByText("New today")).toBeVisible();
});
