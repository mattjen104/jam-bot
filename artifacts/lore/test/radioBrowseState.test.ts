// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from "vitest";
import {
  createRadioBrowseState,
  focusForYou,
  paginateRadioDeck,
  parseRadioBrowseUrl,
  radioBrowseProvenance,
  rankRadioBrowseStations,
  resetRadioBrowseState,
  serializeRadioBrowseUrl,
  toggleRadioFilter,
  type RadioBrowseStation,
} from "../src/lib/radioBrowseState";

const station = (overrides: Partial<RadioBrowseStation>): RadioBrowseStation => ({
  slug: "station",
  name: "Station",
  playable: true,
  ...overrides,
});

describe("radio browse state", () => {
  beforeEach(() => localStorage.clear());

  it("has one exclusive lens and replaces its contextual sort", () => {
    const state = createRadioBrowseState({ locality: { zip: "02139" } });
    const next = focusForYou({ ...state, sort: "nearest" }, "Stereolab");
    expect(next.lens).toBe("for-you");
    expect(next.focusedArtist).toBe("Stereolab");
    expect(next.page).toBe(1);
  });

  it("validates artist focus while keeping it in the For You lens", () => {
    const next = focusForYou(createRadioBrowseState(), "  Broadcast\u0000  Radio  ");
    expect(next.lens).toBe("for-you");
    expect(next.focusedArtist).toBe("Broadcast Radio");
    expect(focusForYou(next, " \n\t " ).focusedArtist).toBeNull();
  });

  it("round trips URL filters without putting device-local location in the URL", () => {
    const state = {
      ...createRadioBrowseState({ locality: { zip: "02139" } }),
      lens: "all" as const,
      filters: {
        ...createRadioBrowseState().filters,
        stationTypes: ["specialist" as const],
        decades: ["1980s" as const],
        playingNow: ["deep" as const],
      },
    };
    const parsed = parseRadioBrowseUrl(serializeRadioBrowseUrl(state));
    expect(parsed.lens).toBe("all");
    expect(serializeRadioBrowseUrl(state)).not.toContain("02139");
    expect(parsed.filters?.decades).toEqual(["1980s"]);
    expect(parsed.filters?.playingNow).toEqual(["deep"]);
  });

  it("uses OR within a family and AND between families", () => {
    const filters = createRadioBrowseState().filters;
    expect(toggleRadioFilter(["specialist", "campus"], "campus")).toEqual(["specialist"]);
    const state = {
      ...createRadioBrowseState(),
      filters: { ...filters, stationTypes: ["specialist" as const], decades: ["1980s" as const] },
    };
    const ordered = rankRadioBrowseStations([
      station({ slug: "tagged", name: "Tagged", stationTypes: ["specialist"], decadeTags: ["1980s"] }),
      station({ slug: "wrong-era", name: "Wrong Era", stationTypes: ["specialist"], decadeTags: ["1990s"] }),
      station({ slug: "wrong-type", name: "Wrong Type", stationTypes: ["campus"], decadeTags: ["1980s"] }),
    ], state);
    expect(ordered.map(({ slug }) => slug)).toEqual(["tagged"]);
  });

  it("keeps unknown current-track age visible", () => {
    const state = {
      ...createRadioBrowseState(),
      filters: { ...createRadioBrowseState().filters, playingNow: ["deep" as const] },
    };
    expect(rankRadioBrowseStations([
      station({ slug: "unknown", currentTrack: { ageTier: null } }),
      station({ slug: "current", currentTrack: { ageTier: "current" } }),
      station({ slug: "deep", currentTrack: { ageTier: "deep" } }),
    ], state).map(({ slug }) => slug)).toEqual(expect.arrayContaining(["deep", "unknown"]));
    expect(rankRadioBrowseStations([
      station({ slug: "unknown", currentTrack: { ageTier: null } }),
      station({ slug: "current", currentTrack: { ageTier: "current" } }),
      station({ slug: "deep", currentTrack: { ageTier: "deep" } }),
    ], state)).toHaveLength(2);
  });

  it("pages stable four-station decks without padding thin results", () => {
    const items = [1, 2, 3, 4, 5];
    expect(paginateRadioDeck(items, 1)).toEqual([1, 2, 3, 4]);
    expect(paginateRadioDeck(items, 2)).toEqual([5]);
  });

  it("reset keeps coarse locality and produces an honest provenance sentence", () => {
    const state = createRadioBrowseState({ locality: { zip: "98101" } });
    const reset = resetRadioBrowseState({ ...state, lens: "for-you", focusedArtist: "X" });
    expect(reset.locality).toEqual({ zip: "98101" });
    expect(radioBrowseProvenance(reset, 4)).toMatch(/playable stations near your coarse ZIP area/i);
    expect(radioBrowseProvenance({ ...reset, lens: "all" }, 4)).toMatch(/without a personalized ranking claim/i);
  });
});