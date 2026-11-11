import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/db/db";
import { addAnnotation, findOrphans, latestConfidence, reattachAnnotation } from "../src/annotations/store";
import { deleteRow } from "../src/edit/model";
import { demo } from "./helpers";

beforeEach(async () => {
  await db.annotations.clear();
  await db.settings.clear();
});

describe("annotation orphaning and re-attach", () => {
  it("keeps an annotation whose row was deleted and lists it as orphaned", async () => {
    const p = demo();
    const a = await addAnnotation({ target: { procedureId: p.id, gateId: "demo-gate-1", rowId: "demo-row-2" }, kind: "note", text: "keep me" });
    const edited = deleteRow(p, "demo-gate-1", "demo-row-2");
    const all = await db.annotations.toArray();
    expect(all).toHaveLength(1);
    expect(findOrphans(all, edited).map((x) => x.id)).toEqual([a.id]);
    expect(findOrphans(all, p)).toEqual([]);
    await reattachAnnotation(a.id, { procedureId: p.id, gateId: "demo-gate-1", rowId: "demo-row-1" });
    expect(findOrphans(await db.annotations.toArray(), edited)).toEqual([]);
    expect((await db.annotations.get(a.id))!.target.rowId).toBe("demo-row-1");
  });
  it("gate-level annotations orphan when the gate disappears", () => {
    const p = demo();
    const a = { id: "g", target: { procedureId: p.id, gateId: "gone" }, kind: "note" as const, createdAt: "t", updatedAt: "t" };
    expect(findOrphans([a], p)).toHaveLength(1);
  });
  it("confidence: one per row, latest wins", async () => {
    const t = { procedureId: "demo-procedure", gateId: "demo-gate-1", rowId: "demo-row-1" };
    await addAnnotation({ target: t, kind: "confidence", confidence: "weak" });
    await addAnnotation({ target: t, kind: "confidence", confidence: "solid" });
    const all = await db.annotations.toArray();
    expect(all.filter((a) => a.kind === "confidence")).toHaveLength(1);
    expect(latestConfidence(all)).toBe("solid");
  });
  it("stamps notes with the active debrief session", async () => {
    await db.settings.put({ key: "activeSessionId", value: "sess1", updatedAt: "t" });
    const a = await addAnnotation({ target: { procedureId: "demo-procedure", rowId: "demo-row-1" }, kind: "note", text: "n" });
    expect(a.sessionId).toBe("sess1");
    const h = await addAnnotation({ target: { procedureId: "demo-procedure", rowId: "demo-row-1" }, kind: "highlight", color: "red" });
    expect(h.sessionId).toBeUndefined();
  });
});
