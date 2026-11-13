import { db, ensurePersisted, recordTombstone, type ReviewItemRecord, type ReviewRole } from "../db/db";
import type { Procedure } from "../content/schema";
import { gradeItem, reviewableItems, type Grade } from "./scheduler";
import { getSetting } from "../state/settings";
import { touchDataChanged } from "../state/settings";

export async function targetDateFor(procedureId: string): Promise<string | null> {
  const per = await getSetting("procedureTargetDates");
  return per[procedureId] ?? (await getSetting("targetDate"));
}

export async function grade(
  key: { procedureId: string; rowId: string; role: ReviewRole },
  g: Grade,
  mode: string,
  now = new Date(),
): Promise<ReviewItemRecord> {
  await ensurePersisted();
  const existing = await db.reviewItems.get([key.procedureId, key.rowId, key.role]);
  const target = await targetDateFor(key.procedureId);
  const res = gradeItem(key, existing, g, now, target, mode);
  await db.transaction("rw", db.reviewItems, db.reviewLog, async () => {
    await db.reviewItems.put(res.item);
    await db.reviewLog.add(res.log);
  });
  await touchDataChanged();
  return res.item;
}

/**
 * Keep review items consistent with a procedure's rows (spec 8): deleted rows
 * lose their items, `to-fill` rows (or standing lanes) are suspended, and
 * suspended items for rows that became drillable again are resumed.
 * Editing text never touches the schedule.
 */
export async function reconcileReviewItems(p: Procedure): Promise<void> {
  const existing = await db.reviewItems.where("procedureId").equals(p.id).toArray();
  if (existing.length === 0) return;
  const rowIds = new Set(p.gates.flatMap((g) => g.rows.map((r) => r.id)));
  const live = new Set(reviewableItems(p).map((i) => `${i.rowId}|${i.role}`));
  const toDelete: Array<[string, string, string]> = [];
  const toPut: ReviewItemRecord[] = [];
  for (const it of existing) {
    if (!rowIds.has(it.rowId)) {
      toDelete.push([it.procedureId, it.rowId, it.role]);
      continue;
    }
    const shouldSuspend = !live.has(`${it.rowId}|${it.role}`);
    if (!!it.suspended !== shouldSuspend) toPut.push({ ...it, suspended: shouldSuspend });
  }
  await db.transaction("rw", db.reviewItems, async () => {
    if (toDelete.length) await db.reviewItems.bulkDelete(toDelete);
    if (toPut.length) await db.reviewItems.bulkPut(toPut.map((it) => ({ ...it, updatedAt: new Date().toISOString() })));
  });
  for (const [pid, rid, role] of toDelete) await recordTombstone("reviewItems", `${pid}|${rid}|${role}`);
}

export async function deleteReviewDataFor(procedureId: string): Promise<void> {
  const items = await db.reviewItems.where("procedureId").equals(procedureId).toArray();
  await db.reviewItems.where("procedureId").equals(procedureId).delete();
  await db.reviewLog.where("procedureId").equals(procedureId).delete();
  for (const it of items) await recordTombstone("reviewItems", `${it.procedureId}|${it.rowId}|${it.role}`);
}
