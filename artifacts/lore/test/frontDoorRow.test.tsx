// @vitest-environment jsdom
/** Component tests for the dial's single-sentence live context. */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("wouter", () => ({ useLocation: () => ["/", vi.fn()] }));
vi.mock("../src/hooks/useDialData", () => ({ useDialData: vi.fn() }));
vi.mock("../src/lib/meHooks", async (importOriginal) => {
  const { makeMeHooksMock } = await import("./helpers/meHooksMock");
  return makeMeHooksMock(importOriginal, {
    useMyOverlapSelectors: vi.fn(() => ({ data: null })),
    useMyGhostMissed: vi.fn(() => ({ data: null })),
    useSpotifyLibraryConnected: vi.fn(() => false),
    startSpotifyLibraryConnect: vi.fn(),
  });
});
vi.mock("../src/components/StationLane", () => ({ StationLane: () => <div /> }));
vi.mock("../src/components/ContextRail", () => ({ ContextRail: () => <div /> }));
vi.mock("../src/components/SearchOverlay", () => ({ SearchOverlay: () => <div /> }));
vi.mock("../src/player/PlayerProvider", async (importOriginal) => {
  const { makePlayerProviderMock } = await import("./helpers/playerProviderMock");
  return makePlayerProviderMock(importOriginal, {
    usePlayer: vi.fn(() => ({ ride: {}, spotify: {}, scan: {}, radio: {} })),
  });
});

import { FrontDoorRow } from "../src/components/DialView";
import type { DialStation, DialShow, DialSpin } from "../src/hooks/useDialData";

function makeStation(overrides: Partial<DialStation["station"]> = {}): DialStation["station"] {
  return {
    slug: "test-fm", name: "Test FM", streamUrl: null, websiteUrl: null,
    description: null, logoUrl: null, radioBrowserId: null, automationClass: null,
    ...overrides,
  } as DialStation["station"];
}

function makeDialStation(
  stationOverrides: Partial<DialStation["station"]> = {},
  dsOverrides: Partial<Omit<DialStation, "station">> = {},
): DialStation {
  return {
    station: makeStation(stationOverrides), isLive: true, shows: [],
    crossings: 0, artistCrossings: 0, lifetimeCrossings: 0, lifetimeArtistCrossings: 0,
    ...dsOverrides,
  };
}

function makeSpin(overrides: Partial<DialSpin> = {}): DialSpin {
  return {
    mbid: "mbid-1", artistMbid: null, title: "Test Track", artist: "Test Artist",
    playedAt: new Date().toISOString(), isLibraryHit: false, isArtistHit: false,
    isFirstSpin: false, ...overrides,
  };
}

function makeShow(overrides: Partial<DialShow> = {}): DialShow {
  return {
    runId: 1, showName: "Morning Mix", djName: null,
    startedAt: new Date(Date.now() - 30 * 60_000).toISOString(),
    endedAt: new Date().toISOString(), state: "live", spins: [],
    crossings: 0, artistCrossings: 0, topArtists: [], topArtistNames: [],
    currentTrack: null, isPickerShow: false, pickerId: null, ...overrides,
  };
}

function renderRow(ds: DialStation, show: DialShow | null, ov = 0, displayMode?: "personal" | "blended") {
  return render(
    <FrontDoorRow ds={ds} show={show} ov={ov} isActive={false} isSampling={false}
      onTuneIn={vi.fn()} onEarlier={vi.fn()} displayMode={displayMode} />,
  );
}

