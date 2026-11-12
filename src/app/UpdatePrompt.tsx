import { useEffect, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { markOfflineReady } from "./offlineStatus";

/** "Update available — reload". Never reloads automatically (spec 9). Also announces offline readiness once. */
export function UpdatePrompt() {
  const [readyNotice, setReadyNotice] = useState(false);
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady],
    updateServiceWorker,
  } = useRegisterSW({ immediate: true });
  useEffect(() => {
    if (!offlineReady) return;
    markOfflineReady();
    setReadyNotice(true);
    const t = window.setTimeout(() => setReadyNotice(false), 5000);
    return () => window.clearTimeout(t);
  }, [offlineReady]);
  if (needRefresh) {
    return (
      <div className="toast" role="status">
        <span>Update available</span>
        <button type="button" className="btn small primary" onClick={() => void updateServiceWorker()}>
          Reload
        </button>
        <button type="button" className="btn small" onClick={() => setNeedRefresh(false)} aria-label="Dismiss update notice">
          Later
        </button>
      </div>
    );
  }
  if (readyNotice) {
    return (
      <div className="toast" role="status" style={{ bottom: "calc(120px + env(safe-area-inset-bottom))" }}>
        <span>Ready to work offline</span>
      </div>
    );
  }
  return null;
}
