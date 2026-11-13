import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

/** Stable sensor options: new objects each render would re-create sensors and cancel an in-progress drag. */
const POINTER_OPTS = { activationConstraint: { distance: 6 } };
const TOUCH_OPTS = { activationConstraint: { delay: 200, tolerance: 8 } };
const KEYBOARD_OPTS = { coordinateGetter: sortableKeyboardCoordinates };
import { useLibrary } from "../state/LibraryProvider";
import { CATEGORIES, FLEETS, ProcedureSchema, STATUSES, WHO, type Category, type Fleet, type Gate, type Layout, type Procedure, type Row, type RowOverride, type Status, type Who } from "../content/schema";
import { deriveNumbering } from "../content/numbering";
import * as M from "../edit/model";
import { saveProcedure } from "../state/procedures";
import { reconcileReviewItems } from "../schedule/store";
import { href } from "../app/router";
import { Sheet } from "../components/Sheet";
import { Confirm } from "../components/Confirm";
import { useToast } from "../components/Toast";
import { downloadText, procedureToJson, procedureToMarkdown, safeFilename } from "../edit/export";
import { formatPath } from "../content/validate";
import { rowSummary } from "../edit/diff";

/** Undo/redo history over immutable procedure snapshots. */
function useHistory(initial: Procedure) {
  const [past, setPast] = useState<Procedure[]>([]);
  const [present, setPresent] = useState<Procedure>(initial);
  const [future, setFuture] = useState<Procedure[]>([]);
  const apply = useCallback((next: Procedure | ((p: Procedure) => Procedure)) => {
    setPresent((cur) => {
      const n = typeof next === "function" ? next(cur) : next;
      if (n === cur) return cur;
      setPast((p) => [...p.slice(-199), cur]);
      setFuture([]);
      return n;
    });
  }, []);
  const undo = useCallback(() => {
    setPast((p) => {
      const prev = p[p.length - 1];
      if (!prev) return p;
      setPresent((cur) => {
        setFuture((f) => [cur, ...f]);
        return prev;
      });
      return p.slice(0, -1);
    });
  }, []);
  const redo = useCallback(() => {
    setFuture((f) => {
      const next = f[0];
      if (!next) return f;
      setPresent((cur) => {
        setPast((p) => [...p, cur]);
        return next;
      });
      return f.slice(1);
    });
  }, []);
  return { present, apply, undo, redo, canUndo: past.length > 0, canRedo: future.length > 0 };
}

export function EditScreen({ id }: { id: string }) {
  const lib = useLibrary();
  const entry = lib.get(id);
  if (!entry) return lib.loading ? <p className="muted">Loading…</p> : <p>Not found. <a href={href.library()}>Library</a></p>;
  return <Editor key={id} initial={entry.procedure} shipped={entry.shipped} />;
}

