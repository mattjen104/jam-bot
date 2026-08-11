// @vitest-environment jsdom

/**
 * FirstRunSidebar unit tests.
 *
 * Verifies the provenance-ordered station sentences surface:
 *  1. Blocks appear in non-decreasing rung order.
 *  2. No "+" glyph anywhere in the rendered output.
 *  3. Unresolved artists carry data-mbid="unknown" and never .frb__artist--kept.
 *  4. Empty state contains no recommendation language.
 *  5. No aggregate-popularity section or gamification vocabulary.
 *
 * Artists are keepable (click → onAddSeed) only when they have a resolved MBID;
 * unresolved artists use the hollow-square channel and are never "kept" visually.
 */

import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

import { buildOnboardingBlocks, FirstRunSidebar } from "../src/components/FirstRunSidebar";
import type { DialStation } from "../src/hooks/useDialData";

// ---------------------------------------------------------------------------
// Minimal DialStation fixture factory
// ---------------------------------------------------------------------------

function makeStation(overrides: {
  slug: string;
  name: string;
  isLive?: boolean;
  djName?: string | null;
  /** Override the inferred isPickerShow flag. Defaults to !!djName. */
  isPickerShow?: boolean;
  automationClass?: "automated" | "human" | null;
  spins?: Array<{ artist: string; mbid?: string | null; artistMbid?: string | null }>;
  liveTrackArtist?: string;
  liveTrackArtistMbid?: string | null;
}): DialStation {
  const {
    slug,
    name,
    isLive = true,
    djName = null,
    isPickerShow: isPickerShowOverride,
    automationClass = null,
    spins = [],
    liveTrackArtist,
    liveTrackArtistMbid = null,
  } = overrides;
  const isPickerShow = isPickerShowOverride ?? !!djName;

  const spinEntries = spins.map((s, i) => ({
    mbid: s.mbid ?? null,
    artistMbid: s.artistMbid ?? null,
    title: `Track ${i}`,
    artist: s.artist,
    playedAt: new Date(Date.now() - (spins.length - i) * 60_000).toISOString(),
    isLibraryHit: false,
    isArtistHit: false,
    isFirstSpin: false,
  }));

  return {
    station: {
      id: 1,
      slug,
      name,
      automationClass: automationClass ?? null,
      tier: "flagship",
      qualityTier: "proven",
      city: "Test City",
      country: "US",
      streamUrl: "https://example.com/stream",
      streamFormat: "mp3",
      mode: "mono",
      attribution: true,
      mayHaveAds: false,
      votes: 0,
      clickcount: 0,
      upcomingShowCount: 0,
    } as DialStation["station"],
    isLive,
    shows: isLive
      ? [
          {
            runId: 1,
            showName: "Test Show",
            djName: djName ?? null,
            djNames: djName ? [djName] : undefined,
            pickerId: djName ? 1 : null,
            startedAt: new Date(Date.now() - 3600_000).toISOString(),
            endedAt: new Date(Date.now() + 3600_000).toISOString(),
            ianaTimezone: "America/New_York",
            state: "live" as const,
            spins: spinEntries,
            crossings: 0,
            artistCrossings: 0,
            topArtists: [],
            topArtistNames: [],
            currentTrack: spinEntries.length > 0 ? spinEntries[spinEntries.length - 1] : null,
            isPickerShow,
          },
        ]
      : [],
    crossings: 0,
    artistCrossings: 0,
    weekCrossings: 0,
    weekArtistCrossings: 0,
    monthCrossings: 0,
    monthArtistCrossings: 0,
    lifetimeCrossings: 0,
    lifetimeArtistCrossings: 0,
    topArtistNames: [],
    liveTrack: liveTrackArtist
      ? {
          mbid: null,
          artistMbid: liveTrackArtistMbid,
          title: "Live Track",
          artist: liveTrackArtist,
          playedAt: new Date().toISOString(),
          isLibraryHit: false,
          isArtistHit: false,
          isFirstSpin: false,
        }
      : null,
  } as DialStation;
}

