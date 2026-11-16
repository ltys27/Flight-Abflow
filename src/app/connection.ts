import { useSyncExternalStore } from "react";

/**
 * Connection state shared by the whole app. `navigator.onLine` alone says
 * "online" on Wi-Fi with no internet, so while it reports online we confirm
 * with a tiny HEAD request for one of the app's own files (HEAD bypasses the
 * service worker cache, so the answer really comes from the network).
 */
export type Connection = "online" | "offline" | "checking";

let state: Connection = typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "checking";
const listeners = new Set<() => void>();
let started = false;
let timer: number | null = null;

function set(next: Connection) {
  if (next === state) return;
  state = next;
  listeners.forEach((l) => l());
}

export async function probe(): Promise<Connection> {
  if (navigator.onLine === false) {
    set("offline");
    return state;
  }
  const ctrl = new AbortController();
  const t = window.setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(`./manifest.webmanifest?ping=${Date.now()}`, { method: "HEAD", cache: "no-store", signal: ctrl.signal });
    set(res.ok || res.status === 304 || res.status === 405 ? "online" : "offline");
  } catch {
    set("offline");
  } finally {
    window.clearTimeout(t);
  }
  return state;
}

/** Other parts of the app can report what they learned (a sync that reached GitHub proves we are online). */
export function reportOnline(): void {
  set("online");
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener("online", () => void probe());
  window.addEventListener("offline", () => set("offline"));
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && void probe());
  timer = window.setInterval(() => document.visibilityState === "visible" && void probe(), 60_000);
  void probe();
}

function subscribe(l: () => void) {
  start();
  listeners.add(l);
  return () => {
    listeners.delete(l);
    if (listeners.size === 0 && timer !== null) {
      /* keep the single interval; it is cheap and the app shell always subscribes */
    }
  };
}

export function useConnection(): Connection {
  return useSyncExternalStore(subscribe, () => state, () => "checking");
}
