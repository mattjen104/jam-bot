// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  classifyScheduleCoverage,
  parseCoverageArgs,
} from "../../src/scripts/audit-schedule-coverage.js";

describe("all-Lore schedule coverage audit", () => {
  it("is read-only by default and validates bounded refresh arguments", () => {
    expect(parseCoverageArgs([])).toEqual({
      refresh: false,
      includeHidden: false,
      limit: null,
      offset: 0,
      write: false,
    });
    expect(parseCoverageArgs([
      "--refresh",
      "--include-hidden",
      "--limit=25",
      "--offset=50",
      "--write",
    ])).toEqual({
      refresh: true,
      includeHidden: true,
      limit: 25,
      offset: 50,
      write: true,
    });
    expect(() => parseCoverageArgs(["--limit=0"])).toThrow(
      "--limit must be a positive integer",
    );
    expect(() => parseCoverageArgs(["--offset=-1"])).toThrow(
      "--offset must be a non-negative integer",
    );
  });

  it("distinguishes successful empty schedules from failed and untried stations", () => {
    const now = new Date("2026-09-04T00:00:00Z");
    expect(classifyScheduleCoverage(0, null, null, now)).toBe("never_attempted");
    expect(classifyScheduleCoverage(
      0,
      null,
      new Date("2026-09-03T00:00:00Z"),
      now,
    )).toBe("attempted_without_success");
    expect(classifyScheduleCoverage(
      0,
      new Date("2026-09-03T00:00:00Z"),
      new Date("2026-09-03T00:00:00Z"),
      now,
    )).toBe("valid_empty");
  });

  it("separates current and stale populated schedules", () => {
    const now = new Date("2026-09-30T00:00:00Z");
    expect(classifyScheduleCoverage(
      1,
      new Date("2026-09-20T00:00:00Z"),
      new Date("2026-09-20T00:00:00Z"),
      now,
    )).toBe("populated_current");
    expect(classifyScheduleCoverage(
      1,
      new Date("2026-09-01T00:00:00Z"),
      new Date("2026-09-01T00:00:00Z"),
      now,
    )).toBe("populated_stale");
  });
});