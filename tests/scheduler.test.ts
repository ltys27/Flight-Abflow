import { describe, expect, it } from "vitest";
import { Rating } from "ts-fsrs";
import { capDue, endOfDay, gradeItem, readiness, weaknessScore, DAY_MS } from "../src/schedule/scheduler";
import { demo } from "./helpers";

const key = { procedureId: "demo-procedure", rowId: "demo-row-1", role: "PF" as const };

describe("target-date interval cap", () => {
  const target = "2026-12-31";
  it("leaves early due dates alone", () => {
    const now = new Date("2026-12-01T10:00:00Z");
    const due = new Date("2026-12-10T10:00:00Z");
    expect(capDue(due, now, target)).toEqual(due);
  });
  it("pulls a late due date back to the start of the final 3-day window", () => {
    const now = new Date("2026-12-01T10:00:00Z");
    const due = new Date("2027-02-01T10:00:00Z");
    const capped = capDue(due, now, target);
    expect(capped.getTime()).toBe(endOfDay(target).getTime() - 3 * DAY_MS);
  });
  it("inside the window, caps at the target itself", () => {
    const now = new Date(endOfDay(target).getTime() - DAY_MS);
    const due = new Date("2027-02-01T10:00:00Z");
    expect(capDue(due, now, target).getTime()).toBe(endOfDay(target).getTime());
  });
  it("does nothing once the target has passed or none is set", () => {
    const now = new Date("2027-03-01T10:00:00Z");
    const due = new Date("2027-04-01T10:00:00Z");
    expect(capDue(due, now, target)).toEqual(due);
    expect(capDue(due, now, null)).toEqual(due);
  });
  it("gradeItem applies the cap and produces a log entry", () => {
    const start = new Date("2026-12-01T10:00:00Z");
    // Without a target the chain of Easy grades runs past the target date.
    let free = gradeItem(key, undefined, Rating.Easy, start, null, "test").item;
    for (let i = 0; i < 6; i++) free = gradeItem(key, free, Rating.Easy, new Date(free.due), null, "test").item;
    expect(new Date(free.due).getTime()).toBeGreaterThan(endOfDay(target).getTime());
    // With a target every due date stays inside the target.
    let capped = gradeItem(key, undefined, Rating.Easy, start, target, "test");
    for (let i = 0; i < 6; i++) {
      expect(new Date(capped.item.due).getTime()).toBeLessThanOrEqual(endOfDay(target).getTime());
      // Review a little before the due date so the clock never passes the target.
      const now = new Date(Math.min(new Date(capped.item.due).getTime(), endOfDay(target).getTime() - 3_600_000));
      capped = gradeItem(key, capped.item, Rating.Easy, now, target, "test");
    }
    expect(capped.log.rating).toBe(Rating.Easy);
    expect(capped.log.mode).toBe("test");
  });
});

describe("weakness and readiness", () => {
  it("weakness = share of items with a lapse in last 5 reviews", () => {
    const items = [
      { ...key, due: "", stability: 0, difficulty: 0, elapsed_days: 0, scheduled_days: 0, learning_steps: 0, reps: 0, lapses: 0, state: 0, updatedAt: "" },
      { ...key, rowId: "demo-row-2", role: "PM" as const, due: "", stability: 0, difficulty: 0, elapsed_days: 0, scheduled_days: 0, learning_steps: 0, reps: 0, lapses: 0, state: 0, updatedAt: "" },
    ];
    const log = [
      { ...key, rating: Rating.Again, state: 0, reviewedAt: "2026-01-01", scheduledDays: 0, elapsedDays: 0, mode: "t" },
      { ...key, rowId: "demo-row-2", role: "PM" as const, rating: Rating.Good, state: 0, reviewedAt: "2026-01-01", scheduledDays: 0, elapsedDays: 0, mode: "t" },
    ];
    expect(weaknessScore(items, log)).toBe(0.5);
    expect(weaknessScore([], log)).toBe(0);
  });
  it("readiness counts successful reviews inside the final window", () => {
    const p = demo();
    const inWindow = new Date(endOfDay("2026-12-31").getTime() - DAY_MS).toISOString();
    const log = [{ ...key, rating: Rating.Good, state: 2, reviewedAt: inWindow, scheduledDays: 1, elapsedDays: 1, mode: "t" }];
    expect(readiness(p, log, "2026-12-31")).toBeCloseTo(1 / 10);
    expect(readiness(p, [], null)).toBeNull();
  });
});
