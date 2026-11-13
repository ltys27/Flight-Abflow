import { useEffect, useRef, useState } from "react";
import { useSettings, setSetting, type Theme, type TextSize, type DefaultRole, type SyncConfig } from "../state/settings";
import { githubClient } from "../sync/github";
import { syncNow } from "../sync/sync";
import { useLibrary } from "../state/LibraryProvider";
import { exportBackup, parseBackup, restoreBackup, eraseAllData, storageEstimate, type BackupSummary, type BackupFile } from "../backup/backup";
import { downloadText } from "../edit/export";
import { Confirm } from "../components/Confirm";
import { Sheet } from "../components/Sheet";
import { useToast } from "../components/Toast";
import { nowIso } from "../util/id";
import { getOfflineStatus, prepareOffline, type OfflineStatus } from "../app/offlineStatus";

export function SettingsScreen() {
  const s = useSettings();
  const lib = useLibrary();
  const toast = useToast();
  const [storage, setStorage] = useState<{ usage: number; quota: number; persisted: boolean | null } | null>(null);
  const [pending, setPending] = useState<{ backup: BackupFile; summary: BackupSummary } | null>(null);
  const [erase, setErase] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const [offline, setOffline] = useState<OfflineStatus | null>(null);
  const [syncDraft, setSyncDraft] = useState<SyncConfig | null>(null);
  const [syncBusy, setSyncBusy] = useState<"" | "test" | "sync">("");
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const sync: SyncConfig = syncDraft ?? s.syncConfig ?? { enabled: false, repo: "", branch: "main", path: "flow-scripts", token: "" };
  const editSync = (patch: Partial<SyncConfig>) => setSyncDraft({ ...sync, ...patch });
  const saveSync = async (next: SyncConfig) => {
    await setSetting("syncConfig", next);
    setSyncDraft(null);
  };
  const [preparing, setPreparing] = useState(false);
  useEffect(() => {
    void getOfflineStatus().then(setOffline);
  }, []);

  useEffect(() => {
    void storageEstimate().then(setStorage);
  }, [s.lastDataChangeAt]);

  const backup = async () => {
    const b = await exportBackup();
    downloadText(`flow-scripts-backup-${b.createdAt.slice(0, 10)}.json`, JSON.stringify(b));
    await setSetting("lastBackupAt", nowIso());
    toast.show("Backup file created");
  };
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    const r = parseBackup(await f.text());
    if (!r.ok) return setRestoreError(r.error);
    setRestoreError(null);
    setPending({ backup: r.backup, summary: r.summary });
  };
  const fmtBytes = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} kB`);

  return (
    <>
      <h1>Settings</h1>
      <section className="card">
        <h2 style={{ marginTop: 0 }}>Appearance</h2>
        <label className="field"><span>Theme</span>
          <select value={s.theme} onChange={(e) => void setSetting("theme", e.target.value as Theme)}><option value="dark">Dark</option><option value="light">Light</option><option value="system">System</option></select>
        </label>
        <label className="field"><span>Text size</span>
          <select value={s.textSize} onChange={(e) => void setSetting("textSize", e.target.value as TextSize)}><option value="small">Small</option><option value="normal">Normal</option><option value="large">Large</option><option value="xlarge">Extra large</option></select>
        </label>
        <label className="field"><span>Finger drawing</span>
          <select value={s.fingerDrawing ? "on" : "off"} onChange={(e) => void setSetting("fingerDrawing", e.target.value === "on")}><option value="off">Off (finger scrolls, stylus draws)</option><option value="on">On (finger draws too)</option></select>
        </label>
      </section>
      <section className="card">
        <h2 style={{ marginTop: 0 }}>Drills and review</h2>
        <label className="field"><span>Default role</span>
          <select value={s.defaultRole} onChange={(e) => void setSetting("defaultRole", e.target.value as DefaultRole)}><option value="PF">PF</option><option value="PM">PM</option><option value="both">Both</option></select>
        </label>
        <label className="field"><span>Daily new items limit</span>
          <input type="number" min={0} max={500} value={s.dailyNewLimit} onChange={(e) => void setSetting("dailyNewLimit", Math.max(0, Number(e.target.value) || 0))} />
        </label>
        <label className="field"><span>Audio rate ({s.audioRate.toFixed(1)}×)</span>
          <input type="range" min={0.5} max={2} step={0.1} value={s.audioRate} onChange={(e) => void setSetting("audioRate", Number(e.target.value))} />
        </label>
        <label className="field"><span>Audio gap before the answer (seconds)</span>
          <input type="number" min={0} max={30} value={s.audioGapSeconds} onChange={(e) => void setSetting("audioGapSeconds", Math.max(0, Number(e.target.value) || 0))} />
        </label>
      </section>
      <section className="card">
        <h2 style={{ marginTop: 0 }}>Target dates</h2>
        <label className="field"><span>Global target date</span>
          <input type="date" value={s.targetDate ?? ""} onChange={(e) => void setSetting("targetDate", e.target.value || null)} />
        </label>
        {lib.entries.map((e) => (
          <label key={e.id} className="field"><span>{e.procedure.title}</span>
            <input type="date" value={s.procedureTargetDates[e.id] ?? ""} onChange={(ev) => { const next = { ...s.procedureTargetDates }; if (ev.target.value) next[e.id] = ev.target.value; else delete next[e.id]; void setSetting("procedureTargetDates", next); }} />
          </label>
        ))}
      </section>
      <section className="card" aria-label="Offline">
        <h2 style={{ marginTop: 0 }}>Offline</h2>
        {offline && (
          <>
            <p className={`banner ${offline.precached && offline.registered ? "" : "warn"}`} role="status">
              {!offline.supported
                ? "This browser cannot store the app for offline use (private browsing, or service workers disabled)."
                : offline.precached && offline.registered
                  ? "Ready: the app and all procedures are stored on this device and open without a connection."
                  : offline.registered
                    ? "Not ready yet: the offline copy is still being stored. Stay online for a moment, then check again."
                    : "Not ready: the offline worker is not installed. Make sure you are online and tap Prepare offline."}
            </p>
            <div className="kv small">
              <span>Worker</span><span>{offline.registered ? `${offline.state ?? "registered"}${offline.controlling ? ", controlling this page" : ", not yet controlling this page"}` : "not registered"}</span>
              <span>Cached files</span><span>{offline.cachedFiles}</span>
              <span>Running as</span><span>{offline.standalone ? "installed app" : "browser tab"}</span>
            </div>
            <div className="row-actions" style={{ marginTop: 8 }}>
              <button type="button" className="btn small primary" disabled={preparing || !offline.supported} onClick={async () => { setPreparing(true); try { await prepareOffline(); } catch (e) { toast.show(`Could not prepare: ${(e as Error).message}`); } setOffline(await getOfflineStatus()); setPreparing(false); }}>{preparing ? "Preparing…" : "Prepare offline"}</button>
              <button type="button" className="btn small" onClick={async () => setOffline(await getOfflineStatus())}>Check again</button>
            </div>
          </>
        )}
      </section>
      <section className="card">
        <h2 style={{ marginTop: 0 }}>Storage</h2>
        {storage && (
          <div className="kv small">
            <span>Persistent storage</span><span>{storage.persisted === null ? "unknown" : storage.persisted ? "granted" : "not granted (the browser may evict data under pressure)"}</span>
            <span>Usage</span><span>{fmtBytes(storage.usage)}{storage.quota ? ` of ${fmtBytes(storage.quota)}` : ""}</span>
          </div>
        )}
        <button type="button" className="btn small" style={{ marginTop: 8 }} onClick={async () => { try { await navigator.storage?.persist?.(); } catch { /* ignore */ } setStorage(await storageEstimate()); }}>Request persistent storage</button>
      </section>
      <section className="card" aria-label="Sync">
        <h2 style={{ marginTop: 0 }}>Sync with a GitHub repository</h2>
        <p className="small muted">Optional. Keeps every device with the same notes, edits and review history by storing them as files in a repository you own. Use a <strong>private</strong> repository and a fine-grained personal access token limited to that repository with Contents: read and write. The token stays on this device and is never included in backups or sync files.</p>
        <label className="field" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={sync.enabled} onChange={(e) => { const next = { ...sync, enabled: e.target.checked }; void saveSync(next); if (next.enabled && next.token) void syncNow("enabled"); }} style={{ width: 24, height: 24, minHeight: 0 }} />
          <span style={{ margin: 0 }}>Enable sync</span>
        </label>
        <label className="field"><span>Repository (owner/name)</span><input type="text" value={sync.repo} placeholder="ltys27/flight-data" autoCapitalize="none" autoCorrect="off" onChange={(e) => editSync({ repo: e.target.value.trim() })} /></label>
        <div className="edit-grid two">
          <label className="field"><span>Branch</span><input type="text" value={sync.branch} onChange={(e) => editSync({ branch: e.target.value.trim() })} /></label>
          <label className="field"><span>Folder in the repository</span><input type="text" value={sync.path} placeholder="flow-scripts" onChange={(e) => editSync({ path: e.target.value.trim() })} /></label>
        </div>
        <label className="field"><span>Personal access token</span><input type="password" value={sync.token} autoComplete="off" onChange={(e) => editSync({ token: e.target.value.trim() })} /></label>
        <div className="row-actions">
          {syncDraft && <button type="button" className="btn small primary" onClick={() => void saveSync(sync)}>Save settings</button>}
          <button type="button" className="btn small" disabled={!sync.repo || !sync.token || syncBusy !== ""} onClick={async () => { setSyncBusy("test"); const r = await githubClient(sync).test(); setSyncMsg(r.message); setSyncBusy(""); }}>{syncBusy === "test" ? "Testing…" : "Test connection"}</button>
          <button type="button" className="btn small" disabled={!s.syncConfig?.enabled || !s.syncConfig.token || syncBusy !== ""} onClick={async () => { if (syncDraft) await saveSync(sync); setSyncBusy("sync"); const r = await syncNow("manual"); setSyncMsg(r.message); setSyncBusy(""); }}>{syncBusy === "sync" ? "Syncing…" : "Sync now"}</button>
        </div>
        {syncMsg && <p className="small" role="status">{syncMsg}</p>}
        {s.lastSyncState && (
          <p className={`small ${s.lastSyncState.ok ? "muted" : ""}`} style={s.lastSyncState.ok ? undefined : { color: "var(--danger)" }}>
            Last sync {new Date(s.lastSyncState.at).toLocaleString()}: {s.lastSyncState.message}
          </p>
        )}
        {s.syncConfig?.enabled && <p className="small muted">Syncs on launch, when the device comes back online, about 15 seconds after a change, and every 10 minutes while open. Newer changes win per item; deletions are kept.</p>}
      </section>
      <section className="card">
        <h2 style={{ marginTop: 0 }}>Backup and restore</h2>
        <p className="small muted">Last backup: {s.lastBackupAt ? new Date(s.lastBackupAt).toLocaleString() : "never"}</p>
        <div className="row-actions">
          <button type="button" className="btn primary" onClick={() => void backup()}>Back up to file</button>
          <input ref={file} type="file" accept="application/json,.json" className="visually-hidden" onChange={(e) => void onFile(e.target.files?.[0])} aria-label="Choose backup file" />
          <button type="button" className="btn" onClick={() => file.current?.click()}>Restore from file…</button>
        </div>
        {restoreError && <p className="banner danger">{restoreError}</p>}
      </section>
      <section className="card">
        <h2 style={{ marginTop: 0 }}>Danger zone</h2>
        <button type="button" className="btn danger" onClick={() => setErase(true)}>Erase all data…</button>
      </section>
      <p className="small muted">All data stays on this device. The app makes no network requests other than loading its own files.</p>

      {pending && (
        <Sheet title="Restore backup" onClose={() => setPending(null)}>
          <p className="small muted">Created {new Date(pending.summary.createdAt).toLocaleString()}</p>
          <div className="kv small">
            {Object.entries(pending.summary.counts).map(([k, v]) => (<span key={k} style={{ display: "contents" }}><span>{k}</span><span>{v}</span></span>))}
          </div>
          <div className="row-actions" style={{ marginTop: 12 }}>
            <button type="button" className="btn primary" onClick={async () => { await restoreBackup(pending.backup, "merge"); setPending(null); toast.show("Merged: newer records won"); }}>Merge (newer wins)</button>
            <button type="button" className="btn danger" onClick={async () => { await restoreBackup(pending.backup, "replace"); setPending(null); toast.show("Replaced all data from backup"); }}>Replace everything</button>
            <button type="button" className="btn" onClick={() => setPending(null)}>Cancel</button>
          </div>
        </Sheet>
      )}
      {erase && (
        <Confirm title="Erase all data" message="This deletes every edit, annotation, voice memo, review record, session and setting on this device. Back up first." confirmLabel="Erase everything" danger typed="ERASE" onCancel={() => setErase(false)} onConfirm={async () => { await eraseAllData(); setErase(false); toast.show("All data erased"); }} />
      )}
    </>
  );
}
