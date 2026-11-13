import { db, recordKey, TABLE_NAMES, type FlowDb, type SyncedTable, type TombstoneRecord } from "../db/db";

/**
 * Device-independent snapshot of user data. Blobs carry metadata only; their
 * bytes are fetched through `getBlob` when a referenced blob is missing locally.
 */
export interface Snapshot {
  overlays: Record<string, unknown>[];
  userProcedures: Record<string, unknown>[];
  annotations: Record<string, unknown>[];
  reviewItems: Record<string, unknown>[];
  reviewLog: Record<string, unknown>[];
  sessions: Record<string, unknown>[];
  settings: Record<string, unknown>[];
  blobs: Array<{ id: string; mime: string; updatedAt: string }>;
  tombstones: TombstoneRecord[];
}

export const SNAPSHOT_TABLES: SyncedTable[] = TABLE_NAMES.filter((t) => t !== "blobs");

const ts = (r: Record<string, unknown> | undefined) => String(r?.updatedAt ?? "");

/**
 * Merge a snapshot into a database. Per record the newer `updatedAt` wins;
 * a tombstone newer than a record deletes it; tombstones merge by latest.
 * Review log entries are appended when not already present.
 */
export async function mergeSnapshot(
  snap: Snapshot,
  database: FlowDb = db,
  getBlob?: (id: string) => Promise<Blob | null>,
): Promise<{ changed: boolean }> {
  let changed = false;
  const tables = [...TABLE_NAMES.map((t) => database.table(t)), database.tombstones];
  await database.transaction("rw", tables, async () => {
    // 1. Tombstones: union by latest deletedAt.
    const localTombs = new Map((await database.tombstones.toArray()).map((t) => [`${t.table}\u0000${t.key}`, t]));
    for (const t of snap.tombstones ?? []) {
      const k = `${t.table}\u0000${t.key}`;
      const cur = localTombs.get(k);
      if (!cur || cur.deletedAt < t.deletedAt) {
        localTombs.set(k, t);
        await database.tombstones.put(t);
      }
    }
    const tombFor = (table: string, key: string) => localTombs.get(`${table}\u0000${key}`);

    // 2. Records.
    for (const name of SNAPSHOT_TABLES) {
      const table = database.table(name);
      const incoming = snap[name] ?? [];
      for (const raw of incoming) {
        const rec: Record<string, unknown> = { ...raw };
        const key = recordKey(name, rec);
        const tomb = tombFor(name, key);
        if (name === "reviewLog") {
          delete rec.id;
          const dup = await table
            .where("[procedureId+rowId+role]")
            .equals([rec.procedureId as string, rec.rowId as string, rec.role as string])
            .filter((x) => x.reviewedAt === rec.reviewedAt)
            .first();
          if (!dup) {
            await table.add(rec);
            changed = true;
          }
          continue;
        }
        if (tomb && tomb.deletedAt > ts(rec)) continue;
        const pk = name === "reviewItems" ? [rec.procedureId, rec.rowId, rec.role] : name === "settings" ? rec.key : name === "overlays" || name === "userProcedures" ? rec.procedureId : rec.id;
        const existing = (await table.get(pk as never)) as Record<string, unknown> | undefined;
        if (!existing || ts(rec) > ts(existing)) {
          await table.put(rec);
          changed = true;
        }
      }
      // Apply tombstones newer than the local record.
      for (const [, t] of localTombs) {
        if (t.table !== name) continue;
        const all = (await table.toArray()) as Record<string, unknown>[];
        for (const r of all) {
          if (recordKey(name, r) === t.key && ts(r) < t.deletedAt) {
            const pk = name === "reviewItems" ? [r.procedureId, r.rowId, r.role] : name === "settings" ? r.key : name === "overlays" || name === "userProcedures" ? r.procedureId : r.id;
            await table.delete(pk as never);
            changed = true;
          }
        }
      }
    }
  });

  // 3. Blobs referenced by annotations and missing locally.
  if (getBlob) {
    const have = new Set((await database.blobs.toArray()).map((b) => b.id));
    for (const meta of snap.blobs ?? []) {
      if (have.has(meta.id)) continue;
      const referenced = await database.annotations.filter((a) => a.blobId === meta.id).count();
      if (!referenced) continue;
      const data = await getBlob(meta.id);
      if (data) {
        await database.blobs.put({ id: meta.id, mime: meta.mime, data, updatedAt: meta.updatedAt });
        changed = true;
      }
    }
  }
  return { changed };
}

/** Build the snapshot of a database, with a stable ordering for comparison. */
export async function buildSnapshot(database: FlowDb = db, excludeSettings: ReadonlySet<string>): Promise<Snapshot> {
  const sortBy = (name: SyncedTable, rows: Record<string, unknown>[]) => rows.sort((a, b) => (recordKey(name, a) < recordKey(name, b) ? -1 : 1));
  const get = async (name: SyncedTable) => sortBy(name, (await database.table(name).toArray()) as Record<string, unknown>[]);
  const referenced = new Set((await database.annotations.toArray()).map((a) => a.blobId).filter(Boolean) as string[]);
  return {
    overlays: await get("overlays"),
    userProcedures: await get("userProcedures"),
    annotations: await get("annotations"),
    reviewItems: await get("reviewItems"),
    reviewLog: (await get("reviewLog")).map(({ id: _id, ...r }) => {
      void _id;
      return r;
    }),
    sessions: await get("sessions"),
    settings: (await get("settings")).filter((r) => !excludeSettings.has(String(r.key))),
    blobs: (await database.blobs.toArray()).filter((b) => referenced.has(b.id)).map((b) => ({ id: b.id, mime: b.mime, updatedAt: b.updatedAt })).sort((a, b) => (a.id < b.id ? -1 : 1)),
    tombstones: (await database.tombstones.toArray()).sort((a, b) => (`${a.table}${a.key}` < `${b.table}${b.key}` ? -1 : 1)),
  };
}

export const snapshotFingerprint = (s: Snapshot) => JSON.stringify(s);
