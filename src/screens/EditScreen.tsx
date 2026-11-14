import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useLibrary } from "../state/LibraryProvider";
import { CATEGORIES, FLEETS, ProcedureSchema, WHO, type Category, type Fleet, type Gate, type LaneCell, type Layout, type Procedure, type Row, type RowOverride, type Status } from "../content/schema";
import { deriveNumbering } from "../content/numbering";
import * as M from "../edit/model";
import { parseQuickRows } from "../edit/quickAdd";
import { saveProcedure } from "../state/procedures";
import { reconcileReviewItems } from "../schedule/store";
import { href, hashQuery } from "../app/router";
import { Sheet } from "../components/Sheet";
import { Confirm } from "../components/Confirm";
import { useToast } from "../components/Toast";
import { downloadText, procedureToJson, procedureToMarkdown, safeFilename } from "../edit/export";
import { formatPath } from "../content/validate";
import { rowSummary } from "../edit/diff";
import { newId } from "../util/id";

/** Stable sensor options: new objects each render would re-create sensors and cancel an in-progress drag. */
const POINTER_OPTS = { activationConstraint: { distance: 6 } };
const TOUCH_OPTS = { activationConstraint: { delay: 200, tolerance: 8 } };
const KEYBOARD_OPTS = { coordinateGetter: sortableKeyboardCoordinates };

type Updater = Procedure | ((p: Procedure) => Procedure);
type Apply = (next: Updater, coalesceKey?: string) => void;

interface HistoryState {
  past: Procedure[];
  present: Procedure;
  future: Procedure[];
  lastKey: string | null;
  lastAt: number;
}

/**
 * Undo/redo over immutable snapshots. Typing in one field within a short
 * window is a single undo step (coalesceKey), not one step per character.
 */
function useHistory(initial: Procedure) {
  const [state, setState] = useState<HistoryState>({ past: [], present: initial, future: [], lastKey: null, lastAt: 0 });
  const apply = useCallback<Apply>((next, key) => {
    const now = Date.now();
    setState((s) => {
      const n = M.autoStatus(typeof next === "function" ? next(s.present) : next);
      if (n === s.present) return s;
      const merge = !!key && s.lastKey === key && now - s.lastAt < 1500 && s.past.length > 0;
      return { past: merge ? s.past : [...s.past.slice(-199), s.present], present: n, future: [], lastKey: key ?? null, lastAt: now };
    });
  }, []);
  const undo = useCallback(() => {
    setState((s) => {
      const prev = s.past[s.past.length - 1];
      return prev ? { past: s.past.slice(0, -1), present: prev, future: [s.present, ...s.future], lastKey: null, lastAt: 0 } : s;
    });
  }, []);
  const redo = useCallback(() => {
    setState((s) => {
      const next = s.future[0];
      return next ? { past: [...s.past, s.present], present: next, future: s.future.slice(1), lastKey: null, lastAt: 0 } : s;
    });
  }, []);
  return { present: state.present, apply, undo, redo, canUndo: state.past.length > 0, canRedo: state.future.length > 0 };
}

export function EditScreen({ id }: { id: string }) {
  const lib = useLibrary();
  const entry = lib.get(id);
  if (!entry) return lib.loading ? <p className="muted">Loading…</p> : <p>Not found. <a href={href.library()}>Library</a></p>;
  return <Editor key={id} initial={entry.procedure} shipped={entry.shipped} />;
}

/** Auto-growing, borderless text field that reads like the script until focused. Enter moves on. */
function Field({ id, value, onChange, label, placeholder, className, onNext, onBlur }: {
  id?: string; value: string; onChange: (v: string) => void; label: string; placeholder?: string; className?: string;
  onNext: (el: HTMLElement) => void; onBlur?: (v: string) => void;
}) {
  return (
    <span className={`grow${className ? ` ${className}` : ""}`} data-value={value || placeholder || ""}>
      <textarea
        id={id}
        rows={1}
        data-nav=""
        aria-label={label}
        placeholder={placeholder}
        value={value}
        enterKeyHint="next"
        autoCapitalize="sentences"
        onChange={(e) => onChange(e.target.value.replace(/\r?\n/g, " "))}
        onBlur={onBlur ? (e) => onBlur(e.target.value) : undefined}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            onNext(e.currentTarget);
          }
        }}
      />
    </span>
  );
}

