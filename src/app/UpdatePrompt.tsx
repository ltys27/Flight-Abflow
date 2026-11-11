import { useRegisterSW } from "virtual:pwa-register/react";

/** "Update available — reload". Never reloads automatically (spec 9). */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({ immediate: true });
  if (!needRefresh) return null;
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
