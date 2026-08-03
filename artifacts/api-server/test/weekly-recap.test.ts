import { describe, expect, it } from "vitest";
import { getCompletedWeekWindow } from "../src/lore/weekly-recap.js";

describe("weekly recap completed-week boundary", () => {
  it("returns the prior Sunday-to-Saturday window on Sunday", () => {
    const window = getCompletedWeekWindow(new Date("2026-08-09T00:00:00.000Z"));

    expect(window).toMatchObject({
      startDate: "2026-08-02",
      endDate: "2026-08-08",
      timezone: "UTC",
    });
    expect(window?.end.toISOString()).toBe("2026-08-09T00:00:00.000Z");
  });

  it("does not present the current Sunday-to-Saturday window before it completes", () => {
    expect(getCompletedWeekWindow(new Date("2026-08-08T23:59:59.999Z"))).toMatchObject({
      startDate: "2026-07-26",
      endDate: "2026-08-01",
    });
    expect(getCompletedWeekWindow(new Date("2026-08-09T12:00:00.000Z"))).toMatchObject({
      startDate: "2026-08-02",
      endDate: "2026-08-08",
    });
  });

  it("accepts only completed Sunday starts for explicit lookup", () => {
    expect(getCompletedWeekWindow(
      new Date("2026-08-10T12:00:00.000Z"),
      "2026-08-02",
    )).toMatchObject({
      startDate: "2026-08-02",
      endDate: "2026-08-08",
    });
    expect(getCompletedWeekWindow(
      new Date("2026-08-10T12:00:00.000Z"),
      "2026-08-03",
    )).toBeNull();
    expect(getCompletedWeekWindow(
      new Date("2026-08-05T12:00:00.000Z"),
      "2026-08-09",
    )).toBeNull();
  });
});