const stripQuotes = (s: string) => s.trim().replace(/^["“”']+|["“”']+$/g, "").trim();

/** Everything a row or gate needs from the editor; one stable object so rows can be memoised. */
interface Ops {
  apply: Apply;
  activate: (rowId: string) => void;
  next: (el: HTMLElement) => void;
  addRow: (gateId: string, index: number) => void;
  removeRow: (gateId: string, rowId: string) => void;
  openRowDetails: (gateId: string, rowId: string) => void;
  openGateMenu: (gateId: string) => void;
  openPaste: (gateId: string) => void;
  toggleCollapse: (gateId: string) => void;
}

function Editor({ initial, shipped }: { initial: Procedure; shipped: Procedure | undefined }) {
  const toast = useToast();
  const [start] = useState(() => M.autoStatus(initial));
  const { present: p, apply, undo, redo, canUndo, canRedo } = useHistory(start);
  const [saved, setSaved] = useState<"saved" | "saving" | "dirty" | "error">("saved");
  const [errors, setErrors] = useState<string[]>([]);
  const [activeRow, setActiveRow] = useState<string | null>(() => hashQuery().get("row"));
  const [focusReq, setFocusReq] = useState<{ id: string; n: number } | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState(false);
  const [showMeta, setShowMeta] = useState(false);
  const [gateMenu, setGateMenu] = useState<string | null>(null);
  const [rowDetails, setRowDetails] = useState<{ gateId: string; rowId: string } | null>(null);
  const [paste, setPaste] = useState<string | null>(null);
  const [convert, setConvert] = useState<{ gateId: string; to: Layout } | null>(null);
  const [branchFor, setBranchFor] = useState<string | null>(null);
  const [branchCond, setBranchCond] = useState("");
  const [confirm, setConfirm] = useState<{ title: string; message: string; run: () => void } | null>(null);
  const baseVersion = useRef(initial.version);
  const lastSaved = useRef<Procedure>(start);
  const latest = useRef<Procedure>(p);
  latest.current = p;
  /** Rows the editor added on its own (Return at the end of a gate); dropped from the saved copy while still blank. */
  const autoRows = useRef<Set<string>>(new Set());
  const [tip, setTip] = useState(() => {
    try {
      return localStorage.getItem("flow.editorTipSeen") !== "1";
    } catch {
      return true;
    }
  });
  const numbering = useMemo(() => deriveNumbering(p), [p]);

  // ---- Saving: debounced while typing, flushed when leaving or backgrounding the app.
  const save = useCallback(
    async (draft: Procedure) => {
      const toSave = { ...M.prepareForSave(M.dropUnusedRows(draft, autoRows.current), initial.title), version: baseVersion.current + 1 };
      const v = ProcedureSchema.safeParse(toSave);
      if (!v.success) {
        setErrors(v.error.issues.map((i) => `${formatPath(i.path)}: ${i.message}`));
        setSaved("error");
        return;
      }
      setErrors([]);
      setSaved("saving");
      try {
        await saveProcedure(v.data, shipped);
        await reconcileReviewItems(v.data);
        lastSaved.current = draft;
        if (latest.current === draft) setSaved("saved");
      } catch (e) {
        setSaved("error");
        setErrors([(e as Error).message]);
      }
    },
    [initial.title, shipped],
  );
  useEffect(() => {
    if (p === lastSaved.current) return;
    setSaved("dirty");
    const t = window.setTimeout(() => void save(p), 700);
    return () => window.clearTimeout(t);
  }, [p, save]);
  useEffect(() => {
    const flush = () => {
      if (latest.current !== lastSaved.current) void save(latest.current);
    };
    const onHide = () => document.visibilityState === "hidden" && flush();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flush);
      flush(); // leaving the editor (Done) never drops the last keystrokes
    };
  }, [save]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el.tagName === "INPUT" || el.tagName === "TEXTAREA";
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !typing) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  // ---- Focus requests (new row, jump from read view).
  useEffect(() => {
    if (!focusReq) return;
    const el = document.getElementById(focusReq.id);
    if (el) {
      el.focus();
      el.scrollIntoView({ block: "nearest" });
    }
  }, [focusReq]);
  useEffect(() => {
    const row = hashQuery().get("row");
    if (row) {
      document.getElementById(`erow-${row}`)?.scrollIntoView({ block: "center" });
    } else if (initial.gates.length === 1 && initial.gates[0]!.rows.length === 1 && !initial.gates[0]!.rows[0]!.trigger) {
      // Brand-new procedure: put the cursor where the work starts.
      setFocusReq({ id: `f-${initial.gates[0]!.id}-title`, n: 0 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ops = useMemo<Ops>(() => {
    const focus = (id: string) => setFocusReq((r) => ({ id, n: (r?.n ?? 0) + 1 }));
    const addRow = (gateId: string, index: number, auto = false) => {
      const gate = latest.current.gates.find((g) => g.id === gateId);
      if (!gate) return;
      const row = M.blankRow(gate.layout);
      if (auto) autoRows.current.add(row.id);
      apply((cur) => M.insertRow(cur, gateId, index, row));
      setCollapsed((c) => (c.has(gateId) ? new Set([...c].filter((x) => x !== gateId)) : c));
      setActiveRow(row.id);
      focus(`f-${row.id}-trigger`);
    };
    return {
      apply,
      activate: (rowId) => setActiveRow(rowId),
      next: (el) => {
        const scope = el.closest<HTMLElement>("[data-gate]");
        if (!scope) return;
        const fields = [...scope.querySelectorAll<HTMLElement>("[data-nav]")];
        const i = fields.indexOf(el);
        const nextEl = fields[i + 1];
        if (nextEl) nextEl.focus();
        else addRow(scope.dataset.gate!, Number.MAX_SAFE_INTEGER, true);
      },
      addRow: (gateId, index) => addRow(gateId, index),
      removeRow: (gateId, rowId) => {
        apply((cur) => M.deleteRow(cur, gateId, rowId));
        toast.show("Row deleted", { label: "Undo", run: undo });
      },
      openRowDetails: (gateId, rowId) => setRowDetails({ gateId, rowId }),
      openGateMenu: (gateId) => setGateMenu(gateId),
      openPaste: (gateId) => setPaste(gateId),
      toggleCollapse: (gateId) => setCollapsed((c) => { const n = new Set(c); if (n.has(gateId)) n.delete(gateId); else n.add(gateId); return n; }),
    };
  }, [apply, toast, undo]);

  const sensors = useSensors(useSensor(PointerSensor, POINTER_OPTS), useSensor(TouchSensor, TOUCH_OPTS), useSensor(KeyboardSensor, KEYBOARD_OPTS));
  const onGateDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    apply((cur) => M.reorderGates(cur, cur.gates.findIndex((g) => g.id === active.id), cur.gates.findIndex((g) => g.id === over.id)));
  };

  const addGate = (afterId?: string) => {
    const gate: Gate = { ...M.blankGate("two-lane", ""), rows: [M.blankRow("two-lane")] };
    apply((cur) => M.addGate(cur, afterId, "two-lane", gate));
    setActiveRow(gate.rows[0]!.id);
    setFocusReq((r) => ({ id: `f-${gate.id}-title`, n: (r?.n ?? 0) + 1 }));
  };

  const exportable = (): Procedure => M.prepareForSave(M.dropUnusedRows(p === start ? p : { ...p, version: baseVersion.current + 1 }, autoRows.current), initial.title);
  const menuGate = gateMenu ? p.gates.find((g) => g.id === gateMenu) : undefined;
  const detailsGate = rowDetails ? p.gates.find((g) => g.id === rowDetails.gateId) : undefined;
  const detailsRow = detailsGate?.rows.find((r) => r.id === rowDetails?.rowId);
  const openCount = p.gates.reduce((n, g) => n + g.rows.filter((r) => r.status !== "ok").length, 0);

  return (
    <>
      <div className="topbar">
        <a className="btn small" href={href.read(p.id)} aria-label="Done, back to read view">‹ Done</a>
        <span className="title">{p.title || "Untitled procedure"}</span>
        <span className="small muted" aria-live="polite">{saved === "saved" ? "Saved" : saved === "saving" ? "Saving…" : saved === "dirty" ? "Saving…" : "Not saved"}</span>
        <button type="button" className="btn small" onClick={undo} disabled={!canUndo} aria-label="Undo">↶</button>
        <button type="button" className="btn small" onClick={redo} disabled={!canRedo} aria-label="Redo">↷</button>
        <button type="button" className="btn small" onClick={() => setMenu(true)} aria-label="More" aria-haspopup="dialog">⋯</button>
      </div>
      {errors.length > 0 && (
        <div className="banner danger" role="alert">
          <strong>Could not save</strong>
          <ul className="small">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </div>
      )}
      {tip && (
        <div className="banner editor-tip small">
          <p>Type straight into the script. <kbd>Return</kbd> jumps to the next box and starts a new row at the end. Tap a row for its tools.</p>
          <button type="button" className="btn small" onClick={() => { setTip(false); try { localStorage.setItem("flow.editorTipSeen", "1"); } catch { /* private mode */ } }}>Got it</button>
        </div>
      )}
      {openCount > 0 && <p className="small muted editor-hint">{openCount} {openCount === 1 ? "row has" : "rows have"} an empty lane (outlined in red).</p>}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onGateDragEnd}>
        <SortableContext items={p.gates.map((g) => g.id)} strategy={verticalListSortingStrategy}>
          {p.gates.map((gate) => (
            <GateEditor
              key={gate.id}
              gate={gate}
              label={numbering.gates.get(gate.id) ?? ""}
              rowNumbers={numbering.rows}
              activeRow={gate.rows.some((r) => r.id === activeRow) ? activeRow : null}
              collapsed={collapsed.has(gate.id)}
              ops={ops}
            />
          ))}
        </SortableContext>
      </DndContext>
      <button type="button" className="btn add-gate" onClick={() => addGate()}>+ Add gate</button>

      {menu && (
        <Sheet title="Procedure" onClose={() => setMenu(false)}>
          <div className="grid">
            <button type="button" className="btn" onClick={() => { setMenu(false); setShowMeta(true); }}>Title, fleets, tables…</button>
            <button type="button" className="btn" onClick={() => { setCollapsed(new Set(p.gates.map((g) => g.id))); setMenu(false); }}>Collapse all gates</button>
            <button type="button" className="btn" onClick={() => { setCollapsed(new Set()); setMenu(false); }}>Expand all gates</button>
            <button type="button" className="btn" onClick={() => downloadText(`${safeFilename(p.id)}.json`, procedureToJson(exportable()))}>Export JSON</button>
            <button type="button" className="btn" onClick={() => downloadText(`${safeFilename(p.id)}.md`, procedureToMarkdown(exportable()), "text/markdown")}>Export Markdown</button>
          </div>
        </Sheet>
      )}
      {showMeta && <MetaEditor p={p} apply={apply} onClose={() => setShowMeta(false)} />}

      {menuGate && (
        <Sheet title={`Gate ${numbering.gates.get(menuGate.id) ?? ""} ${menuGate.title}`.trim()} onClose={() => setGateMenu(null)}>
          <div className="grid">
            <button type="button" className="btn" disabled={p.gates[0]?.id === menuGate.id} onClick={() => apply((cur) => M.moveGate(cur, menuGate.id, -1))}>↑ Move up</button>
            <button type="button" className="btn" disabled={p.gates[p.gates.length - 1]?.id === menuGate.id} onClick={() => apply((cur) => M.moveGate(cur, menuGate.id, 1))}>↓ Move down</button>
            <button type="button" className="btn" onClick={() => { setGateMenu(null); addGate(menuGate.id); }}>+ Gate after this</button>
            <button type="button" className="btn" onClick={() => { setBranchFor(menuGate.id); setBranchCond(""); setGateMenu(null); }}>+ Branch after this</button>
            <button type="button" className="btn" onClick={() => { setPaste(menuGate.id); setGateMenu(null); }}>Paste rows…</button>
            <button type="button" className="btn" onClick={() => { setConvert({ gateId: menuGate.id, to: menuGate.layout === "two-lane" ? "single-lane" : "two-lane" }); setGateMenu(null); }}>
              Switch to {menuGate.layout === "two-lane" ? "single lane" : "PF / PM lanes"}…
            </button>
          </div>
          {menuGate.layout === "single-lane" && (
            <div className="chips" role="group" aria-label="Assign every row to" style={{ marginTop: 12 }}>
              <span className="small muted" style={{ alignSelf: "center" }}>Assign every row to</span>
              {WHO.map((w) => <button key={w} type="button" className="chip" onClick={() => apply((cur) => M.bulkWho(cur, menuGate.id, w))}>{w === "UNASSIGNED" ? "nobody" : w}</button>)}
            </div>
          )}
          {menuGate.branch && (
            <div style={{ marginTop: 12 }}>
              <label className="field"><span>This is a branch chosen after</span>
                <select value={menuGate.branch.parentGateId} onChange={(e) => apply((cur) => M.updateGate(cur, menuGate.id, { branch: { ...menuGate.branch!, parentGateId: e.target.value } }))}>
                  {p.gates.filter((g) => g.id !== menuGate.id).map((g) => <option key={g.id} value={g.id}>{numbering.gates.get(g.id)} {g.title || M.UNTITLED_GATE}</option>)}
                </select>
              </label>
              <label className="field"><span>When (shown in the chooser)</span>
                <input type="text" value={menuGate.branch.condition} onChange={(e) => apply((cur) => M.updateGate(cur, menuGate.id, { branch: { ...menuGate.branch!, condition: e.target.value } }), `${menuGate.id}:cond`)} />
              </label>
              <button type="button" className="btn small" onClick={() => apply((cur) => M.updateGate(cur, menuGate.id, { branch: undefined }))}>Make it a main gate</button>
            </div>
          )}
          <div className="row-actions" style={{ marginTop: 16 }}>
            <button type="button" className="btn danger" onClick={() => { const g = menuGate; setGateMenu(null); setConfirm({ title: "Delete gate?", message: `Delete “${g.title || M.UNTITLED_GATE}” and its ${g.rows.length} rows? You can undo this.`, run: () => apply((cur) => M.deleteGate(cur, g.id)) }); }}>Delete gate</button>
            <button type="button" className="btn primary" onClick={() => setGateMenu(null)}>Close</button>
          </div>
        </Sheet>
      )}

      {rowDetails && detailsGate && detailsRow && (
        <RowDetailsSheet p={p} gate={detailsGate} row={detailsRow} number={numbering.rows.get(detailsRow.id) ?? ""} apply={apply} onClose={() => setRowDetails(null)} />
      )}
      {paste && <PasteRowsSheet gate={p.gates.find((g) => g.id === paste)!} onClose={() => setPaste(null)} onAdd={(rows) => { apply((cur) => rows.reduce((acc, r) => M.insertRow(acc, paste, Number.MAX_SAFE_INTEGER, r), dropBlankRows(cur, paste))); setPaste(null); toast.show(`${rows.length} ${rows.length === 1 ? "row" : "rows"} added`, { label: "Undo", run: undo }); }} />}

      {convert && (
        <Sheet title={`Switch to ${convert.to === "two-lane" ? "PF / PM lanes" : "single lane"}`} onClose={() => setConvert(null)}>
          <p className="small muted">Before and after. Gaps stay empty for you to fill; nothing is invented.</p>
          {p.gates.find((g) => g.id === convert.gateId)?.rows.map((r) => (
            <div key={r.id} className="diff-row changed">
              <div className="side">{rowSummary(r)}</div>
              <div className="side">{rowSummary(M.convertRow(r, convert.to))}</div>
            </div>
          ))}
          <div className="row-actions">
            <button type="button" className="btn primary" onClick={() => { apply((cur) => M.switchLayout(cur, convert.gateId, convert.to)); setConvert(null); }}>Convert</button>
            <button type="button" className="btn" onClick={() => setConvert(null)}>Cancel</button>
          </div>
        </Sheet>
      )}
      {branchFor && (
        <Sheet title="Add branch" onClose={() => setBranchFor(null)}>
          <p className="small muted">A branch is an alternative path chosen after this gate. Add one branch per outcome.</p>
          <label className="field"><span>When is this branch taken?</span>
            <input type="text" value={branchCond} onChange={(e) => setBranchCond(e.target.value)} />
          </label>
          <div className="row-actions">
            <button type="button" className="btn primary" disabled={!branchCond.trim()} onClick={() => { apply((cur) => M.addBranch(cur, branchFor, branchCond.trim())); setBranchFor(null); }}>Add branch</button>
            <button type="button" className="btn" onClick={() => setBranchFor(null)}>Cancel</button>
          </div>
        </Sheet>
      )}
      {confirm && <Confirm title={confirm.title} message={confirm.message} danger confirmLabel="Delete" onCancel={() => setConfirm(null)} onConfirm={() => { confirm.run(); setConfirm(null); toast.show("Deleted", { label: "Undo", run: undo }); }} />}
    </>
  );
}

/** Before pasting, clear blank rows at the end of the gate so pasted rows follow the real content. */
function dropBlankRows(p: Procedure, gateId: string): Procedure {
  const g = p.gates.find((x) => x.id === gateId);
  if (!g) return p;
  let end = g.rows.length;
  while (end > 0 && M.rowBlank(g.rows[end - 1]!)) end -= 1;
  return end === g.rows.length ? p : M.updateGate(p, gateId, { rows: g.rows.slice(0, end) });
}

const GateEditor = memo(function GateEditor({ gate, label, rowNumbers, activeRow, collapsed, ops }: {
  gate: Gate; label: string; rowNumbers: Map<string, string>; activeRow: string | null; collapsed: boolean; ops: Ops;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: gate.id });
  const sensors = useSensors(useSensor(PointerSensor, POINTER_OPTS), useSensor(TouchSensor, TOUCH_OPTS), useSensor(KeyboardSensor, KEYBOARD_OPTS));
  const onRowDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    ops.apply((cur) => {
      const g = cur.gates.find((x) => x.id === gate.id)!;
      return M.updateGate(cur, gate.id, { rows: arrayMove(g.rows, g.rows.findIndex((r) => r.id === active.id), g.rows.findIndex((r) => r.id === over.id)) });
    });
  };
  const open = gate.rows.filter((r) => r.status !== "ok").length;
  return (
    <section ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`egate${isDragging ? " dragging" : ""}`} aria-label={`Gate ${label} ${gate.title}`} data-gate={gate.id}>
      <div className="egate-head">
        <button type="button" className="drag-handle" {...attributes} {...listeners} aria-label={`Drag to reorder gate ${label}`}>⋮⋮</button>
        <span className="num">{label}</span>
        <Field id={`f-${gate.id}-title`} className="gate-title" label="Gate title" placeholder="Gate title" value={gate.title === M.UNTITLED_GATE ? "" : gate.title} onChange={(v) => ops.apply((cur) => M.updateGate(cur, gate.id, { title: v }), `${gate.id}:title`)} onNext={ops.next} />
        <button type="button" className="btn tool" aria-expanded={!collapsed} onClick={() => ops.toggleCollapse(gate.id)} aria-label={collapsed ? "Expand gate" : "Collapse gate"}>{collapsed ? "▸" : "▾"}</button>
        <button type="button" className="btn tool" onClick={() => ops.openGateMenu(gate.id)} aria-label={`Gate ${label} options`} aria-haspopup="dialog">⋯</button>
      </div>
      {gate.branch && (
        <button type="button" className="chip tiny branch-chip" onClick={() => ops.openGateMenu(gate.id)}>branch: {gate.branch.condition || "…"}</button>
      )}
      {collapsed ? (
        <p className="small muted egate-summary">{gate.rows.length} {gate.rows.length === 1 ? "row" : "rows"}{open > 0 ? ` · ${open} with an empty lane` : ""}</p>
      ) : (
        <>
          <Field className="gate-aim" label="Gate aim" placeholder="Aim: what this gate achieves (optional)" value={gate.aim ?? ""} onChange={(v) => ops.apply((cur) => M.updateGate(cur, gate.id, { aim: v || undefined }), `${gate.id}:aim`)} onNext={ops.next} />
          {gate.layout === "two-lane" && (
            <div className="erow-colhead" aria-hidden="true"><span>Trigger</span><span className="pf">PF</span><span className="pm">PM</span></div>
          )}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onRowDragEnd}>
            <SortableContext items={gate.rows.map((r) => r.id)} strategy={verticalListSortingStrategy}>
              {gate.rows.map((row, i) => (
                <RowEditor key={row.id} gateId={gate.id} layout={gate.layout} row={row} index={i} count={gate.rows.length} number={rowNumbers.get(row.id) ?? "?"} active={activeRow === row.id} ops={ops} />
              ))}
            </SortableContext>
          </DndContext>
          <div className="egate-foot">
            <button type="button" className="btn" onClick={() => ops.addRow(gate.id, Number.MAX_SAFE_INTEGER)}>+ Row</button>
            <button type="button" className="btn ghost" onClick={() => ops.openPaste(gate.id)}>Paste rows…</button>
          </div>
        </>
      )}
    </section>
  );
});

