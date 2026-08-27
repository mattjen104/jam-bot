import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseSpotifyAddedAt,
  SpotifyConnector,
} from "../src/lore/serviceConnector.js";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe("Spotify saved-track source dates", () => {
  it("canonicalizes valid dates and rejects absent or malformed values", () => {
    expect(parseSpotifyAddedAt("2019-04-05T12:34:56Z")).toBe("2019-04-05T12:34:56.000Z");
    expect(parseSpotifyAddedAt(undefined)).toBeUndefined();
    expect(parseSpotifyAddedAt("")).toBeUndefined();
    expect(parseSpotifyAddedAt("not-a-date")).toBeUndefined();
  });

  it("keeps each valid added_at and omits invalid source dates", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      items: [
        {
          added_at: "2019-04-05T12:34:56Z",
          track: {
            id: "valid-2019",
            name: "Old Like",
            duration_ms: 180_000,
            artists: [{ name: "Archive Artist" }],
          },
        },
        {
          added_at: "2024-08-09T01:02:03.456Z",
          track: {
            id: "valid-2024",
            name: "New Like",
            duration_ms: 181_000,
            artists: [{ name: "Archive Artist" }],
          },
        },
        {
          track: {
            id: "missing-date",
            name: "Missing Date",
            duration_ms: 182_000,
            artists: [{ name: "Archive Artist" }],
          },
        },
        {
          added_at: "malformed",
          track: {
            id: "bad-date",
            name: "Bad Date",
            duration_ms: 183_000,
            artists: [{ name: "Archive Artist" }],
          },
        },
      ],
      next: null,
      offset: 0,
      total: 4,
    }), { status: 200 })) as typeof fetch;

    const tracks = [];
    for await (const track of new SpotifyConnector().importLibrary("token")) {
      tracks.push(track);
    }

    expect(tracks.map(({ externalId, addedAt }) => ({ externalId, addedAt }))).toEqual([
      { externalId: "valid-2019", addedAt: "2019-04-05T12:34:56.000Z" },
      { externalId: "valid-2024", addedAt: "2024-08-09T01:02:03.456Z" },
      { externalId: "missing-date", addedAt: undefined },
      { externalId: "bad-date", addedAt: undefined },
    ]);
  });
});