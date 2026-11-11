import { describe, expect, it } from "vitest";
import { ProcedureSchema } from "../src/content/schema";
import { formatPath, validateIndex, validateProcedure, validateProcedureText } from "../src/content/validate";
import { demo, readJson } from "./helpers";

const issuesOf = (data: unknown) => {
  const r = validateProcedure("t.json", data);
  return r.ok ? [] : r.issues;
};

describe("shipped files", () => {
  it("demo-procedure.json validates", () => {
    expect(issuesOf(readJson("public/procedures/demo-procedure.json"))).toEqual([]);
  });
  it("index.json validates and matches the procedure files", () => {
    const r = validateIndex("index.json", readJson("public/procedures/index.json"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const e of r.value) {
      const p = readJson(`public/procedures/${e.file}`) as { id: string; version: number; title: string };
      expect(p.id).toBe(e.id);
      expect(p.version).toBe(e.version);
      expect(p.title).toBe(e.title);
    }
  });
  it("fixture minimal validates", () => {
    expect(issuesOf(readJson("tests/fixtures/good-minimal.json"))).toEqual([]);
  });
});

describe("good variations", () => {
  it("accepts a two-lane row with an empty standing cell", () => {
    const p = demo();
    p.gates[0]!.rows[0]!.pf = { action: "", standing: true };
    expect(issuesOf(p)).toEqual([]);
  });
  it("accepts a cell that has only a callout", () => {
    const p = demo();
    p.gates[0]!.rows[0]!.pf = { action: "", callout: "Demo callout only" };
    expect(issuesOf(p)).toEqual([]);
  });
  it("accepts empty cells when status is to-fill", () => {
    const p = demo();
    p.gates[0]!.rows[0] = { id: "x1", trigger: "Prompt", pf: { action: "" }, pm: { action: "" }, status: "to-fill" };
    expect(issuesOf(p)).toEqual([]);
  });
  it("accepts optional fields", () => {
    const p = demo();
    p.lastReviewed = "2026-01-31";
    p.relatedProcedures = ["other-one"];
    expect(issuesOf(p)).toEqual([]);
  });
  it("types are derived from the schema", () => {
    const r = ProcedureSchema.parse(demo());
    expect(r.gates[0]?.layout).toBe("two-lane");
  });
});

describe("bad files", () => {
  it("reports JSON syntax errors at the root", () => {
    const r = validateProcedureText("broken.json", "{ not json");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issues[0]).toMatchObject({ file: "broken.json", path: "$" });
    expect(r.issues[0]!.message).toMatch(/invalid JSON/);
  });
  it("rejects wrong schemaVersion", () => {
    const p = demo() as unknown as Record<string, unknown>;
    p.schemaVersion = 2;
    expect(issuesOf(p).map((i) => i.path)).toContain("schemaVersion");
  });
  it("rejects a non-kebab id", () => {
    const p = demo();
    p.id = "Not Kebab";
    expect(issuesOf(p)).toMatchObject([{ path: "id" }]);
  });
  it("rejects unknown category and fleet", () => {
    const p = demo() as unknown as { category: string; fleets: string[] };
    p.category = "WEATHER";
    p.fleets = ["A380"];
    const paths = issuesOf(p).map((i) => i.path);
    expect(paths).toContain("category");
    expect(paths).toContain("fleets[0]");
  });
  it("rejects a non-integer version", () => {
    const p = demo();
    p.version = 1.5;
    expect(issuesOf(p).map((i) => i.path)).toContain("version");
  });
  it("rejects unknown keys (strict)", () => {
    const p = demo() as unknown as Record<string, unknown>;
    p.extra = true;
    expect(issuesOf(p).length).toBeGreaterThan(0);
  });
  it("rejects a two-lane row missing pm", () => {
    const p = demo();
    delete p.gates[0]!.rows[0]!.pm;
    expect(issuesOf(p)).toMatchObject([{ path: "gates[0].rows[0].pm" }]);
  });
  it("rejects a two-lane row with a completely empty cell", () => {
    const p = demo();
    p.gates[0]!.rows[0]!.pf = { action: "   " };
    const issues = issuesOf(p);
    expect(issues).toMatchObject([{ path: "gates[0].rows[0].pf" }]);
    expect(issues[0]!.message).toMatch(/standing/);
  });
  it("rejects single-lane fields on a two-lane row and vice versa", () => {
    const p = demo();
    p.gates[0]!.rows[0]!.who = "PF";
    p.gates[1]!.rows[0]!.pf = { action: "x" };
    const paths = issuesOf(p).map((i) => i.path);
    expect(paths).toContain("gates[0].rows[0]");
    expect(paths).toContain("gates[1].rows[0]");
  });
  it("rejects a single-lane row without who", () => {
    const p = demo();
    delete p.gates[1]!.rows[0]!.who;
    expect(issuesOf(p)).toMatchObject([{ path: "gates[1].rows[0].who" }]);
  });
  it("rejects duplicate gate and row ids with the location of the first", () => {
    const p = demo();
    delete p.profile; // it references the gate we are about to rename
    p.gates[3]!.id = "demo-gate-1";
    p.gates[3]!.rows[0]!.id = "demo-row-1";
    const issues = issuesOf(p);
    expect(issues).toMatchObject([
      { path: "gates[3].id" },
      { path: "gates[3].rows[0].id" },
    ]);
    expect(issues[1]!.message).toMatch(/gates\[0\]\.rows\[0\]/);
  });
  it("rejects a branch pointing at an unknown or self gate", () => {
    const p = demo();
    p.gates[1]!.branch!.parentGateId = "nope";
    p.gates[2]!.branch!.parentGateId = "demo-gate-2b";
    expect(issuesOf(p)).toMatchObject([
      { path: "gates[1].branch.parentGateId" },
      { path: "gates[2].branch.parentGateId" },
    ]);
  });
  it("rejects a profile point with an unknown gate", () => {
    const p = demo();
    p.profile![0]!.gateId = "ghost";
    expect(issuesOf(p)).toMatchObject([{ path: "profile[0].gateId" }]);
  });
  it("rejects a reference table row with the wrong cell count", () => {
    const p = demo();
    p.referenceTables[0]!.rows[1] = ["only one"];
    expect(issuesOf(p)).toMatchObject([{ path: "referenceTables[0].rows[1]" }]);
  });
  it("rejects a bad lastReviewed date and a self-reference", () => {
    const p = demo();
    p.lastReviewed = "31/01/2026";
    p.relatedProcedures = ["demo-procedure"];
    const paths = issuesOf(p).map((i) => i.path);
    expect(paths).toContain("lastReviewed");
    expect(paths).toContain("relatedProcedures[0]");
  });
  it("rejects a variant for an unknown fleet", () => {
    const p = demo() as unknown as { gates: { rows: { variants?: Record<string, unknown> }[] }[] };
    p.gates[0]!.rows[0]!.variants = { B747: { trigger: "x" } };
    expect(issuesOf(p).length).toBeGreaterThan(0);
  });
  it("index rejects duplicate ids", () => {
    const idx = readJson("public/procedures/index.json") as unknown[];
    const r = validateIndex("index.json", [...idx, ...idx]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issues[0]!.path).toBe("[1].id");
  });
});

describe("formatPath", () => {
  it("renders JSON paths", () => {
    expect(formatPath([])).toBe("$");
    expect(formatPath(["gates", 0, "rows", 2, "pf"])).toBe("gates[0].rows[2].pf");
    expect(formatPath([3, "id"])).toBe("[3].id");
    expect(formatPath(["weird key"])).toBe('["weird key"]');
  });
});
