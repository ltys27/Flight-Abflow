import type { Gate, Layout, Procedure, Row, Who } from "../content/schema";
import { newId } from "../util/id";

/** Pure editing operations on a procedure (spec 6.3). Every function returns a new object. */

export const blankRow = (layout: Layout): Row =>
  layout === "two-lane"
    ? { id: newId(), trigger: "", pf: { action: "" }, pm: { action: "" }, status: "to-fill", statusNote: "New row" }
    : { id: newId(), trigger: "", action: "", who: "UNASSIGNED", status: "to-fill", statusNote: "New row" };

export const blankGate = (layout: Layout = "two-lane", title = "New gate"): Gate => ({ id: newId(), title, layout, rows: [] });

export const blankProcedure = (id: string, title: string, category: Procedure["category"], fleets: Procedure["fleets"]): Procedure => ({
  schemaVersion: 1,
  id,
  title,
  category,
  fleets,
  tags: [],
  version: 1,
  relatedProcedures: [],
  gates: [blankGate("two-lane", "Gate 1")],
  referenceTables: [],
});

const mapGate = (p: Procedure, gateId: string, fn: (g: Gate) => Gate): Procedure => ({ ...p, gates: p.gates.map((g) => (g.id === gateId ? fn(g) : g)) });

export function updateRow(p: Procedure, gateId: string, rowId: string, patch: Partial<Row>): Procedure {
  return mapGate(p, gateId, (g) => ({ ...g, rows: g.rows.map((r) => (r.id === rowId ? { ...r, ...patch } : r)) }));
}

export function updateGate(p: Procedure, gateId: string, patch: Partial<Gate>): Procedure {
  return mapGate(p, gateId, (g) => ({ ...g, ...patch }));
}

export function insertRow(p: Procedure, gateId: string, index: number, row?: Row): Procedure {
  return mapGate(p, gateId, (g) => {
    const rows = [...g.rows];
    rows.splice(Math.max(0, Math.min(index, rows.length)), 0, row ?? blankRow(g.layout));
    return { ...g, rows };
  });
}

export function duplicateRow(p: Procedure, gateId: string, rowId: string): Procedure {
  return mapGate(p, gateId, (g) => {
    const i = g.rows.findIndex((r) => r.id === rowId);
    if (i < 0) return g;
    const copy: Row = structuredClone(g.rows[i]!);
    copy.id = newId();
    const rows = [...g.rows];
    rows.splice(i + 1, 0, copy);
    return { ...g, rows };
  });
}

export function deleteRow(p: Procedure, gateId: string, rowId: string): Procedure {
  return mapGate(p, gateId, (g) => ({ ...g, rows: g.rows.filter((r) => r.id !== rowId) }));
}

export function reorderRows(p: Procedure, gateId: string, from: number, to: number): Procedure {
  return mapGate(p, gateId, (g) => {
    const rows = [...g.rows];
    const [m] = rows.splice(from, 1);
    if (!m) return g;
    rows.splice(to, 0, m);
    return { ...g, rows };
  });
}

/** Move a row to another gate; converts the row shape when layouts differ. */
export function moveRowToGate(p: Procedure, fromGateId: string, rowId: string, toGateId: string, index?: number): Procedure {
  const from = p.gates.find((g) => g.id === fromGateId);
  const to = p.gates.find((g) => g.id === toGateId);
  const row = from?.rows.find((r) => r.id === rowId);
  if (!from || !to || !row) return p;
  const converted = from.layout === to.layout ? row : convertRow(row, to.layout);
  const without = deleteRow(p, fromGateId, rowId);
  return insertRow(without, toGateId, index ?? to.rows.length, converted);
}

export function reorderGates(p: Procedure, from: number, to: number): Procedure {
  const gates = [...p.gates];
  const [m] = gates.splice(from, 1);
  if (!m) return p;
  gates.splice(to, 0, m);
  return { ...p, gates };
}

export function addGate(p: Procedure, afterGateId?: string, layout: Layout = "two-lane"): Procedure {
  const g = blankGate(layout);
  const i = afterGateId ? p.gates.findIndex((x) => x.id === afterGateId) : p.gates.length - 1;
  const gates = [...p.gates];
  gates.splice(i + 1, 0, g);
  return { ...p, gates };
}

