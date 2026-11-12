/** Offline readiness diagnostics shown in Settings. */
export interface OfflineStatus {
  supported: boolean;
  registered: boolean;
  scope?: string;
  state?: string;
  controlling: boolean;
  cachedFiles: number;
  precached: boolean;
  installedThisSession: boolean;
  standalone: boolean;
}

let installedThisSession = false;
export const markOfflineReady = () => {
  installedThisSession = true;
};

export async function getOfflineStatus(): Promise<OfflineStatus> {
  const supported = "serviceWorker" in navigator && "caches" in window;
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
  if (!supported) return { supported, registered: false, controlling: false, cachedFiles: 0, precached: false, installedThisSession, standalone };
  let reg: ServiceWorkerRegistration | undefined;
  try {
    reg = await navigator.serviceWorker.getRegistration();
  } catch {
    /* ignore */
  }
  let cachedFiles = 0;
  let precached = false;
  try {
    for (const key of await caches.keys()) {
      const c = await caches.open(key);
      const keys = await c.keys();
      cachedFiles += keys.length;
      if (keys.some((r) => r.url.includes("index.html")) && keys.some((r) => r.url.includes("procedures/index.json"))) precached = true;
    }
  } catch {
    /* ignore */
  }
  const sw = reg?.active ?? reg?.waiting ?? reg?.installing;
  return {
    supported,
    registered: !!reg,
    scope: reg?.scope,
    state: sw?.state,
    controlling: !!navigator.serviceWorker.controller,
    cachedFiles,
    precached,
    installedThisSession,
    standalone,
  };
}

/** Re-register the worker and ask it to check for updates, so the precache is (re)filled. */
export async function prepareOffline(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("./sw.js", { scope: "./" }));
  await reg.update();
  await navigator.serviceWorker.ready;
}
