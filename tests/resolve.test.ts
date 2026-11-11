import { describe, expect, it } from "vitest";
import { applyFleet, drillableLanes, visibleGates } from "../src/content/resolve";
import { demo } from "./helpers";

describe("fleet variant resolution", () => {
  it("applies an override for the chosen fleet only", () => {
    const p = demo();
    const row4 = (fleet: Parameters<typeof applyFleet>[1]) => applyFleet(p, fleet).gates[0]!.rows[3]!;
    expect(row4("A321").pf!.action).toBe("Demo row 4 PF action (A321 variant)");
    expect(row4("A321").pm!.action).toBe("Demo row 4 PM action (all fleets)");
    expect(row4("CEO").pf!.action).toBe("Demo row 4 PF action (all fleets)");
    expect(row4(null).pf!.action).toBe("Demo row 4 PF action (all fleets)");
  });
  it("does not mutate the base procedure", () => {
    const p = demo();
    applyFleet(p, "A321");
    expect(p.gates[0]!.rows[3]!.pf!.action).toBe("Demo row 4 PF action (all fleets)");
  });
});

describe("drillable lanes", () => {
  it("excludes standing cells, empty cells and to-fill rows", () => {
    const p = demo();
    const g = p.gates[0]!;
    expect(drillableLanes(g, g.rows[0]!)).toEqual(["PF", "PM"]);
    expect(drillableLanes(g, g.rows[1]!)).toEqual(["PM"]); // PF standing
    expect(drillableLanes(g, g.rows[2]!)).toEqual([]); // to-fill
    expect(drillableLanes(p.gates[1]!, p.gates[1]!.rows[0]!)).toEqual(["PM"]);
    expect(drillableLanes(p.gates[2]!, p.gates[2]!.rows[0]!)).toEqual(["PF", "PM"]); // BOTH
  });
});

describe("branch visibility", () => {
  it("shows only the chosen branch, defaulting to the first", () => {
    const p = demo();
    expect(visibleGates(p, {}).map((g) => g.id)).toEqual(["demo-gate-1", "demo-gate-2a", "demo-gate-3"]);
    expect(visibleGates(p, { "demo-gate-1": "demo-gate-2b" }).map((g) => g.id)).toEqual(["demo-gate-1", "demo-gate-2b", "demo-gate-3"]);
  });
});
