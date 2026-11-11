// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/db/db";
import { blobBytes, eraseAllData, exportBackup, parseBackup, restoreBackup } from "../src/backup/backup";
import { demo } from "./helpers";

async function snapshot() {
  const blobs = await Promise.all((await db.blobs.toArray()).map(async (b) => ({ ...b, data: new TextDecoder().decode(await blobBytes(b.data)) })));
  return {
    overlays: await db.overlays.toArray(),
    userProcedures: await db.userProcedures.toArray(),
    annotations: await db.annotations.toArray(),
    blobs,
    reviewItems: await db.reviewItems.toArray(),
    reviewLog: (await db.reviewLog.toArray()).map(({ id: _id, ...r }) => r),
    sessions: await db.sessions.toArray(),
    settings: await db.settings.toArray(),
  };
}

async function seed() {
  await db.overlays.put({ procedureId: "demo-procedure", procedure: { ...demo(), title: "edited" }, baseVersion: 1, updatedAt: "2026-01-02T00:00:00Z" });
  await db.userProcedures.put({ procedureId: "mine", procedure: { ...demo(), id: "mine" }, updatedAt: "2026-01-02T00:00:00Z" });
  await db.annotations.put({ id: "a1", target: { procedureId: "demo-procedure", rowId: "demo-row-1" }, kind: "note", text: "hello", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-02T00:00:00Z" });
  await db.annotations.put({ id: "v1", target: { procedureId: "demo-procedure", rowId: "demo-row-1" }, kind: "voice", blobId: "b1", durationMs: 1200, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-02T00:00:00Z" });
  await db.blobs.put({ id: "b1", mime: "audio/webm", data: new Blob(["fake audio bytes"], { type: "audio/webm" }), updatedAt: "2026-01-02T00:00:00Z" });
  await db.reviewItems.put({ procedureId: "demo-procedure", rowId: "demo-row-1", role: "PF", due: "2026-02-01T00:00:00Z", stability: 1, difficulty: 5, elapsed_days: 0, scheduled_days: 1, learning_steps: 0, reps: 1, lapses: 0, state: 2, updatedAt: "2026-01-02T00:00:00Z" });
  await db.reviewLog.add({ procedureId: "demo-procedure", rowId: "demo-row-1", role: "PF", rating: 3, state: 0, reviewedAt: "2026-01-02T00:00:00Z", scheduledDays: 1, elapsedDays: 0, mode: "t" });
  await db.sessions.put({ id: "s1", name: "Sim 1", date: "2026-01-02", createdAt: "2026-01-02T00:00:00Z", updatedAt: "2026-01-02T00:00:00Z" });
  await db.settings.put({ key: "theme", value: "light", updatedAt: "2026-01-02T00:00:00Z" });
}

beforeEach(async () => {
  await eraseAllData();
});

describe("backup round-trip", () => {
  it("export, erase, restore (replace) yields deep-equal data", async () => {
    await seed();
    const before = await snapshot();
    const file = JSON.stringify(await exportBackup());
    await eraseAllData();
    expect((await snapshot()).annotations).toEqual([]);
    const parsed = parseBackup(file);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.summary.counts.annotations).toBe(2);
    expect(parsed.summary.counts.blobs).toBe(1);
    await restoreBackup(parsed.backup, "replace");
    expect(await snapshot()).toEqual(before);
  });
  it("rejects a malformed file with a message", () => {
    expect(parseBackup("nope").ok).toBe(false);
    const r = parseBackup(JSON.stringify({ backupVersion: 99 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/backupVersion/);
  });
});

describe("merge restore", () => {
  it("newer updatedAt wins per record; missing records are added; log entries are not duplicated", async () => {
    await seed();
    const file = await exportBackup();
    // Local changes after the backup: note edited (newer), session renamed older than backup, new annotation.
    await db.annotations.put({ id: "a1", target: { procedureId: "demo-procedure", rowId: "demo-row-1" }, kind: "note", text: "newer local", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-03-01T00:00:00Z" });
    await db.sessions.put({ id: "s1", name: "older local", date: "2026-01-02", createdAt: "2026-01-02T00:00:00Z", updatedAt: "2025-12-01T00:00:00Z" });
    await db.annotations.put({ id: "a2", target: { procedureId: "demo-procedure", rowId: "demo-row-2" }, kind: "tag", tag: "x", createdAt: "2026-03-01T00:00:00Z", updatedAt: "2026-03-01T00:00:00Z" });
    await db.annotations.delete("v1");
    await restoreBackup(file, "merge");
    expect((await db.annotations.get("a1"))!.text).toBe("newer local");
    expect((await db.sessions.get("s1"))!.name).toBe("Sim 1");
    expect(await db.annotations.get("a2")).toBeDefined();
    expect(await db.annotations.get("v1")).toBeDefined();
    expect(await db.reviewLog.count()).toBe(1);
  });
});
