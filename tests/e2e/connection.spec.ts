import { expect, test } from "@playwright/test";

test("status indicator follows the connection and explains itself", async ({ page, context }) => {
  await page.goto("./", { waitUntil: "networkidle" });
  const pill = page.getByRole("button", { name: /^Connection:/ });
  await expect(pill).toContainText("Online");

  await context.setOffline(true);
  await expect(pill).toContainText("Offline");
  await pill.click();
  await expect(page.getByRole("dialog", { name: "Offline" })).toContainText("saved on this device");
  await page.getByRole("button", { name: "Close" }).click();

  await context.setOffline(false);
  await expect(pill).toContainText("Online");

  // The editor carries the compact version.
  await page.goto("./#/p/demo-procedure/edit", { waitUntil: "networkidle" });
  await context.setOffline(true);
  await expect(page.locator(".topbar .conn")).toContainText("Offline");
  await context.setOffline(false);
});
