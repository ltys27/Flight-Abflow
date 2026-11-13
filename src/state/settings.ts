import { useLiveQuery } from "dexie-react-hooks";
import { db, ensurePersisted } from "../db/db";
import { nowIso } from "../util/id";

export type Theme = "dark" | "light" | "system";
export type TextSize = "small" | "normal" | "large" | "xlarge";
export type DefaultRole = "PF" | "PM" | "both";

export interface SyncConfig {
  enabled: boolean;
  /** "owner/repo" */
  repo: string;
  branch: string;
  /** Folder inside the repo, no leading or trailing slash. */
  path: string;
  /** Fine-grained personal access token with Contents read/write on that repo. Stays on this device. */
  token: string;
}
export interface SyncState {
  ok: boolean;
  message: string;
  at: string;
  pushed?: boolean;
  pulled?: boolean;
}

/** Settings that stay on this device: never synced, never written to a backup file. */
export const DEVICE_ONLY_SETTINGS: ReadonlySet<string> = new Set(["syncConfig", "lastSyncAt", "lastSyncState", "lastBackupAt", "lastDataChangeAt"]);

export interface Settings {
  syncConfig: SyncConfig | null;
  lastSyncAt: string | null;
  lastSyncState: SyncState | null;
  theme: Theme;
  textSize: TextSize;
  defaultRole: DefaultRole;
  audioRate: number;
  audioGapSeconds: number;
  dailyNewLimit: number;
  fingerDrawing: boolean;
  targetDate: string | null;
  /** Per-procedure target dates (ISO date). */
  procedureTargetDates: Record<string, string>;
  hideAnnotations: boolean;
  lastBackupAt: string | null;
  lastDataChangeAt: string | null;
  /** Remembered branch choice per procedure per parent gate. */
  branchChoices: Record<string, Record<string, string>>;
  lastOpened: Record<string, string>;
  fleetFilter: Record<string, string>;
  activeSessionId: string | null;
}

export const DEFAULT_SETTINGS: Settings = {
  syncConfig: null,
  lastSyncAt: null,
  lastSyncState: null,
  theme: "dark",
  textSize: "normal",
  defaultRole: "PF",
  audioRate: 1,
  audioGapSeconds: 4,
  dailyNewLimit: 15,
  fingerDrawing: false,
  targetDate: null,
  procedureTargetDates: {},
  hideAnnotations: false,
  lastBackupAt: null,
  lastDataChangeAt: null,
  branchChoices: {},
  lastOpened: {},
  fleetFilter: {},
  activeSessionId: null,
};

export async function getSetting<K extends keyof Settings>(key: K): Promise<Settings[K]> {
  const r = await db.settings.get(key);
  return (r?.value as Settings[K] | undefined) ?? DEFAULT_SETTINGS[key];
}

export async function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void> {
  await ensurePersisted();
  await db.settings.put({ key, value, updatedAt: nowIso() });
}

export async function getAllSettings(): Promise<Settings> {
  const rows = await db.settings.toArray();
  const out: Settings = { ...DEFAULT_SETTINGS };
  for (const r of rows) {
    if (r.key in DEFAULT_SETTINGS) (out as unknown as Record<string, unknown>)[r.key] = r.value;
  }
  return out;
}

/** Live settings; returns defaults until the first read completes. */
export function useSettings(): Settings {
  return useLiveQuery(getAllSettings, [], DEFAULT_SETTINGS);
}

export function useSetting<K extends keyof Settings>(key: K): Settings[K] {
  return useLiveQuery(() => getSetting(key), [key], DEFAULT_SETTINGS[key]);
}

/** Mark that user data changed (backup reminder, and a nudge for auto-sync). */
export async function touchDataChanged(): Promise<void> {
  await db.settings.put({ key: "lastDataChangeAt", value: nowIso(), updatedAt: nowIso() });
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("flow:data-changed"));
}