const RowEditor = memo(function RowEditor({ gateId, layout, row, index, count, number, active, ops }: {
  gateId: string; layout: Layout; row: Row; index: number; count: number; number: string; active: boolean; ops: Ops;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: row.id });
  const set = (patch: Partial<Row>, key?: string) => ops.apply((cur) => M.updateRow(cur, gateId, row.id, patch), key ? `${row.id}:${key}` : undefined);
  const setCell = (lane: "pf" | "pm", patch: Partial<LaneCell>, key?: string) => set({ [lane]: { ...(row[lane] ?? { action: "" }), ...patch } }, key ? `${lane}.${key}` : undefined);
  const twoLane = layout === "two-lane";
  const incomplete = M.rowIncomplete(layout, row);

  const lane = (which: "pf" | "pm") => {
    const cell = row[which] ?? { action: "" };
    const L = which.toUpperCase();
    const empty = !cell.action.trim() && !cell.callout && !cell.standing;
    return (
      <div className={`lane-block ${which}${cell.standing ? " is-standing" : ""}${empty ? " is-empty" : ""}`}>
        <div className={`lane-label ${which}`}>{L}{cell.standing && <span className="standing-tag"> · standing</span>}</div>
        <Field id={`f-${row.id}-${which}`} label={`${L} action`} placeholder={cell.standing ? "(continues)" : `${L} does…`} value={cell.action} onChange={(v) => setCell(which, { action: v }, "action")} onNext={ops.next} />
        {(active || cell.callout) && (
          <span className="callout-edit">
            <Field label={`${L} callout`} placeholder="says…" value={cell.callout ?? ""} onChange={(v) => setCell(which, { callout: v || undefined }, "callout")} onBlur={(v) => { const c = stripQuotes(v); if (c !== v) setCell(which, { callout: c || undefined }); }} onNext={ops.next} />
          </span>
        )}
        {active && (
          <button type="button" className="chip standing-chip" aria-pressed={!!cell.standing} title="A standing task: the pilot keeps doing something (flies, continues). Shown muted and never drilled." onClick={() => setCell(which, { standing: cell.standing ? undefined : true })}>
            {cell.standing ? "✓ Standing" : "Standing"}
          </button>
        )}
      </div>
    );
  };

  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`erow${active ? " active" : ""}${isDragging ? " dragging" : ""}`} id={`erow-${row.id}`} onFocusCapture={() => !active && ops.activate(row.id)} onClick={() => !active && ops.activate(row.id)}>
      <div className="erow-main">
        <div className="erow-head">
          <button type="button" className="drag-handle" {...attributes} {...listeners} aria-label={`Drag to reorder row ${number}`}>⋮⋮</button>
          <span className="num">{number}</span>
          <Field id={`f-${row.id}-trigger`} className="trigger" label="Trigger" placeholder="Trigger: what starts this step" value={row.trigger} onChange={(v) => set({ trigger: v }, "trigger")} onNext={ops.next} />
        </div>
        {twoLane ? (
          <div className="erow-lanes">{lane("pf")}{lane("pm")}</div>
        ) : (
          <div className="erow-lanes single">
            <div className={`lane-block ${row.who === "PF" ? "pf" : row.who === "PM" ? "pm" : "action"}`}>
              <div className="chips who-chips" role="group" aria-label="Who">
                {WHO.map((w) => (
                  <button key={w} type="button" className="chip tiny-tap" aria-pressed={(row.who ?? "UNASSIGNED") === w} onClick={() => set({ who: w })}>{w === "UNASSIGNED" ? "—" : w}</button>
                ))}
              </div>
              <Field id={`f-${row.id}-action`} label="Action" placeholder="Action…" value={row.action ?? ""} onChange={(v) => set({ action: v }, "action")} onNext={ops.next} />
              {(active || row.callout) && (
                <span className="callout-edit">
                  <Field label="Callout" placeholder="says…" value={row.callout ?? ""} onChange={(v) => set({ callout: v || undefined }, "callout")} onBlur={(v) => { const c = stripQuotes(v); if (c !== v) set({ callout: c || undefined }); }} onNext={ops.next} />
                </span>
              )}
            </div>
          </div>
        )}
      </div>
      {!active && row.status !== "ok" && (
        <div className="erow-status">
          <span className={`status-badge ${row.status}`}>{row.status === "verify" ? "verify" : incomplete ? "empty lane" : "to fill"}</span>
          {row.statusNote && <span className="small muted"> {row.statusNote}</span>}
        </div>
      )}
      {active && (
        <div className="erow-tools" role="toolbar" aria-label={`Row ${number} tools`}>
          <button type="button" className="btn tool" disabled={index === 0} onClick={() => ops.apply((cur) => M.moveRow(cur, gateId, row.id, -1))} aria-label="Move row up">↑</button>
          <button type="button" className="btn tool" disabled={index === count - 1} onClick={() => ops.apply((cur) => M.moveRow(cur, gateId, row.id, 1))} aria-label="Move row down">↓</button>
          <button type="button" className="btn tool" onClick={() => ops.addRow(gateId, index + 1)}>+ Below</button>
          <button type="button" className="btn tool" onClick={() => ops.apply((cur) => M.duplicateRow(cur, gateId, row.id))}>Copy</button>
          <button type="button" className={`btn tool${row.status === "verify" ? " active" : ""}`} aria-pressed={row.status === "verify"} disabled={incomplete} onClick={() => set(row.status === "verify" ? { status: "ok", statusNote: undefined } : { status: "verify" })}>Verify</button>
          <button type="button" className="btn tool" onClick={() => ops.openRowDetails(gateId, row.id)} aria-haspopup="dialog">More…</button>
          <button type="button" className="btn tool danger" onClick={() => ops.removeRow(gateId, row.id)} aria-label="Delete row">Delete</button>
          {row.status === "verify" && (
            <input type="text" className="status-note" aria-label="What needs verifying" placeholder="What needs verifying?" value={row.statusNote ?? ""} onChange={(e) => set({ statusNote: e.target.value || undefined }, "note")} />
          )}
          {incomplete && twoLane && <p className="small muted tool-hint">A lane is empty. Fill it, or tap <strong>Standing</strong> if that pilot simply carries on.</p>}
        </div>
      )}
    </div>
  );
});

