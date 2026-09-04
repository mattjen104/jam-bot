// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  classifyScheduleCoverage,
  countScheduleFailures,
  parseCoverageArgs,
  selectUnclassifiedRefreshCandidates,
} from "../../src/scripts/audit-schedule-coverage.js";

describe("all-Lore schedule coverage audit", () => {
  it("is read-only by default and validates bounded refresh arguments", () => {
    expect(parseCoverageArgs([])).toEqual({
      refresh: false,
      includeHidden: false,
      limit: null,
      afterId: 0,
      write: false,
    });
    expect(parseCoverageArgs([
      "--refresh",
      "--include-hidden",
      "--limit=25",
      "--after-id=50",
      "--write",
    ])).toEqual({
      refresh: true,
      includeHidden: true,
      limit: 25,
      afterId: 50,
      write: true,
    });
    expect(() => parseCoverageArgs(["--limit=0"])).toThrow(
      "--limit must be a positive integer",
    );
    expect(() => parseCoverageArgs(["--after-id=-1"])).toThrow(
      "--after-id must be a non-negative integer",
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

  it("groups failed attempts by their durable reason", () => {
    expect(countScheduleFailures([
      { scheduleFailureReason: "policy_blocked" },
      { scheduleFailureReason: "transient_fetch" },
      { scheduleFailureReason: "transient_fetch" },
      { scheduleFailureReason: null },
    ])).toMatchObject({
      policy_blocked: 1,
      transient_fetch: 2,
      source_unavailable: 0,
      unclassified: 1,
    });
  });

  it("refreshes only bounded, resumable unclassified failures", () => {
    const rows = [
      { id: 9, schedule: { status: "attempted_without_success" as const, failureReason: null } },
      { id: 4, schedule: { status: "attempted_without_success" as const, failureReason: null } },
      { id: 7, schedule: { status: "attempted_without_success" as const, failureReason: "transient_fetch" as const } },
      { id: 8, schedule: { status: "never_attempted" as const, failureReason: null } },
      { id: 10, schedule: { status: "valid_empty" as const, failureReason: null } },
      { id: 12, schedule: { status: "attempted_without_success" as const, failureReason: null } },
    ];

    expect(selectUnclassifiedRefreshCandidates(rows, 5, 2).map((row) => row.id))
      .toEqual([9, 12]);
  });
});