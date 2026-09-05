import { describe, expect, it } from "vitest";
import {
  deriveListenerBroadcastAdvisory,
  LISTENER_BROADCAST_ADVISORY_TTL_MS,
  buildIcyMetadataCandidate,
} from "../../src/lore/broadcast-timeline.js";

describe("listener broadcast advisory", () => {
  const occurredAt = new Date("2026-09-03T12:00:00.000Z");

  it("reduces private speech evidence to a bounded identity-free state", () => {
    expect(deriveListenerBroadcastAdvisory({
      capture: { outcome: "speech_over_music", occurredAt },
      now: new Date(occurredAt.getTime() + 1_000),
    })).toEqual({
      kind: "dj_speaking",
      observedAt: occurredAt.toISOString(),
      expiresAt: new Date(occurredAt.getTime() + LISTENER_BROADCAST_ADVISORY_TTL_MS).toISOString(),
    });
  });

  it("prefers newer resumption evidence and never predicts a track", () => {
    const resumptionAt = new Date(occurredAt.getTime() + 5_000);
    expect(deriveListenerBroadcastAdvisory({
      capture: { outcome: "speech", occurredAt },
      resumption: { occurredAt: resumptionAt },
      now: new Date(resumptionAt.getTime() + 1_000),
    })).toEqual({
      kind: "music_resuming",
      observedAt: resumptionAt.toISOString(),
      expiresAt: new Date(resumptionAt.getTime() + LISTENER_BROADCAST_ADVISORY_TTL_MS).toISOString(),
    });
  });

  it("clears on fresh contradictory metadata or expiry", () => {
    expect(deriveListenerBroadcastAdvisory({
      capture: { outcome: "speech", occurredAt },
      trackObservedAt: new Date(occurredAt.getTime() + 1),
      now: new Date(occurredAt.getTime() + 1_000),
    })).toBeNull();
    expect(deriveListenerBroadcastAdvisory({
      capture: { outcome: "speech", occurredAt },
      now: new Date(occurredAt.getTime() + LISTENER_BROADCAST_ADVISORY_TTL_MS),
    })).toBeNull();
  });
});

describe("ICY metadata candidate retention", () => {
  const observedAt = new Date("2026-09-05T12:07:31.000Z");

  it("retains unconfirmed program/person candidates in a stable time bucket", () => {
    expect(buildIcyMetadataCandidate(
      "Sounds of Survivance with Tory J",
      observedAt,
    )).toEqual({
      rawStreamTitle: "Sounds of Survivance with Tory J",
      candidateClass: "program_or_person",
      rejectionReason: "title_only",
      parsedArtist: null,
      parsedTitle: "Sounds of Survivance with Tory J",
      bucketStartedAt: new Date("2026-09-05T12:00:00.000Z"),
    });
  });

  it("never creates candidate records for tracks or blank metadata", () => {
    expect(buildIcyMetadataCandidate("Beck - Heart Is A Drum", observedAt)).toBeNull();
    expect(buildIcyMetadataCandidate("", observedAt)).toBeNull();
  });

  it("bounds retained raw metadata", () => {
    const candidate = buildIcyMetadataCandidate("x".repeat(3_000), observedAt);
    expect(candidate?.rawStreamTitle).toHaveLength(2_048);
  });
});