function Editor({ initial, shipped }: { initial: Procedure; shipped: Procedure | undefined }) {
  const toast = useToast();
  const { present: p, apply, undo, redo, canUndo, canRedo } = useHistory(initial);
  const [saved, setSaved] = useState<"saved" | "saving" | "dirty" | "error">("saved");
  const [errors, setErrors] = useState<string[]>([]);
  const [convert, setConvert] = useState<{ gateId: string; to: Layout } | null>(null);
  const [branchFor, setBranchFor] = useState<string | null>(null);
  const [branchCond, setBranchCond] = useState("");
  const [confirm, setConfirm] = useState<{ title: string; message: string; run: () => void } | null>(null);
  const [showMeta, setShowMeta] = useState(false);
  const baseVersion = useRef(initial.version);
  const numbering = useMemo(() => deriveNumbering(p), [p]);
  const lastSaved = useRef<Procedure>(initial);
  /** What an export should contain: the current state with the version the save gives it. */
  const exportable = (): Procedure => (p === initial && lastSaved.current === initial ? p : { ...p, version: baseVersion.current + 1 });

  // Autosave (debounced). Every save bumps version once per editing session (spec 6.3).
  useEffect(() => {
    if (p === lastSaved.current) return;
    setSaved("dirty");
    const t = window.setTimeout(async () => {
      const toSave: Procedure = { ...p, version: baseVersion.current + 1 };
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
        lastSaved.current = p;
        setSaved("saved");
      } catch (e) {
        setSaved("error");
        setErrors([(e as Error).message]);
      }
    }, 700);
    return () => window.clearTimeout(t);
  }, [p, shipped]);

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

  const sensors = useSensors(
    useSensor(PointerSensor, POINTER_OPTS),
    useSensor(TouchSensor, TOUCH_OPTS),
    useSensor(KeyboardSensor, KEYBOARD_OPTS),
  );
  const onGateDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = p.gates.findIndex((g) => g.id === active.id);
    const to = p.gates.findIndex((g) => g.id === over.id);
    apply(M.reorderGates(p, from, to));
  };

  return (
    <>
      <div className="topbar">
        <a className="btn small" href={href.read(p.id)} aria-label="Back to read view">‹ Done</a>
        <span className="title">Editing: {p.title}</span>
        <span className="small muted" aria-live="polite">{saved === "saved" ? "Saved" : saved === "saving" ? "Saving…" : saved === "dirty" ? "Unsaved" : "Not saved: fix errors"}</span>
        <button type="button" className="btn small" onClick={undo} disabled={!canUndo} aria-label="Undo">↶</button>
        <button type="button" className="btn small" onClick={redo} disabled={!canRedo} aria-label="Redo">↷</button>
      </div>
      {errors.length > 0 && (
        <div className="banner danger" role="alert">
          <strong>Cannot save until these are fixed</strong>
          <ul className="small">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </div>
      )}
      <div className="row-actions" style={{ margin: "8px 0" }}>
        <button type="button" className="btn small" onClick={() => setShowMeta(true)}>Procedure details</button>
        <button type="button" className="btn small" onClick={() => apply(M.addGate(p))}>+ Gate</button>
        <button type="button" className="btn small" onClick={() => downloadText(`${safeFilename(p.id)}.json`, procedureToJson(exportable()))}>Export JSON</button>
        <button type="button" className="btn small" onClick={() => downloadText(`${safeFilename(p.id)}.md`, procedureToMarkdown(exportable()), "text/markdown")}>Export Markdown</button>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onGateDragEnd}>
        <SortableContext items={p.gates.map((g) => g.id)} strategy={verticalListSortingStrategy}>
          {p.gates.map((gate) => (
            <GateEditor
              key={gate.id}
              p={p}
              gate={gate}
              numbering={numbering}
              apply={apply}
              onConvert={(to) => setConvert({ gateId: gate.id, to })}
              onAddBranch={() => { setBranchFor(gate.id); setBranchCond(""); }}
              onDelete={() => setConfirm({ title: "Delete gate?", message: `Delete “${gate.title}” and its ${gate.rows.length} rows? You can undo this.`, run: () => apply(M.deleteGate(p, gate.id)) })}
            />
          ))}
        </SortableContext>
      </DndContext>

      {convert && (
        <Sheet title={`Switch to ${convert.to}`} onClose={() => setConvert(null)}>
          <p className="small muted">Preview of the converted rows. Gaps are marked to-fill, nothing is invented.</p>
          {p.gates.find((g) => g.id === convert.gateId)?.rows.map((r) => (
            <div key={r.id} className="diff-row changed">
              <div className="side">{rowSummary(r)}</div>
              <div className="side">{rowSummary(M.convertRow(r, convert.to))}</div>
            </div>
          ))}
          <div className="row-actions">
            <button type="button" className="btn primary" onClick={() => { apply(M.switchLayout(p, convert.gateId, convert.to)); setConvert(null); }}>Convert</button>
            <button type="button" className="btn" onClick={() => setConvert(null)}>Cancel</button>
          </div>
        </Sheet>
      )}
      {branchFor && (
        <Sheet title="Add branch" onClose={() => setBranchFor(null)}>
          <label className="field"><span>Condition (shown in the chooser, e.g. the outcome that selects this branch)</span>
            <input type="text" value={branchCond} onChange={(e) => setBranchCond(e.target.value)} />
          </label>
          <div className="row-actions">
            <button type="button" className="btn primary" disabled={!branchCond.trim()} onClick={() => { apply(M.addBranch(p, branchFor, branchCond.trim())); setBranchFor(null); }}>Add</button>
            <button type="button" className="btn" onClick={() => setBranchFor(null)}>Cancel</button>
          </div>
        </Sheet>
      )}
      {confirm && <Confirm title={confirm.title} message={confirm.message} danger confirmLabel="Delete" onCancel={() => setConfirm(null)} onConfirm={() => { confirm.run(); setConfirm(null); toast.show("Deleted", { label: "Undo", run: undo }); }} />}
      {showMeta && <MetaEditor p={p} apply={apply} onClose={() => setShowMeta(false)} />}
    </>
  );
}

