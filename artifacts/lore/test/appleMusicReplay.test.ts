import { describe, expect, it } from "vitest";
import {
  buildAppleMusicQueue,
  canPlayAppleMusic,
  describeMusicKitError,
  eventTrackId,
} from "../src/lib/appleMusicReplay";
import type { AppleMusicReplayMaterialization } from "@workspace/api-client-react";

function materialization(
  overrides: Partial<AppleMusicReplayMaterialization> = {},
): AppleMusicReplayMaterialization {
  return {
    configured: true,
    developerToken: "short-lived-token",
    appName: "Lore",
    apiBase: "https://api.music.apple.com",
    storefront: "us",
    replayId: 7,
    entries: [
      {
        position: 0,
        spinId: 10,
        recordingMbid: "first",
        rawArtist: "First artist",
        rawTitle: "First title",
        title: "First title",
        artist: "First artist",
        appleMusicId: "100",
        url: "https://music.apple.com/us/song/first/100",
        status: "available",
        reason: null,
      },
      {
        position: 1,
        spinId: 11,
        recordingMbid: null,
        rawArtist: "Unknown",
        rawTitle: "Unknown",
        title: "Unknown",
        artist: "Unknown",
        appleMusicId: null,
        url: null,
        status: "unresolved",
        reason: "unresolved",
      },
      {
        position: 2,
        spinId: 12,
        recordingMbid: "dead",
        rawArtist: "Dead artist",
        rawTitle: "Dead title",
        title: "Dead title",
        artist: "Dead artist",
        appleMusicId: null,
        url: null,
        status: "dead",
        reason: "dead_link",
      },
      {
        position: 3,
        spinId: 13,
        recordingMbid: "last",
        rawArtist: "Last artist",
        rawTitle: "Last title",
        title: "Last title",
        artist: "Last artist",
        appleMusicId: "300",
        url: "https://music.apple.com/us/song/last/300",
        status: "available",
        reason: null,
      },
    ],
    coverage: { total: 4, available: 2, unavailable: 0, unresolved: 1, dead: 1 },
    ...overrides,
  };
}

describe("Apple Music replay materialization helpers", () => {
  it("builds an exact-ID queue in manifest order without changing the receipt", () => {
    const receipt = materialization();
    const before = structuredClone(receipt);
    const queue = buildAppleMusicQueue(receipt);

    expect(queue.ids).toEqual(["100", "300"]);
    expect(queue.entries.map((entry) => entry.position)).toEqual([0, 3]);
    expect(receipt).toEqual(before);
  });

  it("requires server configuration, a token, and at least one available entry", () => {
    expect(canPlayAppleMusic(materialization())).toBe(true);
    expect(canPlayAppleMusic(materialization({ configured: false }))).toBe(false);
    expect(canPlayAppleMusic(materialization({ developerToken: null }))).toBe(false);
    expect(
      canPlayAppleMusic(materialization({
        coverage: { total: 4, available: 0, unavailable: 2, unresolved: 1, dead: 1 },
        entries: materialization().entries.map((entry) => ({
          ...entry,
          status: entry.status === "available" ? "unavailable" : entry.status,
          appleMusicId: null,
        })),
      })),
    ).toBe(false);
  });

  it("classifies authorization, subscription, and provider failures for the UI", () => {
    expect(describeMusicKitError(new Error("User cancelled authorization")).kind).toBe(
      "authorization-cancelled",
    );
    expect(describeMusicKitError(new Error("not entitled to play")).kind).toBe(
      "subscription-required",
    );
    expect(describeMusicKitError(new Error("network failure")).kind).toBe("provider");
  });

  it("reads track IDs from MusicKit item-change payloads", () => {
    expect(eventTrackId({ item: { id: "123" } })).toBe("123");
    expect(eventTrackId({ songId: "456" })).toBe("456");
    expect(eventTrackId({ item: { title: "no id" } })).toBeNull();
  });
});