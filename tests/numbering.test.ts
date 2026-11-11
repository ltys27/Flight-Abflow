import { describe, expect, it } from "vitest";
import { deriveNumbering } from "../src/content/numbering";
import { demo } from "./helpers";

describe("derived numbering", () => {
  it("numbers main gates sequentially and branches with letters", () => {
    const { gates, rows } = deriveNumbering(demo());
    expect(gates.get("demo-gate-1")).toBe("1");
    expect(gates.get("demo-gate-2a")).toBe("1A");
    expect(gates.get("demo-gate-2b")).toBe("1B");
    expect(gates.get("demo-gate-3")).toBe("2");
    expect(rows.get("demo-row-1")).toBe("1.1");
    expect(rows.get("demo-row-4")).toBe("1.4");
    expect(rows.get("demo-row-5")).toBe("1A.1");
    expect(rows.get("demo-row-6")).toBe("1B.1");
    expect(rows.get("demo-row-7")).toBe("2.1");
  });
  it("renumbers after a move without touching ids", () => {
    const p = demo();
    const g = p.gates[0]!;
    const [first, ...rest] = g.rows;
    g.rows = [...rest, first!];
    const { rows } = deriveNumbering(p);
    expect(rows.get("demo-row-1")).toBe("1.4");
    expect(rows.get("demo-row-2")).toBe("1.1");
  });
});
