import { createEmptyCard, fsrs, Rating, State, type Card, type Grade } from "ts-fsrs";
import type { ReviewItemRecord, ReviewLogRecord, ReviewRole } from "../db/db";
import type { Procedure } from "../content/schema";
import { drillableLanes } from "../content/resolve";

export type { Grade };
export { Rating };

const f = fsrs(); // default parameters (spec 8)

export const DAY_MS = 86_400_000;
export const TARGET_WINDOW_DAYS = 3;

export function cardFromRecord(r: ReviewItemRecord): Card {
  const c: Card = {
    due: new Date(r.due),
    stability: r.stability,
    difficulty: r.difficulty,
    elapsed_days: r.elapsed_days,
    scheduled_days: r.scheduled_days,
    learning_steps: r.learning_steps,
    reps: r.reps,
    lapses: r.lapses,
    state: r.state as State,
  };
  if (r.last_review) c.last_review = new Date(r.last_review);
  return c;
}

export function recordFromCard(key: { procedureId: string; rowId: string; role: ReviewRole }, c: Card, now: Date): ReviewItemRecord {
  const r: ReviewItemRecord = {
    ...key,
    due: c.due.toISOString(),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsed_days: c.elapsed_days,
    scheduled_days: c.scheduled_days,
    learning_steps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state,
    updatedAt: now.toISOString(),
  };
  if (c.last_review) r.last_review = c.last_review.toISOString();
  return r;
}

/** End of the target day (local time) as a Date. */
export function endOfDay(isoDate: string): Date {
  const [y, m, d] = isoDate.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d, 23, 59, 59, 999);
}

/**
 * Target-date cap (spec 8): every scheduled interval is capped so the item is
 * seen at least once in the final 3 days before the target date.
 * - If the target is already past, no cap.
 * - Otherwise a due date later than the start of the final window is pulled
 *   back to that start (or, when now is already inside the window, to no later
 *   than the target itself).
 */
export function capDue(due: Date, now: Date, targetDate: string | null | undefined): Date {
  if (!targetDate) return due;
  const target = endOfDay(targetDate);
  if (now >= target) return due;
  const windowStart = new Date(target.getTime() - TARGET_WINDOW_DAYS * DAY_MS);
  if (due <= windowStart) return due;
  if (now < windowStart) return windowStart;
  return due > target ? target : due;
}

export interface GradeResult {
  item: ReviewItemRecord;
  log: Omit<ReviewLogRecord, "id">;
}

export function gradeItem(
  key: { procedureId: string; rowId: string; role: ReviewRole },
  existing: ReviewItemRecord | undefined,
  grade: Grade,
  now: Date,
  targetDate: string | null | undefined,
  mode: string,
): GradeResult {
  const card = existing ? cardFromRecord(existing) : createEmptyCard(now);
  const { card: next, log } = f.next(card, now, grade);
  const capped = capDue(next.due, now, targetDate);
  const item = recordFromCard(key, { ...next, due: capped }, now);
  if (existing?.suspended) item.suspended = true;
  return {
    item,
    log: {
      ...key,
      rating: log.rating,
      state: log.state,
      reviewedAt: now.toISOString(),
      scheduledDays: Math.round((capped.getTime() - now.getTime()) / DAY_MS),
      elapsedDays: log.elapsed_days,
      mode,
    },
  };
}

export const itemKey = (procedureId: string, rowId: string, role: ReviewRole) => `${procedureId}\u0000${rowId}\u0000${role}`;

/** Every (rowId, role) a procedure can yield as a review item (spec 8). */
export function reviewableItems(p: Procedure): Array<{ rowId: string; role: ReviewRole; gateId: string }> {
  const out: Array<{ rowId: string; role: ReviewRole; gateId: string }> = [];
  for (const g of p.gates) {
    for (const r of g.rows) {
      for (const role of drillableLanes(g, r)) out.push({ rowId: r.id, role, gateId: g.id });
    }
  }
  return out;
}

/** Weakness score (spec 8): share of items with a lapse (Again) in their last 5 reviews. */
export function weaknessScore(items: ReviewItemRecord[], log: ReviewLogRecord[]): number {
  if (items.length === 0) return 0;
  const byKey = new Map<string, ReviewLogRecord[]>();
  for (const l of log) {
    const k = itemKey(l.procedureId, l.rowId, l.role);
    const arr = byKey.get(k) ?? [];
    arr.push(l);
    byKey.set(k, arr);
  }
  let weak = 0;
  for (const it of items) {
    const entries = (byKey.get(itemKey(it.procedureId, it.rowId, it.role)) ?? [])
      .sort((a, b) => (a.reviewedAt < b.reviewedAt ? 1 : -1))
      .slice(0, 5);
    if (entries.some((e) => e.rating === Rating.Again)) weak += 1;
  }
  return weak / items.length;
}

/** "Ready by" (spec 8): share of items with a successful review inside the final window. */
export function readiness(p: Procedure, log: ReviewLogRecord[], targetDate: string | null | undefined): number | null {
  if (!targetDate) return null;
  const all = reviewableItems(p);
  if (all.length === 0) return null;
  const target = endOfDay(targetDate);
  const windowStart = new Date(target.getTime() - TARGET_WINDOW_DAYS * DAY_MS);
  const good = new Set<string>();
  for (const l of log) {
    if (l.procedureId !== p.id || l.rating === Rating.Again) continue;
    const t = new Date(l.reviewedAt);
    if (t >= windowStart && t <= target) good.add(itemKey(l.procedureId, l.rowId, l.role));
  }
  return all.filter((i) => good.has(itemKey(p.id, i.rowId, i.role))).length / all.length;
}

export const isDue = (r: ReviewItemRecord, now: Date) => !r.suspended && new Date(r.due) <= now;
