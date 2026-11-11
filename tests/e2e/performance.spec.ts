import { expect, test } from "@playwright/test";

/** Spec 10: 200 procedures × 60 rows. Library < 1 s, procedure < 300 ms on a mid-range phone; here we record desktop headless numbers. */
function bigBackup() {
  const userProcedures = [];
  for (let p = 0; p < 200; p++) {
    const gates = [];
    for (let g = 0; g < 6; g++) {
      const rows = [];
      for (let r = 0; r < 10; r++) {
        rows.push({ id: `p${p}g${g}r${r}`, trigger: `Demo row ${r + 1} trigger of gate ${g + 1}`, pf: { action: `Demo PF action ${r + 1}`, callout: r % 3 === 0 ? `Demo callout ${r + 1}` : undefined }, pm: { action: `Demo PM action ${r + 1}` }, status: "ok" });
      }
      gates.push({ id: `p${p}g${g}`, title: `Demo gate ${g + 1}`, layout: "two-lane", rows });
    }
    const id = `perf-${String(p).padStart(3, "0")}`;
    userProcedures.push({ procedureId: id, updatedAt: "2026-01-01T00:00:00Z", procedure: { schemaVersion: 1, id, title: `Perf demo procedure ${p}`, category: "MISC", fleets: ["CEO"], tags: ["perf"], version: 1, relatedProcedures: [], gates, referenceTables: [] } });
  }
  return { backupVersion: 1, createdAt: "2026-01-01T00:00:00Z", overlays: [], userProcedures, annotations: [], blobs: [], reviewItems: [], reviewLog: [], sessions: [], settings: [] };
}

test("library of 200 procedures × 60 rows restores from backup and opens fast", async ({ page }) => {
  await page.goto("./#/settings", { waitUntil: "networkidle" });
  const file = Buffer.from(JSON.stringify(bigBackup()));
  await page.getByLabel("Choose backup file").setInputFiles({ name: "backup.json", mimeType: "application/json", buffer: file });
  await expect(page.getByRole("dialog", { name: "Restore backup" })).toBeVisible();
  await expect(page.getByRole("dialog").getByText("200")).toBeVisible();
  await page.getByRole("button", { name: "Replace everything" }).click();
  await expect(page.getByText("Replaced all data from backup")).toBeVisible();

  const t0 = Date.now();
  await page.goto("./#/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("list", { name: "Procedures" }).locator("li")).toHaveCount(201);
  const libraryMs = Date.now() - t0;

  const t1 = Date.now();
  await page.goto("./#/p/perf-100", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Demo row 10 trigger of gate 6")).toBeVisible();
  const procedureMs = Date.now() - t1;

  console.log(`PERF library=${libraryMs}ms procedure=${procedureMs}ms (includes navigation and IndexedDB read)`);
  expect(libraryMs).toBeLessThan(3000);
  expect(procedureMs).toBeLessThan(1500);

  // Search still works across 12,000 rows.
  await page.goto("./#/", { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("Search title, tags, rows, notes").fill("procedure 199");
  await expect(page.getByRole("list", { name: "Procedures" }).locator("li")).toHaveCount(1);
});
