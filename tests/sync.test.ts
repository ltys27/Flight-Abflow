// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { FlowDb, recordTombstone } from "../src/db/db";
import { buildSnapshot, mergeSnapshot } from "../src/sync/merge";
import { syncNow, syncPaths } from "../src/sync/sync";
import { SyncConflictError, type RepoClient } from "../src/sync/github";
import { DEVICE_ONLY_SETTINGS, type SyncConfig } from "../src/state/settings";

/** In-memory stand-in for the GitHub Contents API with sha-based optimistic concurrency. */
function fakeRepo() {
  const files = new Map<string, { sha: string; bytes: Uint8Array }>();
  let n = 0;
  let puts = 0;
  const client: RepoClient = {
    async getFile(path) {
      const f = files.get(path);
      return f ? { sha: f.sha, bytes: f.bytes } : null;
    },
    async putFile(path, bytes, _message, sha) {
      const cur = files.get(path);
      if ((cur && cur.sha !== sha) || (!cur && sha)) throw new SyncConflictError();
      const next = { sha: `sha${++n}`, bytes };
      files.set(path, next);
      puts += 1;
      return next.sha;
    },
    async test() {
      return { ok: true, message: "ok" };
    },
  };
  return { client, files, puts: () => puts };
}

const cfg: SyncConfig = { enabled: true, repo: "o/r", branch: "main", path: "flow-scripts", token: "t" };
let counter = 0;
const freshDb = () => new FlowDb(`test-${Date.now()}-${++counter}`);

const note = (id: string, text: string, updatedAt: string) => ({ id, target: { procedureId: "demo-procedure", rowId: "demo-row-1" }, kind: "note" as const, text, createdAt: updatedAt, updatedAt });

describe("merge with tombstones", () => {
  let a: FlowDb;
  beforeEach(() => {
    a = freshDb();
  });
  it("a newer tombstone removes an older incoming record and a newer record survives a tombstone", async () => {
    await a.annotations.put(note("n1", "local", "2026-01-01T00:00:00Z"));
    await recordTombstone("annotations", "n2", a);
    const snap = await buildSnapshot(a, DEVICE_ONLY_SETTINGS);
    expect(snap.tombstones.map((t) => t.key)).toEqual(["n2"]);
    // Incoming: n2 older than the tombstone (stays deleted), n3 newer than a tombstone we also receive.
    await mergeSnapshot(
      {
        ...snap,
        annotations: [note("n2", "old", "2025-12-01T00:00:00Z"), note("n3", "revived", "2026-03-01T00:00:00Z")],
        tombstones: [...snap.tombstones, { table: "annotations", key: "n3", deletedAt: "2026-02-01T00:00:00Z" }],
      },
      a,
    );
    const ids = (await a.annotations.toArray()).map((x) => x.id).sort();
    expect(ids).toEqual(["n1", "n3"]);
  });
  it("newer updatedAt wins per record", async () => {
    await a.annotations.put(note("n1", "local-newer", "2026-02-01T00:00:00Z"));
    await a.annotations.put(note("n2", "local-older", "2026-01-01T00:00:00Z"));
    const snap = await buildSnapshot(a, DEVICE_ONLY_SETTINGS);
    await mergeSnapshot({ ...snap, annotations: [note("n1", "remote-older", "2026-01-15T00:00:00Z"), note("n2", "remote-newer", "2026-01-20T00:00:00Z")] }, a);
    expect((await a.annotations.get("n1"))!.text).toBe("local-newer");
    expect((await a.annotations.get("n2"))!.text).toBe("remote-newer");
  });
});

describe("two-device sync through a repository", () => {
  it("pushes, pulls, propagates deletions, keeps device-only settings local, and retries on conflict", async () => {
    const repo = fakeRepo();
    const A = freshDb();
    const B = freshDb();
    const paths = syncPaths(cfg);

    await A.annotations.put(note("n1", "from A", "2026-01-01T00:00:00Z"));
    await A.settings.put({ key: "theme", value: "light", updatedAt: "2026-01-01T00:00:00Z" });
    await A.settings.put({ key: "syncConfig", value: cfg, updatedAt: "2026-01-01T00:00:00Z" });
    await A.blobs.put({ id: "b1", mime: "audio/webm", data: new Blob(["voice"], { type: "audio/webm" }), updatedAt: "2026-01-01T00:00:00Z" });
    await A.annotations.put({ id: "v1", target: { procedureId: "demo-procedure", rowId: "demo-row-1" }, kind: "voice", blobId: "b1", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" });

    const r1 = await syncNow("test", A, repo.client, cfg);
    expect(r1).toMatchObject({ ok: true, pushed: true });
    expect(repo.files.has(paths.data)).toBe(true);
    expect(repo.files.has(paths.blob("b1"))).toBe(true);
    const uploaded = JSON.parse(new TextDecoder().decode(repo.files.get(paths.data)!.bytes));
    expect(uploaded.snapshot.settings.some((x: { key: string }) => x.key === "syncConfig")).toBe(false); // token never leaves the device

    // Second sync with nothing changed: no push.
    const before = repo.puts();
    expect((await syncNow("test", A, repo.client, cfg)).message).toBe("Already in sync");
    expect(repo.puts()).toBe(before);

    // B pulls everything including the voice blob.
    const r2 = await syncNow("test", B, repo.client, cfg);
    expect(r2).toMatchObject({ ok: true, pulled: true });
    expect((await B.annotations.get("n1"))!.text).toBe("from A");
    expect((await B.blobs.get("b1"))!.mime).toBe("audio/webm");
    expect((await B.settings.get("theme"))!.value).toBe("light");
    expect(await B.settings.get("syncConfig")).toBeUndefined();

    // B deletes n1 and adds n2; A edits nothing. After both sync, A loses n1 and gains n2.
    await B.annotations.delete("n1");
    await recordTombstone("annotations", "n1", B);
    await B.annotations.put(note("n2", "from B", "2026-02-01T00:00:00Z"));
    expect((await syncNow("test", B, repo.client, cfg)).pushed).toBe(true);
    const r3 = await syncNow("test", A, repo.client, cfg);
    expect(r3.ok).toBe(true);
    expect(await A.annotations.get("n1")).toBeUndefined();
    expect((await A.annotations.get("n2"))!.text).toBe("from B");

    // Conflict: a third device writes between A's read and write. Simulate by wrapping the client.
    let injected = false;
    const racing: RepoClient = {
      ...repo.client,
      async putFile(path, bytes, message, sha) {
        if (!injected && path === paths.data) {
          injected = true;
          // Someone else pushed first.
          const cur = repo.files.get(path)!;
          const doc = JSON.parse(new TextDecoder().decode(cur.bytes));
          doc.snapshot.annotations.push(note("n9", "from C", "2026-03-01T00:00:00Z"));
          await repo.client.putFile(path, new TextEncoder().encode(JSON.stringify(doc)), "C", cur.sha);
        }
        return repo.client.putFile(path, bytes, message, sha);
      },
    };
    await A.annotations.put(note("n4", "from A again", "2026-03-02T00:00:00Z"));
    const r4 = await syncNow("test", A, racing, cfg);
    expect(r4.ok).toBe(true);
    expect((await A.annotations.get("n9"))!.text).toBe("from C"); // retried after the conflict and merged C's change
    const final = JSON.parse(new TextDecoder().decode(repo.files.get(paths.data)!.bytes));
    expect(final.snapshot.annotations.map((x: { id: string }) => x.id).sort()).toEqual(["n2", "n4", "n9", "v1"]);
  });
});