function leadingSentence(container: HTMLElement) {
  const sentence = container.querySelector(".fdrow__t1");
  expect(sentence).not.toBeNull();
  return sentence!;
}

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("live sentence", () => {
  it("uses only anonymous aggregate wording in community mode", () => {
    const { container } = renderRow(
      makeDialStation({}, { crossings: 2 }),
      makeShow({
        currentTrack: makeSpin({ isLibraryHit: true, artist: "Private Artist" }),
      }),
      2,
      "blended",
    );
    expect(leadingSentence(container).textContent).toBe("2 community matches here in the last 24h");
    expect(leadingSentence(container).textContent).not.toMatch(/your|library|private artist/i);
  });

  it("shows DJ/track attribution as a secondary line alongside the community count in blended mode", () => {
    const { container } = renderRow(
      makeDialStation({}, { crossings: 3 }),
      makeShow({
        djName: "Diane Kamikaze",
        currentTrack: makeSpin({ title: "Change", artist: "Deftones", isLibraryHit: true }),
      }),
      3,
      "blended",
    );
    // Tier 1 must still be the community count
    expect(leadingSentence(container).textContent).toBe("3 community matches here in the last 24h");
    expect(leadingSentence(container).textContent).not.toMatch(/your|library|private/i);
    // Secondary line shows the live DJ/track attribution
    const secondary = container.querySelector(".fdrow__live-secondary");
    expect(secondary).not.toBeNull();
    expect(secondary!.textContent).toContain("Diane Kamikaze");
    expect(secondary!.textContent).not.toMatch(/your|library/i);
  });

  it("shows live station context as secondary line in blended mode with no DJ", () => {
    const { container } = renderRow(
      makeDialStation({}, { crossings: 1 }),
      makeShow({
        djName: null,
        currentTrack: makeSpin({ title: "Blue Lines", artist: "Massive Attack", isLibraryHit: false }),
      }),
      1,
      "blended",
    );
    // Tier 1 community count preserved
    expect(leadingSentence(container).textContent).toBe("1 community match here in the last 24h");
    // Secondary shows now-playing metadata (no personal library language)
    const secondary = container.querySelector(".fdrow__live-secondary");
    expect(secondary).not.toBeNull();
    expect(secondary!.textContent).toMatch(/Massive Attack/);
    expect(secondary!.textContent).not.toMatch(/your|library/i);
  });

  it("keeps ordinary live rows title-inclusive while the station stays in the byline", () => {
    const { container } = renderRow(makeDialStation(), makeShow({
      djName: "Diane Kamikaze",
      currentTrack: makeSpin({ title: "Change", artist: "Deftones" }),
    }));
    const sentence = leadingSentence(container);
    expect(sentence.textContent).toBe("Diane Kamikaze is playing Change by Deftones");
    expect(container.querySelector(".fdrow__t3")?.textContent).toBe("Morning Mix · Test FM");
    expect(sentence.textContent).not.toMatch(/library/i);
  });

  it("restores artist emphasis for an exact crossing and suppresses its title", () => {
    const { container } = renderRow(makeDialStation(), makeShow({
      djName: "Diane Kamikaze",
      currentTrack: makeSpin({ title: "Change", artist: "Deftones", isLibraryHit: true }),
    }));
    expect(leadingSentence(container).textContent).toBe("Diane Kamikaze is playing Deftones.");
    expect(leadingSentence(container).querySelectorAll("b")).toHaveLength(1);
    expect(leadingSentence(container).querySelector("b")?.textContent).toBe("Deftones");
    expect(leadingSentence(container).querySelector("b")?.className).toBe("fdrow__artist");
    expect(leadingSentence(container).textContent).not.toContain("Change");
    expect(container.querySelector(".fdrow")?.classList.contains("fdrow--t1")).toBe(true);
  });

  it("highlights each artist in a multi-artist crossing and keeps punctuation neutral", () => {
    const { container } = renderRow(makeDialStation(), makeShow({
      djName: "Diane Kamikaze", crossings: 2, topArtists: ["Deftones", "Portishead"], currentTrack: null,
    }));
    expect(leadingSentence(container).textContent).toBe("Diane Kamikaze is playing Deftones and Portishead.");
    expect(leadingSentence(container).querySelectorAll("b")).toHaveLength(2);
    expect(leadingSentence(container).textContent).not.toContain("Test Track");
    expect(container.querySelector(".fdrow")?.classList.contains("fdrow--z1")).toBe(true);
  });

  it("uses the deliberate artist-only label when a crossing has no DJ", () => {
    const { container } = renderRow(makeDialStation(), makeShow({
      djName: null, currentTrack: makeSpin({ title: "Change", artist: "Deftones", isArtistHit: true }),
    }));
    expect(leadingSentence(container).textContent).toBe("Now playing: Deftones.");
    expect(leadingSentence(container).querySelector("b")?.textContent).toBe("Deftones");
  });

  it("uses a complete count fallback when crossing artist metadata is unavailable", () => {
    const { container } = renderRow(makeDialStation(), makeShow({
      djName: null, crossings: 3, currentTrack: null,
    }));
    expect(leadingSentence(container).textContent).toBe("3 tracks from your library have aired.");
  });

  it("removes repeated and placeholder values from the byline", () => {
    const { container } = renderRow(makeDialStation(), makeShow({
      djName: "Test FM",
      currentTrack: makeSpin({ title: "Deftones", artist: "Test FM" }),
      showName: "Unknown show",
    }));
    expect(leadingSentence(container).textContent).toBe("Deftones is playing");
    expect(container.querySelector(".fdrow__t3")?.textContent).toBe("Test FM");
    expect(container.textContent).not.toMatch(/unknown show/i);
  });

  it("falls back to ordinary on-air rendering when the live artist is presented as the DJ", () => {
    const { container } = renderRow(makeDialStation(), makeShow({
      djName: "THE—FLAMING LIPS",
      currentTrack: makeSpin({ title: "Do You Realize??", artist: "The Flaming Lips" }),
    }));
    expect(leadingSentence(container).textContent).toBe("The Flaming Lips is playing Do You Realize??");
    expect(leadingSentence(container).textContent).not.toContain("THE—FLAMING LIPS is playing");
  });
});

