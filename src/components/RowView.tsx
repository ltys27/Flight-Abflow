import { useState } from "react";
import type { Gate, LaneCell, Row } from "../content/schema";
import type { Annotation, Stroke } from "../annotations/types";
import { RowBadges } from "../annotations/RowAnnotations";
import { InkLayer } from "../annotations/InkLayer";
import { useLongPress, type PressInfo } from "../util/useLongPress";

export interface RowViewProps {
  gate: Gate;
  row: Row;
  number: string;
  annotations: Annotation[];
  hideAnnotations: boolean;
  wide: boolean;
  /** Ink editing state for this row, if any. */
  ink?: { strokes: Stroke[]; onChange: (s: Stroke[]) => void; onDone: () => void } | null;
  fingerDrawing: boolean;
  onOpenSheet: (info: PressInfo) => void;
  onStartDraw: () => void;
  onEditInk: (a: Annotation) => void;
  highlightedRow?: boolean;
}

export function StatusMarker({ row }: { row: Row }) {
  const [open, setOpen] = useState(false);
  if (row.status === "ok") return null;
  const label = row.status === "verify" ? "verify" : "to fill";
  return (
    <span>
      <button type="button" className={`status-badge ${row.status}`} style={{ cursor: "pointer", font: "inherit", fontSize: "0.75rem" }} aria-expanded={open} onClick={() => setOpen(!open)} title={row.statusNote}>
        {row.status === "verify" ? "⚠" : "✖"} {label}
      </button>
      {open && <span className="small" style={{ display: "block", color: row.status === "verify" ? "var(--warn)" : "var(--danger)" }}>{row.statusNote || `Marked ${label}.`}</span>}
    </span>
  );
}

export function InfoControl({ row }: { row: Row }) {
  const [open, setOpen] = useState(false);
  if (!row.why && !row.sourceRef) return null;
  return (
    <span className="no-print">
      <button type="button" className="btn small ghost" aria-label="Rationale and source" aria-expanded={open} onClick={() => setOpen(!open)}>
        ⓘ
      </button>
      {open && (
        <span className="small muted" style={{ display: "block" }}>
          {row.why && <span style={{ display: "block" }}>Why: {row.why}</span>}
          {row.sourceRef && <span style={{ display: "block" }}>Source: {row.sourceRef}</span>}
        </span>
      )}
    </span>
  );
}

export function CellText({ cell }: { cell: LaneCell | undefined }) {
  if (!cell) return <span className="muted">—</span>;
  const empty = cell.action.trim() === "" && !cell.callout;
  return (
    <span className={cell.standing ? "standing" : undefined}>
      {cell.action && <span>{cell.action}</span>}
      {empty && !cell.standing && <span className="muted">—</span>}
      {empty && cell.standing && <span>(continues)</span>}
      {cell.callout && <span className="callout">“{cell.callout}”</span>}
    </span>
  );
}

const highlightClass = (annotations: Annotation[], hide: boolean) => {
  if (hide) return "";
  const h = annotations.filter((a) => a.kind === "highlight").sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0];
  return h?.color ? ` hl-${h.color}` : "";
};

export function RowView(p: RowViewProps) {
  const { gate, row, number, annotations, hideAnnotations, wide, ink } = p;
  const press = useLongPress(p.onOpenSheet, ink ? undefined : () => p.onStartDraw());
  const inkStrokes = ink ? ink.strokes : hideAnnotations ? [] : annotations.filter((a) => a.kind === "ink").flatMap((a) => a.strokes ?? []);
  const showInk = ink || inkStrokes.length > 0;
  const hl = highlightClass(annotations, hideAnnotations);
  const badges = !hideAnnotations && <RowBadges annotations={annotations} onEditInk={p.onEditInk} />;
  const inkLayer = showInk && (
    <InkLayer strokes={inkStrokes} active={!!ink} fingerDrawing={p.fingerDrawing} onChange={ink?.onChange ?? (() => undefined)} onDone={ink?.onDone ?? (() => undefined)} />
  );
  const style = p.highlightedRow ? { outline: "2px solid var(--accent)", outlineOffset: 2 } : undefined;
  const twoLane = gate.layout === "two-lane";

  if (wide) {
    return (
      <div className={`row-wrap flow-row${hl}`} role="row" id={`row-${row.id}`} data-row-id={row.id} style={style} {...press}>
        <div role="cell" className="num">{number}</div>
        <div role="cell" className="trigger">
          {row.trigger} <StatusMarker row={row} /> <InfoControl row={row} />
          {badges}
        </div>
        {twoLane ? (
          <>
            <div role="cell" className="pf"><span className="visually-hidden">PF: </span><CellText cell={row.pf} /></div>
            <div role="cell" className="pm"><span className="visually-hidden">PM: </span><CellText cell={row.pm} /></div>
          </>
        ) : (
          <>
            <div role="cell" className="action" style={{ gridColumn: "3 / 4" }}>
              {row.action || <span className="muted">—</span>}
              {row.callout && <span className="callout">“{row.callout}”</span>}
            </div>
            <div role="cell" className="who">{row.who ?? "UNASSIGNED"}</div>
          </>
        )}
        {inkLayer}
      </div>
    );
  }

  return (
    <div className={`row-card row-wrap${hl}`} id={`row-${row.id}`} data-row-id={row.id} style={style} {...press}>
      <div className="trigger">
        <span className="num">{number}</span> {row.trigger} <StatusMarker row={row} /> <InfoControl row={row} />
      </div>
      {twoLane ? (
        <>
          <div className="lane-block pf">
            <div className="lane-label pf">PF</div>
            <CellText cell={row.pf} />
          </div>
          <div className="lane-block pm">
            <div className="lane-label pm">PM</div>
            <CellText cell={row.pm} />
          </div>
        </>
      ) : (
        <div className={`lane-block ${row.who === "PF" ? "pf" : row.who === "PM" ? "pm" : "action"}`}>
          <div className={`lane-label ${row.who === "PF" ? "pf" : row.who === "PM" ? "pm" : ""}`}>{row.who ?? "UNASSIGNED"}</div>
          {row.action || <span className="muted">—</span>}
          {row.callout && <span className="callout">“{row.callout}”</span>}
        </div>
      )}
      {badges}
      {inkLayer}
    </div>
  );
}
