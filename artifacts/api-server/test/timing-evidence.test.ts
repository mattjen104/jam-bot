import { describe, expect, it } from "vitest";
import { normalizeTimingEvidence } from "../src/lore/timing-evidence.js";
import { estimateExpiry } from "../src/lore/expiry.js";

const start = new Date("2026-09-03T12:00:00.000Z");
const end = new Date("2026-09-03T12:00:08.000Z");

describe("normalizeTimingEvidence", () => {
  it("anchors a fingerprint offset to capture end while retaining the midpoint", () => {
    const timing = normalizeTimingEvidence({
      durationMs: 180_000,
      fingerprintOffsetMs: 64_000,
      captureStartedAt: start,
      captureEndedAt: end,
    });
    expect(timing.confidence).toBe("trusted");
    expect(timing.captureMidpointAt?.toISOString()).toBe("2026-09-03T12:00:04.000Z");
    expect(timing.estimatedAudibleStartedAt?.toISOString()).toBe("2026-09-03T11:59:04.000Z");
  });

  it("keeps the ACR expiry boundary on the provider's clip-end clock", () => {
    const timing = normalizeTimingEvidence({
      durationMs: 180_000,
      fingerprintOffsetMs: 64_000,
      captureStartedAt: start,
      captureEndedAt: end,
    });
    expect(estimateExpiry({
      durationMs: 180_000,
      playedAt: timing.estimatedAudibleStartedAt,
      playOffsetMs: 64_000,
      offsetCapturedAt: end,
      timestampKind: "fingerprint",
      timingUncertaintyMs: 3_000,
      now: new Date("2026-09-03T12:00:18.000Z"),
    })).toMatchObject({
      remainingMs: 106_000,
      positionSource: "fingerprint",
    });
  });

  it("never claims a position for identity-only recognition", () => {
    const timing = normalizeTimingEvidence({
      durationMs: 180_000,
      captureStartedAt: start,
      captureEndedAt: end,
    });
    expect(timing.confidence).toBe("unknown");
    expect(timing.estimatedAudibleStartedAt).toBeNull();
  });

  it("keeps metadata time distinct and uses lag only when stable", () => {
    const metadataObservedAt = new Date("2026-09-03T12:01:00.000Z");
    const timing = normalizeTimingEvidence({
      durationMs: 180_000,
      metadataObservedAt,
      metadataAudioLag: { meanMs: 4_000, standardDeviationMs: 500, samples: 5 },
    });
    expect(timing.metadataObservedAt).toBe(metadataObservedAt);
    expect(timing.metadataAudioLagMs).toBe(4_000);
    expect(timing.estimatedAudibleStartedAt?.toISOString()).toBe("2026-09-03T12:01:04.000Z");
    expect(timing.confidence).toBe("approximate");
  });

  it("rejects high-variance metadata-to-audio lag", () => {
    const timing = normalizeTimingEvidence({
      durationMs: 180_000,
      metadataObservedAt: start,
      metadataAudioLag: { meanMs: 4_000, standardDeviationMs: 8_000, samples: 8 },
    });
    expect(timing.metadataAudioLagMs).toBeNull();
    expect(timing.estimatedAudibleStartedAt).toEqual(start);
  });
});