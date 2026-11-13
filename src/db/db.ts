import Dexie, { type EntityTable } from "dexie";
import type { Procedure } from "../content/schema";
import type { Annotation } from "../annotations/types";

/** Storage tables (spec 4). */
export interface OverlayRecord {
  procedureId: string;
  procedure: Procedure;
  /** Shipped version this overlay was forked from. */
  baseVersion: number;
  updatedAt: string;
}
export interface UserProcedureRecord {
  procedureId: string;
  procedure: Procedure;
  updatedAt: string;
}
export interface BlobRecord {
  id: string;
  mime: string;
  data: Blob;
  updatedAt: string;
}
export type ReviewRole = "PF" | "PM";
export interface ReviewItemRecord {
  procedureId: string;
  rowId: string;
  role: ReviewRole;
  /** ts-fsrs card, dates stored as ISO strings. */
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: number;
  last_review?: string;
  suspended?: boolean;
  updatedAt: string;
}
export interface ReviewLogRecord {
  id?: number;
  procedureId: string;
  rowId: string;
  role: ReviewRole;
  rating: number; // 1..4
  state: number;
  reviewedAt: string;
  scheduledDays: number;
  elapsedDays: number;
  mode: string;
}
export interface SessionRecord {
  id: string;
  name: string;
  date: string;
  createdAt: string;
  updatedAt: string;
  active?: boolean;
}
export interface SettingRecord {
  key: string;
  value: unknown;
  updatedAt: string;
}
/** Deletion marker so a delete on one device wins over an older copy elsewhere. */
export interface TombstoneRecord {
  table: string;
  key: string;
  deletedAt: string;
}

export class FlowDb extends Dexie {
  overlays!: EntityTable<OverlayRecord, "procedureId">;
  userProcedures!: EntityTable<UserProcedureRecord, "procedureId">;
  annotations!: EntityTable<Annotation, "id">;
  blobs!: EntityTable<BlobRecord, "id">;
  reviewItems!: Dexie.Table<ReviewItemRecord, [string, string, string]>;
  reviewLog!: EntityTable<ReviewLogRecord, "id">;
  sessions!: EntityTable<SessionRecord, "id">;
  settings!: EntityTable<SettingRecord, "key">;
  tombstones!: Dexie.Table<TombstoneRecord, [string, string]>;

  constructor(name = "flow-scripts") {
    super(name);
    const stores = {
      overlays: "procedureId, updatedAt",
      userProcedures: "procedureId, updatedAt",
      annotations: "id, target.procedureId, target.rowId, kind, sessionId, tag, updatedAt",
      blobs: "id",
      reviewItems: "[procedureId+rowId+role], procedureId, due, [procedureId+rowId]",
      reviewLog: "++id, procedureId, reviewedAt, [procedureId+rowId+role]",
      sessions: "id, createdAt",
      settings: "key",
    };
    this.version(1).stores(stores);
    this.version(2).stores({ ...stores, tombstones: "[table+key], deletedAt" });
  }
}

export const db = new FlowDb();

export const TABLE_NAMES = [
  "overlays",
  "userProcedures",
  "annotations",
  "blobs",
  "reviewItems",
  "reviewLog",
  "sessions",
  "settings",
] as const;

/** Tables that take part in sync and merge (tombstones are handled separately). */
export type SyncedTable = (typeof TABLE_NAMES)[number];

/** Primary key of a record as a string, for tombstones. */
export function recordKey(table: SyncedTable, r: Record<string, unknown>): string {
  switch (table) {
    case "overlays":
    case "userProcedures":
      return String(r.procedureId);
    case "reviewItems":
      return `${r.procedureId}|${r.rowId}|${r.role}`;
    case "reviewLog":
      return `${r.procedureId}|${r.rowId}|${r.role}|${r.reviewedAt}`;
    case "settings":
      return String(r.key);
    default:
      return String(r.id);
  }
}

/** Record that a row was deleted, so sync and merge do not resurrect it. */
export async function recordTombstone(table: SyncedTable, key: string, database: FlowDb = db): Promise<void> {
  await database.tombstones.put({ table, key, deletedAt: new Date().toISOString() });
}

export async function clearTombstone(table: SyncedTable, key: string, database: FlowDb = db): Promise<void> {
  await database.tombstones.delete([table, key]);
}

let persistAsked = false;
/** Ask for durable storage on first write (spec 4). */
export async function ensurePersisted(): Promise<void> {
  if (persistAsked) return;
  persistAsked = true;
  try {
    if (navigator.storage?.persist) await navigator.storage.persist();
  } catch {
    /* ignore */
  }
}
