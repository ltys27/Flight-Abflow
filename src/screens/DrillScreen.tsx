import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useLibrary } from "../state/LibraryProvider";
import { href } from "../app/router";
import { deriveNumbering } from "../content/numbering";
import { applyFleet, visibleGates } from "../content/resolve";
import type { Fleet } from "../content/schema";
import { buildItems, type DrillItem, type DrillMode, type RoleSel, type Scope } from "../drill/items";
import { AudioMode, OrderMode, RevealMode, RolePlayMode } from "../drill/Modes";
import { grade as gradeStore } from "../schedule/store";
import { isDue, type Grade, Rating } from "../schedule/scheduler";
import { db } from "../db/db";
import { useSettings, setSetting } from "../state/settings";

export function DrillScreen({ id }: { id: string }) {
  const lib = useLibrary();
  const entry = lib.get(id);
  const settings = useSettings();
  const [mode, setMode] = useState<DrillMode>("reveal");
  const [scope, setScope] = useState<Scope>({ kind: "whole" });
  const [role, setRole] = useState<RoleSel>(settings.defaultRole);
  const [running, setRunning] = useState<DrillItem[] | null>(null);
  const [index, setIndex] = useState(0);
  const [missed, setMissed] = useState<DrillItem[]>([]);
  const [graded, setGraded] = useState(0);
  const dueItems = useLiveQuery(() => db.reviewItems.where("procedureId").equals(id).toArray(), [id], []);

  const fleet = (settings.fleetFilter[id] as Fleet | undefined) ?? null;
  const p = useMemo(() => (entry ? applyFleet(entry.procedure, fleet) : null), [entry, fleet]);
  const numbering = useMemo(() => (p ? deriveNumbering(p) : null), [p]);
  const branches = p?.gates.filter((g) => g.branch) ?? [];
  const now = new Date();
  const dueKeys = new Set(dueItems.filter((i) => isDue(i, now)).map((i) => `${i.rowId}|${i.role}`));

  if (!entry || !p || !numbering) return lib.loading ? <p className="muted">Loading…</p> : <p>Not found. <a href={href.library()}>Library</a></p>;

  const start = (items?: DrillItem[]) => {
    let list = items ?? buildItems(p, scope, role, numbering.rows, dueKeys);
    if (mode === "order") {
      // Order drill works on one gate at a time: use the first gate in scope that has 2+ rows.
      const gateIds = [...new Set(list.map((i) => i.gate.id))];
      const gid = gateIds.find((g) => list.filter((i) => i.gate.id === g).length >= 2) ?? gateIds[0];
      list = list.filter((i) => i.gate.id === gid);
    }
    setRunning(list);
    setIndex(0);
    setMissed([]);
    setGraded(0);
  };
  const onGrade = async (it: DrillItem, g: Grade, forceMissed?: boolean) => {
    await gradeStore({ procedureId: id, rowId: it.row.id, role: it.role }, g, mode);
    setGraded((n) => n + 1);
    if (forceMissed ?? g === Rating.Again) setMissed((m) => (m.some((x) => x.row.id === it.row.id && x.role === it.role) ? m : [...m, it]));
    if (mode === "roleplay") setIndex((i) => i + 1);
  };
  const finished = running && (mode === "roleplay" ? index >= running.length : false);

  return (
    <>
      <div className="topbar">
        <a className="btn small" href={href.read(id)} aria-label="Back to procedure">‹ Back</a>
        <span className="title">Drill: {p.title}</span>
        {running && <button type="button" className="btn small" onClick={() => setRunning(null)}>End</button>}
      </div>
      {!running && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Set up</h2>
          <div className="chips" role="group" aria-label="Mode">
            {(["reveal", "callouts", "roleplay", "order", "audio"] as DrillMode[]).map((m) => (
              <button key={m} type="button" className="chip" aria-pressed={mode === m} onClick={() => setMode(m)}>
                {m === "reveal" ? "Reveal" : m === "callouts" ? "Callouts only" : m === "roleplay" ? "Role play" : m === "order" ? "Order" : "Audio"}
              </button>
            ))}
          </div>
          <h3>Role</h3>
          <div className="chips" role="group" aria-label="Role">
            {(["PF", "PM", "both"] as RoleSel[]).map((r) => (
              <button key={r} type="button" className="chip" aria-pressed={role === r} onClick={() => setRole(r)}>{r}</button>
            ))}
          </div>
          <h3>Scope</h3>
          <div className="chips" role="group" aria-label="Scope">
            <button type="button" className="chip" aria-pressed={scope.kind === "whole"} onClick={() => setScope({ kind: "whole" })}>Whole procedure</button>
            <button type="button" className="chip" aria-pressed={scope.kind === "gates"} onClick={() => setScope({ kind: "gates", gateIds: visibleGates(p, settings.branchChoices[id] ?? {}).map((g) => g.id) })}>Chosen gates</button>
            <button type="button" className="chip" aria-pressed={scope.kind === "branch"} disabled={branches.length === 0} onClick={() => setScope({ kind: "branch", gateId: branches[0]!.id })}>One branch</button>
            <button type="button" className="chip" aria-pressed={scope.kind === "due"} onClick={() => setScope({ kind: "due" })}>Due only ({dueKeys.size})</button>
          </div>
          {scope.kind === "gates" && (
            <div className="chips" style={{ marginTop: 6 }} role="group" aria-label="Gates">
              {p.gates.map((g) => {
                const on = scope.gateIds.includes(g.id);
                return <button key={g.id} type="button" className="chip" aria-pressed={on} onClick={() => setScope({ kind: "gates", gateIds: on ? scope.gateIds.filter((x) => x !== g.id) : [...scope.gateIds, g.id] })}>{numbering.gates.get(g.id)} {g.title}</button>;
              })}
            </div>
          )}
          {scope.kind === "branch" && (
            <div className="chips" style={{ marginTop: 6 }} role="group" aria-label="Branch">
              {branches.map((g) => <button key={g.id} type="button" className="chip" aria-pressed={scope.gateId === g.id} onClick={() => setScope({ kind: "branch", gateId: g.id })}>{g.branch!.condition}</button>)}
            </div>
          )}
          <p className="small muted" style={{ marginTop: 12 }}>{buildItems(p, scope, role, numbering.rows, dueKeys).length} items. Standing cells and to-fill rows are never drilled.</p>
          <button type="button" className="btn primary" disabled={buildItems(p, scope, role, numbering.rows, dueKeys).length === 0} onClick={() => start()}>Start</button>
        </div>
      )}
      {running && !finished && mode === "reveal" && <RevealMode items={running} hideCallouts={false} onGrade={(it, g) => void onGrade(it, g)} />}
      {running && !finished && mode === "callouts" && <RevealMode items={running} hideCallouts onGrade={(it, g) => void onGrade(it, g)} />}
      {running && !finished && mode === "roleplay" && <RolePlayMode items={running} index={index} onGrade={(it, g) => void onGrade(it, g)} onSkip={() => setIndex((i) => i + 1)} />}
      {running && !finished && mode === "order" && <OrderMode items={running} onGraded={(it, g, miss) => void onGrade(it, g, miss)} />}
      {running && !finished && mode === "audio" && <AudioMode items={running} rate={settings.audioRate} gapSeconds={settings.audioGapSeconds} onGrade={(it, g) => void onGrade(it, g)} onRate={(r) => void setSetting("audioRate", r)} />}
      {running && (finished || (mode !== "roleplay" && graded >= running.length && running.length > 0)) && (
        <Summary items={running} missed={missed} graded={graded} onAgain={() => start(missed)} onDone={() => setRunning(null)} />
      )}
      {running && !finished && mode !== "roleplay" && graded < running.length && (
        <div className="row-actions" style={{ marginTop: 12 }}>
          <button type="button" className="btn" onClick={() => setGraded(running.length)}>Finish and show summary</button>
        </div>
      )}
    </>
  );
}

export function Summary({ items, missed, graded, onAgain, onDone }: { items: DrillItem[]; missed: DrillItem[]; graded: number; onAgain: () => void; onDone: () => void }) {
  return (
    <div className="card" role="region" aria-label="Drill summary">
      <h2 style={{ marginTop: 0 }}>Summary</h2>
      <p>{graded} of {items.length} graded · {missed.length} missed</p>
      {missed.length > 0 && (
        <ul>{missed.map((m) => <li key={`${m.row.id}|${m.role}`}>{m.number} {m.row.trigger} <span className="small muted">({m.role})</span></li>)}</ul>
      )}
      <div className="row-actions">
        {missed.length > 0 && <button type="button" className="btn primary" onClick={onAgain}>Drill misses again</button>}
        <button type="button" className="btn" onClick={onDone}>Done</button>
      </div>
    </div>
  );
}
