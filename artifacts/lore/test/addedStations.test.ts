// @vitest-environment jsdom
/**
 * useAddedStations / addedStations store — the listener's device-local
 * personal station list (Station Finder pins).
 *
 * Covers:
 *   - add / remove / dedup-by-uuid semantics and localStorage persistence
 *   - corrupted or malformed storage degrading to an empty list
 *   - shared state across hook instances (single source of truth)
 *   - addedStationToStation: negative stable id, rb- slug, category mapping
 *   - streamFormatForCodec / qualityLabel / categoryForTags mapping rules
 */
import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  ADDED_STATIONS_LS_KEY,
  __testOnlyResetAddedStations,
  addedStationToStation,
  qualityLabel,
  streamFormatForCodec,
  type AddedStation,
} from "../src/lib/addedStations";
import { categoryForTags } from "../src/lib/dialCategories";
import { useAddedStations } from "../src/hooks/useAddedStations";

function makeStation(overrides: Partial<AddedStation> = {}): AddedStation {
  return {
    radioBrowserUuid: "uuid-1",
    name: "WTEST",
    streamUrl: "https://stream.example.com/wtest",
    streamFormat: "aac",
    faviconUrl: null,
    state: "California",
    country: "United States",
    tags: ["jazz"],
    bitrate: 128,
    codec: "AAC",
    addedAt: "2026-08-17T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  __testOnlyResetAddedStations();
});

describe("useAddedStations", () => {
  it("starts empty", () => {
    const { result } = renderHook(() => useAddedStations());
    expect(result.current.addedStations).toEqual([]);
    expect(result.current.isAdded("uuid-1")).toBe(false);
  });

  it("addStation appends and persists to localStorage", () => {
    const { result } = renderHook(() => useAddedStations());
    act(() => result.current.addStation(makeStation()));

    expect(result.current.addedStations).toHaveLength(1);
    expect(result.current.addedStations[0].name).toBe("WTEST");
    expect(result.current.isAdded("uuid-1")).toBe(true);

    const stored = JSON.parse(localStorage.getItem(ADDED_STATIONS_LS_KEY) ?? "null");
    expect(stored).toHaveLength(1);
    expect(stored[0].radioBrowserUuid).toBe("uuid-1");
  });

  it("addStation deduplicates by radioBrowserUuid", () => {
    const { result } = renderHook(() => useAddedStations());
    act(() => result.current.addStation(makeStation()));
    act(() => result.current.addStation(makeStation({ name: "WTEST renamed" })));

    expect(result.current.addedStations).toHaveLength(1);
    // The first write wins — no silent overwrite.
    expect(result.current.addedStations[0].name).toBe("WTEST");
  });

  it("removeStation removes by uuid and is a no-op for unknown uuids", () => {
    const { result } = renderHook(() => useAddedStations());
    act(() => result.current.addStation(makeStation()));
    act(() => result.current.addStation(makeStation({ radioBrowserUuid: "uuid-2", name: "KOTHER" })));

    act(() => result.current.removeStation("uuid-1"));
    expect(result.current.addedStations.map((s) => s.radioBrowserUuid)).toEqual(["uuid-2"]);
    expect(result.current.isAdded("uuid-1")).toBe(false);
    expect(localStorage.getItem(ADDED_STATIONS_LS_KEY)).toContain("uuid-2");
    expect(localStorage.getItem(ADDED_STATIONS_LS_KEY)).not.toContain("uuid-1");

    act(() => result.current.removeStation("uuid-nope"));
    expect(result.current.addedStations).toHaveLength(1);
  });

  it("shares one store across hook instances (sheet + dial stay in sync)", () => {
    const a = renderHook(() => useAddedStations());
    const b = renderHook(() => useAddedStations());

    act(() => a.result.current.addStation(makeStation()));

    expect(b.result.current.addedStations).toHaveLength(1);
    expect(b.result.current.isAdded("uuid-1")).toBe(true);
  });

  it("survives a reload: a fresh store read restores persisted stations", () => {
    const { result } = renderHook(() => useAddedStations());
    act(() => result.current.addStation(makeStation()));

    // Simulate a reload: drop the in-memory cache, keep localStorage.
    __testOnlyResetAddedStations();
    const fresh = renderHook(() => useAddedStations());
    expect(fresh.result.current.addedStations).toHaveLength(1);
    expect(fresh.result.current.addedStations[0].name).toBe("WTEST");
  });

  it("degrades to an empty list on corrupted or malformed storage", () => {
    localStorage.setItem(ADDED_STATIONS_LS_KEY, "{not json");
    __testOnlyResetAddedStations();
    const a = renderHook(() => useAddedStations());
    expect(a.result.current.addedStations).toEqual([]);

    localStorage.setItem(ADDED_STATIONS_LS_KEY, JSON.stringify([{ nope: true }, makeStation()]));
    __testOnlyResetAddedStations();
    const b = renderHook(() => useAddedStations());
    expect(b.result.current.addedStations).toHaveLength(1);
  });
});

