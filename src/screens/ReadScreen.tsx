import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useLibrary } from "../state/LibraryProvider";
import { applyFleet, branchesOf, visibleGates } from "../content/resolve";
import type { Fleet, Gate, Procedure, Row } from "../content/schema";
import { deriveNumbering } from "../content/numbering";
import { href, hashQuery } from "../app/router";
import { db } from "../db/db";
import { useSettings, setSetting } from "../state/settings";
import { useWide } from "../util/useMedia";
import { RowView } from "../components/RowView";
import { AnnotationActionSheet } from "../annotations/RowAnnotations";
import { addAnnotation, findOrphans, groupByRow, reattachAnnotation, updateAnnotation, deleteAnnotation, restoreAnnotation } from "../annotations/store";
import type { Annotation, AnnotationTarget, Stroke } from "../annotations/types";
import { Sheet } from "../components/Sheet";
import { useToast } from "../components/Toast";
import { Confirm } from "../components/Confirm";
import { saveProcedure, discardOverlay, rebaseOverlay, deleteUserProcedure } from "../state/procedures";
import { downloadText, procedureToJson, procedureToMarkdown, safeFilename } from "../edit/export";
import { diffProcedures, rowSummary } from "../edit/diff";
import { todayIso } from "../util/id";
import { useProcedureStats } from "../schedule/useStats";
import { deleteReviewDataFor } from "../schedule/store";
import { AnnotationItem } from "../annotations/RowAnnotations";


