import { describe, expect, it } from "vitest";
import { diffProcedures } from "../src/edit/diff";
import { resolve } from "../src/state/procedures";
import { demo } from "./helpers";

describe("overlay / upstream diff", () => {
  it("matches rows by id and classifies changes", () => {
    const mine = demo();
    const theirs = demo();
    mine.gates[0]!.rows[0]!.trigger = "edited";
    mine.gates[0]!.rows.push({ id: "mine-only", trigger: "x", pf: { action: "a" }, pm: { action: "b" }, status: "ok" });
    theirs.gates[3]!.rows = [];
    const d = diffProcedures(mine, theirs);
    const byId = Object.fromEntries(d.map((x) => [x.rowId, x.kind]));
    expect(byId["demo-row-1"]).toBe("changed");
    expect(byId["demo-row-2"]).toBe("same");
    expect(byId["mine-only"]).toBe("added");
    expect(byId["demo-row-7"]).toBe("added"); // theirs removed it -> only in mine
    const theirsOnly = demo();
    theirsOnly.gates[0]!.rows.push({ id: "theirs-only", trigger: "y", pf: { action: "a" }, pm: { action: "b" }, status: "ok" });
    expect(diffProcedures(demo(), theirsOnly).find((x) => x.rowId === "theirs-only")!.kind).toBe("removed");
  });
  it("resolves overlay over user over shipped and flags upstream changes", () => {
    const shipped = demo();
    const edited = { ...demo(), title: "mine" };
    const r = resolve("demo-procedure", shipped, { procedureId: "demo-procedure", procedure: edited, baseVersion: 1, updatedAt: "t" }, undefined)!;
    expect(r.source).toBe("overlay");
    expect(r.upstreamChanged).toBe(false);
    const newer = { ...shipped, version: 2 };
    expect(resolve("demo-procedure", newer, { procedureId: "demo-procedure", procedure: edited, baseVersion: 1, updatedAt: "t" }, undefined)!.upstreamChanged).toBe(true);
    expect(resolve("x", undefined, undefined, { procedure: edited, updatedAt: "t" })!.source).toBe("user");
    expect(resolve("x", shipped, undefined, undefined)!.source).toBe("shipped");
    expect(resolve("x", undefined, undefined, undefined)).toBeNull();
  });
});
