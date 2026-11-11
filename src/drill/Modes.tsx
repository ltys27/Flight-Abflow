import { useEffect, useRef, useState } from "react";
import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GradeBar } from "./GradeBar";
import { countMisplaced, itemText, orderGrade, shuffle, type DrillItem } from "./items";
import type { Grade } from "../schedule/scheduler";
import type { Row } from "../content/schema";

const Hidden = ({ label, onReveal }: { label: string; onReveal: () => void }) => (
  <button type="button" className="drill-hidden" onClick={onReveal} aria-label={`Reveal ${label}`}>
    tap to reveal {label}
  </button>
);

/** Reveal / Callouts-only (spec 7.1, 7.2): list of rows, hidden parts revealed per row, then graded. */
export function RevealMode({ items, hideCallouts, onGrade }: { items: DrillItem[]; hideCallouts: boolean; onGrade: (it: DrillItem, g: Grade) => void }) {
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [graded, setGraded] = useState<Set<string>>(new Set());
  const key = (it: DrillItem) => `${it.row.id}|${it.role}`;
  return (
    <div>
      {items.map((it) => {
        const t = itemText(it);
        const k = key(it);
        const shown = revealed.has(k);
        return (
          <div key={k} className="drill-card">
            <div className="small muted">{it.number} · {it.gate.title} · you are {it.role}</div>
            <div className="big" style={{ fontWeight: 600 }}>{it.row.trigger}</div>
            {t.otherAction !== "" && (
              <div className={`lane-block ${t.otherRole.toLowerCase()}`}>
                <div className={`lane-label ${t.otherRole.toLowerCase()}`}>{t.otherRole}</div>
                {hideCallouts ? t.otherAction : <>{t.otherAction}{t.otherCallout && <span className="callout">“{t.otherCallout}”</span>}</>}
                {hideCallouts && t.otherCallout && (shown ? <span className="callout">“{t.otherCallout}”</span> : <span className="muted"> (callout hidden)</span>)}
              </div>
            )}
            <div className={`lane-block ${it.role.toLowerCase()}`}>
              <div className={`lane-label ${it.role.toLowerCase()}`}>{it.role} (you)</div>
              {hideCallouts ? (
                <>
                  {t.ownAction || <span className="muted">—</span>}
                  {t.ownCallout && (shown ? <span className="callout">“{t.ownCallout}”</span> : <Hidden label="callout" onReveal={() => setRevealed(new Set(revealed).add(k))} />)}
                  {!t.ownCallout && <span className="small muted"> (no callout)</span>}
                </>
              ) : shown ? (
                <>{t.ownAction}{t.ownCallout && <span className="callout">“{t.ownCallout}”</span>}</>
              ) : (
                <Hidden label={`${it.role} cell`} onReveal={() => setRevealed(new Set(revealed).add(k))} />
              )}
            </div>
            {(shown || (hideCallouts && !t.ownCallout)) && !graded.has(k) && <GradeBar onGrade={(g) => { setGraded(new Set(graded).add(k)); onGrade(it, g); }} />}
            {graded.has(k) && <p className="small muted">Graded.</p>}
          </div>
        );
      })}
    </div>
  );
}

