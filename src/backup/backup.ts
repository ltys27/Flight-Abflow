import { z } from "zod";
import { db, ensurePersisted, TABLE_NAMES } from "../db/db";
import { nowIso } from "../util/id";

/** Backup file (spec 9): every table, voice blobs as base64. */
export const BACKUP_VERSION = 1;

const BackupSchema = z.object({
  backupVersion: z.literal(BACKUP_VERSION),
  createdAt: z.string(),
  app: z.string().optional(),
  overlays: z.array(z.record(z.string(), z.unknown())),
  userProcedures: z.array(z.record(z.string(), z.unknown())),
  annotations: z.array(z.record(z.string(), z.unknown())),
  blobs: z.array(z.object({ id: z.string(), mime: z.string(), updatedAt: z.string(), base64: z.string() })),
  reviewItems: z.array(z.record(z.string(), z.unknown())),
  reviewLog: z.array(z.record(z.string(), z.unknown())),
  sessions: z.array(z.record(z.string(), z.unknown())),
  settings: z.array(z.record(z.string(), z.unknown())),
});
export type BackupFile = z.infer<typeof BackupSchema>;

export function blobBytes(b: Blob): Promise<ArrayBuffer> {
  if (typeof b.arrayBuffer === "function") return b.arrayBuffer();
  // Older DOM implementations (and jsdom) only offer FileReader.
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(b);
  });
}

export async function blobToBase64(b: Blob): Promise<string> {
  const buf = new Uint8Array(await blobBytes(b));
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}
export function base64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

export async function exportBackup(): Promise<BackupFile> {
  const blobs = await db.blobs.toArray();
  return {
    backupVersion: BACKUP_VERSION,
    createdAt: nowIso(),
    app: "flow-scripts",
    overlays: (await db.overlays.toArray()) as unknown as Record<string, unknown>[],
    userProcedures: (await db.userProcedures.toArray()) as unknown as Record<string, unknown>[],
    annotations: (await db.annotations.toArray()) as unknown as Record<string, unknown>[],
    blobs: await Promise.all(blobs.map(async (b) => ({ id: b.id, mime: b.mime, updatedAt: b.updatedAt, base64: await blobToBase64(b.data) }))),
    reviewItems: (await db.reviewItems.toArray()) as unknown as Record<string, unknown>[],
    reviewLog: (await db.reviewLog.toArray()) as unknown as Record<string, unknown>[],
    sessions: (await db.sessions.toArray()) as unknown as Record<string, unknown>[],
    settings: (await db.settings.toArray()) as unknown as Record<string, unknown>[],
  };
}

export interface BackupSummary {
  createdAt: string;
  counts: Record<string, number>;
}

export function parseBackup(text: string): { ok: true; backup: BackupFile; summary: BackupSummary } | { ok: false; error: string } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `Not valid JSON: ${(e as Error).message}` };
  }
  const r = BackupSchema.safeParse(data);
  if (!r.success) return { ok: false, error: r.error.issues.map((i) => `${i.path.join(".") || "$"}: ${i.message}`).join("; ") };
  const counts: Record<string, number> = {};
  for (const t of TABLE_NAMES) counts[t] = (r.data[t] as unknown[]).length;
  return { ok: true, backup: r.data, summary: { createdAt: r.data.createdAt, counts } };
}

const keyOf: Record<(typeof TABLE_NAMES)[number], (r: Record<string, unknown>) => unknown> = {
  overlays: (r) => r.procedureId,
  userProcedures: (r) => r.procedureId,
  annotations: (r) => r.id,
  blobs: (r) => r.id,
  reviewItems: (r) => [r.procedureId, r.rowId, r.role],
  reviewLog: (r) => r.id,
  sessions: (r) => r.id,
  settings: (r) => r.key,
};

/**
 * Restore (spec 9). `replace` wipes every table first. `merge` keeps the record
 * with the newer `updatedAt` per key (records without one are added when missing).
 * Review log entries are appended when merging (deduplicated by content).
 */
export async function restoreBackup(b: BackupFile, mode: "merge" | "replace"): Promise<void> {
  await ensurePersisted();
  const tables = TABLE_NAMES.map((t) => db.table(t));
  await db.transaction("rw", tables, async () => {
    if (mode === "replace") for (const t of tables) await t.clear();
    for (const name of TABLE_NAMES) {
      const table = db.table(name);
      const incoming = b[name] as Record<string, unknown>[];
      for (const raw of incoming) {
        const rec: Record<string, unknown> = { ...raw };
        if (name === "blobs") {
          rec.data = base64ToBlob(String(raw.base64), String(raw.mime));
          delete rec.base64;
        }
        if (name === "reviewLog") {
          if (mode === "replace") {
            await table.add(rec);
          } else {
            const { id: _id, ...rest } = rec;
            void _id;
            const dup = await table.where("[procedureId+rowId+role]").equals([rest.procedureId as string, rest.rowId as string, rest.role as string]).filter((x) => x.reviewedAt === rest.reviewedAt).first();
            if (!dup) await table.add(rest);
          }
          continue;
        }
        if (mode === "replace") {
          await table.put(rec);
          continue;
        }
        const key = keyOf[name](rec);
        const existing = (await table.get(key as never)) as Record<string, unknown> | undefined;
        if (!existing) {
          await table.put(rec);
          continue;
        }
        const a = String(existing.updatedAt ?? "");
        const c = String(rec.updatedAt ?? "");
        if (c > a) await table.put(rec);
      }
    }
  });
}

export async function eraseAllData(): Promise<void> {
  const tables = TABLE_NAMES.map((t) => db.table(t));
  await db.transaction("rw", tables, async () => {
    for (const t of tables) await t.clear();
  });
}

export async function storageEstimate(): Promise<{ usage: number; quota: number; persisted: boolean | null }> {
  let usage = 0;
  let quota = 0;
  let persisted: boolean | null = null;
  try {
    const e = await navigator.storage?.estimate?.();
    usage = e?.usage ?? 0;
    quota = e?.quota ?? 0;
    persisted = (await navigator.storage?.persisted?.()) ?? null;
  } catch {
    /* unsupported */
  }
  return { usage, quota, persisted };
}
