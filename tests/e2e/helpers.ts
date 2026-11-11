import type { Page } from "@playwright/test";

/** Wait until the service worker controls the page so offline navigation works. */
export async function waitForServiceWorker(page: Page): Promise<void> {
  await page.goto("./", { waitUntil: "networkidle" });
  await page.evaluate(() => navigator.serviceWorker.ready);
  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) {
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  }
  // Give Workbox a moment to finish precaching.
  await page.waitForFunction(async () => {
    const keys = await caches.keys();
    for (const k of keys) {
      const c = await caches.open(k);
      const entries = await c.keys();
      if (entries.some((r) => r.url.includes("procedures/demo-procedure.json"))) return true;
    }
    return false;
  });
}

export async function readReviewItems(page: Page): Promise<Array<{ procedureId: string; rowId: string; role: string; due: string }>> {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open("flow-scripts");
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction("reviewItems", "readonly");
          const all = tx.objectStore("reviewItems").getAll();
          all.onsuccess = () => resolve(all.result);
          all.onerror = () => reject(all.error);
        };
      }),
  );
}