// ---------------------------------------------------------------------------
// buildOnboardingBlocks unit tests
// ---------------------------------------------------------------------------

describe("buildOnboardingBlocks", () => {
  it("assigns rung 1 when live show has a djName", () => {
    const ds = makeStation({ slug: "wfmu", name: "WFMU", djName: "Jaded Lady" });
    const [block] = buildOnboardingBlocks([ds]);
    expect(block.rung).toBe(1);
    expect(block.pickerName).toBe("Jaded Lady");
  });

  it("assigns rung 2 when live show exists but no djName and not automated", () => {
    const ds = makeStation({ slug: "dublab", name: "Dublab", automationClass: "human" });
    const [block] = buildOnboardingBlocks([ds]);
    expect(block.rung).toBe(2);
    expect(block.pickerName).toBeNull();
  });

  it("assigns rung 3 when no live show data and not automated", () => {
    // No show — create a station with no shows but isLive=true (live-only spin, no schedule)
    const ds: DialStation = {
      ...makeStation({ slug: "nts", name: "NTS", isLive: true }),
      shows: [], // no schedule data
    };
    const [block] = buildOnboardingBlocks([ds]);
    expect(block.rung).toBe(3);
  });

  it("assigns rung 4 when automationClass is automated", () => {
    const ds = makeStation({ slug: "auto-fm", name: "Auto FM", automationClass: "automated" });
    const [block] = buildOnboardingBlocks([ds]);
    expect(block.rung).toBe(4);
  });

  it("returns blocks in non-decreasing rung order", () => {
    const stations = [
      makeStation({ slug: "auto", name: "AutoStation", automationClass: "automated" }),  // rung 4
      makeStation({ slug: "human", name: "HumanStation", automationClass: "human" }),     // rung 2
      makeStation({ slug: "dj", name: "DJStation", djName: "DJ Foo" }),                  // rung 1
    ];
    const blocks = buildOnboardingBlocks(stations);
    for (let i = 1; i < blocks.length; i++) {
      expect(blocks[i].rung).toBeGreaterThanOrEqual(blocks[i - 1].rung);
    }
  });

  it("excludes off-air stations", () => {
    const off = makeStation({ slug: "offline", name: "Offline FM", isLive: false });
    const blocks = buildOnboardingBlocks([off]);
    expect(blocks).toHaveLength(0);
  });

  it("named show with isPickerShow=false is rung 2, not rung 1", () => {
    // djName present but isPickerShow=false (e.g. ambiguous multi-DJ attribution)
    // → must not be promoted to the strong "X is playing…" claim
    const ds = makeStation({
      slug: "wnyu",
      name: "WNYU",
      djName: "Various DJs",
      isPickerShow: false,
    });
    const [block] = buildOnboardingBlocks([ds]);
    expect(block.rung).toBe(2);
    expect(block.pickerName).toBeNull(); // no picker claim for unvalidated attribution
  });

  it("automated station with live schedule and djName is still rung 4", () => {
    // Automation class takes absolute precedence over any show/DJ metadata
    const ds = makeStation({
      slug: "autobot",
      name: "AutoBot FM",
      automationClass: "automated",
      djName: "Algo Selector",
      isPickerShow: true, // even if the show claims picker status
    });
    const [block] = buildOnboardingBlocks([ds]);
    expect(block.rung).toBe(4);
  });

  it("derives artists from live show spins in order", () => {
    const ds = makeStation({
      slug: "krwm",
      name: "KRWM",
      spins: [
        { artist: "Sun Ra", artistMbid: "artist-sun-ra" },
        { artist: "Alice Coltrane", artistMbid: null },     // unresolved artist
        { artist: "Sun Ra", artistMbid: "artist-sun-ra" }, // duplicate — deduped
      ],
    });
    const [block] = buildOnboardingBlocks([ds]);
    // Duplicate deduplicated → 2 unique artists
    expect(block.artists).toHaveLength(2);
    expect(block.artists[0].name).toBe("Sun Ra");
    expect(block.artists[0].mbid).toBe("artist-sun-ra");   // resolved via artistMbid
    expect(block.artists[1].name).toBe("Alice Coltrane");
    expect(block.artists[1].mbid).toBeNull();               // unresolved
  });

  it("treats null artistMbid as unresolved even when recording mbid is present", () => {
    // Divergent case: recording resolved but artist identity not yet in the graph
    const ds = makeStation({
      slug: "wkdu",
      name: "WKDU",
      spins: [{ artist: "The Caretaker", mbid: "rec-mbid-caretaker", artistMbid: null }],
    });
    const [block] = buildOnboardingBlocks([ds]);
    expect(block.artists[0].mbid).toBeNull(); // unresolved — uses artistMbid, not mbid
  });

  it("treats resolved artistMbid as resolved even when recording mbid is null", () => {
    // Divergent case: artist known but this specific recording not yet matched
    const ds = makeStation({
      slug: "wnyu",
      name: "WNYU",
      spins: [{ artist: "Alice Coltrane", mbid: null, artistMbid: "artist-alice-coltrane" }],
    });
    const [block] = buildOnboardingBlocks([ds]);
    expect(block.artists[0].mbid).toBe("artist-alice-coltrane"); // resolved via artistMbid
  });

  it("falls back to liveTrack when no show spins", () => {
    const ds: DialStation = {
      ...makeStation({ slug: "kkjz", name: "KKJZ", isLive: true }),
      shows: [
        {
          runId: 2,
          showName: "Jazz Set",
          djName: null,
          pickerId: null,
          startedAt: new Date(Date.now() - 3600_000).toISOString(),
          endedAt: new Date(Date.now() + 3600_000).toISOString(),
          ianaTimezone: null,
          state: "live" as const,
          spins: [], // no spins in the show window
          crossings: 0,
          artistCrossings: 0,
          topArtists: [],
          topArtistNames: [],
          currentTrack: null,
          isPickerShow: false,
        },
      ],
      liveTrack: {
        mbid: "mbid-monk",
        artistMbid: null,
        title: "Round Midnight",
        artist: "Thelonious Monk",
        playedAt: new Date().toISOString(),
        isLibraryHit: false,
        isArtistHit: false,
        isFirstSpin: false,
      },
    } as DialStation;
    const [block] = buildOnboardingBlocks([ds]);
    expect(block.artists).toHaveLength(1);
    expect(block.artists[0].name).toBe("Thelonious Monk");
  });

  it("caps extraCount at artists beyond ARTISTS_SHOWN", () => {
    const ds = makeStation({
      slug: "kexp",
      name: "KEXP",
      spins: [
        { artist: "A", mbid: "m1" },
        { artist: "B", mbid: "m2" },
        { artist: "C", mbid: "m3" },
        { artist: "D", mbid: "m4" },
        { artist: "E", mbid: "m5" },
        { artist: "F", mbid: "m6" },
      ],
    });
    const [block] = buildOnboardingBlocks([ds]);
    // ARTISTS_SHOWN = 4; 6 - 4 = 2 extra
    expect(block.artists).toHaveLength(4);
    expect(block.extraCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// FirstRunSidebar render tests
// ---------------------------------------------------------------------------

const noop = () => undefined;

describe("FirstRunSidebar", () => {
  it("renders an empty state with no recommendation language when no stations", () => {
    render(
      <FirstRunSidebar stations={[]} seeds={[]} onAddSeed={noop} onTune={noop} />,
    );
    // Must contain some indication stations are absent
    expect(screen.getByText(/no stations on air/i)).toBeTruthy();
    // Must NOT contain recommendation vocabulary
    const html = document.body.innerHTML;
    expect(html).not.toMatch(/popular|trending|top pick|recommend|discover/i);
  });

  it("renders no '+' glyph anywhere", () => {
    const stations = [makeStation({ slug: "wfmu", name: "WFMU", djName: "DJ Test" })];
    const { container } = render(
      <FirstRunSidebar stations={stations} seeds={[]} onAddSeed={noop} onTune={noop} />,
    );
    expect(container.textContent).not.toContain("+");
  });

  it("unresolved artists carry data-mbid=unknown and never get --kept class", () => {
    // artistMbid: null → unresolved regardless of recording mbid
    const ds = makeStation({
      slug: "nts",
      name: "NTS",
      spins: [{ artist: "Unknown Act", artistMbid: null }],
    });
    const { container } = render(
      <FirstRunSidebar stations={[ds]} seeds={[]} onAddSeed={noop} onTune={noop} />,
    );
    const artistEl = container.querySelector<HTMLElement>('[data-station-artist="Unknown Act"]');
    expect(artistEl).toBeTruthy();
    expect(artistEl!.getAttribute("data-mbid")).toBe("unknown");
    expect(artistEl!.classList.contains("frb__artist--kept")).toBe(false);
    // Click should NOT apply --kept class (unresolved = separate axis)
    fireEvent.click(artistEl!);
    expect(artistEl!.classList.contains("frb__artist--kept")).toBe(false);
  });

  it("unresolved artists are not focusable and carry no button semantics", () => {
    // Hollow-square artists must be plain spans — no role, no tabIndex, no aria-pressed
    const ds = makeStation({
      slug: "nts",
      name: "NTS",
      spins: [{ artist: "Ghost Artist", artistMbid: null }],
    });
    const { container } = render(
      <FirstRunSidebar stations={[ds]} seeds={[]} onAddSeed={noop} onTune={noop} />,
    );
    const artistEl = container.querySelector<HTMLElement>('[data-station-artist="Ghost Artist"]');
    expect(artistEl).toBeTruthy();
    expect(artistEl!.getAttribute("role")).toBeNull();
    expect(artistEl!.getAttribute("tabindex")).toBeNull();
    expect(artistEl!.getAttribute("aria-pressed")).toBeNull();
  });

  it("resolved artists get --kept class when added as seed", () => {
    const onAdd = vi.fn();
    // artistMbid present → resolved, interactive, keepable
    const ds = makeStation({
      slug: "wfmu",
      name: "WFMU",
      djName: "Jaded Lady",
      spins: [{ artist: "Sun Ra", artistMbid: "artist-sun-ra" }],
    });
    const { rerender, container } = render(
      <FirstRunSidebar stations={[ds]} seeds={[]} onAddSeed={onAdd} onTune={noop} />,
    );
    const artistEl = container.querySelector<HTMLElement>('[data-station-artist="Sun Ra"]');
    expect(artistEl).toBeTruthy();
    expect(artistEl!.getAttribute("data-mbid")).not.toBe("unknown");

    fireEvent.click(artistEl!);
    expect(onAdd).toHaveBeenCalledWith("Sun Ra");

    // After seed is added externally, rerender with seed present → --kept
    rerender(
      <FirstRunSidebar stations={[ds]} seeds={["Sun Ra"]} onAddSeed={onAdd} onTune={noop} />,
    );
    const updatedEl = container.querySelector<HTMLElement>('[data-station-artist="Sun Ra"]');
    expect(updatedEl!.classList.contains("frb__artist--kept")).toBe(true);
  });

  it("blocks appear in non-decreasing rung order in the DOM", () => {
    const stations = [
      makeStation({ slug: "auto", name: "AutoFM", automationClass: "automated" }),    // rung 4
      makeStation({ slug: "human", name: "HumanFM", automationClass: "human" }),       // rung 2
      makeStation({ slug: "dj", name: "DJStation", djName: "DJ Foo" }),               // rung 1
    ];
    const { container } = render(
      <FirstRunSidebar stations={stations} seeds={[]} onAddSeed={noop} onTune={noop} />,
    );
    const blocks = container.querySelectorAll<HTMLElement>("[data-rung]");
    const rungs = [...blocks].map((el) => parseInt(el.getAttribute("data-rung") ?? "0", 10));
    for (let i = 1; i < rungs.length; i++) {
      expect(rungs[i]).toBeGreaterThanOrEqual(rungs[i - 1]);
    }
  });

  it("renders no aggregate-popularity section", () => {
    const stations = [makeStation({ slug: "wfmu", name: "WFMU", djName: "DJ Test" })];
    const { container } = render(
      <FirstRunSidebar stations={stations} seeds={[]} onAddSeed={noop} onTune={noop} />,
    );
    // No vote counts, play counts, or discovery-score widgets
    expect(container.innerHTML).not.toMatch(/plays|spins this week|discovery score|listener count/i);
    // No popularity chip rows
    expect(container.querySelectorAll(".live-artist-picker")).toHaveLength(0);
    expect(container.querySelectorAll(".z1-placeholder__seedchip")).toHaveLength(0);
  });

  it("renders provenance as inert text — the retired station workspace is unreachable", () => {
    const onTune = vi.fn();
    const ds = makeStation({ slug: "wfmu", name: "WFMU", djName: "DJ Test" });
    const { container } = render(
      <FirstRunSidebar stations={[ds]} seeds={[]} onAddSeed={noop} onTune={onTune} />,
    );
    // The tune target is the only station-level interaction.
    const tune = within(container).getByRole("button", { name: /tune WFMU/i });
    fireEvent.click(tune);
    expect(onTune).toHaveBeenCalledWith("wfmu");

    // No "Open … sets" control exists anywhere — the workspace is retired.
    expect(within(container).queryByRole("button", { name: /open .* sets/i })).toBeNull();
    // The provenance line still renders, but as plain text, not a button.
    const provenance = container.querySelector(".frb__provenance");
    expect(provenance).toBeTruthy();
    expect(provenance!.tagName).not.toBe("BUTTON");
  });

  it("keeps artist saving separate from station tuning for click, Enter, and Space", () => {
    const onTune = vi.fn();
    const onAddSeed = vi.fn();
    const ds = makeStation({
      slug: "wfmu",
      name: "WFMU",
      djName: "DJ Test",
      spins: [{ artist: "Broadcast", artistMbid: "artist-broadcast" }],
    });
    const { container } = render(
      <FirstRunSidebar stations={[ds]} seeds={[]} onAddSeed={onAddSeed} onTune={onTune} />,
    );
    const artist = within(container).getByRole("button", { name: "Broadcast" });

    fireEvent.click(artist);
    fireEvent.keyDown(artist, { key: "Enter" });
    fireEvent.keyDown(artist, { key: " " });

    expect(onAddSeed).toHaveBeenCalledTimes(3);
    expect(onTune).not.toHaveBeenCalled();
  });

  it("shows rung-2 dagger (†) for live shift with host not named in feed", () => {
    const ds = makeStation({
      slug: "dublab",
      name: "Dublab",
      automationClass: "human",
      spins: [{ artist: "Laraaji", mbid: "mbid-laraaji" }],
    });
    const { container } = render(
      <FirstRunSidebar stations={[ds]} seeds={[]} onAddSeed={noop} onTune={noop} />,
    );
    expect(container.textContent).toContain("†");
    expect(container.textContent).toContain("Laraaji");
    // Citation must not claim a picker name
    const cite = container.querySelector<HTMLElement>(".frb__cite");
    expect(cite?.textContent).toContain("host not named in feed");
  });

  it("reveals more stations button only when blocks exceed cap", () => {
    const manyStations = Array.from({ length: 7 }, (_, i) =>
      makeStation({
        slug: `station-${i}`,
        name: `Station ${i}`,
        djName: `DJ ${i}`,
      }),
    );
    const { container } = render(
      <FirstRunSidebar stations={manyStations} seeds={[]} onAddSeed={noop} onTune={noop} />,
    );
    const moreBtn = screen.getByText(/2 more stations on air/i);
    expect(moreBtn).toBeTruthy();
    fireEvent.click(moreBtn);
    // After click, all 7 blocks should be visible within this render's container
    expect(container.querySelectorAll("[data-rung]")).toHaveLength(7);
  });
});