function MetaEditor({ p, apply, onClose }: { p: Procedure; apply: (n: Procedure) => void; onClose: () => void }) {
  return (
    <Sheet title="Procedure details" onClose={onClose}>
      <label className="field"><span>Title</span><input type="text" value={p.title} onChange={(e) => apply({ ...p, title: e.target.value })} /></label>
      <label className="field"><span>Category</span>
        <select value={p.category} onChange={(e) => apply({ ...p, category: e.target.value as Category })}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
      </label>
      <div className="chips" role="group" aria-label="Fleets">
        {FLEETS.map((f) => (
          <button key={f} type="button" className="chip" aria-pressed={p.fleets.includes(f)} onClick={() => apply({ ...p, fleets: p.fleets.includes(f) ? p.fleets.filter((x) => x !== f) : [...p.fleets, f as Fleet] })}>{f}</button>
        ))}
      </div>
      <label className="field"><span>Tags (comma separated)</span><input type="text" value={p.tags.join(", ")} onChange={(e) => apply({ ...p, tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) })} /></label>
      <label className="field"><span>Related procedure ids (comma separated)</span><input type="text" value={p.relatedProcedures.join(", ")} onChange={(e) => apply({ ...p, relatedProcedures: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) })} /></label>
      <label className="field"><span>Last reviewed</span><input type="date" value={p.lastReviewed ?? ""} onChange={(e) => { const n = { ...p }; if (e.target.value) n.lastReviewed = e.target.value; else delete n.lastReviewed; apply(n); }} /></label>
      <h3>Reference tables</h3>
      {p.referenceTables.map((t, ti) => (
        <div key={t.id} className="card">
          <label className="field"><span>Title</span><input type="text" value={t.title} onChange={(e) => apply({ ...p, referenceTables: p.referenceTables.map((x, i) => (i === ti ? { ...x, title: e.target.value } : x)) })} /></label>
          <label className="field"><span>Note</span><input type="text" value={t.note ?? ""} onChange={(e) => apply({ ...p, referenceTables: p.referenceTables.map((x, i) => (i === ti ? { ...x, note: e.target.value || undefined } : x)) })} /></label>
          <label className="field"><span>Columns (| separated)</span><input type="text" value={t.columns.join(" | ")} onChange={(e) => { const columns = e.target.value.split("|").map((c) => c.trim()); apply({ ...p, referenceTables: p.referenceTables.map((x, i) => (i === ti ? { ...x, columns, rows: x.rows.map((r) => columns.map((_, ci) => r[ci] ?? "")) } : x)) }); }} /></label>
          <label className="field"><span>Rows (one per line, cells | separated)</span>
            <textarea value={t.rows.map((r) => r.join(" | ")).join("\n")} onChange={(e) => { const rows = e.target.value.split("\n").filter((l) => l.trim()).map((l) => { const cells = l.split("|").map((c) => c.trim()); return t.columns.map((_, ci) => cells[ci] ?? ""); }); apply({ ...p, referenceTables: p.referenceTables.map((x, i) => (i === ti ? { ...x, rows } : x)) }); }} />
          </label>
          <button type="button" className="btn small danger" onClick={() => apply({ ...p, referenceTables: p.referenceTables.filter((_, i) => i !== ti) })}>Remove table</button>
        </div>
      ))}
      <button type="button" className="btn small" onClick={() => apply({ ...p, referenceTables: [...p.referenceTables, { id: M.blankGate().id, title: "New table", columns: ["Column 1"], rows: [] }] })}>+ Reference table</button>
      <h3>Profile points</h3>
      {(p.profile ?? []).map((pt, i) => (
        <div key={i} className="edit-grid two">
          <input type="text" aria-label="Label" value={pt.label} onChange={(e) => apply({ ...p, profile: p.profile!.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)) })} />
          <select aria-label="Gate" value={pt.gateId} onChange={(e) => apply({ ...p, profile: p.profile!.map((x, k) => (k === i ? { ...x, gateId: e.target.value } : x)) })}>{p.gates.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}</select>
          <div className="row-actions">
            <input type="number" aria-label="Altitude ft" placeholder="ft" value={pt.altitudeFt ?? ""} onChange={(e) => apply({ ...p, profile: p.profile!.map((x, k) => (k === i ? { ...x, altitudeFt: e.target.value === "" ? undefined : Number(e.target.value) } : x)) })} />
            <button type="button" className="btn small danger" onClick={() => apply({ ...p, profile: p.profile!.filter((_, k) => k !== i) })} aria-label="Remove profile point">✕</button>
          </div>
        </div>
      ))}
      {p.gates.length > 0 && <button type="button" className="btn small" onClick={() => apply({ ...p, profile: [...(p.profile ?? []), { label: "Point", gateId: p.gates[0]!.id }] })}>+ Profile point</button>}
      <div className="row-actions" style={{ marginTop: 12 }}><button type="button" className="btn primary" onClick={onClose}>Close</button></div>
    </Sheet>
  );
}