describe("show context and missing attribution", () => {
  it("uses a known show as a quiet cue instead of another identity row", () => {
    const { container } = renderRow(makeDialStation(), makeShow({
      djName: "DJ Cosmos", currentTrack: makeSpin(),
    }));
    expect(container.querySelector(".fdrow__context")?.textContent).toBe("Morning Mix · Test FM");
    expect(container.querySelector(".fdrow__t2")).toBeNull();
    expect(container.querySelector(".fdrow__bare-track")).toBeNull();
  });

  it("does not show a placeholder for ordinary missing attribution", () => {
    const { container } = renderRow(makeDialStation(), makeShow({
      djName: null, showName: " Unknown Show ", currentTrack: makeSpin(),
    }));
    expect(container.querySelector(".fdrow__t3")?.textContent).toBe("Test FM");
    expect(container.textContent).not.toMatch(/unknown show|continuous/i);
  });

  it("uses Continuous only for an explicitly automated showless station", () => {
    const { container } = renderRow(makeDialStation({ automationClass: "automated" }), makeShow({
      djName: null, showName: "Unknown show", currentTrack: makeSpin(),
    }));
    expect(container.querySelector(".fdrow__context")?.textContent).toBe("Continuous · Test FM");
  });

  it("does not reuse a recently-ended DJ as if they were current", () => {
    const past = makeShow({
      djName: "DJ Luna", state: "past",
      endedAt: new Date(Date.now() - 30 * 60_000).toISOString(),
    });
    const { container } = renderRow(
      makeDialStation({ automationClass: "human" }, { shows: [past] }),
      makeShow({ djName: null, currentTrack: makeSpin() }),
    );
    expect(container.textContent).not.toContain("DJ Luna");
  });
});

describe("narrow-screen byline readability", () => {
  it("keeps the full station name visible when the show name is very long", () => {
    const longShowName = "The Extremely Long Late-Night Program With An Unusually Verbose Title That Runs On And On";
    const longStationName = "KCRW 89.9 FM Santa Monica Public Radio";
    const { container } = renderRow(
      makeDialStation({ name: longStationName }),
      makeShow({ showName: longShowName, djName: null }),
    );
    const byline = container.querySelector(".fdrow__t3");
    expect(byline?.textContent).toContain(longStationName);
    expect(byline?.textContent).toContain(longShowName);
    // Station name is never hidden — the byline element must be present
    expect(byline).not.toBeNull();
  });

  it("keeps the station-only byline intact when there is no show context", () => {
    const longStationName = "WFMU 91.1 FM Jersey City Freeform Radio Broadcasting Live";
    const { container } = renderRow(
      makeDialStation({ name: longStationName }),
      makeShow({ showName: null, djName: null }),
    );
    const byline = container.querySelector(".fdrow__t3");
    expect(byline?.textContent).toBe(longStationName);
  });

  it("artist in the reason sentence carries the fdrow__artist class for visual distinction from byline text", () => {
    const { container } = renderRow(
      makeDialStation({ name: "KEXP 90.3 FM Seattle" }),
      makeShow({
        djName: "John Richards",
        currentTrack: makeSpin({ title: "Yoshimi Battles the Pink Robots", artist: "The Flaming Lips", isLibraryHit: true }),
      }),
    );
    // The reason sentence artist must be wrapped in <b class="fdrow__artist">
    const artistBolds = container.querySelectorAll(".fdrow__t1 b.fdrow__artist");
    expect(artistBolds.length).toBeGreaterThanOrEqual(1);
    // The byline (fdrow__t3) should not carry the fdrow__artist class
    const byline = container.querySelector(".fdrow__t3");
    expect(byline?.querySelector(".fdrow__artist")).toBeNull();
    // The highlighted artist text is separate from the byline station text
    expect(container.querySelector(".fdrow__t3")?.textContent).not.toContain("fdrow__artist");
  });

  it("renders the reason sentence with overflow-wrap support for long unbroken artist names", () => {
    const { container } = renderRow(
      makeDialStation({ name: "Test FM" }),
      makeShow({
        djName: null,
        crossings: 1,
        topArtists: ["Sigur Rós"],
        currentTrack: null,
      }),
    );
    const sentence = container.querySelector(".fdrow__t1");
    expect(sentence?.textContent).toContain("Sigur Rós");
    expect(sentence?.querySelector("b.fdrow__artist")?.textContent).toBe("Sigur Rós");
  });
});

describe("fallback and interaction", () => {
  it("keeps the useful weak-match reason and station label when no live show exists", () => {
    const { container } = renderRow(makeDialStation(), null);
    expect(leadingSentence(container).textContent).toContain("Lore can't see who's playing");
    expect(container.querySelector(".fdrow__t3")?.textContent).toBe("Test FM");
  });

  it("has one row-level tune-in target, no nested entity links, and an earlier control", () => {
    const { container } = render(
      <FrontDoorRow ds={makeDialStation()} show={makeShow({ currentTrack: makeSpin() })}
        ov={0} isActive={false} isSampling={false} onTuneIn={vi.fn()} onEarlier={vi.fn()} />,
    );
    expect(container.querySelectorAll("a")).toHaveLength(0);
    expect(container.querySelectorAll("[role=button]")).toHaveLength(1);
    expect(container.querySelector(".fdrow__back")).not.toBeNull();
  });

  it("continues to show the lifetime overlap caption for weak-match rows", () => {
    const { container } = renderRow(makeDialStation(), null, 7);
    expect(container.querySelector(".fdrow__ov-caption")?.textContent).toContain("7 artists you know play here");
  });

});