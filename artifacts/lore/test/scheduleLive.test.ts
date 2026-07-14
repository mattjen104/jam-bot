import { describe, it, expect } from "vitest";
import {
  toMinutes,
  isSlotLive,
  isOvernightCarryoverLive,
} from "../src/lib/scheduleLive";

const t = (hhmm: string) => toMinutes(hhmm)!;

describe("toMinutes", () => {
  it("parses HH:MM", () => {
    expect(toMinutes("00:00")).toBe(0);
    expect(toMinutes("23:30")).toBe(1410);
    expect(toMinutes("5:15")).toBe(315);
  });
  it("returns null on garbage", () => {
    expect(toMinutes("")).toBeNull();
    expect(toMinutes("noon")).toBeNull();
    expect(toMinutes("12")).toBeNull();
  });
});

describe("isSlotLive", () => {
  it("is live inside a normal slot, not outside", () => {
    expect(isSlotLive("10:00", "12:00", t("11:00"))).toBe(true);
    expect(isSlotLive("10:00", "12:00", t("12:00"))).toBe(false);
    expect(isSlotLive("10:00", "12:00", t("09:59"))).toBe(false);
  });
  it("treats a null end as a 60-minute block", () => {
    expect(isSlotLive("10:00", null, t("10:30"))).toBe(true);
    expect(isSlotLive("10:00", null, t("11:00"))).toBe(false);
  });
  it("midnight-crossing slot is live until midnight on its own day", () => {
    // 23:00–02:00 at 23:30 → live
    expect(isSlotLive("23:00", "02:00", t("23:30"))).toBe(true);
    // at 22:59 → not yet
    expect(isSlotLive("23:00", "02:00", t("22:59"))).toBe(false);
  });
  it("does NOT report the post-midnight tail (that's carryover's job)", () => {
    // 23:00–02:00 at 00:30 evaluated against the same day's row → false
    expect(isSlotLive("23:00", "02:00", t("00:30"))).toBe(false);
  });
});

describe("isOvernightCarryoverLive", () => {
  it("yesterday's 23:00–02:00 is live at 00:30 and 01:59, off at 02:00", () => {
    expect(isOvernightCarryoverLive("23:00", "02:00", t("00:30"))).toBe(true);
    expect(isOvernightCarryoverLive("23:00", "02:00", t("01:59"))).toBe(true);
    expect(isOvernightCarryoverLive("23:00", "02:00", t("02:00"))).toBe(false);
  });
  it("a normal daytime slot never carries over", () => {
    expect(isOvernightCarryoverLive("10:00", "12:00", t("00:30"))).toBe(false);
    expect(isOvernightCarryoverLive("10:00", "12:00", t("11:00"))).toBe(false);
  });
  it("null-end slot starting 23:30 carries its implied hour to 00:30", () => {
    expect(isOvernightCarryoverLive("23:30", null, t("00:15"))).toBe(true);
    expect(isOvernightCarryoverLive("23:30", null, t("00:30"))).toBe(false);
  });
  it("null-end slot fully inside the day does not carry over", () => {
    expect(isOvernightCarryoverLive("22:00", null, t("00:10"))).toBe(false);
  });
  it("returns false on unparseable start", () => {
    expect(isOvernightCarryoverLive("late", "02:00", t("00:30"))).toBe(false);
  });
});