function GateEditor({ p, gate, numbering, apply, onConvert, onAddBranch, onDelete }: {
  p: Procedure; gate: Gate; numbering: ReturnType<typeof deriveNumbering>;
  apply: (n: Procedure | ((p: Procedure) => Procedure)) => void; onConvert: (to: Layout) => void; onAddBranch: () => void; onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: gate.id });
  const sensors = useSensors(
    useSensor(PointerSensor, POINTER_OPTS),
    useSensor(TouchSensor, TOUCH_OPTS),
    useSensor(KeyboardSensor, KEYBOARD_OPTS),
  );
  const [collapsed, setCollapsed] = useState(false);
  const onRowDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = gate.rows.findIndex((r) => r.id === active.id);
    const to = gate.rows.findIndex((r) => r.id === over.id);
    apply((cur) => M.updateGate(cur, gate.id, { rows: arrayMove(cur.gates.find((g) => g.id === gate.id)!.rows, from, to) }));
  };
  return (
    <section ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`card${isDragging ? " dragging" : ""}`} aria-label={`Gate ${gate.title}`}>
      <div className="head row-actions">
        <button type="button" className="drag-handle" {...attributes} {...listeners} aria-label={`Drag to reorder gate ${gate.title}`}>⋮⋮</button>
        <span className="num">{numbering.gates.get(gate.id)}</span>
        <input type="text" aria-label="Gate title" value={gate.title} onChange={(e) => apply((cur) => M.updateGate(cur, gate.id, { title: e.target.value }))} style={{ flex: 1, minWidth: 160 }} />
        <button type="button" className="btn small" aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}>{collapsed ? "Expand" : "Collapse"}</button>
      </div>
      {!collapsed && (
        <>
          <label className="field"><span>Aim</span><input type="text" value={gate.aim ?? ""} onChange={(e) => apply((cur) => M.updateGate(cur, gate.id, { aim: e.target.value || undefined }))} /></label>
          {gate.branch && (
            <div className="edit-grid two">
              <label className="field"><span>Branch of</span>
                <select value={gate.branch.parentGateId} onChange={(e) => apply((cur) => M.updateGate(cur, gate.id, { branch: { ...gate.branch!, parentGateId: e.target.value } }))}>{p.gates.filter((g) => g.id !== gate.id).map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}</select>
              </label>
              <label className="field"><span>Condition</span><input type="text" value={gate.branch.condition} onChange={(e) => apply((cur) => M.updateGate(cur, gate.id, { branch: { ...gate.branch!, condition: e.target.value } }))} /></label>
              <div className="row-actions"><button type="button" className="btn small" onClick={() => apply((cur) => M.updateGate(cur, gate.id, { branch: undefined }))}>Make main gate</button></div>
            </div>
          )}
          <div className="row-actions" style={{ margin: "6px 0" }}>
            <span className="chip tiny">{gate.layout}</span>
            <button type="button" className="btn small" onClick={() => onConvert(gate.layout === "two-lane" ? "single-lane" : "two-lane")}>Switch to {gate.layout === "two-lane" ? "single-lane" : "two-lane"}…</button>
            {gate.layout === "single-lane" && (
              <label className="btn small" style={{ gap: 6 }}>Assign all to
                <select aria-label="Assign who to all rows" onChange={(e) => { if (e.target.value) apply((cur) => M.bulkWho(cur, gate.id, e.target.value as Who)); e.target.value = ""; }} defaultValue="" style={{ minHeight: 28, padding: "2px 6px", width: "auto" }}>
                  <option value="">…</option>{WHO.map((w) => <option key={w}>{w}</option>)}
                </select>
              </label>
            )}
            <button type="button" className="btn small" onClick={onAddBranch}>+ Branch after this gate</button>
            <button type="button" className="btn small" onClick={() => apply((cur) => M.addGate(cur, gate.id))}>+ Gate after</button>
            <button type="button" className="btn small danger" onClick={onDelete}>Delete gate</button>
          </div>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onRowDragEnd}>
            <SortableContext items={gate.rows.map((r) => r.id)} strategy={verticalListSortingStrategy}>
              {gate.rows.map((row, i) => (
                <RowEditor key={row.id} p={p} gate={gate} row={row} index={i} number={numbering.rows.get(row.id) ?? "?"} apply={apply} />
              ))}
            </SortableContext>
          </DndContext>
          <button type="button" className="btn small" onClick={() => apply((cur) => M.insertRow(cur, gate.id, gate.rows.length))}>+ Row</button>
        </>
      )}
    </section>
  );
}

