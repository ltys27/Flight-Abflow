import type { Procedure } from "./schema";

/**
 * Derived display numbers (spec 3.2): never stored, always computed from
 * position. Gates are numbered 1..n in document order; rows are "g.r".
 * Branch gates get a letter suffix per parent in order of appearance
 * ("3A", "3B") and their rows "3A.1".
 */
export interface GateNumber {
  gateId: string;
  label: string;
}
export interface RowNumber {
  rowId: string;
  gateId: string;
  label: string;
}

export function deriveNumbering(p: Pick<Procedure, "gates">): {
  gates: Map<string, string>;
  rows: Map<string, string>;
} {
  const gates = new Map<string, string>();
  const rows = new Map<string, string>();
  const branchCount = new Map<string, number>();
  let mainIndex = 0;

  for (const gate of p.gates) {
    let label: string;
    if (gate.branch) {
      const parentLabel = gates.get(gate.branch.parentGateId) ?? "?";
      const n = branchCount.get(gate.branch.parentGateId) ?? 0;
      branchCount.set(gate.branch.parentGateId, n + 1);
      label = `${parentLabel}${String.fromCharCode(65 + n)}`;
    } else {
      mainIndex += 1;
      label = String(mainIndex);
    }
    gates.set(gate.id, label);
    gate.rows.forEach((row, i) => rows.set(row.id, `${label}.${i + 1}`));
  }
  return { gates, rows };
}
