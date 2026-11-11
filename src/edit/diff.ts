import type { Procedure, Row } from "../content/schema";

export type RowDiffKind = "same" | "changed" | "added" | "removed";
export interface RowDiff {
  rowId: string;
  kind: RowDiffKind;
  mine?: Row;
  theirs?: Row;
  gateTitle: string;
}

const rowText = (r: Row) => JSON.stringify({ ...r, id: undefined });

/**
 * Side-by-side row diff matched by row id (spec 4 upstream change).
 * "mine" is the overlay, "theirs" the shipped file.
 */
export function diffProcedures(mine: Procedure, theirs: Procedure): RowDiff[] {
  const out: RowDiff[] = [];
  const theirsById = new Map<string, { row: Row; gate: string }>();
  for (const g of theirs.gates) for (const r of g.rows) theirsById.set(r.id, { row: r, gate: g.title });
  const seen = new Set<string>();
  for (const g of mine.gates) {
    for (const r of g.rows) {
      seen.add(r.id);
      const t = theirsById.get(r.id);
      if (!t) out.push({ rowId: r.id, kind: "added", mine: r, gateTitle: g.title });
      else out.push({ rowId: r.id, kind: rowText(r) === rowText(t.row) ? "same" : "changed", mine: r, theirs: t.row, gateTitle: g.title });
    }
  }
  for (const [id, t] of theirsById) {
    if (!seen.has(id)) out.push({ rowId: id, kind: "removed", theirs: t.row, gateTitle: t.gate });
  }
  return out;
}

export const rowSummary = (r: Row | undefined): string => {
  if (!r) return "—";
  const parts = [r.trigger];
  if (r.pf) parts.push(`PF: ${r.pf.action}${r.pf.callout ? ` “${r.pf.callout}”` : ""}`);
  if (r.pm) parts.push(`PM: ${r.pm.action}${r.pm.callout ? ` “${r.pm.callout}”` : ""}`);
  if (r.action !== undefined) parts.push(`${r.who ?? ""}: ${r.action}${r.callout ? ` “${r.callout}”` : ""}`);
  if (r.status !== "ok") parts.push(`[${r.status}${r.statusNote ? `: ${r.statusNote}` : ""}]`);
  return parts.join(" · ");
};
