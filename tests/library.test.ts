import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { loadShippedLibrary } from "../src/content/library";

const good = readFileSync("public/procedures/demo-procedure.json", "utf8");

describe("loadShippedLibrary", () => {
  it("loads the rest of the library when one file fails", async () => {
    const files: Record<string, string> = {
      "p/index.json": JSON.stringify([
        { id: "demo-procedure", file: "demo-procedure.json", title: "Demo procedure (placeholder, not real)", category: "MISC", fleets: ["CEO", "NEO", "A321"], version: 1 },
        { id: "broken-one", file: "broken-one.json", title: "Broken", category: "ENG", fleets: ["CEO"], version: 1 },
        { id: "missing-one", file: "missing-one.json", title: "Missing", category: "ENG", fleets: ["CEO"], version: 1 },
      ]),
      "p/demo-procedure.json": good,
      "p/broken-one.json": JSON.stringify({ schemaVersion: 1, id: "broken-one" }),
    };
    const r = await loadShippedLibrary("p/", async (path) => {
      const t = files[path];
      if (t === undefined) throw new Error("HTTP 404");
      return t;
    });
    expect(r.procedures.has("demo-procedure")).toBe(true);
    expect(r.procedures.size).toBe(1);
    expect(r.issues.some((i) => i.file === "broken-one.json" && i.path === "title")).toBe(true);
    expect(r.issues.some((i) => i.file === "missing-one.json" && i.path === "$")).toBe(true);
  });
  it("reports an id mismatch between index and file", async () => {
    const r = await loadShippedLibrary("p/", async (path) =>
      path.endsWith("index.json")
        ? JSON.stringify([{ id: "other-id", file: "demo-procedure.json", title: "x", category: "MISC", fleets: [], version: 1 }])
        : good,
    );
    expect(r.procedures.size).toBe(0);
    expect(r.issues[0]).toMatchObject({ file: "demo-procedure.json", path: "id" });
  });
});
