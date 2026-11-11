import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/db";
import { useLibrary } from "../state/LibraryProvider";
import { useSettings } from "../state/settings";
import { deriveNumbering } from "../content/numbering";
import { isDue, reviewableItems, type Grade } from "../schedule/scheduler";
import { grade as gradeStore } from "../schedule/store";
import type { DrillItem } from "../drill/items";
import { RolePlayMode } from "../drill/Modes";
import { href } from "../app/router";

/** Daily review queue (spec 8): due items first, then new items up to the daily limit, role-play format. */
export function ReviewScreen() {
  const lib = useLibrary();
  const settings = useSettings();
  const items = useLiveQuery(() => db.reviewItems.toArray(), [], undefined);
  const todayLog = useLiveQuery(() => db.reviewLog.where("reviewedAt").aboveOrEqual(new Date().toISOString().slice(0, 10)).toArray(), [], []);
  const [queue, setQueue] = useState<DrillItem[] | null>(null);
  const [index, setIndex] = useState(0);

  const built = useMemo(() => {
    if (!items) return null;
    const now = new Date();
    const due: DrillItem[] = [];
    const fresh: DrillItem[] = [];
    const have = new Map(items.map((i) => [`${i.procedureId}|${i.rowId}|${i.role}`, i]));
    const newToday = new Set(todayLog.filter((l) => l.state === 0).map((l) => `${l.procedureId}|${l.rowId}|${l.role}`)).size;
    let newBudget = Math.max(0, settings.dailyNewLimit - newToday);
    for (const e of lib.entries) {
      const numbering = deriveNumbering(e.procedure);
      for (const ri of reviewableItems(e.procedure)) {
        const gate = e.procedure.gates.find((g) => g.id === ri.gateId)!;
        const row = gate.rows.find((r) => r.id === ri.rowId)!;
        const item: DrillItem = { procedureId: e.id, gate, row, role: ri.role, number: numbering.rows.get(row.id) ?? "?" };
        const rec = have.get(`${e.id}|${ri.rowId}|${ri.role}`);
        if (rec) {
          if (isDue(rec, now)) due.push(item);
        } else if (newBudget > 0) {
          fresh.push(item);
          newBudget -= 1;
        }
      }
    }
    due.sort((a, b) => (have.get(`${a.procedureId}|${a.row.id}|${a.role}`)!.due < have.get(`${b.procedureId}|${b.row.id}|${b.role}`)!.due ? -1 : 1));
    return { due, fresh };
  }, [items, lib.entries, settings.dailyNewLimit, todayLog]);

  if (!built) return <p className="muted">Loading…</p>;
  const total = built.due.length + built.fresh.length;

  const onGrade = async (it: DrillItem, g: Grade) => {
    await gradeStore({ procedureId: it.procedureId, rowId: it.row.id, role: it.role }, g, "review");
    setIndex((i) => i + 1);
  };

  if (queue) {
    if (index >= queue.length) {
      return (
        <div className="card">
          <h1>Review done</h1>
          <p>{queue.length} items reviewed.</p>
          <button type="button" className="btn primary" onClick={() => { setQueue(null); setIndex(0); }}>Back</button>
        </div>
      );
    }
    const it = queue[index]!;
    return (
      <>
        <div className="small muted"><a href={href.read(it.procedureId, it.row.id)}>{lib.get(it.procedureId)?.procedure.title}</a></div>
        <RolePlayMode items={queue} index={index} onGrade={(i, g) => void onGrade(i, g)} onSkip={() => setIndex((i) => i + 1)} />
        <button type="button" className="btn small ghost" style={{ marginTop: 12 }} onClick={() => setQueue(null)}>Stop</button>
      </>
    );
  }

  return (
    <>
      <h1>Review</h1>
      <div className="card">
        <div className="kv">
          <span>Due now</span><span>{built.due.length}</span>
          <span>New today</span><span>{built.fresh.length} <span className="small muted">(limit {settings.dailyNewLimit})</span></span>
        </div>
        <button type="button" className="btn primary" style={{ marginTop: 12 }} disabled={total === 0} onClick={() => { setQueue([...built.due, ...built.fresh]); setIndex(0); }}>
          Start review ({total})
        </button>
        {total === 0 && <p className="muted small">Nothing to review. Items appear here after you drill them, and new ones are added daily up to your limit.</p>}
      </div>
      <h2>Upcoming</h2>
      <ul className="small">
        {(items ?? []).filter((i) => !i.suspended && !isDue(i, new Date())).sort((a, b) => (a.due < b.due ? -1 : 1)).slice(0, 20).map((i) => {
          const e = lib.get(i.procedureId);
          const row = e?.procedure.gates.flatMap((g) => g.rows).find((r) => r.id === i.rowId);
          return <li key={`${i.procedureId}|${i.rowId}|${i.role}`}>{new Date(i.due).toLocaleDateString()} · {e?.procedure.title ?? i.procedureId} · {row?.trigger ?? i.rowId} ({i.role})</li>;
        })}
      </ul>
    </>
  );
}