export function addBranch(p: Procedure, parentGateId: string, condition: string, layout: Layout = "two-lane"): Procedure {
  const g: Gate = { ...blankGate(layout, condition), branch: { parentGateId, condition } };
  // Place after the parent's existing branches (or the parent itself).
  let i = p.gates.findIndex((x) => x.id === parentGateId);
  for (let k = i + 1; k < p.gates.length; k++) if (p.gates[k]!.branch?.parentGateId === parentGateId) i = k;
  const gates = [...p.gates];
  gates.splice(i + 1, 0, g);
  return { ...p, gates };
}

export function deleteGate(p: Procedure, gateId: string): Procedure {
  // Branches of the deleted gate become orphan branches; re-parent them to nothing by making them main gates.
  return {
    ...p,
    gates: p.gates.filter((g) => g.id !== gateId).map((g) => (g.branch?.parentGateId === gateId ? { ...g, branch: undefined, title: `${g.title} (was branch: ${g.branch.condition})` } : g)),
    profile: p.profile?.filter((pt) => pt.gateId !== gateId),
  };
}

/** Convert a row between layouts. Lossless where possible; otherwise the gap is marked to-fill. */
export function convertRow(r: Row, to: Layout): Row {
  if (to === "single-lane") {
    const { pf, pm, ...rest } = r;
    const pfHas = pf && (pf.action.trim() || pf.callout);
    const pmHas = pm && (pm.action.trim() || pm.callout);
    let action = "";
    let who: Who = "UNASSIGNED";
    let callout: string | undefined;
    if (pfHas && pmHas) {
      action = `PF: ${pf.action} / PM: ${pm.action}`.trim();
      who = "BOTH";
      callout = [pf.callout, pm.callout].filter(Boolean).join(" / ") || undefined;
    } else if (pfHas) {
      action = pf.action;
      who = "PF";
      callout = pf.callout;
    } else if (pmHas) {
      action = pm.action;
      who = "PM";
      callout = pm.callout;
    }
    const out: Row = { ...rest, action, who };
    if (callout) out.callout = callout;
    return out;
  }
  const { action, who, callout, ...rest } = r;
  const cell = { action: action ?? "", ...(callout ? { callout } : {}) };
  const empty = { action: "" };
  const out: Row = { ...rest, pf: empty, pm: empty };
  if (who === "PF") out.pf = cell;
  else if (who === "PM") out.pm = cell;
  else if (who === "BOTH") {
    out.pf = cell;
    out.pm = { ...cell };
  }
  const missing = (who === "PF" && "PM") || (who === "PM" && "PF") || (who !== "BOTH" && "PF and PM");
  if (missing && out.status !== "to-fill") {
    out.status = "to-fill";
    out.statusNote = `Converted from single-lane: ${missing} lane empty`;
  }
  return out;
}

export function switchLayout(p: Procedure, gateId: string, to: Layout): Procedure {
  return mapGate(p, gateId, (g) => (g.layout === to ? g : { ...g, layout: to, rows: g.rows.map((r) => convertRow(r, to)) }));
}

export function bulkWho(p: Procedure, gateId: string, who: Who): Procedure {
  return mapGate(p, gateId, (g) => (g.layout === "single-lane" ? { ...g, rows: g.rows.map((r) => ({ ...r, who })) } : g));
}

/** Duplicate a procedure as a template: new id/title; optionally clear row content but keep structure. */
export function duplicateProcedure(src: Procedure, id: string, title: string, clearContent: boolean): Procedure {
  const p: Procedure = structuredClone(src);
  p.id = id;
  p.title = title;
  p.version = 1;
  delete p.lastReviewed;
  const gateIdMap = new Map<string, string>();
  for (const g of p.gates) gateIdMap.set(g.id, newId());
  for (const g of p.gates) {
    g.id = gateIdMap.get(g.id)!;
    if (g.branch) g.branch.parentGateId = gateIdMap.get(g.branch.parentGateId) ?? g.branch.parentGateId;
    for (const r of g.rows) {
      r.id = newId();
      if (clearContent) {
        r.trigger = "";
        if (r.pf) r.pf = { action: "" };
        if (r.pm) r.pm = { action: "" };
        if (r.action !== undefined) r.action = "";
        delete r.callout;
        delete r.why;
        delete r.sourceRef;
        delete r.variants;
        r.status = "to-fill";
        r.statusNote = "Template row";
      }
    }
  }
  for (const t of p.referenceTables) {
    t.id = newId();
    if (clearContent) t.rows = [];
  }
  if (p.profile) p.profile = p.profile.map((pt) => ({ ...pt, gateId: gateIdMap.get(pt.gateId) ?? pt.gateId }));
  return p;
}