export function ReadScreen({ id }: { id: string }) {
  const lib = useLibrary();
  const entry = lib.get(id);
  const settings = useSettings();
  const wide = useWide();
  const toast = useToast();
  const [sheet, setSheet] = useState<AnnotationTarget | null>(null);
  const [ink, setInk] = useState<{ rowId: string; gateId: string; annotationId?: string; strokes: Stroke[] } | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const [more, setMore] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [jumpRow, setJumpRow] = useState<string | null>(() => hashQuery().get("row"));
  const annotations = useLiveQuery(() => db.annotations.where("target.procedureId").equals(id).toArray(), [id], []);
  const stats = useProcedureStats(entry ? [entry.procedure] : []);

  useEffect(() => {
    void setSetting("lastOpened", { ...settings.lastOpened, [id]: new Date().toISOString() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const fleet = (settings.fleetFilter[id] as Fleet | undefined) ?? null;
  const base = entry?.procedure;
  const procedure = useMemo(() => (base ? applyFleet(base, fleet) : null), [base, fleet]);
  const choices = settings.branchChoices[id] ?? {};
  const gates = useMemo(() => (procedure ? visibleGates(procedure, choices) : []), [procedure, choices]);
  const numbering = useMemo(() => (procedure ? deriveNumbering(procedure) : null), [procedure]);
  const byRow = useMemo(() => groupByRow(annotations), [annotations]);
  const orphans = useMemo(() => (procedure ? findOrphans(annotations, procedure) : []), [annotations, procedure]);

  useEffect(() => {
    if (!jumpRow || !procedure) return;
    const el = document.getElementById(`row-${jumpRow}`);
    if (el) {
      el.scrollIntoView({ block: "center" });
      const t = window.setTimeout(() => setJumpRow(null), 4000);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [jumpRow, procedure, gates]);

  const chooseBranch = useCallback(
    (parentId: string, gateId: string) => void setSetting("branchChoices", { ...settings.branchChoices, [id]: { ...choices, [parentId]: gateId } }),
    [settings.branchChoices, choices, id],
  );

  const startInk = (gate: Gate, row: Row, existing?: Annotation) =>
    setInk({ rowId: row.id, gateId: gate.id, annotationId: existing?.id, strokes: existing?.strokes ?? [] });
  const finishInk = async () => {
    if (!ink) return;
    if (ink.annotationId) {
      if (ink.strokes.length === 0) {
        const removed = await deleteAnnotation(ink.annotationId);
        if (removed) toast.show("Drawing deleted", { label: "Undo", run: () => void restoreAnnotation(removed) });
      } else await updateAnnotation(ink.annotationId, { strokes: ink.strokes });
    } else if (ink.strokes.length > 0) {
      await addAnnotation({ target: { procedureId: id, gateId: ink.gateId, rowId: ink.rowId }, kind: "ink", strokes: ink.strokes });
    }
    setInk(null);
  };

  if (!entry || !procedure || !numbering) {
    return lib.loading ? <p className="muted">Loading…</p> : <p>Procedure “{id}” was not found. <a href={href.library()}>Back to library</a></p>;
  }
  const p = procedure;
  const st = stats.get(id);
  const targetDate = settings.procedureTargetDates[id] ?? settings.targetDate;

  const setLastReviewed = async () => {
    await saveProcedure({ ...entry.procedure, lastReviewed: todayIso() }, entry.shipped);
    toast.show("Last reviewed set to today");
  };

  const renderGate = (gate: Gate, index: number) => {
    const branches = branchesOf(p, gate.id);
    const rows = gate.rows.map((row) => {
      const target: AnnotationTarget = { procedureId: id, gateId: gate.id, rowId: row.id };
      const rowInk = ink?.rowId === row.id ? { strokes: ink.strokes, onChange: (s: Stroke[]) => setInk({ ...ink, strokes: s }), onDone: () => void finishInk() } : null;
      return (
        <RowView
          key={row.id}
          gate={gate}
          row={row}
          number={numbering.rows.get(row.id) ?? "?"}
          annotations={byRow.get(row.id) ?? []}
          hideAnnotations={settings.hideAnnotations}
          wide={wide && focus === null}
          ink={rowInk}
          fingerDrawing={settings.fingerDrawing}
          onOpenSheet={() => !ink && setSheet(target)}
          onStartDraw={() => startInk(gate, row)}
          onEditInk={(a) => startInk(gate, row, a)}
          highlightedRow={jumpRow === row.id}
        />
      );
    });
    return (
      <section className="gate" key={gate.id} id={`gate-${gate.id}`} aria-labelledby={`gate-title-${gate.id}`}>
        <div className="gate-head">
          <h2 id={`gate-title-${gate.id}`}>
            <span className="num">{numbering.gates.get(gate.id)}</span> {gate.title}
          </h2>
          {gate.branch && <span className="chip tiny">branch: {gate.branch.condition}</span>}
          {gate.aim && <span className="aim">{gate.aim}</span>}
          <span className="chip tiny">{gate.layout === "two-lane" ? "PF / PM" : "single lane"}</span>
        </div>
        {gate.rows.length === 0 && <p className="muted small">No rows.</p>}
        {wide && focus === null ? (
          <div className={`flow-table${gate.layout === "single-lane" ? " single" : ""}`} role="table" aria-label={gate.title}>
            <div className="flow-head" role="row">
              <div role="columnheader">#</div>
              <div role="columnheader">Trigger</div>
              {gate.layout === "two-lane" ? (
                <>
                  <div role="columnheader" className="pf">PF</div>
                  <div role="columnheader" className="pm">PM</div>
                </>
              ) : (
                <>
                  <div role="columnheader">Action</div>
                  <div role="columnheader">Who</div>
                </>
              )}
            </div>
            {rows}
          </div>
        ) : (
          rows
        )}
        {branches.length > 0 && (
          <div className="branch-chooser" role="group" aria-label={`Branch after ${gate.title}`}>
            <span className="small muted">Then:</span>
            {branches.map((b) => {
              const chosen = (choices[gate.id] ?? branches[0]!.id) === b.id;
              return (
                <button key={b.id} type="button" className="chip" aria-pressed={chosen} onClick={() => chooseBranch(gate.id, b.id)}>
                  {b.branch!.condition}
                </button>
              );
            })}
          </div>
        )}
        {void index}
      </section>
    );
  };

  const exportJson = () => downloadText(`${safeFilename(p.id)}.json`, procedureToJson(entry.procedure));
  const exportMd = () => downloadText(`${safeFilename(p.id)}.md`, procedureToMarkdown(entry.procedure), "text/markdown");

  return (
    <>
      <div className="proc-header">
        <h1>{p.title}</h1>
        <div className="chips" role="group" aria-label="Fleet filter">
          <button type="button" className="chip" aria-pressed={fleet === null} onClick={() => void setSetting("fleetFilter", { ...settings.fleetFilter, [id]: "" })}>All fleets</button>
          {p.fleets.map((f) => (
            <button key={f} type="button" className="chip" aria-pressed={fleet === f} onClick={() => void setSetting("fleetFilter", { ...settings.fleetFilter, [id]: f })}>{f}</button>
          ))}
        </div>
        <span className="small muted">v{p.version} · {p.category}{entry.source !== "shipped" ? ` · ${entry.source === "overlay" ? "edited copy" : "my procedure"}` : ""}</span>
        <button type="button" className="btn small" onClick={() => void setLastReviewed()} title="Tap to set today">
          Last reviewed: {p.lastReviewed ?? "never"}
        </button>
        {st && (st.due > 0 || st.readiness !== null) && (
          <span className="small muted">
            {st.due > 0 && `${st.due} due`}
            {st.readiness !== null && ` · ready by ${targetDate}: ${Math.round(st.readiness * 100)}%`}
          </span>
        )}
        <div className="row-actions" style={{ flex: "1 1 100%" }}>
          <a className="btn primary" href={href.drill(id)}>Drill</a>
          <a className="btn" href={href.edit(id)}>Edit</a>
          <button type="button" className="btn" onClick={() => setMore(true)} aria-haspopup="dialog">More</button>
        </div>
      </div>

      {entry.upstreamChanged && entry.shipped && (
        <div className="banner warn" role="region" aria-label="Shipped content changed">
          <strong>The shipped version of this procedure changed</strong> (v{entry.baseVersion} → v{entry.shipped.version}). Your edited copy is unchanged.
          <div className="row-actions" style={{ marginTop: 6 }}>
            <button type="button" className="btn small" onClick={async () => { await rebaseOverlay(id, entry.shipped!.version); toast.show("Kept your copy"); }}>Keep mine</button>
            <button type="button" className="btn small" onClick={async () => { exportJson(); await discardOverlay(id); toast.show("Your copy was exported, shipped version restored"); }}>Take shipped (exports mine first)</button>
            <button type="button" className="btn small" onClick={() => setDiffOpen(true)}>Review differences</button>
          </div>
        </div>
      )}

      <nav className="gate-nav" aria-label="Gates">
        {gates.map((g) => (
          <a key={g.id} className="btn small" href={`#gate-${g.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(`gate-${g.id}`)?.scrollIntoView({ block: "start", behavior: "smooth" }); }}>
            {numbering.gates.get(g.id)} {g.title}
          </a>
        ))}
      </nav>

      {focus === null && gates.map(renderGate)}

      {focus !== null && (
        <FocusMode gates={gates} index={focus} onIndex={setFocus} onClose={() => setFocus(null)} render={renderGate} />
      )}

      {p.referenceTables.length > 0 && (
        <section aria-label="Reference tables">
          {p.referenceTables.map((t) => (
            <details key={t.id} className="ref">
              <summary>{t.title}</summary>
              {t.note && <p className="small muted">{t.note}</p>}
              <div style={{ overflowX: "auto" }}>
                <table className="ref">
                  <thead><tr>{t.columns.map((c, i) => <th key={i}>{c}</th>)}</tr></thead>
                  <tbody>{t.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
                </table>
              </div>
            </details>
          ))}
        </section>
      )}

      {p.profile && p.profile.length > 0 && <ProfileView p={p} />}

      {orphans.length > 0 && (
        <section className="card" aria-label="Orphaned annotations">
          <h2 style={{ marginTop: 0 }}>Orphaned ({orphans.length})</h2>
          <p className="small muted">These annotations point at rows or gates that no longer exist. Re-attach or delete them.</p>
          {orphans.map((a) => (
            <AnnotationItem
              key={a.id}
              a={a}
              onDelete={async () => { const removed = await deleteAnnotation(a.id); if (removed) toast.show("Deleted", { label: "Undo", run: () => void restoreAnnotation(removed) }); }}
              extra={
                <label className="field">
                  <span>Re-attach to row</span>
                  <select defaultValue="" onChange={(e) => { const rowId = e.target.value; if (!rowId) return; const g = p.gates.find((gg) => gg.rows.some((r) => r.id === rowId))!; void reattachAnnotation(a.id, { procedureId: id, gateId: g.id, rowId }); toast.show("Re-attached"); }}>
                    <option value="">Choose a row…</option>
                    {p.gates.flatMap((g) => g.rows.map((r) => <option key={r.id} value={r.id}>{numbering.rows.get(r.id)} {r.trigger}</option>))}
                  </select>
                </label>
              }
            />
          ))}
        </section>
      )}

      {sheet && <AnnotationActionSheet target={sheet} onClose={() => setSheet(null)} onDraw={() => { const g = p.gates.find((gg) => gg.id === sheet.gateId)!; const r = g.rows.find((rr) => rr.id === sheet.rowId)!; startInk(g, r); }} />}

      {more && (
        <Sheet title="More" onClose={() => setMore(false)}>
          <div className="grid">
            <button type="button" className="btn" onClick={() => { setFocus(0); setMore(false); }}>Focus mode</button>
            <button type="button" className="btn" aria-pressed={settings.hideAnnotations} onClick={() => void setSetting("hideAnnotations", !settings.hideAnnotations)}>{settings.hideAnnotations ? "Show annotations" : "Hide annotations"}</button>
            <button type="button" className="btn" onClick={exportJson}>Export JSON</button>
            <button type="button" className="btn" onClick={exportMd}>Export Markdown</button>
            <button type="button" className="btn" onClick={() => { setMore(false); setTimeout(() => window.print(), 100); }}>Print</button>
            {p.relatedProcedures.length > 0 && p.relatedProcedures.map((r) => <a key={r} className="btn" href={href.read(r)}>Related: {lib.get(r)?.procedure.title ?? r}</a>)}
            {entry.source === "overlay" && <button type="button" className="btn danger" onClick={() => { setMore(false); setConfirmDelete(true); }}>Discard my edits</button>}
            {entry.source === "user" && <button type="button" className="btn danger" onClick={() => { setMore(false); setConfirmDelete(true); }}>Delete procedure</button>}
          </div>
        </Sheet>
      )}

      {confirmDelete && (
        <Confirm
          title={entry.source === "overlay" ? "Discard edits?" : "Delete procedure?"}
          message={entry.source === "overlay" ? "Your edited copy is exported to a file first, then the shipped version is restored. Annotations are kept." : "The procedure is exported to a file first, then deleted together with its review history. Annotations are kept as orphans."}
          confirmLabel={entry.source === "overlay" ? "Export and discard" : "Export and delete"}
          danger
          onCancel={() => setConfirmDelete(false)}
          onConfirm={async () => {
            exportJson();
            if (entry.source === "overlay") await discardOverlay(id);
            else { await deleteUserProcedure(id); await deleteReviewDataFor(id); window.location.hash = href.library(); }
            setConfirmDelete(false);
          }}
        />
      )}

      {diffOpen && entry.shipped && (
        <Sheet title="Your copy vs shipped" onClose={() => setDiffOpen(false)}>
          <div className="diff-row"><div className="side mine"><strong>Mine</strong></div><div className="side theirs"><strong>Shipped v{entry.shipped.version}</strong></div></div>
          {diffProcedures(entry.procedure, entry.shipped).filter((d) => d.kind !== "same").map((d) => (
            <div key={d.rowId} className={`diff-row ${d.kind}`}>
              <div className="side mine">{d.kind === "removed" ? <em className="muted">(not in mine)</em> : rowSummary(d.mine)}</div>
              <div className="side theirs">{d.kind === "added" ? <em className="muted">(not in shipped)</em> : rowSummary(d.theirs)}</div>
            </div>
          ))}
          {diffProcedures(entry.procedure, entry.shipped).every((d) => d.kind === "same") && <p className="muted">Rows are identical; only metadata differs.</p>}
        </Sheet>
      )}
    </>
  );
}

function FocusMode({ gates, index, onIndex, onClose, render }: { gates: Gate[]; index: number; onIndex: (i: number) => void; onClose: () => void; render: (g: Gate, i: number) => React.ReactNode }) {
  const start = useRef<number | null>(null);
  const gate = gates[Math.min(index, gates.length - 1)];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" && index < gates.length - 1) onIndex(index + 1);
      if (e.key === "ArrowLeft" && index > 0) onIndex(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, gates.length, onIndex, onClose]);
  if (!gate) return null;
  return (
    <div
      className="focus"
      role="region"
      aria-label="Focus mode"
      onTouchStart={(e) => (start.current = e.touches[0]?.clientX ?? null)}
      onTouchEnd={(e) => {
        const x = e.changedTouches[0]?.clientX;
        if (start.current === null || x === undefined) return;
        const dx = x - start.current;
        if (dx < -60 && index < gates.length - 1) onIndex(index + 1);
        if (dx > 60 && index > 0) onIndex(index - 1);
        start.current = null;
      }}
    >
      <div className="focus-bar">
        <button type="button" className="btn" onClick={() => onIndex(index - 1)} disabled={index === 0} aria-label="Previous gate">‹</button>
        <span className="small muted">Gate {index + 1} of {gates.length}</span>
        <button type="button" className="btn" onClick={() => onIndex(index + 1)} disabled={index >= gates.length - 1} aria-label="Next gate">›</button>
        <button type="button" className="btn" onClick={onClose}>Exit</button>
      </div>
      {render(gate, index)}
    </div>
  );
}

function ProfileView({ p }: { p: Procedure }) {
  const pts = p.profile ?? [];
  const alts = pts.map((x) => x.altitudeFt ?? 0);
  const max = Math.max(1, ...alts);
  return (
    <section className="card" aria-label="Profile">
      <h2 style={{ marginTop: 0 }}>Profile</h2>
      <div className="profile">
        <div className="line" aria-hidden="true" />
        <ul>
          {pts.map((pt, i) => (
            <li key={i} style={{ marginLeft: `${Math.round((1 - (pt.altitudeFt ?? 0) / max) * 0)}px` }}>
              <a className="btn small" href={`#gate-${pt.gateId}`} onClick={(e) => { e.preventDefault(); document.getElementById(`gate-${pt.gateId}`)?.scrollIntoView({ behavior: "smooth" }); }}>
                {pt.label}
              </a>
              {pt.altitudeFt !== undefined && <span className="small muted">{pt.altitudeFt.toLocaleString()} ft</span>}
              <span className="ready-bar" style={{ flex: 1 }}><span style={{ display: "block", height: "100%", width: `${Math.round(((pt.altitudeFt ?? 0) / max) * 100)}%`, background: "var(--accent)" }} /></span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
