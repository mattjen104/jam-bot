// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildOnboardingBlocks,
  FIRST_RUN_STATIONS,
  FirstRunSidebar,
  firstRunLivePhrase,
} from "../src/components/FirstRunSidebar";
import type { DialStation } from "../src/hooks/useDialData";

function station(slug: string, name: string, options: {
  id?: number;
  artist?: string;
  title?: string;
  artistMbid?: string | null;
  playedAt?: string;
  spins?: string[];
  timing?: {
    serverTime: string;
    estimatedRemainingMs: number;
    timingConfidence: "trusted" | "estimated";
  };
} = {}): DialStation {
  const playedAt = options.playedAt ?? new Date().toISOString();
  const spin = (artist: string, index: number) => ({
    mbid: null,
    artistMbid: options.artistMbid ?? null,
    title: `Track ${index}`,
    artist,
    playedAt,
    isLibraryHit: false,
    isArtistHit: false,
    isFirstSpin: false,
    releaseYear: null,
    ageTier: null,
  });
  const liveTrack = options.artist ? {
    ...spin(options.artist, 0),
    title: options.title ?? "Live Track",
    freshness: options.timing ? "fresh" as const : undefined,
    timestampKind: options.timing ? "source" as const : undefined,
    timingUncertaintyMs: options.timing ? 2_000 : undefined,
    ...options.timing,
  } : null;
  const spins = (options.spins ?? []).map(spin);
  return {
    station: {
      id: options.id ?? FIRST_RUN_STATIONS.findIndex((entry) => entry.slug === slug) + 1,
      slug,
      name,
      automationClass: null,
      tier: "flagship",
      qualityTier: "proven",
      streamUrl: "https://example.com/live",
      streamFormat: "mp3",
      mode: "mono",
      attribution: true,
      mayHaveAds: false,
      votes: 0,
      clickcount: 0,
      upcomingShowCount: 0,
    },
    isLive: true,
    shows: [{
      runId: 1,
      showName: "Live show",
      djName: null,
      pickerId: null,
      startedAt: playedAt,
      endedAt: new Date(Date.now() + 60_000).toISOString(),
      ianaTimezone: null,
      state: "live",
      spins,
      crossings: 0,
      artistCrossings: 0,
      topArtists: [],
      topArtistNames: [],
      currentTrack: liveTrack,
      isPickerShow: false,
    }],
    liveTrack,
    crossings: 0,
    artistCrossings: 0,
    firstPlayCrossings: 0,
    weekCrossings: 0,
    weekArtistCrossings: 0,
    weekFirstPlayCrossings: 0,
    monthCrossings: 0,
    monthArtistCrossings: 0,
    monthFirstPlayCrossings: 0,
    lifetimeCrossings: 0,
    lifetimeArtistCrossings: 0,
    lifetimeFirstPlayCrossings: 0,
    topArtistNames: [],
    topArtistNames24h: [],
    topArtistNames7d: [],
    topArtistNames30d: [],
    topArtistNamesLifetime: [],
  } as DialStation;
}

const roster = FIRST_RUN_STATIONS.map((entry, index) =>
  station(entry.slug, entry.name, {
    id: index + 1,
    artist: `Artist ${index + 1}`,
    title: `Title ${index + 1}`,
    spins: [`Recent ${index + 1}`, `Artist ${index + 1}`],
  }),
);

const props = {
  seeds: [] as string[],
  onAddSeed: vi.fn(),
  onPlay: vi.fn(),
  onCatchNext: vi.fn(async () => "The next song just started."),
};

afterEach(cleanup);

describe("first-run editorial roster", () => {
  it("selects exactly the 12 reviewed identities in deterministic order", () => {
    const noise = station("championshipvinyl", "Championshipvinyl", { id: 100 });
    const duplicate = station("kexp-variant", "KEXP 90.3 FM", { id: 1 });
    const blocks = buildOnboardingBlocks([noise, ...[...roster].reverse(), duplicate]);
    expect(blocks.map((block) => block.name)).toEqual(FIRST_RUN_STATIONS.map((entry) => entry.name));
    expect(blocks).toHaveLength(12);
    expect(blocks.some((block) => block.name === "Championshipvinyl")).toBe(false);
  });

  it("does not replace a missing reviewed station with an arbitrary live station", () => {
    const blocks = buildOnboardingBlocks([
      ...roster.filter((candidate) => candidate.station.slug !== "jamm-fm"),
      station("other", "Other Radio", { id: 99 }),
    ]);
    expect(blocks).toHaveLength(11);
    expect(blocks.some((block) => block.name === "Other Radio")).toBe(false);
  });

  it("uses honest just-changed, about-to-change, and on-air phrases", () => {
    const now = Date.parse("2026-09-03T12:00:00Z");
    const track = station("kexp", "KEXP", { playedAt: "2026-09-03T11:59:30Z", artist: "A" }).liveTrack;
    expect(firstRunLivePhrase(track, now)).toBe("just changed");
    expect(firstRunLivePhrase({ ...track!, playedAt: "2026-09-03T11:55:00Z" }, now)).toBe("about to change");
    expect(firstRunLivePhrase(null, now)).toBe("on air");
  });
});