/** Role play (spec 7.3): one row at a time, full screen. Also used by the review queue. */
export function RolePlayMode({ items, index, onGrade, onSkip }: { items: DrillItem[]; index: number; onGrade: (it: DrillItem, g: Grade) => void; onSkip?: () => void }) {
  const it = items[index];
  const [shown, setShown] = useState(false);
  useEffect(() => setShown(false), [index]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === " " && !shown) {
        e.preventDefault();
        setShown(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shown]);
  if (!it) return null;
  const t = itemText(it);
  return (
    <div className="roleplay" aria-live="polite">
      <div className="small muted">{index + 1} / {items.length} · {it.number} · {it.gate.title} · you are <strong>{it.role}</strong></div>
      <div className="big" style={{ fontWeight: 700 }}>{it.row.trigger}</div>
      {t.otherAction !== "" && (
        <div className={`lane-block ${t.otherRole.toLowerCase()}`}>
          <div className={`lane-label ${t.otherRole.toLowerCase()}`}>{t.otherRole}</div>
          {t.otherAction}
          {t.otherCallout && <span className="callout">“{t.otherCallout}”</span>}
        </div>
      )}
      <div className={`lane-block ${it.role.toLowerCase()}`}>
        <div className={`lane-label ${it.role.toLowerCase()}`}>{it.role} (you)</div>
        {shown ? (
          <>
            {t.ownAction || <span className="muted">—</span>}
            {t.ownCallout && <span className="callout">“{t.ownCallout}”</span>}
          </>
        ) : (
          <button type="button" className="drill-hidden big" onClick={() => setShown(true)}>Reveal (space)</button>
        )}
      </div>
      {shown && <GradeBar onGrade={(g) => onGrade(it, g)} />}
      {onSkip && <button type="button" className="btn small ghost" onClick={onSkip}>Skip</button>}
    </div>
  );
}

function OrderCard({ row, state }: { row: Row; state?: "wrong" | "right" }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: row.id });
  const text = row.pf ? `PF: ${row.pf.action}${row.pm?.action ? ` · PM: ${row.pm.action}` : ""}` : row.action ?? "";
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`order-card${state ? ` ${state}` : ""}`}>
      <button type="button" className="handle drag-handle" {...attributes} {...listeners} aria-label={`Drag ${row.trigger}`}>⋮⋮</button>
      <div><strong>{row.trigger}</strong><div className="small muted">{text}</div></div>
    </div>
  );
}

