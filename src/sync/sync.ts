import { db, type FlowDb } from "../db/db";
import { DEVICE_ONLY_SETTINGS, getSetting, setSetting, type SyncConfig, type SyncState } from "../state/settings";
import { blobBytes } from "../backup/backup";
import { buildSnapshot, mergeSnapshot, snapshotFingerprint, type Snapshot } from "./merge";
import { githubClient, SyncConflictError, type RepoClient } from "./github";

/**
 * Two-way sync with a GitHub repository (opt-in). One JSON file holds every
 * table except voice memos; each memo is its own file under blobs/.
 * Pull, merge (newer wins, tombstones respected), push if anything differs.
 */
export const SYNC_FORMAT = 1;
const DATA_FILE = "data.json";

interface RemoteDoc {
  syncFormat: number;
  updatedAt: string;
  device?: string;
  snapshot: Snapshot;
}

let inFlight: Promise<SyncState> | null = null;

export function syncPaths(cfg: Pick<SyncConfig, "path">) {
  const dir = cfg.path.replace(/^\/+|\/+$/g, "");
  const prefix = dir ? `${dir}/` : "";
  return { data: `${prefix}${DATA_FILE}`, blob: (id: string) => `${prefix}blobs/${id}` };
}

export async function syncNow(reason: string, database: FlowDb = db, client?: RepoClient, cfgOverride?: SyncConfig): Promise<SyncState> {
  if (inFlight) return inFlight;
  inFlight = run(reason, database, client, cfgOverride).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function run(reason: string, database: FlowDb, clientIn?: RepoClient, cfgOverride?: SyncConfig): Promise<SyncState> {
  const cfg = cfgOverride ?? (await getSetting("syncConfig"));
  const done = async (state: Omit<SyncState, "at">): Promise<SyncState> => {
    const full = { ...state, at: new Date().toISOString() };
    if (!cfgOverride) {
      await setSetting("lastSyncState", full);
      if (full.ok) await setSetting("lastSyncAt", full.at);
    }
    return full;
  };
  if (!cfg?.enabled || !cfg.token || !cfg.repo) return done({ ok: false, message: "Sync is not set up." });
  if (typeof navigator !== "undefined" && navigator.onLine === false) return done({ ok: false, message: "Offline; will sync when back online." });
  const client = clientIn ?? githubClient(cfg);
  const paths = syncPaths(cfg);
  const dec = new TextDecoder();
  const enc = new TextEncoder();

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const remote = await client.getFile(paths.data);
      let pulled = false;
      let remoteFingerprint: string | null = null;
      if (remote) {
        let doc: RemoteDoc;
        try {
          doc = JSON.parse(dec.decode(remote.bytes)) as RemoteDoc;
        } catch {
          return done({ ok: false, message: `The sync file in the repository is not valid JSON (${paths.data}).` });
        }
        if (doc.syncFormat !== SYNC_FORMAT) return done({ ok: false, message: `Sync file format ${doc.syncFormat} is not supported by this app version.` });
        remoteFingerprint = snapshotFingerprint(doc.snapshot);
        const res = await mergeSnapshot(doc.snapshot, database, async (id) => {
          const f = await client.getFile(paths.blob(id));
          if (!f) return null;
          const meta = doc.snapshot.blobs.find((b) => b.id === id);
          return new Blob([f.bytes as BlobPart], { type: meta?.mime ?? "application/octet-stream" });
        });
        pulled = res.changed;
      }
      const local = await buildSnapshot(database, DEVICE_ONLY_SETTINGS);
      const localFingerprint = snapshotFingerprint(local);
      let pushed = false;
      if (localFingerprint !== remoteFingerprint) {
        // Upload any referenced blob the remote does not have yet.
        const remoteBlobIds = new Set((remote ? (JSON.parse(dec.decode(remote.bytes)) as RemoteDoc).snapshot.blobs : []).map((b) => b.id));
        for (const meta of local.blobs) {
          if (remoteBlobIds.has(meta.id)) continue;
          const rec = await database.blobs.get(meta.id);
          if (!rec) continue;
          const existing = await client.getFile(paths.blob(meta.id));
          if (!existing) await client.putFile(paths.blob(meta.id), new Uint8Array(await blobBytes(rec.data)), `Flow Scripts: voice memo ${meta.id}`);
        }
        const doc: RemoteDoc = { syncFormat: SYNC_FORMAT, updatedAt: new Date().toISOString(), snapshot: local };
        await client.putFile(paths.data, enc.encode(JSON.stringify(doc)), `Flow Scripts sync (${reason})`, remote?.sha);
        pushed = true;
      }
      return done({ ok: true, message: pushed && pulled ? "Merged changes both ways" : pushed ? "Uploaded local changes" : pulled ? "Downloaded changes" : "Already in sync", pushed, pulled });
    } catch (e) {
      if (e instanceof SyncConflictError && attempt < 2) continue; // someone else pushed: pull again and retry
      return done({ ok: false, message: (e as Error).message });
    }
  }
  return done({ ok: false, message: "Gave up after repeated conflicts; try again." });
}

/** Debounced auto-sync scheduling used by the app shell. */
let timer: number | null = null;
export function scheduleSync(delayMs = 15_000): void {
  if (typeof window === "undefined") return;
  if (timer) window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    timer = null;
    void syncNow("auto");
  }, delayMs);
}