describe("FirstRunSidebar", () => {
  it("renders the three editorial bands and all 12 rows", () => {
    const { container } = render(<FirstRunSidebar stations={roster} {...props} />);
    const bands = container.querySelectorAll<HTMLElement>("[data-band]");
    expect([...bands].map((band) => band.dataset.band)).toEqual(["broad", "worlds", "left-field"]);
    expect(container.querySelectorAll("[data-station-slug]")).toHaveLength(12);
    expect(screen.getByText("KEXP 90.3 FM")).toBeTruthy();
    expect(screen.getByText("JAMM FM")).toBeTruthy();
  });

  it("shows grounded identity, live artist/title, and no crossing claims", () => {
    const { container } = render(<FirstRunSidebar stations={[roster[0]]} {...props} />);
    expect(within(container).getByText("Listener-powered independent music from Seattle.")).toBeTruthy();
    expect(container.textContent).toContain("Artist 1 · Title 1");
    expect(container.textContent).not.toMatch(/crossing|popular|trending|listeners/i);
  });

  it("plays only after a user presses Play now", () => {
    const onPlay = vi.fn();
    const { container } = render(<FirstRunSidebar stations={[roster[0]]} {...props} onPlay={onPlay} />);
    expect(onPlay).not.toHaveBeenCalled();
    fireEvent.click(within(container).getByRole("button", { name: "Play KEXP 90.3 FM now" }));
    expect(onPlay).toHaveBeenCalledWith(roster[0]);
  });

  it("puts trustworthy timing directly in the Play now button", () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-09-03T12:00:00Z");
    const timed = station("kexp", "KEXP 90.3 FM", {
      artist: "Broadcast artist",
      timing: {
        serverTime: "2026-09-03T12:00:00Z",
        estimatedRemainingMs: 154_000,
        timingConfidence: "trusted",
      },
    });
    render(<FirstRunSidebar stations={[timed]} {...props} />);
    expect(screen.getByRole("button", { name: "Play KEXP 90.3 FM now" }).textContent)
      .toContain("Play now2:34");
    vi.useRealTimers();
  });

  it("runs Catch the next song and reports its result", async () => {
    const onCatchNext = vi.fn(async () => "The next song just started.");
    const { container } = render(<FirstRunSidebar stations={[roster[0]]} {...props} onCatchNext={onCatchNext} />);
    fireEvent.click(within(container).getByRole("button", { name: "Catch the next song on KEXP 90.3 FM" }));
    expect(await within(container).findByText("The next song just started.")).toBeTruthy();
    expect(onCatchNext).toHaveBeenCalledWith(roster[0]);
  });

  it("keeps recent context compact until expanded", () => {
    render(<FirstRunSidebar stations={[roster[0]]} {...props} />);
    expect(screen.queryByText("Recent 1")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Recent set" }));
    expect(screen.getByText("Recent 1")).toBeTruthy();
  });

  it("reveals sound shelves plus category and search paths", () => {
    render(<FirstRunSidebar stations={[roster[0]]} {...props} />);
    expect(screen.queryByRole("link", { name: "Jazz and funk" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More stations" }));
    expect(screen.getByRole("link", { name: "Electronic and ambient" }).getAttribute("href")).toBe("/feed");
    expect(screen.getByRole("link", { name: "Browse categories" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Search stations" }).getAttribute("href")).toContain("/index");
  });

  it("keeps unresolved artists non-focusable and resolved artists keepable", () => {
    const onAddSeed = vi.fn();
    const unresolved = roster[0];
    const resolved = station("wfmu", "WFMU 91.1 FM", {
      artist: "Sun Ra",
      artistMbid: "artist-sun-ra",
    });
    const { container } = render(
      <FirstRunSidebar stations={[unresolved, resolved]} {...props} onAddSeed={onAddSeed} />,
    );
    const unknown = container.querySelector<HTMLElement>('[data-mbid="unknown"]');
    expect(unknown?.getAttribute("role")).toBeNull();
    const sunRa = within(container).getByRole("button", { name: "Sun Ra" });
    fireEvent.click(sunRa);
    expect(onAddSeed).toHaveBeenCalledWith("Sun Ra");
  });
});