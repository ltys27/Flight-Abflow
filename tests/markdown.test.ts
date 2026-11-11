import { describe, expect, it } from "vitest";
import { parseMarkdown, splitCallout, splitTableRow, toGates } from "../src/import/markdown";
import { ProcedureSchema } from "../src/content/schema";

const twoLane = `# Demo doc title

## Demo gate one

| # | Trigger | PF | PM |
|---|---------|----|----|
| 1 | Demo trigger 1 | Demo PF action **Demo PF callout** | Demo PM action |
| 2 | Demo trigger 2 | Demo PF action 2 | **Demo PM callout** |
`;

const singleLane = `## Demo gate two
| # | Trigger | Action | Who |
|---|---|---|---|
| 1 | Demo trigger | Demo action **Demo callout** | PM |
| 2 | Demo trigger b | Demo action b | both |
`;

describe("splitCallout", () => {
  it("extracts bold as callout and keeps the rest as action", () => {
    expect(splitCallout("Do thing **Say this**")).toEqual({ action: "Do thing", callout: "Say this" });
    expect(splitCallout("**Only callout**")).toEqual({ action: "", callout: "Only callout" });
    expect(splitCallout("Plain")).toEqual({ action: "Plain" });
    expect(splitCallout("")).toEqual({ action: "" });
  });
});

describe("splitTableRow", () => {
  it("splits and honours escaped pipes", () => {
    expect(splitTableRow("| a | b \\| c | d |")).toEqual(["a", "b | c", "d"]);
    expect(splitTableRow("a|b")).toEqual(["a", "b"]);
  });
});

describe("parseMarkdown", () => {
  it("parses a two-lane table under a heading", () => {
    const r = parseMarkdown(twoLane);
    expect(r.unparsed).toEqual([]);
    expect(r.gates).toHaveLength(1);
    const g = r.gates[0]!;
    expect(g.title).toBe("Demo gate one");
    expect(g.layout).toBe("two-lane");
    expect(g.rows).toEqual([
      { trigger: "Demo trigger 1", pf: { action: "Demo PF action", callout: "Demo PF callout" }, pm: { action: "Demo PM action" }, status: "ok" },
      { trigger: "Demo trigger 2", pf: { action: "Demo PF action 2" }, pm: { action: "", callout: "Demo PM callout" }, status: "ok" },
    ]);
  });
  it("parses a single-lane table", () => {
    const r = parseMarkdown(singleLane);
    expect(r.unparsed).toEqual([]);
    const g = r.gates[0]!;
    expect(g.layout).toBe("single-lane");
    expect(g.rows).toEqual([
      { trigger: "Demo trigger", action: "Demo action", who: "PM", callout: "Demo callout", status: "ok" },
      { trigger: "Demo trigger b", action: "Demo action b", who: "BOTH", status: "ok" },
    ]);
  });
  it("reports bad lines with line numbers and keeps going", () => {
    const text = `## G
| # | Trigger | PF | PM |
|---|---|---|---|
| 1 | ok | a | b |
| 2 | too few |
| 3 | ok2 | c | d |
stray prose line

| # | Trigger | Foo | Bar |
|---|---|---|---|
| 1 | x | y | z |

## Empty heading
`;
    const r = parseMarkdown(text);
    expect(r.gates).toHaveLength(1);
    expect(r.gates[0]!.rows.map((x) => x.trigger)).toEqual(["ok", "ok2"]);
    expect(r.unparsed.map((u) => [u.line, u.reason])).toEqual([
      [5, "expected 4 cells, found 2"],
      [7, "not part of a table"],
      [9, "table header is not `# | Trigger | PF | PM` or `# | Trigger | Action | Who`"],
      [10, "belongs to a table with an unrecognised header"],
      [11, "belongs to a table with an unrecognised header"],
      [13, "heading has no table after it"],
    ]);
  });
  it("rejects an unknown who value", () => {
    const r = parseMarkdown(`## G\n| # | Trigger | Action | Who |\n|-|-|-|-|\n| 1 | t | a | CAPT |\n`);
    expect(r.gates[0]!.rows).toEqual([]);
    expect(r.unparsed[0]!.reason).toMatch(/who must be/);
  });
  it("produces gates that validate once ids are assigned", () => {
    let n = 0;
    const gates = toGates(parseMarkdown(twoLane + "\n" + singleLane).gates, () => `id${++n}`);
    const p = ProcedureSchema.safeParse({
      schemaVersion: 1, id: "imported", title: "Imported", category: "MISC", fleets: [], tags: [],
      version: 1, relatedProcedures: [], gates, referenceTables: [],
    });
    expect(p.success).toBe(true);
    expect(gates[0]!.rows[0]!.id).toBe("id2");
  });
});