describe("addedStationToStation", () => {
  it("adapts to the Station shape with a negative id and rb- slug", () => {
    const s = addedStationToStation(makeStation());

    expect(s.slug).toBe("rb-uuid-1");
    expect(s.id).toBeLessThan(0);
    // Stable across calls — scan-skip and presence identity depend on it.
    expect(addedStationToStation(makeStation()).id).toBe(s.id);
    expect(s.streamUrl).toBe("https://stream.example.com/wtest");
    expect(s.streamFormat).toBe("aac");
    expect(s.streamQuality).toBe("128kbps AAC");
    expect(s.logoUrl).toBeNull();
    expect(s.mode).toBe("live");
    expect(s.attribution).toBe(true);
    expect(s.upcomingShowCount).toBe(0);
    expect(s.relayUrl).toBeNull();
  });

  it("maps Radio Browser tags onto editorial station categories", () => {
    expect(addedStationToStation(makeStation({ tags: ["Jazz", "Fusion"] })).stationCategories).toEqual(["specialist"]);
    expect(addedStationToStation(makeStation({ tags: ["xyzzy"] })).stationCategories).toEqual([]);
  });

  it("emits null tags (not an empty array) when the station has none", () => {
    expect(addedStationToStation(makeStation({ tags: [] })).tags).toBeNull();
  });
});

describe("streamFormatForCodec", () => {
  it("maps common Radio Browser codecs to player hints", () => {
    expect(streamFormatForCodec("MP3", "https://x/s")).toBe("mp3");
    expect(streamFormatForCodec("AAC+", "https://x/s")).toBe("aac");
    expect(streamFormatForCodec("FLAC", "https://x/s")).toBe("flac");
    expect(streamFormatForCodec("OGG", "https://x/s")).toBe("ogg");
    expect(streamFormatForCodec(null, "https://x/s")).toBe("mp3");
  });

  it("detects HLS from the URL regardless of codec", () => {
    expect(streamFormatForCodec(null, "https://x/live.m3u8")).toBe("hls");
  });
});

describe("qualityLabel", () => {
  it("joins bitrate and codec, or returns null when both are unknown", () => {
    expect(qualityLabel(128, "MP3")).toBe("128kbps MP3");
    expect(qualityLabel(null, "AAC")).toBe("AAC");
    expect(qualityLabel(64, null)).toBe("64kbps");
    expect(qualityLabel(null, null)).toBeNull();
    expect(qualityLabel(0, null)).toBeNull();
  });
});

describe("categoryForTags", () => {
  it("maps tags in taxonomy-precedence order (first match wins)", () => {
    expect(categoryForTags(["ambient", "jazz"])).toEqual(["ambient"]);
    expect(categoryForTags(["university", "jazz"])).toEqual(["campus"]);
    expect(categoryForTags(["jazz"])).toEqual(["specialist"]);
    expect(categoryForTags(["community"])).toEqual(["public"]);
    expect(categoryForTags(["freeform"])).toEqual(["indie"]);
  });

  it("never assigns anchor and uses no fallback for unmatched tags", () => {
    expect(categoryForTags(["xyzzy", "qqq"])).toEqual([]);
    expect(categoryForTags([])).toEqual([]);
    expect(categoryForTags(["eclectic", "variety"])).toEqual(["indie"]);
  });
});
