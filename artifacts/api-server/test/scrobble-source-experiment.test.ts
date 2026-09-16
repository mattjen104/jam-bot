import { describe, expect, it } from "vitest";
import {
  modelFleetCost,
  isPrivateExperimentIp,
  parseLastFmRecentTracks,
  parseRockskyActorScrobbles,
  parseRockskyStatus,
  summarizeExperiment,
  tracksAgree,
  type ExperimentObservation,
} from "../src/lore/scrobble-source-experiment.js";

describe("scrobble source experiment parsers", () => {
  it("rejects loopback, private, link-local, and mapped private addresses", () => {
    expect(isPrivateExperimentIp("127.0.0.1")).toBe(true);
    expect(isPrivateExperimentIp("10.20.30.40")).toBe(true);
    expect(isPrivateExperimentIp("169.254.169.254")).toBe(true);
    expect(isPrivateExperimentIp("::1")).toBe(true);
    expect(isPrivateExperimentIp("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateExperimentIp("1.1.1.1")).toBe(false);
  });

  it("distinguishes Last.fm now-playing rows from completed scrobbles", () => {
    expect(
      parseLastFmRecentTracks({
        recenttracks: {
          track: [{ name: "Morning", artist: { "#text": "Beck" }, "@attr": { nowplaying: "true" } }],
        },
      }),
    ).toMatchObject({
      current: true,
      nowPlaying: { rawArtist: "Beck", rawTitle: "Morning" },
    });
    expect(
      parseLastFmRecentTracks({
        recenttracks: {
          track: [{ name: "Morning", artist: { "#text": "Beck" }, date: { uts: "1700000000" } }],
        },
      }),
    ).toMatchObject({ current: false, providerAt: "2023-11-14T22:13:20.000Z" });
  });

  it("treats Rocksky scrobbles as history, never current", () => {
    expect(
      parseRockskyActorScrobbles({
        scrobbles: [{ artist: "Angela Aki", title: "This Love", createdAt: "2026-09-11T02:29:28.857Z" }],
      }),
    ).toEqual({
      nowPlaying: { rawArtist: "Angela Aki", rawTitle: "This Love" },
      current: false,
      providerAt: "2026-09-11T02:29:28.857Z",
    });
  });

  it("honors Rocksky status expiry", () => {
    const body = {
      value: {
        track: { artist: "Beck", title: "Morning" },
        startedAt: "2026-09-16T05:00:00.000Z",
        expiresAt: "2026-09-16T05:04:00.000Z",
      },
    };
    expect(parseRockskyStatus(body, new Date("2026-09-16T05:03:00.000Z")).current).toBe(true);
    expect(parseRockskyStatus(body, new Date("2026-09-16T05:05:00.000Z")).current).toBe(false);
  });
});

describe("scrobble experiment comparison and cost", () => {
  it("normalizes punctuation and case for exact artist/title agreement", () => {
    expect(
      tracksAgree(
        { rawArtist: "Beyoncé", rawTitle: "BREAK MY SOUL" },
        { rawArtist: "beyonce", rawTitle: "Break My Soul" },
      ),
    ).toBe(true);
    expect(
      tracksAgree(
        { rawArtist: "Beck", rawTitle: "Morning" },
        { rawArtist: "Beck", rawTitle: "Loser" },
      ),
    ).toBe(false);
    expect(tracksAgree(null, { rawArtist: "Beck", rawTitle: "Morning" })).toBeNull();
  });

  it("aggregates bytes and agreement without any ingestion dependency", () => {
    const base = {
      schemaVersion: 1 as const,
      stationSlug: "test",
      identityConfidence: "candidate" as const,
      sampleId: 1,
      observedAt: "2026-09-16T05:03:30.000Z",
      current: true,
      elapsedMs: 10,
      httpStatus: 200,
    };
    const rows: ExperimentObservation[] = [
      { ...base, source: "icy", nowPlaying: { rawArtist: "Beck", rawTitle: "Morning" }, requestBytes: 0 },
      { ...base, source: "lastfm", nowPlaying: { rawArtist: "Beck", rawTitle: "Morning" }, requestBytes: 900 },
    ];
    expect(summarizeExperiment(rows)).toMatchObject({
      observations: 2,
      usable: 2,
      agreements: 1,
      disagreements: 0,
      bytesBySource: { icy: 0, lastfm: 900 },
    });
  });

  it("never compares completed history or expired status with live ICY", () => {
    const base = {
      schemaVersion: 1 as const,
      sampleId: 1,
      stationSlug: "test",
      identityConfidence: "candidate" as const,
      observedAt: "2026-09-16T05:03:30.000Z",
      elapsedMs: 10,
      requestBytes: 100,
      nowPlaying: { rawArtist: "Beck", rawTitle: "Morning" },
    };
    const rows: ExperimentObservation[] = [
      { ...base, source: "icy", current: true },
      { ...base, source: "rocksky_history", current: false },
      {
        ...base,
        source: "rocksky_status",
        current: false,
        expiresAt: "2026-09-16T05:02:00.000Z",
      },
    ];
    expect(summarizeExperiment(rows)).toMatchObject({
      agreements: 0,
      disagreements: 0,
      incomparable: 2,
    });
  });

  it("models fleet request and measured transfer costs", () => {
    expect(modelFleetCost(1_000, 60, 1_000)).toEqual({
      requestsPerDay: 1_440_000,
      requestsPerSecond: 1_000 / 60,
      bytesPerDay: 1_440_000_000,
    });
  });
});