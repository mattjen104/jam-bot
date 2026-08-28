import { describe, expect, it } from "vitest";
import {
  currentLocalDayWindow,
  localDayWindow,
} from "../src/routes/me/attendance.js";

describe("currentLocalDayWindow", () => {
  it("uses the listener timezone rather than the server timezone", () => {
    const now = new Date("2026-08-28T04:00:00.000Z");
    const window = currentLocalDayWindow("America/Los_Angeles", now);

    expect(window.day).toBe("2026-08-27");
    expect(window.start.toISOString()).toBe("2026-08-27T07:00:00.000Z");
    expect(window.end.toISOString()).toBe("2026-08-28T07:00:00.000Z");
  });

  it("keeps a daylight-saving transition at local midnight boundaries", () => {
    const now = new Date("2026-11-01T20:00:00.000Z");
    const window = currentLocalDayWindow("America/New_York", now);

    expect(window.day).toBe("2026-11-01");
    expect(window.start.toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(window.end.toISOString()).toBe("2026-11-02T05:00:00.000Z");
  });

  it("computes an explicitly requested earlier local date", () => {
    const window = localDayWindow(
      "America/Los_Angeles",
      "2026-08-20",
      new Date("2026-08-28T04:00:00.000Z"),
    );

    expect(window.day).toBe("2026-08-20");
    expect(window.start.toISOString()).toBe("2026-08-20T07:00:00.000Z");
    expect(window.end.toISOString()).toBe("2026-08-21T07:00:00.000Z");
  });

  it("keeps a requested DST transition day bounded by its two local midnights", () => {
    const window = localDayWindow(
      "America/New_York",
      "2026-11-01",
    );

    expect(window.start.toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(window.end.toISOString()).toBe("2026-11-02T05:00:00.000Z");
  });

  it("rejects impossible calendar dates instead of normalizing them", () => {
    expect(() => localDayWindow("UTC", "2026-02-30")).toThrow(
      'Invalid local calendar date: "2026-02-30"',
    );
  });
});