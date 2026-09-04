import { describe, expect, it } from "vitest";
import type { Station } from "@workspace/db";
import {
  detectScheduledBoundary,
  shouldObserveScheduledBoundary,
} from "../../src/lore/speech-boundary-observer.js";
import type { ActiveScheduleEntry } from "../../src/lore/speech-schedule-comparison.js";

const station = {
  id: 7,
  ianaTimezone: "America/Los_Angeles",
} as Station;

function entry(showName: string, djName: string | null): ActiveScheduleEntry {
  return {
    showName,
    djName,
    sourceUrl: "https://radio.example/schedule",
    extraction: "official_json",
    scheduleKind: "scraped_recurring",
  };
}

describe("scheduled speech boundary observer", () => {
  it("detects a named schedule change without inferring one from audio", async () => {
    const at = new Date("2026-09-04T19:00:20.000Z");
    const candidate = await detectScheduledBoundary(station, at, async (_id, _tz, instant) =>
      instant < new Date("2026-09-04T19:00:00.000Z")
        ? entry("Morning Music", "Alex")
        : entry("Noon Show", "Sam"));

    expect(candidate).toMatchObject({
      boundaryAt: new Date("2026-09-04T19:00:00.000Z"),
      previous: { showName: "Morning Music", djName: "Alex" },
      current: { showName: "Noon Show", djName: "Sam" },
    });
  });

  it("does not spend capture budget when the schedule identity is unchanged", async () => {
    await expect(detectScheduledBoundary(
      station,
      new Date("2026-09-04T19:00:20.000Z"),
      async () => entry("Noon Show", "Sam"),
    )).resolves.toBeNull();
  });

  it("treats a DJ substitution as a boundary even when the show name stays fixed", async () => {
    const at = new Date("2026-09-04T19:00:20.000Z");
    const candidate = await detectScheduledBoundary(station, at, async (_id, _tz, instant) =>
      instant < new Date("2026-09-04T19:00:00.000Z")
        ? entry("Noon Show", "Sam")
        : entry("Noon Show", "Guest Host"));
    expect(candidate?.previous?.djName).toBe("Sam");
    expect(candidate?.current.djName).toBe("Guest Host");
  });

  it("always revisits contradictions and sparsely checks stable schedules", () => {
    expect(shouldObserveScheduledBoundary("slot-a", {
      supporting: 20,
      contradictory: 1,
    })).toBe(true);
    expect(shouldObserveScheduledBoundary("slot-a", {
      supporting: 2,
      contradictory: 0,
    })).toBe(true);

    const stableDecisions = Array.from({ length: 100 }, (_, index) =>
      shouldObserveScheduledBoundary(`stable-slot-${index}`, {
        supporting: 20,
        contradictory: 0,
      }, 4));
    const sampled = stableDecisions.filter(Boolean).length;
    expect(sampled).toBeGreaterThan(10);
    expect(sampled).toBeLessThan(40);
  });
});