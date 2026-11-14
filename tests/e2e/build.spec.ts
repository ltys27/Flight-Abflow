import { expect, test, devices } from "@playwright/test";

test.use({ viewport: devices["iPhone 13"].viewport, hasTouch: true });

test("build a procedure on a phone with typing and Return only; paste more rows; nothing typed is lost on Done", async ({ page }) => {
  await page.goto("./#/new", { waitUntil: "networkidle" });
  await page.keyboard.type("Demo build"); // name field is focused on arrival
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#\/p\/demo-build\/edit/);
  await expect(page.getByLabel("Gate title")).toBeFocused();

  const type = async (...steps: string[]) => {
    for (const s of steps) {
      if (s) await page.keyboard.type(s);
      await page.keyboard.press("Enter");
    }
  };
  // gate title, aim (skipped), then two full rows: trigger, PF action, PF callout, PM action, PM callout
  await type("Demo gate A", "");
  await type("Demo trigger 1", "Demo PF 1", "Demo PF call 1", "Demo PM 1", "");
  await type("Demo trigger 2", "Demo PF 2", "", "Demo PM 2", "Demo PM call 2");
  await expect(page.locator(".erow")).toHaveCount(3); // Return at the end opened a third row
  await expect(page.getByLabel("Trigger").nth(2)).toBeFocused();
  // Filled rows need no manual status change.
  await expect(page.locator(".erow").nth(0).locator(".status-badge")).toHaveCount(0);

  // One undo removes a whole typed phrase, not one character.
  await page.getByLabel("Trigger").nth(1).click();
  await page.keyboard.type(" EXTRA");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByLabel("Trigger").nth(1)).toHaveValue("Demo trigger 2");

  // Paste rows from plain text.
  await page.getByRole("button", { name: "Paste rows…" }).click();
  await page.getByRole("textbox", { name: "Rows" }).fill('Demo trigger 3 | Demo PF 3 "Demo PF call 3" | -\nDemo trigger 4 | Demo PF 4 | Demo PM 4');
  await page.getByRole("button", { name: "Add 2 rows" }).click();
  await expect(page.locator(".erow")).toHaveCount(4); // the unused blank row was replaced

  // Type and leave immediately: the last keystrokes must be saved.
  await page.getByLabel("Trigger").nth(3).click();
  await page.keyboard.type(" final");
  await page.getByRole("link", { name: /Done/ }).click();

  await expect(page.getByRole("heading", { name: "Demo build" })).toBeVisible();
  await expect(page.locator(".row-card")).toHaveCount(4);
  await expect(page.getByText("Demo trigger 4 final")).toBeVisible();
  await expect(page.getByText("“Demo PF call 3”")).toBeVisible();
  await expect(page.locator(".status-badge")).toHaveCount(0); // every row complete, none flagged
  await expect(page.locator(".standing")).toHaveCount(1); // the "-" lane
});