function RowDetailsSheet({ p, gate, row, number, apply, onClose }: { p: Procedure; gate: Gate; row: Row; number: string; apply: Apply; onClose: () => void }) {
  const [fleet, setFleet] = useState<Fleet | "">("");
  const set = (patch: Partial<Row>, key?: string) => apply((cur) => M.updateRow(cur, gate.id, row.id, patch), key ? `${row.id}:${key}` : undefined);
  const twoLane = gate.layout === "two-lane";
  const variant: RowOverride = (fleet && row.variants?.[fleet]) || {};
  const setVariant = (patch: RowOverride) => {
    if (!fleet) return;
    const cleaned = Object.fromEntries(Object.entries({ ...variant, ...patch }).filter(([, v]) => v !== undefined && v !== "")) as RowOverride;
    const variants = { ...(row.variants ?? {}) };
    if (Object.keys(cleaned).length === 0) delete variants[fleet];
    else variants[fleet] = cleaned;
    set({ variants: Object.keys(variants).length ? variants : undefined }, `variant.${fleet}`);
  };
  const others = p.gates.filter((g) => g.id !== gate.id);
  return (
    <Sheet title={`Row ${number}`} onClose={onClose}>
      <p className="small muted">{row.trigger || "(no trigger yet)"}</p>
      <label className="field"><span>Status</span>
        <select value={row.status} onChange={(e) => set({ status: e.target.value as Status, ...(e.target.value === "ok" ? { statusNote: undefined } : {}) })}>
          <option value="ok">ok</option>
          <option value="verify">verify</option>
          {row.status === "to-fill" && <option value="to-fill">to fill</option>}
        </select>
      </label>
      {row.status !== "ok" && <label className="field"><span>Status note</span><input type="text" value={row.statusNote ?? ""} onChange={(e) => set({ statusNote: e.target.value || undefined }, "note")} /></label>}
      <label className="field"><span>Why (your rationale)</span><textarea value={row.why ?? ""} onChange={(e) => set({ why: e.target.value || undefined }, "why")} /></label>
      <label className="field"><span>Source reference</span><input type="text" value={row.sourceRef ?? ""} onChange={(e) => set({ sourceRef: e.target.value || undefined }, "src")} /></label>
      <h3>Fleet differences</h3>
      <div className="chips" role="group" aria-label="Fleet to override">
        {FLEETS.map((f) => <button key={f} type="button" className="chip" aria-pressed={fleet === f} onClick={() => setFleet(fleet === f ? "" : f)}>{f}{row.variants?.[f] ? " •" : ""}</button>)}
      </div>
      {fleet && (
        <div className="card">
          <p className="small muted">Only fill what differs on {fleet}. Blank means same as the main row.</p>
          <label className="field"><span>Trigger</span><input type="text" value={variant.trigger ?? ""} onChange={(e) => setVariant({ trigger: e.target.value || undefined })} /></label>
          {twoLane ? (
            (["pf", "pm"] as const).map((l) => (
              <div key={l}>
                <label className="field"><span>{l.toUpperCase()} action</span><input type="text" value={variant[l]?.action ?? ""} onChange={(e) => setVariant({ [l]: e.target.value || variant[l]?.callout ? { ...(variant[l] ?? {}), action: e.target.value } : undefined })} /></label>
                <label className="field"><span>{l.toUpperCase()} callout</span><input type="text" value={variant[l]?.callout ?? ""} onChange={(e) => setVariant({ [l]: e.target.value || variant[l]?.action ? { action: variant[l]?.action ?? row[l]?.action ?? "", ...(e.target.value ? { callout: e.target.value } : {}) } : undefined })} /></label>
              </div>
            ))
          ) : (
            <>
              <label className="field"><span>Action</span><input type="text" value={variant.action ?? ""} onChange={(e) => setVariant({ action: e.target.value || undefined })} /></label>
              <label className="field"><span>Callout</span><input type="text" value={variant.callout ?? ""} onChange={(e) => setVariant({ callout: e.target.value || undefined })} /></label>
            </>
          )}
        </div>
      )}
      {others.length > 0 && (
        <label className="field"><span>Move this row to another gate</span>
          <select value="" onChange={(e) => { if (e.target.value) { apply((cur) => M.moveRowToGate(cur, gate.id, row.id, e.target.value)); onClose(); } }}>
            <option value="">Choose a gate…</option>
            {others.map((g) => <option key={g.id} value={g.id}>{g.title || M.UNTITLED_GATE}</option>)}
          </select>
        </label>
      )}
      <div className="row-actions"><button type="button" className="btn primary" onClick={onClose}>Done</button></div>
    </Sheet>
  );
}

