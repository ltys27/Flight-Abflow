import { describe, expect, it } from "vitest";
import { parseCell, parseQuickRows } from "../src/edit/quickAdd";

let n = 0;
const id = () => `q${++n}`;

describe("paste rows", () => {
  it("reads quoted or bold text as the callout, straight or curly quotes", () => {
    expect(parseCell('Demo action "Demo call"')).toEqual({ action: "Demo action", callout: "Demo call" });
    expect(parseCell("Demo action \u201cDemo call\u201d")).toEqual({ action: "Demo action", callout: "Demo call" });
    expect(parseCell("**Demo call** Demo action")).toEqual({ action: "Demo action", callout: "Demo call" });
    expect(parseCell("Plain")).toEqual({ action: "Plain" });
    expect(parseCell(" - ")).toEqual({ action: "", standing: true });
  });
  it("parses pipe, tab and Markdown-table lines into two-lane rows", () => {
    const text = [
      "| # | Trigger | PF | PM |",
      "|---|---|---|---|",
      '| 1.1 | Demo trigger a | Demo PF a "Demo call a" | Demo PM a |',
      "Demo trigger b | Demo PF b | -",
      "Demo trigger c\tDemo PF c\tDemo PM c",
      "Demo trigger d",
      "",
    ].join("\n");
    const r = parseQuickRows(text, "two-lane", id);
    expect(r.skipped).toEqual([]);
    expect(r.rows.map((x) => [x.trigger, x.pf!.action, x.pf!.callout, x.pm!.action, !!x.pm!.standing, x.status])).toEqual([
      ["Demo trigger a", "Demo PF a", "Demo call a", "Demo PM a", false, "ok"],
      ["Demo trigger b", "Demo PF b", undefined, "", true, "ok"],
      ["Demo trigger c", "Demo PF c", undefined, "Demo PM c", false, "ok"],
      ["Demo trigger d", "", undefined, "", false, "to-fill"],
    ]);
  });
  it("parses single-lane rows and reports what it cannot use", () => {
    const r = parseQuickRows('Demo t1 | Demo act "Demo say" | pm\nDemo t2 | Demo act 2\nDemo t3 | x | CAPT\na | b | c | d | e', "single-lane", id);
    expect(r.rows.map((x) => [x.trigger, x.action, x.callout, x.who])).toEqual([
      ["Demo t1", "Demo act", "Demo say", "PM"],
      ["Demo t2", "Demo act 2", undefined, "UNASSIGNED"],
    ]);
    expect(r.skipped.map((s) => s.line)).toEqual([3, 4]);
  });
});
