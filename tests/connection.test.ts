import { describe, expect, it } from "vitest";
import { describeStatus } from "../src/components/ConnectionStatus";

const base = { connection: "online" as const, syncEnabled: false, syncing: false, lastSyncOk: null, lastSyncAt: null, lastSyncMessage: null, pending: false };

describe("connection indicator wording", () => {
  it("online without sync", () => {
    expect(describeStatus(base)).toMatchObject({ tone: "ok", label: "Online" });
  });
  it("offline always wins and reassures that data is on the device", () => {
    const st = describeStatus({ ...base, connection: "offline", syncEnabled: true, pending: true, lastSyncOk: false });
    expect(st.tone).toBe("off");
    expect(st.label).toBe("Offline");
    expect(st.detail).toMatch(/saved on this device/);
    expect(st.detail).toMatch(/back online/);
  });
  it("sync states when online, in priority order", () => {
    const on = { ...base, syncEnabled: true, lastSyncAt: new Date().toISOString(), lastSyncOk: true };
    expect(describeStatus({ ...on, syncing: true, pending: true }).label).toBe("Online · syncing…");
    expect(describeStatus({ ...on, lastSyncOk: false, lastSyncMessage: "401: Bad credentials" })).toMatchObject({ tone: "warn", label: "Online · sync failed", detail: "401: Bad credentials" });
    expect(describeStatus({ ...on, pending: true }).label).toBe("Online · changes waiting");
    expect(describeStatus(on).label).toMatch(/^Online · synced \d/);
    expect(describeStatus({ ...on, lastSyncAt: null, lastSyncOk: null }).label).toBe("Online · not synced yet");
  });
  it("checking state", () => {
    expect(describeStatus({ ...base, connection: "checking" }).tone).toBe("busy");
  });
});
