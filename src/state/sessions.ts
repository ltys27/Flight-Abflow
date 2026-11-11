import { db, ensurePersisted, type SessionRecord } from "../db/db";
import { newId, nowIso, todayIso } from "../util/id";
import { setSetting, touchDataChanged } from "./settings";

/** Debrief sessions (spec 5): named, dated; while active, new notes are stamped. */
export async function createSession(name: string, date = todayIso(), activate = true): Promise<SessionRecord> {
  await ensurePersisted();
  const s: SessionRecord = { id: newId(), name, date, createdAt: nowIso(), updatedAt: nowIso() };
  await db.sessions.put(s);
  if (activate) await setSetting("activeSessionId", s.id);
  await touchDataChanged();
  return s;
}

export async function setActiveSession(id: string | null): Promise<void> {
  await setSetting("activeSessionId", id);
}

export async function deleteSession(id: string): Promise<void> {
  await db.sessions.delete(id);
  const active = await db.settings.get("activeSessionId");
  if (active?.value === id) await setSetting("activeSessionId", null);
  // Notes keep their text; they simply lose the session stamp.
  const notes = await db.annotations.where("sessionId").equals(id).toArray();
  await db.annotations.bulkPut(notes.map((n) => ({ ...n, sessionId: undefined })));
  await touchDataChanged();
}
