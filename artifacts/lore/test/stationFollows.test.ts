// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  STATION_FOLLOWS_LS_KEY,
  __testOnlyResetStationFollows,
  followStation,
  readStationFollows,
} from "../src/lib/stationFollows";
import { useStationFollows } from "../src/hooks/useStationFollows";
import { __testOnlyResetAddedStations, addAddedStation, removeAddedStation, type AddedStation } from "../src/lib/addedStations";
import { rankFollowedStations } from "../src/pages/Following";

const personal: AddedStation = {
  radioBrowserUuid: "Radio-ID", name: "Personal", streamUrl: "https://example.test/live",
  streamFormat: "mp3", faviconUrl: null, state: null, country: null, tags: [],
  bitrate: null, codec: null, addedAt: "2026-01-01T00:00:00.000Z",
};

beforeEach(() => {
  localStorage.clear();
  __testOnlyResetStationFollows();
  __testOnlyResetAddedStations();
});

describe("station follows", () => {
  it("persists a versioned, normalized and deduplicated curated identity", () => {
    followStation(" KEXP ");
    followStation("kexp");
    expect([...readStationFollows()]).toEqual(["kexp"]);
    expect(JSON.parse(localStorage.getItem(STATION_FOLLOWS_LS_KEY) ?? "{}")).toEqual({
      version: 1, slugs: ["kexp"],
    });
  });

  it("defensively migrates legacy dial pins", () => {
    localStorage.setItem("lore:dialPins", JSON.stringify(["KEXP", 4, "", "kexp"]));
    __testOnlyResetStationFollows();
    expect([...readStationFollows()]).toEqual(["kexp"]);
    expect(JSON.parse(localStorage.getItem(STATION_FOLLOWS_LS_KEY) ?? "{}")).toEqual({
      version: 1, slugs: ["kexp"],
    });
  });

  it("adopts personal stations saved before the follow model existed", () => {
    localStorage.setItem("lore_added_stations", JSON.stringify([personal]));
    __testOnlyResetStationFollows();
    expect([...readStationFollows()]).toEqual(["rb-radio-id"]);
  });

  it("rejects malformed and unsupported follow records", () => {
    localStorage.setItem(STATION_FOLLOWS_LS_KEY, JSON.stringify({ version: 2, slugs: ["kexp"] }));
    __testOnlyResetStationFollows();
    expect([...readStationFollows()]).toEqual([]);
  });

  it("updates mounted hooks in the same tab", () => {
    const hook = renderHook(() => useStationFollows());
    act(() => hook.result.current.followStation("wfm-u"));
    expect(hook.result.current.isFollowing("WFM-U")).toBe(true);
  });

  it("re-reads follows written by another tab", () => {
    const hook = renderHook(() => useStationFollows());
    localStorage.setItem(STATION_FOLLOWS_LS_KEY, JSON.stringify({ version: 1, slugs: ["wfmu"] }));
    act(() => window.dispatchEvent(new StorageEvent("storage", { key: STATION_FOLLOWS_LS_KEY })));
    expect(hook.result.current.isFollowing("wfmu")).toBe(true);
  });

  it("adding a personal station follows it and removing it unfollows it", () => {
    addAddedStation(personal);
    expect(readStationFollows().has("rb-radio-id")).toBe(true);
    removeAddedStation("Radio-ID");
    expect(readStationFollows().has("rb-radio-id")).toBe(false);
  });

  it("filtering by follows retains a quiet station", () => {
    followStation("quiet");
    const rows = [{ slug: "quiet", liveTrack: null }, { slug: "loud", liveTrack: { title: "song" } }];
    expect(rows.filter((row) => readStationFollows().has(row.slug)).map((row) => row.slug)).toEqual(["quiet"]);
  });

  it("promotes live followed stations without dropping quiet or unplayable stations", () => {
    const rows = [
      { isLive: false, station: { name: "Quiet FM", streamUrl: null } },
      { isLive: true, station: { name: "Live FM", streamUrl: "https://example.test/live" } },
      { isLive: false, station: { name: "Unavailable FM", streamUrl: null } },
    ];
    expect(rankFollowedStations(rows).map((row) => row.station.name)).toEqual([
      "Live FM",
      "Quiet FM",
      "Unavailable FM",
    ]);
  });
});