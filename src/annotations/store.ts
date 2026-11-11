import { db, ensurePersisted } from "../db/db";
import type { Procedure } from "../content/schema";
import { newId, nowIso } from "../util/id";
import { touchDataChanged } from "../state/settings";
import type { Annotation, AnnotationTarget, Confidence } from "./types";

export async function addAnnotation(
  a: Omit<Annotation, "id" | "createdAt" | "updatedAt"> & { id?: string },
): Promise<Annotation> {
  await ensurePersisted();
  const active = (await db.settings.get("activeSessionId"))?.value as string | null | undefined;
  const now = nowIso();
  const full: Annotation = {
    ...a,
    id: a.id ?? newId(),
    createdAt: now,
    updatedAt: now,
  };
  if (a.kind === "note" && active && !full.sessionId) full.sessionId = active;
  // Confidence: one per row, latest wins -> replace the previous one.
  if (a.kind === "confidence" && a.target.rowId) {
    const prev = await db.annotations
      .where("target.rowId")
      .equals(a.target.rowId)
      .filter((x) => x.kind === "confidence" && x.target.procedureId === a.target.procedureId)
      .toArray();
    await db.annotations.bulkDelete(prev.map((p) => p.id));
  }
  await db.annotations.put(full);
  await touchDataChanged();
  return full;
}

export async function updateAnnotation(id: string, patch: Partial<Annotation>): Promise<void> {
  const cur = await db.annotations.get(id);
  if (!cur) return;
  await db.annotations.put({ ...cur, ...patch, id, updatedAt: nowIso() });
  await touchDataChanged();
}

export async function deleteAnnotation(id: string): Promise<Annotation | undefined> {
  const cur = await db.annotations.get(id);
  if (!cur) return undefined;
  await db.annotations.delete(id);
  if (cur.blobId) await db.blobs.delete(cur.blobId);
  await touchDataChanged();
  return cur;
}

/** Undo helper: put a deleted annotation back exactly as it was. */
export async function restoreAnnotation(a: Annotation): Promise<void> {
  await db.annotations.put(a);
}

export async function reattachAnnotation(id: string, target: AnnotationTarget): Promise<void> {
  await updateAnnotation(id, { target });
}

export function annotationsForProcedure(procedureId: string): Promise<Annotation[]> {
  return db.annotations.where("target.procedureId").equals(procedureId).toArray();
}

/** Group annotations by row id (and gate-level ones under the gate id with "gate:" prefix). */
export function groupByRow(list: Annotation[]): Map<string, Annotation[]> {
  const m = new Map<string, Annotation[]>();
  for (const a of list) {
    const key = a.target.rowId ?? (a.target.gateId ? `gate:${a.target.gateId}` : "procedure");
    const arr = m.get(key) ?? [];
    arr.push(a);
    m.set(key, arr);
  }
  return m;
}

/** Annotations whose target row or gate no longer exists (spec 5, orphans). */
export function findOrphans(list: Annotation[], p: Pick<Procedure, "gates">): Annotation[] {
  const gateIds = new Set(p.gates.map((g) => g.id));
  const rowIds = new Set(p.gates.flatMap((g) => g.rows.map((r) => r.id)));
  return list.filter((a) => {
    if (a.target.rowId) return !rowIds.has(a.target.rowId);
    if (a.target.gateId) return !gateIds.has(a.target.gateId);
    return false;
  });
}

export function latestConfidence(list: Annotation[]): Confidence | undefined {
  let best: Annotation | undefined;
  for (const a of list) {
    if (a.kind !== "confidence") continue;
    if (!best || a.updatedAt > best.updatedAt) best = a;
  }
  return best?.confidence;
}