function PasteRowsSheet({ gate, onAdd, onClose }: { gate: Gate; onAdd: (rows: Row[]) => void; onClose: () => void }) {
  const [text, setText] = useState("");
  const twoLane = gate.layout === "two-lane";
  const parsed = useMemo(() => parseQuickRows(text, gate.layout, newId), [text, gate.layout]);
  return (
    <Sheet title="Paste rows" onClose={onClose}>
      <p className="small muted">
        One row per line: <code>{twoLane ? "Trigger | PF | PM" : "Trigger | Action | Who"}</code>. Put spoken words in "quotes".
        {twoLane && <> Use <code>-</code> for a pilot who simply carries on.</>} Tables copied from Notes, Excel or Markdown work too.
      </p>
      <label className="field"><span>Rows</span>
        <textarea value={text} onChange={(e) => setText(e.target.value)} style={{ minHeight: 140 }} autoCapitalize="sentences" />
      </label>
      {parsed.rows.length > 0 && (
        <div className="paste-preview" role="region" aria-label="Preview">
          {parsed.rows.slice(0, 50).map((r) => <div key={r.id} className="small paste-line">{rowSummary(r)}</div>)}
        </div>
      )}
      {parsed.skipped.length > 0 && (
        <ul className="small" style={{ color: "var(--danger)" }}>{parsed.skipped.map((s) => <li key={s.line}>Line {s.line} skipped: {s.reason}</li>)}</ul>
      )}
      <div className="row-actions">
        <button type="button" className="btn primary" disabled={parsed.rows.length === 0} onClick={() => onAdd(parsed.rows)}>Add {parsed.rows.length || ""} {parsed.rows.length === 1 ? "row" : "rows"}</button>
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
      </div>
    </Sheet>
  );
}

