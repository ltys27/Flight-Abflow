import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/db";
import type { Procedure } from "../content/schema";
import { isDue, readiness, reviewableItems, weaknessScore } from "./scheduler";
import { useSettings } from "../state/settings";

export interface ProcedureStats {
  due: number;
  newCount: number;
  weakness: number;
  readiness: number | null;
  reviewed: number;
}

/** Per-procedure review stats for the library and read header. */
export function useProcedureStats(procedures: Procedure[]): Map<string, ProcedureStats> {
  const settings = useSettings();
  const data = useLiveQuery(
    async () => ({ items: await db.reviewItems.toArray(), log: await db.reviewLog.toArray() }),
    [],
    undefined,
  );
  const out = new Map<string, ProcedureStats>();
  const now = new Date();
  for (const p of procedures) {
    const items = (data?.items ?? []).filter((i) => i.procedureId === p.id);
    const log = (data?.log ?? []).filter((l) => l.procedureId === p.id);
    const haveKeys = new Set(items.map((i) => `${i.rowId}|${i.role}`));
    const all = reviewableItems(p);
    const target = settings.procedureTargetDates[p.id] ?? settings.targetDate;
    out.set(p.id, {
      due: items.filter((i) => isDue(i, now)).length,
      newCount: all.filter((i) => !haveKeys.has(`${i.rowId}|${i.role}`)).length,
      weakness: weaknessScore(items, log),
      readiness: readiness(p, log, target),
      reviewed: items.length,
    });
  }
  return out;
}
