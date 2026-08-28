import { describe, expect, it } from "vitest";
import { currentLocalDayWindow } from "../src/routes/me/attendance.js";

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
});