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

export class FlowDb extends Dexie {
  overlays!: EntityTable<OverlayRecord, "procedureId">;
  userProcedures!: EntityTable<UserProcedureRecord, "procedureId">;
  annotations!: EntityTable<Annotation, "id">;
  blobs!: EntityTable<BlobRecord, "id">;
  reviewItems!: Dexie.Table<ReviewItemRecord, [string, string, string]>;
  reviewLog!: EntityTable<ReviewLogRecord, "id">;
  sessions!: EntityTable<SessionRecord, "id">;
  settings!: EntityTable<SettingRecord, "key">;

  constructor(name = "flow-scripts") {
    super(name);
    this.version(1).stores({
      overlays: "procedureId, updatedAt",
      userProcedures: "procedureId, updatedAt",
      annotations: "id, target.procedureId, target.rowId, kind, sessionId, tag, updatedAt",
      blobs: "id",
      reviewItems: "[procedureId+rowId+role], procedureId, due, [procedureId+rowId]",
      reviewLog: "++id, procedureId, reviewedAt, [procedureId+rowId+role]",
      sessions: "id, createdAt",
      settings: "key",
    });
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
