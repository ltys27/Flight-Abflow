import type { Fleet, Gate, LaneCell, Procedure, Row } from "./schema";

/** Apply fleet variants (spec 3.2 `variants`) to every row. Pure. */
export function applyFleet(p: Procedure, fleet: Fleet | null): Procedure {
  if (!fleet) return p;
  return {
    ...p,
    gates: p.gates.map((g) => ({ ...g, rows: g.rows.map((r) => resolveRow(r, fleet)) })),
  };
}

export function resolveRow(r: Row, fleet: Fleet | null): Row {
  const o = fleet ? r.variants?.[fleet] : undefined;
  if (!o) return r;
  const out: Row = { ...r };
  if (o.trigger !== undefined) out.trigger = o.trigger;
  if (o.pf !== undefined) out.pf = o.pf;
  if (o.pm !== undefined) out.pm = o.pm;
  if (o.action !== undefined) out.action = o.action;
  if (o.who !== undefined) out.who = o.who;
  if (o.callout !== undefined) out.callout = o.callout;
  return out;
}

export const rowCount = (p: Pick<Procedure, "gates">) => p.gates.reduce((n, g) => n + g.rows.length, 0);

export const openItemCount = (p: Pick<Procedure, "gates">) =>
  p.gates.reduce((n, g) => n + g.rows.filter((r) => r.status !== "ok").length, 0);

export function findRow(p: Pick<Procedure, "gates">, rowId: string): { gate: Gate; row: Row; index: number } | null {
  for (const gate of p.gates) {
    const index = gate.rows.findIndex((r) => r.id === rowId);
    if (index >= 0) return { gate, row: gate.rows[index]!, index };
  }
  return null;
}

/** Lanes of a row that can be drilled: non-standing, non-empty, row not to-fill. */
export function drillableLanes(gate: Gate, row: Row): Array<"PF" | "PM"> {
  if (row.status === "to-fill") return [];
  if (gate.layout === "two-lane") {
    const out: Array<"PF" | "PM"> = [];
    if (row.pf && cellHasContent(row.pf) && !row.pf.standing) out.push("PF");
    if (row.pm && cellHasContent(row.pm) && !row.pm.standing) out.push("PM");
    return out;
  }
  if (!row.action && !row.callout) return [];
  if (row.who === "PF") return ["PF"];
  if (row.who === "PM") return ["PM"];
  if (row.who === "BOTH") return ["PF", "PM"];
  return [];
}

export const cellHasContent = (c: LaneCell) => c.action.trim() !== "" || (c.callout ?? "").trim() !== "";

/** Text searched by the library search box: title, tags, row text. */
export function searchableText(p: Procedure): string {
  const parts: string[] = [p.title, ...p.tags];
  for (const g of p.gates) {
    parts.push(g.title, g.aim ?? "");
    for (const r of g.rows) {
      parts.push(r.trigger, r.pf?.action ?? "", r.pf?.callout ?? "", r.pm?.action ?? "", r.pm?.callout ?? "", r.action ?? "", r.callout ?? "");
    }
  }
  return parts.join("\n").toLowerCase();
}

/** Gates in display order with branch structure: main gates, and the branches attached to each parent. */
export function branchesOf(p: Pick<Procedure, "gates">, parentGateId: string): Gate[] {
  return p.gates.filter((g) => g.branch?.parentGateId === parentGateId);
}

/**
 * The gates to show given branch choices (parentGateId -> chosen branch gate id).
 * Main gates always show; after a parent with branches, only the chosen branch
 * (default: first) is shown. Branch gates can themselves be parents.
 */
export function visibleGates(p: Pick<Procedure, "gates">, choices: Record<string, string>): Gate[] {
  const chosen = new Set<string>();
  const parents = new Set(p.gates.filter((g) => g.branch).map((g) => g.branch!.parentGateId));
  for (const parent of parents) {
    const options = branchesOf(p, parent);
    const pick = options.find((g) => g.id === choices[parent]) ?? options[0];
    if (pick) chosen.add(pick.id);
  }
  // A branch is visible only if its whole ancestry is chosen.
  const byId = new Map(p.gates.map((g) => [g.id, g]));
  const visible = (g: Gate): boolean => {
    let cur: Gate | undefined = g;
    while (cur?.branch) {
      if (!chosen.has(cur.id)) return false;
      cur = byId.get(cur.branch.parentGateId);
    }
    return true;
  };
  return p.gates.filter(visible);
}