function RowEditor({ p, gate, row, index, number, apply }: { p: Procedure; gate: Gate; row: Row; index: number; number: string; apply: (n: Procedure | ((p: Procedure) => Procedure)) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: row.id });
  const [more, setMore] = useState(false);
  const [variantFleet, setVariantFleet] = useState<Fleet | "">("");
  const set = (patch: Partial<Row>) => apply((cur) => M.updateRow(cur, gate.id, row.id, patch));
  const setCell = (lane: "pf" | "pm", patch: Partial<NonNullable<Row["pf"]>>) => set({ [lane]: { ...(row[lane] ?? { action: "" }), ...patch } });
  const twoLane = gate.layout === "two-lane";
  const variant: RowOverride = (variantFleet && row.variants?.[variantFleet]) || {};
  const setVariant = (patch: RowOverride) => {
    if (!variantFleet) return;
    const next = { ...variant, ...patch };
    const cleaned = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined && v !== "")) as RowOverride;
    const variants = { ...(row.variants ?? {}) };
    if (Object.keys(cleaned).length === 0) delete variants[variantFleet];
    else variants[variantFleet] = cleaned;
    set({ variants: Object.keys(variants).length ? variants : undefined });
  };
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`edit-row${isDragging ? " dragging" : ""}`}>
      <div className="head">
        <button type="button" className="drag-handle" {...attributes} {...listeners} aria-label={`Drag to reorder row ${number}`}>⋮⋮</button>
        <span className="num">{number}</span>
        <select aria-label="Status" value={row.status} onChange={(e) => set({ status: e.target.value as Status })} style={{ width: "auto", minHeight: 36 }}>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button type="button" className="btn small" aria-expanded={more} onClick={() => setMore(!more)}>{more ? "Less" : "More"}</button>
      </div>
      <div className={`edit-grid${twoLane ? " two" : ""}`}>
        <label className="field"><span>Trigger</span><textarea rows={2} value={row.trigger} onChange={(e) => set({ trigger: e.target.value })} /></label>
        {twoLane ? (
          <>
            <LaneEditor label="PF" cell={row.pf} onChange={(patch) => setCell("pf", patch)} />
            <LaneEditor label="PM" cell={row.pm} onChange={(patch) => setCell("pm", patch)} />
          </>
        ) : (
          <>
            <label className="field"><span>Action</span><textarea rows={2} value={row.action ?? ""} onChange={(e) => set({ action: e.target.value })} /></label>
            <label className="field"><span>Callout (spoken words, no quote marks)</span><input type="text" value={row.callout ?? ""} onChange={(e) => set({ callout: e.target.value || undefined })} /></label>
            <label className="field"><span>Who</span>
              <select value={row.who ?? "UNASSIGNED"} onChange={(e) => set({ who: e.target.value as Who })}>{WHO.map((w) => <option key={w}>{w}</option>)}</select>
            </label>
          </>
        )}
      </div>
      {row.status !== "ok" && <label className="field"><span>Status note (what needs verifying or filling)</span><input type="text" value={row.statusNote ?? ""} onChange={(e) => set({ statusNote: e.target.value || undefined })} /></label>}
      {more && (
        <>
          <label className="field"><span>Why (rationale)</span><input type="text" value={row.why ?? ""} onChange={(e) => set({ why: e.target.value || undefined })} /></label>
          <label className="field"><span>Source reference</span><input type="text" value={row.sourceRef ?? ""} onChange={(e) => set({ sourceRef: e.target.value || undefined })} /></label>
          <label className="field"><span>Fleet variant</span>
            <select value={variantFleet} onChange={(e) => setVariantFleet(e.target.value as Fleet | "")}>
              <option value="">Choose a fleet to override…</option>
              {FLEETS.map((f) => <option key={f} value={f}>{f}{row.variants?.[f] ? " (has override)" : ""}</option>)}
            </select>
          </label>
          {variantFleet && (
            <div className="card">
              <p className="small muted">Leave a field blank to use the base row.</p>
              <label className="field"><span>Trigger ({variantFleet})</span><input type="text" value={variant.trigger ?? ""} onChange={(e) => setVariant({ trigger: e.target.value || undefined })} /></label>
              {twoLane ? (
                <>
                  <label className="field"><span>PF action ({variantFleet})</span><input type="text" value={variant.pf?.action ?? ""} onChange={(e) => setVariant({ pf: e.target.value ? { ...(variant.pf ?? { action: "" }), action: e.target.value } : undefined })} /></label>
                  <label className="field"><span>PF callout ({variantFleet})</span><input type="text" value={variant.pf?.callout ?? ""} onChange={(e) => setVariant({ pf: { ...(variant.pf ?? { action: row.pf?.action ?? "" }), callout: e.target.value || undefined } })} /></label>
                  <label className="field"><span>PM action ({variantFleet})</span><input type="text" value={variant.pm?.action ?? ""} onChange={(e) => setVariant({ pm: e.target.value ? { ...(variant.pm ?? { action: "" }), action: e.target.value } : undefined })} /></label>
                  <label className="field"><span>PM callout ({variantFleet})</span><input type="text" value={variant.pm?.callout ?? ""} onChange={(e) => setVariant({ pm: { ...(variant.pm ?? { action: row.pm?.action ?? "" }), callout: e.target.value || undefined } })} /></label>
                </>
              ) : (
                <>
                  <label className="field"><span>Action ({variantFleet})</span><input type="text" value={variant.action ?? ""} onChange={(e) => setVariant({ action: e.target.value || undefined })} /></label>
                  <label className="field"><span>Callout ({variantFleet})</span><input type="text" value={variant.callout ?? ""} onChange={(e) => setVariant({ callout: e.target.value || undefined })} /></label>
                </>
              )}
            </div>
          )}
          <div className="row-actions">
            <button type="button" className="btn small" onClick={() => apply((cur) => M.insertRow(cur, gate.id, index))}>Add above</button>
            <button type="button" className="btn small" onClick={() => apply((cur) => M.insertRow(cur, gate.id, index + 1))}>Add below</button>
            <button type="button" className="btn small" onClick={() => apply((cur) => M.duplicateRow(cur, gate.id, row.id))}>Duplicate</button>
            <label className="btn small" style={{ gap: 6 }}>Move to
              <select aria-label="Move row to gate" defaultValue="" onChange={(e) => { if (e.target.value) apply((cur) => M.moveRowToGate(cur, gate.id, row.id, e.target.value)); }} style={{ minHeight: 28, padding: "2px 6px", width: "auto" }}>
                <option value="">gate…</option>
                {p.gates.filter((g) => g.id !== gate.id).map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
              </select>
            </label>
            <button type="button" className="btn small danger" onClick={() => apply((cur) => M.deleteRow(cur, gate.id, row.id))}>Delete row</button>
          </div>
        </>
      )}
    </div>
  );
}

function LaneEditor({ label, cell, onChange }: { label: string; cell: Row["pf"]; onChange: (patch: Partial<NonNullable<Row["pf"]>>) => void }) {
  return (
    <div className={`lane-block ${label.toLowerCase()}`}>
      <div className={`lane-label ${label.toLowerCase()}`}>{label}</div>
      <label className="field"><span>Action</span><textarea rows={2} value={cell?.action ?? ""} onChange={(e) => onChange({ action: e.target.value })} /></label>
      <label className="field"><span>Callout</span><input type="text" value={cell?.callout ?? ""} onChange={(e) => onChange({ callout: e.target.value || undefined })} /></label>
      <label className="field" style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input type="checkbox" checked={!!cell?.standing} onChange={(e) => onChange({ standing: e.target.checked || undefined })} style={{ width: 24, height: 24, minHeight: 0 }} />
        <span style={{ margin: 0 }}>Standing task (muted, not drilled)</span>
      </label>
    </div>
  );
}