function MetaEditor({ p, apply, onClose }: { p: Procedure; apply: Apply; onClose: () => void }) {
  return (
    <Sheet title="Procedure details" onClose={onClose}>
      <label className="field"><span>Title</span><input type="text" value={p.title} onChange={(e) => apply({ ...p, title: e.target.value }, "meta:title")} /></label>
      <label className="field"><span>Category</span>
        <select value={p.category} onChange={(e) => apply({ ...p, category: e.target.value as Category })}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
      </label>
      <div className="chips" role="group" aria-label="Fleets">
        {FLEETS.map((f) => (
          <button key={f} type="button" className="chip" aria-pressed={p.fleets.includes(f)} onClick={() => apply({ ...p, fleets: p.fleets.includes(f) ? p.fleets.filter((x) => x !== f) : [...p.fleets, f as Fleet] })}>{f}</button>
        ))}
      </div>
      <label className="field"><span>Tags (comma separated)</span><input type="text" value={p.tags.join(", ")} onChange={(e) => apply({ ...p, tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) }, "meta:tags")} /></label>
      <label className="field"><span>Related procedure ids (comma separated)</span><input type="text" value={p.relatedProcedures.join(", ")} onChange={(e) => apply({ ...p, relatedProcedures: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) }, "meta:rel")} /></label>
      <label className="field"><span>Last reviewed</span><input type="date" value={p.lastReviewed ?? ""} onChange={(e) => { const n = { ...p }; if (e.target.value) n.lastReviewed = e.target.value; else delete n.lastReviewed; apply(n); }} /></label>
      <h3>Reference tables</h3>
      {p.referenceTables.map((t, ti) => (
        <div key={t.id} className="card">
          <label className="field"><span>Title</span><input type="text" value={t.title} onChange={(e) => apply({ ...p, referenceTables: p.referenceTables.map((x, i) => (i === ti ? { ...x, title: e.target.value } : x)) }, `tbl:${t.id}:title`)} /></label>
          <label className="field"><span>Note</span><input type="text" value={t.note ?? ""} onChange={(e) => apply({ ...p, referenceTables: p.referenceTables.map((x, i) => (i === ti ? { ...x, note: e.target.value || undefined } : x)) }, `tbl:${t.id}:note`)} /></label>
          <label className="field"><span>Columns (| separated)</span><input type="text" value={t.columns.join(" | ")} onChange={(e) => { const columns = e.target.value.split("|").map((c) => c.trim()); apply({ ...p, referenceTables: p.referenceTables.map((x, i) => (i === ti ? { ...x, columns, rows: x.rows.map((r) => columns.map((_, ci) => r[ci] ?? "")) } : x)) }, `tbl:${t.id}:cols`); }} /></label>
          <label className="field"><span>Rows (one per line, cells | separated)</span>
            <textarea value={t.rows.map((r) => r.join(" | ")).join("\n")} onChange={(e) => { const rows = e.target.value.split("\n").filter((l) => l.trim()).map((l) => { const cells = l.split("|").map((c) => c.trim()); return t.columns.map((_, ci) => cells[ci] ?? ""); }); apply({ ...p, referenceTables: p.referenceTables.map((x, i) => (i === ti ? { ...x, rows } : x)) }, `tbl:${t.id}:rows`); }} />
          </label>
          <button type="button" className="btn small danger" onClick={() => apply({ ...p, referenceTables: p.referenceTables.filter((_, i) => i !== ti) })}>Remove table</button>
        </div>
      ))}
      <button type="button" className="btn small" onClick={() => apply({ ...p, referenceTables: [...p.referenceTables, { id: newId(), title: "New table", columns: ["Column 1"], rows: [] }] })}>+ Reference table</button>
      <h3>Profile points</h3>
      {(p.profile ?? []).map((pt, i) => (
        <div key={i} className="edit-grid two">
          <input type="text" aria-label="Label" value={pt.label} onChange={(e) => apply({ ...p, profile: p.profile!.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)) }, `prof:${i}`)} />
          <select aria-label="Gate" value={pt.gateId} onChange={(e) => apply({ ...p, profile: p.profile!.map((x, k) => (k === i ? { ...x, gateId: e.target.value } : x)) })}>{p.gates.map((g) => <option key={g.id} value={g.id}>{g.title || M.UNTITLED_GATE}</option>)}</select>
          <div className="row-actions">
            <input type="number" aria-label="Altitude ft" placeholder="ft" value={pt.altitudeFt ?? ""} onChange={(e) => apply({ ...p, profile: p.profile!.map((x, k) => (k === i ? { ...x, altitudeFt: e.target.value === "" ? undefined : Number(e.target.value) } : x)) })} />
            <button type="button" className="btn small danger" onClick={() => apply({ ...p, profile: p.profile!.filter((_, k) => k !== i) })} aria-label="Remove profile point">✕</button>
          </div>
        </div>
      ))}
      {p.gates.length > 0 && <button type="button" className="btn small" onClick={() => apply({ ...p, profile: [...(p.profile ?? []), { label: "Point", gateId: p.gates[0]!.id }] })}>+ Profile point</button>}
      <div className="row-actions" style={{ marginTop: 12 }}><button type="button" className="btn primary" onClick={onClose}>Done</button></div>
    </Sheet>
  );
}
