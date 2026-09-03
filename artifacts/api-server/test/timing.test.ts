import { describe, expect, it } from "vitest";
import {
  FINGERPRINT_UNCERTAINTY_MS,
  INFERRED_START_UNCERTAINTY_MS,
  SOURCE_START_UNCERTAINTY_MS,
  timingConfidence,
  timingFromRaw,
  timingFromStoredRow,
} from "../src/lore/timing.js";

const START = new Date("2026-09-03T12:00:00.000Z");

describe("now-playing timing contract", () => {
  it("marks a station-declared start with a bounded source uncertainty", () => {
    expect(timingFromRaw({ playedAt: START })).toEqual({
      timestampKind: "source",
      timingReason: "station_declared_start",
      timingUncertaintyMs: SOURCE_START_UNCERTAINTY_MS,
      sourceStartedAt: START,
    });
  });

  it("prefers a fingerprint offset over a playedAt compatibility value", () => {
    const timing = timingFromRaw({
      playedAt: START,
      playOffsetMs: 42_000,
      offsetCapturedAt: new Date(START.getTime() + 42_000),
    });
    expect(timing).toMatchObject({
      timestampKind: "fingerprint",
      timingReason: "fingerprint_play_offset",
      timingUncertaintyMs: FINGERPRINT_UNCERTAINTY_MS,
      sourceStartedAt: null,
    });
    expect(timingConfidence(timing)).toBe("trusted");
  });

  it("labels explicitly inferred starts approximate", () => {
    const timing = timingFromRaw({ playedAt: START, timingKind: "inferred" });
    expect(timing).toMatchObject({
      timestampKind: "inferred",
      timingReason: "inferred_start",
      timingUncertaintyMs: INFERRED_START_UNCERTAINTY_MS,
    });
    expect(timingConfidence(timing)).toBe("estimated");
  });

  it("keeps receipt-only observations out of countdowns", () => {
    const timing = timingFromRaw({});
    expect(timing).toEqual({
      timestampKind: "receipt",
      timingReason: "receipt_only",
      timingUncertaintyMs: null,
      sourceStartedAt: null,
    });
    expect(timingConfidence(timing)).toBe("unknown");
  });

  it("downgrades legacy playedAt rows rather than trusting unknown provenance", () => {
    expect(timingFromStoredRow({ playedAt: START })).toMatchObject({
      timestampKind: "inferred",
      timingReason: "inferred_start",
      timingUncertaintyMs: INFERRED_START_UNCERTAINTY_MS,
    });
  });
});