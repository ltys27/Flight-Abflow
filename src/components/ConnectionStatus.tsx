import { useState, useSyncExternalStore } from "react";
import { probe, useConnection } from "../app/connection";
import { useSettings } from "../state/settings";
import { isSyncing, subscribeSyncing, syncNow } from "../sync/sync";
import { Sheet } from "./Sheet";
import { href } from "../app/router";

type Tone = "ok" | "off" | "warn" | "busy";

const timeLabel = (iso: string) => {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString([], { day: "numeric", month: "short" });
};

/** What to show, as plain data so it can be tested without rendering. */
export function describeStatus(input: {
  connection: "online" | "offline" | "checking";
  syncEnabled: boolean;
  syncing: boolean;
  lastSyncOk: boolean | null;
  lastSyncAt: string | null;
  lastSyncMessage: string | null;
  pending: boolean;
}): { tone: Tone; label: string; detail: string } {
  const { connection, syncEnabled, syncing, lastSyncOk, lastSyncAt, lastSyncMessage, pending } = input;
  if (connection === "offline") {
    return {
      tone: "off",
      label: "Offline",
      detail: syncEnabled
        ? pending
          ? "Your changes are saved on this device and will sync when you are back online."
          : "Everything is saved on this device. Sync resumes when you are back online."
        : "Everything is saved on this device. The app works fully without a connection.",
    };
  }
  if (connection === "checking") return { tone: "busy", label: "Checking…", detail: "Checking the connection." };
  if (!syncEnabled) return { tone: "ok", label: "Online", detail: "Connected. Sync is not set up, so data stays on this device only." };
  if (syncing) return { tone: "busy", label: "Online · syncing…", detail: "Syncing with your repository now." };
  if (lastSyncOk === false) return { tone: "warn", label: "Online · sync failed", detail: lastSyncMessage ?? "The last sync did not complete." };
  if (pending) return { tone: "busy", label: "Online · changes waiting", detail: "Recent changes will be uploaded in a few seconds." };
  if (lastSyncAt) return { tone: "ok", label: `Online · synced ${timeLabel(lastSyncAt)}`, detail: lastSyncMessage ?? "In sync with your repository." };
  return { tone: "ok", label: "Online · not synced yet", detail: "Sync is on; the first sync has not run yet." };
}

/** Connection + sync indicator. Text and dot shape carry the state, not colour alone. */
export function ConnectionStatus({ compact = false }: { compact?: boolean }) {
  const connection = useConnection();
  const s = useSettings();
  const syncing = useSyncExternalStore(subscribeSyncing, isSyncing, () => false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const syncEnabled = !!s.syncConfig?.enabled && !!s.syncConfig.token;
  const pending = syncEnabled && !!s.lastDataChangeAt && (!s.lastSyncAt || s.lastDataChangeAt > s.lastSyncAt);
  const st = describeStatus({
    connection,
    syncEnabled,
    syncing,
    lastSyncOk: s.lastSyncState ? s.lastSyncState.ok : null,
    lastSyncAt: s.lastSyncAt,
    lastSyncMessage: s.lastSyncState?.message ?? null,
    pending,
  });
  return (
    <>
      <button type="button" className={`conn conn-${st.tone}${compact ? " compact" : ""}`} onClick={() => setOpen(true)} aria-label={`Connection: ${st.label}. Tap for details.`} aria-haspopup="dialog">
        <span className="conn-dot" aria-hidden="true" />
        {!compact && <span className="conn-label">{st.label}</span>}
        {compact && <span className="conn-label">{connection === "offline" ? "Offline" : ""}</span>}
      </button>
      {open && (
        <Sheet title={st.label} onClose={() => setOpen(false)}>
          <p>{st.detail}</p>
          {syncEnabled && s.lastSyncState && (
            <p className="small muted">Last sync attempt {new Date(s.lastSyncState.at).toLocaleString()}: {s.lastSyncState.message}</p>
          )}
          <div className="row-actions">
            {syncEnabled && (
              <button type="button" className="btn primary" disabled={busy || connection === "offline"} onClick={async () => { setBusy(true); await syncNow("manual"); setBusy(false); }}>
                {busy ? "Syncing…" : "Sync now"}
              </button>
            )}
            <button type="button" className="btn" disabled={busy} onClick={async () => { setBusy(true); await probe(); setBusy(false); }}>Check connection</button>
            {!syncEnabled && <a className="btn" href={href.settings()} onClick={() => setOpen(false)}>Set up sync</a>}
            <button type="button" className="btn" onClick={() => setOpen(false)}>Close</button>
          </div>
        </Sheet>
      )}
    </>
  );
}
