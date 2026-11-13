import { useEffect } from "react";
import { useSetting } from "../state/settings";
import { scheduleSync, syncNow } from "./sync";

/** Sync on start, when the device comes back online, after local changes, and every 10 minutes. */
export function useAutoSync(): void {
  const cfg = useSetting("syncConfig");
  const enabled = !!cfg?.enabled && !!cfg.token;
  useEffect(() => {
    if (!enabled) return;
    void syncNow("startup");
    const onOnline = () => void syncNow("online");
    const onChange = () => scheduleSync();
    const onVisible = () => document.visibilityState === "visible" && void syncNow("foreground");
    window.addEventListener("online", onOnline);
    window.addEventListener("flow:data-changed", onChange);
    document.addEventListener("visibilitychange", onVisible);
    const every = window.setInterval(() => void syncNow("interval"), 10 * 60_000);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("flow:data-changed", onChange);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(every);
    };
  }, [enabled]);
}
