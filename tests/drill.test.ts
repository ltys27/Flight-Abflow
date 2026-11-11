import { describe, expect, it } from "vitest";
import { Rating } from "ts-fsrs";
import { buildItems, countMisplaced, orderGrade, shuffle } from "../src/drill/items";
import { deriveNumbering } from "../src/content/numbering";
import { demo } from "./helpers";

describe("order-drill grading", () => {
  it("maps misplaced count to grades", () => {
    expect(orderGrade(0)).toBe(Rating.Good);
    expect(orderGrade(1)).toBe(Rating.Hard);
    expect(orderGrade(2)).toBe(Rating.Again);
    expect(orderGrade(5)).toBe(Rating.Again);
  });
  it("counts misplaced positions", () => {
    expect(countMisplaced(["a", "b", "c"], ["a", "b", "c"])).toBe(0);
    expect(countMisplaced(["b", "a", "c"], ["a", "b", "c"])).toBe(2);
    expect(countMisplaced(["a", "c", "b"], ["a", "b", "c"])).toBe(2);
  });
  it("shuffle keeps every element", () => {
    const s = shuffle([1, 2, 3, 4], () => 0.1);
    expect([...s].sort()).toEqual([1, 2, 3, 4]);
  });
});

describe("drill items", () => {
  it("builds items by role and scope, skipping standing and to-fill", () => {
    const p = demo();
    const n = deriveNumbering(p).rows;
    expect(buildItems(p, { kind: "whole" }, "both", n).map((i) => `${i.number}${i.role}`)).toEqual(["1.1PF", "1.1PM", "1.2PM", "1.4PF", "1.4PM", "1A.1PM", "1B.1PF", "1B.1PM", "2.1PF", "2.1PM"]);
    expect(buildItems(p, { kind: "whole" }, "PF", n)).toHaveLength(4);
    expect(buildItems(p, { kind: "branch", gateId: "demo-gate-2b" }, "both", n)).toHaveLength(2);
    expect(buildItems(p, { kind: "gates", gateIds: ["demo-gate-3"] }, "PM", n)).toHaveLength(1);
    expect(buildItems(p, { kind: "due" }, "both", n, new Set(["demo-row-1|PM"]))).toHaveLength(1);
  });
});
