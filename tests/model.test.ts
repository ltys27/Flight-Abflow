import { describe, expect, it } from "vitest";
import * as M from "../src/edit/model";
import { ProcedureSchema } from "../src/content/schema";
import { importMarkdown, importJson } from "../src/edit/import";
import { procedureToMarkdown, procedureToJson } from "../src/edit/export";
import { parseMarkdown } from "../src/import/markdown";
import { demo } from "./helpers";

const valid = (p: unknown) => ProcedureSchema.safeParse(p).success;

describe("edit model", () => {
  it("row operations keep the procedure valid and ids stable", () => {
    let p = demo();
    p = M.insertRow(p, "demo-gate-1", 1);
    expect(p.gates[0]!.rows[1]!.status).toBe("to-fill");
    p = M.duplicateRow(p, "demo-gate-1", "demo-row-1");
    expect(p.gates[0]!.rows[1]!.id).not.toBe("demo-row-1");
    expect(p.gates[0]!.rows[1]!.trigger).toBe("Demo row 1 trigger");
    p = M.reorderRows(p, "demo-gate-1", 0, 2);
    expect(p.gates[0]!.rows[2]!.id).toBe("demo-row-1");
    p = M.deleteRow(p, "demo-gate-1", "demo-row-1");
    expect(p.gates[0]!.rows.some((r) => r.id === "demo-row-1")).toBe(false);
    expect(valid(p)).toBe(true);
  });
  it("moving a row across layouts converts it", () => {
    const p = M.moveRowToGate(demo(), "demo-gate-1", "demo-row-1", "demo-gate-2a");
    const moved = p.gates[1]!.rows.find((r) => r.id === "demo-row-1")!;
    expect(moved.pf).toBeUndefined();
    expect(moved.who).toBe("BOTH");
    expect(moved.action).toContain("PF:");
    expect(valid(p)).toBe(true);
  });
  it("switching layout converts rows and marks gaps to-fill", () => {
    const single = M.switchLayout(demo(), "demo-gate-1", "single-lane");
    expect(single.gates[0]!.rows[1]!.who).toBe("PM"); // PF was standing/empty
    expect(valid(single)).toBe(true);
    const back = M.switchLayout(single, "demo-gate-1", "two-lane");
    const r2 = back.gates[0]!.rows[1]!;
    expect(r2.pm!.action).toBe("Demo row 2 PM action");
    expect(r2.status).toBe("to-fill");
    expect(valid(back)).toBe(true);
  });
  it("gates: add, branch, reorder, delete, bulk who", () => {
    let p = M.addGate(demo(), "demo-gate-1");
    expect(p.gates[1]!.title).toBe("New gate");
    p = M.addBranch(p, "demo-gate-3", "Cond");
    expect(p.gates[p.gates.length - 1]!.branch).toEqual({ parentGateId: "demo-gate-3", condition: "Cond" });
    p = M.reorderGates(p, 0, 1);
    expect(p.gates[1]!.id).toBe("demo-gate-1");
    p = M.bulkWho(p, "demo-gate-2a", "PF");
    expect(p.gates.find((g) => g.id === "demo-gate-2a")!.rows[0]!.who).toBe("PF");
    p = M.deleteGate(p, "demo-gate-1");
    expect(p.gates.find((g) => g.id === "demo-gate-2a")!.branch).toBeUndefined();
    expect(p.profile!.some((pt) => pt.gateId === "demo-gate-1")).toBe(false);
    expect(valid(p)).toBe(true);
  });
  it("duplicating as a template clears content and keeps structure with fresh ids", () => {
    const t = M.duplicateProcedure(demo(), "copy", "Copy", true);
    expect(t.gates).toHaveLength(4);
    expect(t.gates[0]!.rows).toHaveLength(4);
    expect(t.gates[0]!.rows[0]!.trigger).toBe("");
    expect(t.gates[0]!.rows[0]!.status).toBe("to-fill");
    expect(t.gates[1]!.branch!.parentGateId).toBe(t.gates[0]!.id);
    expect(t.gates[0]!.id).not.toBe("demo-gate-1");
    expect(valid(t)).toBe(true);
  });
});

describe("export / import", () => {
  it("Markdown export re-imports with the same gate structure", () => {
    const p = demo();
    const md = procedureToMarkdown(p);
    const parsed = parseMarkdown(md);
    expect(parsed.gates.map((g) => [g.layout, g.rows.length])).toEqual(p.gates.map((g) => [g.layout, g.rows.length]));
    expect(parsed.gates[0]!.rows[0]!.pf!.callout).toBe("Demo row 1 PF callout");
    const r = importMarkdown(md, { id: "re", title: "Re", category: "MISC", fleets: ["CEO"] }, new Set());
    expect(valid(r.procedure)).toBe(true);
  });
  it("JSON export re-imports and reports id clashes", () => {
    const text = procedureToJson(demo());
    const r = importJson(text, new Set(["demo-procedure"]));
    expect(r.ok && r.summary.idClash).toBe(true);
    expect(r.ok && r.summary.rows).toBe(7);
    expect(importJson("{}", new Set()).ok).toBe(false);
  });
});
