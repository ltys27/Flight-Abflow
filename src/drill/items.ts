import type { Gate, Procedure, Row } from "../content/schema";
import { drillableLanes } from "../content/resolve";
import type { ReviewRole } from "../db/db";
import type { Grade } from "../schedule/scheduler";
import { Rating } from "ts-fsrs";

export type DrillMode = "reveal" | "callouts" | "roleplay" | "order" | "audio";
export type RoleSel = "PF" | "PM" | "both";
export type Scope = { kind: "whole" } | { kind: "gates"; gateIds: string[] } | { kind: "branch"; gateId: string } | { kind: "due" };

export interface DrillItem {
  procedureId: string;
  gate: Gate;
  row: Row;
  role: ReviewRole;
  number: string;
}

/** Text the user must recall for an item, and the context shown to them. */
export function itemText(it: DrillItem): { ownAction: string; ownCallout?: string; otherAction: string; otherCallout?: string; otherRole: ReviewRole } {
  const r = it.row;
  if (it.gate.layout === "two-lane") {
    const own = it.role === "PF" ? r.pf : r.pm;
    const other = it.role === "PF" ? r.pm : r.pf;
    return { ownAction: own?.action ?? "", ownCallout: own?.callout, otherAction: other?.standing ? `${other.action || "(continues)"}` : other?.action ?? "", otherCallout: other?.callout, otherRole: it.role === "PF" ? "PM" : "PF" };
  }
  return { ownAction: r.action ?? "", ownCallout: r.callout, otherAction: "", otherRole: it.role === "PF" ? "PM" : "PF" };
}

export function buildItems(p: Procedure, scope: Scope, role: RoleSel, numbering: Map<string, string>, dueKeys?: Set<string>): DrillItem[] {
  const roles: ReviewRole[] = role === "both" ? ["PF", "PM"] : [role];
  let gates = p.gates;
  if (scope.kind === "gates") gates = p.gates.filter((g) => scope.gateIds.includes(g.id));
  if (scope.kind === "branch") gates = p.gates.filter((g) => g.id === scope.gateId);
  const out: DrillItem[] = [];
  for (const gate of gates) {
    for (const row of gate.rows) {
      for (const r of drillableLanes(gate, row)) {
        if (!roles.includes(r)) continue;
        if (scope.kind === "due" && !dueKeys?.has(`${row.id}|${r}`)) continue;
        out.push({ procedureId: p.id, gate, row, role: r, number: numbering.get(row.id) ?? "?" });
      }
    }
  }
  return out;
}

/** Order drill grading (spec 7): 0 misplaced = Good, 1 = Hard, 2+ = Again. */
export function orderGrade(misplaced: number): Grade {
  if (misplaced === 0) return Rating.Good;
  if (misplaced === 1) return Rating.Hard;
  return Rating.Again;
}

export function countMisplaced(submitted: string[], correct: string[]): number {
  let n = 0;
  for (let i = 0; i < correct.length; i++) if (submitted[i] !== correct[i]) n += 1;
  return n;
}

export function shuffle<T>(arr: T[], rand: () => number = Math.random): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
