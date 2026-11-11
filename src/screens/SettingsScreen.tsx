import { useEffect, useRef, useState } from "react";
import { useSettings, setSetting, type Theme, type TextSize, type DefaultRole } from "../state/settings";
import { useLibrary } from "../state/LibraryProvider";
import { exportBackup, parseBackup, restoreBackup, eraseAllData, storageEstimate, type BackupSummary, type BackupFile } from "../backup/backup";
import { downloadText } from "../edit/export";
import { Confirm } from "../components/Confirm";
import { Sheet } from "../components/Sheet";
import { useToast } from "../components/Toast";
import { nowIso } from "../util/id";

export function SettingsScreen() {
  const s = useSettings();
  const lib = useLibrary();
  const toast = useToast();
  const [storage, setStorage] = useState<{ usage: number; quota: number; persisted: boolean | null } | null>(null);
  const [pending, setPending] = useState<{ backup: BackupFile; summary: BackupSummary } | null>(null);
  const [erase, setErase] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

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