/** Order drill (spec 7.4): one gate's rows shuffled; drag into sequence, then check. */
export function OrderMode({ items, onGraded }: { items: DrillItem[]; onGraded: (it: DrillItem, g: Grade, missed: boolean) => void }) {
  const rows = [...new Map(items.map((i) => [i.row.id, i.row])).values()];
  const correct = rows.map((r) => r.id);
  const [order, setOrder] = useState<string[]>(() => {
    let s = shuffle(correct);
    if (s.length > 1 && s.every((id, i) => id === correct[i])) s = [...s.slice(1), s[0]!];
    return s;
  });
  const [result, setResult] = useState<{ misplaced: number } | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id || result) return;
    setOrder((o) => arrayMove(o, o.indexOf(String(active.id)), o.indexOf(String(over.id))));
  };
  const check = () => {
    const misplaced = countMisplaced(order, correct);
    setResult({ misplaced });
    const g = orderGrade(misplaced);
    for (const it of items) onGraded(it, g, order.indexOf(it.row.id) !== correct.indexOf(it.row.id));
  };
  return (
    <div>
      <p className="small muted">Drag the rows into the correct sequence, then check. Keyboard: focus a handle, press space, use arrows.</p>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={order} strategy={verticalListSortingStrategy}>
          {order.map((id, i) => <OrderCard key={id} row={byId.get(id)!} state={result ? (correct[i] === id ? "right" : "wrong") : undefined} />)}
        </SortableContext>
      </DndContext>
      {!result && <button type="button" className="btn primary" onClick={check}>Check order</button>}
      {result && (
        <div className="card">
          <strong>{result.misplaced === 0 ? "All in order" : `${result.misplaced} misplaced`}</strong> → graded {result.misplaced === 0 ? "Good" : result.misplaced === 1 ? "Hard" : "Again"} for each row.
          {result.misplaced > 0 && (
            <>
              <h3>Correct order</h3>
              <ol>{correct.map((id) => <li key={id}>{byId.get(id)!.trigger}</li>)}</ol>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Audio drill (spec 7.5): speechSynthesis reads trigger + other pilot's callout, waits, then reads the answer. */
export function AudioMode({ items, rate, gapSeconds, onGrade, onRate }: { items: DrillItem[]; rate: number; gapSeconds: number; onGrade: (it: DrillItem, g: Grade) => void; onRate: (r: number) => void }) {
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<"idle" | "question" | "gap" | "answer" | "done">("idle");
  const [paused, setPaused] = useState(false);
  const [graded, setGraded] = useState<Set<number>>(new Set());
  const timer = useRef<number | null>(null);
  const lock = useRef<WakeLockSentinel | null>(null);
  const supported = typeof speechSynthesis !== "undefined";
  const it = items[index];

  useEffect(() => {
    void navigator.wakeLock?.request("screen").then((l) => (lock.current = l)).catch(() => undefined);
    return () => {
      void lock.current?.release();
      if (supported) speechSynthesis.cancel();
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [supported]);

  const speak = (text: string, then: () => void) => {
    if (!supported || !text.trim()) return then();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = rate;
    u.onend = then;
    u.onerror = then;
    speechSynthesis.speak(u);
  };
  const play = (i = index) => {
    const item = items[i];
    if (!item) return setPhase("done");
    speechSynthesis.cancel();
    setPhase("question");
    const t = itemText(item);
    const q = [item.row.trigger, t.otherCallout ? `${t.otherRole}: ${t.otherCallout}` : ""].filter(Boolean).join(". ");
    speak(q, () => {
      setPhase("gap");
      timer.current = window.setTimeout(() => {
        setPhase("answer");
        const a = [t.ownAction, t.ownCallout ?? ""].filter(Boolean).join(". ");
        speak(`${item.role}: ${a}`, () => setPhase("idle"));
      }, gapSeconds * 1000);
    });
  };
  const next = () => {
    if (timer.current) window.clearTimeout(timer.current);
    speechSynthesis.cancel();
    const n = index + 1;
    if (n >= items.length) return setPhase("done");
    setIndex(n);
    play(n);
  };
  if (!supported) return <p className="banner danger">Speech synthesis is not available in this browser.</p>;
  if (phase === "done" || !it) return <p className="card">Audio drill finished.</p>;
  const t = itemText(it);
  return (
    <div className="roleplay">
      <div className="small muted">{index + 1} / {items.length} · {it.number} · you are <strong>{it.role}</strong> · {phase}</div>
      <div className="big" style={{ fontWeight: 700 }}>{it.row.trigger}</div>
      {phase === "answer" || phase === "idle" ? (
        <div className={`lane-block ${it.role.toLowerCase()}`}>{t.ownAction}{t.ownCallout && <span className="callout">“{t.ownCallout}”</span>}</div>
      ) : (
        <div className="drill-hidden" aria-hidden="true">listening…</div>
      )}
      <div className="row-actions">
        {phase === "idle" && <button type="button" className="btn primary" onClick={() => play()}>{index === 0 && !graded.size ? "Start" : "Repeat"}</button>}
        {phase !== "idle" && (
          <button type="button" className="btn" onClick={() => { if (paused) { speechSynthesis.resume(); setPaused(false); } else { speechSynthesis.pause(); setPaused(true); } }}>{paused ? "Resume" : "Pause"}</button>
        )}
        <button type="button" className="btn" onClick={() => play()}>Repeat</button>
        <button type="button" className="btn" onClick={next}>Skip / next</button>
        <label className="btn" style={{ gap: 6 }}>Rate
          <input type="range" min={0.5} max={2} step={0.1} value={rate} onChange={(e) => onRate(Number(e.target.value))} aria-label="Speech rate" style={{ width: 90, minHeight: 0 }} />
          {rate.toFixed(1)}×
        </label>
      </div>
      <p className="small muted">Not graded unless you tap a grade.</p>
      <GradeBar disabled={graded.has(index)} onGrade={(g) => { setGraded(new Set(graded).add(index)); onGrade(it, g); next(); }} />
    </div>
  );
}
