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

import { FrontDoorRow, PopCrossingLine } from "../src/components/DialView";
import type { DialStation, DialShow, DialSpin, PopularCrossingArtist } from "../src/hooks/useDialData";

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

function renderCompactRow(
  ds: DialStation,
  show: DialShow | null,
  props: Partial<React.ComponentProps<typeof FrontDoorRow>> = {},
) {
  return render(
    <FrontDoorRow ds={ds} show={show} ov={0} isActive={false} isSampling={false}
      onTuneIn={props.onTuneIn ?? vi.fn()} compactSentence {...props} />,
  );
}

function leadingSentence(container: HTMLElement) {
  const sentence = container.querySelector(".fdrow__t1");
  expect(sentence).not.toBeNull();
  return sentence!;
}

function popularArtists(n: number) {
  return Array.from({ length: n }, (_, index) => ({
    name: `Artist ${index + 1}`,
    inLibrary: false,
  }));
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

  it("keeps ordinary live rows artist-led with the show inside the sentence and no song title", () => {
    const { container } = renderRow(makeDialStation(), makeShow({
      djName: "Diane Kamikaze",
      currentTrack: makeSpin({ title: "Change", artist: "Deftones" }),
    }));
    const sentence = leadingSentence(container);
    expect(sentence.textContent).toBe("Diane Kamikaze selected Deftones on Morning Mix");
    expect(sentence.textContent).not.toContain("Change");
    expect(sentence.textContent).not.toMatch(/library/i);
  });

  it("restores artist emphasis for an exact crossing and suppresses its title", () => {
    const { container } = renderRow(makeDialStation(), makeShow({
      djName: "Diane Kamikaze",
      currentTrack: makeSpin({ title: "Change", artist: "Deftones", isLibraryHit: true }),
    }));
    expect(leadingSentence(container).textContent).toBe("Diane Kamikaze selected Deftones on Morning Mix, now.");
    expect(leadingSentence(container).querySelector("b.fdrow__artist")?.textContent).toBe("Deftones");
    expect(leadingSentence(container).querySelector("b.fdrow__dj")?.textContent).toBe("Diane Kamikaze");
    expect(leadingSentence(container).textContent).not.toContain("Change");
    expect(container.querySelector(".fdrow")?.classList.contains("fdrow--t1")).toBe(true);
  });

  it("highlights each artist in a multi-artist crossing and keeps punctuation neutral", () => {
    const { container } = renderRow(makeDialStation(), makeShow({
      djName: "Diane Kamikaze", crossings: 2, topArtists: ["Deftones", "Portishead"], currentTrack: null,
    }));
    expect(leadingSentence(container).textContent).toBe("Diane Kamikaze selected Deftones and Portishead on Morning Mix in the current set.");
    expect(leadingSentence(container).querySelectorAll("b.fdrow__artist")).toHaveLength(2);
    expect(leadingSentence(container).textContent).not.toContain("Test Track");
    expect(container.querySelector(".fdrow")?.classList.contains("fdrow--z1")).toBe(true);
  });

  it("keeps the artist-led sentence when a crossing has no DJ", () => {
    const { container } = renderRow(makeDialStation(), makeShow({
      djName: null, currentTrack: makeSpin({ title: "Change", artist: "Deftones", isArtistHit: true }),
    }));
    expect(leadingSentence(container).textContent).toBe("Deftones on Morning Mix, now.");
    expect(leadingSentence(container).querySelector("b.fdrow__artist")?.textContent).toBe("Deftones");
    expect(leadingSentence(container).textContent).not.toContain("Change");
  });

  it("uses a complete count fallback when crossing artist metadata is unavailable", () => {
    const { container } = renderRow(makeDialStation(), makeShow({
      djName: null, crossings: 3, currentTrack: null,
    }));
    expect(leadingSentence(container).textContent).toBe("3 tracks of yours on Morning Mix in the current set.");
  });

  it("goes dark instead of echoing repeated and placeholder values", () => {
    const { container } = renderRow(makeDialStation(), makeShow({
      djName: "Test FM",
      currentTrack: makeSpin({ title: "Deftones", artist: "Test FM" }),
      showName: "Unknown show",
    }));
    // DJ, artist, and show name are all suppressed (station echo / placeholder),
    // so the row falls back to the dark no-attribution sentence.
    expect(leadingSentence(container).textContent).toBe("on air · Lore can't see who's playing");
    expect(container.textContent).not.toMatch(/unknown show/i);
    expect(container.textContent).not.toContain("Test FM is playing");
  });

  it("suppresses the DJ credit when the live artist is presented as the DJ", () => {
    const { container } = renderRow(makeDialStation(), makeShow({
      djName: "THE—FLAMING LIPS",
      currentTrack: makeSpin({ title: "Do You Realize??", artist: "The Flaming Lips" }),
    }));
    expect(leadingSentence(container).textContent).toBe("The Flaming Lips on Morning Mix now");
    expect(leadingSentence(container).textContent).not.toContain("THE—FLAMING LIPS");
  });
});

describe("show context and missing attribution", () => {
  it("folds the show name into the sentence instead of another identity row", () => {
    const { container } = renderRow(makeDialStation(), makeShow({
      djName: "DJ Cosmos", currentTrack: makeSpin(),
    }));
    const sentence = leadingSentence(container);
    expect(sentence.textContent).toBe("DJ Cosmos selected Test Artist on Morning Mix");
    expect(sentence.querySelector(".fdrow__show")?.textContent).toBe("Morning Mix");
    expect(container.querySelector(".fdrow__t2")).toBeNull();
    expect(container.querySelector(".fdrow__bare-track")).toBeNull();
  });

  it("does not show a placeholder for ordinary missing attribution", () => {
    const { container } = renderRow(makeDialStation(), makeShow({
      djName: null, showName: " Unknown Show ", currentTrack: makeSpin(),
    }));
    expect(leadingSentence(container).textContent).toBe("Test Artist on now");
    expect(container.textContent).not.toMatch(/unknown show|continuous/i);
  });

  it("never surfaces Continuous even for an explicitly automated showless station", () => {
    const { container } = renderRow(makeDialStation({ automationClass: "automated" }), makeShow({
      djName: null, showName: "Unknown show", currentTrack: makeSpin(),
    }));
    expect(leadingSentence(container).textContent).toBe("Test Artist on now");
    expect(container.textContent).not.toMatch(/continuous|unknown show/i);
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
  it("keeps a very long show name fully visible in the reason sentence", () => {
    const longShowName = "The Extremely Long Late-Night Program With An Unusually Verbose Title That Runs On And On";
    const { container } = renderRow(
      makeDialStation({ name: "KCRW 89.9 FM Santa Monica Public Radio" }),
      makeShow({ showName: longShowName, djName: null }),
    );
    const sentence = leadingSentence(container);
    expect(sentence.querySelector(".fdrow__show")?.textContent).toBe(longShowName);
    expect(sentence.textContent).toContain(longShowName);
  });

  it("goes dark rather than inventing context when there is no show or DJ", () => {
    const { container } = renderRow(
      makeDialStation({ name: "WFMU 91.1 FM Jersey City Freeform Radio Broadcasting Live" }),
      makeShow({ showName: null, djName: null }),
    );
    expect(leadingSentence(container).textContent).toBe("on air · Lore can't see who's playing");
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
    expect(artistBolds[0].textContent).toBe("The Flaming Lips");
  });

  it("adds popular-crossing artists via the explicit + affordance (name never adds)", () => {
    const onAdd = vi.fn();
    const popLine = <PopCrossingLine
      artists={[{ name: "Artist 1", inLibrary: false } as PopularCrossingArtist]}
      seedsLower={new Set()}
      onAdd={onAdd}
    />;
    render(
      <FrontDoorRow
        ds={makeDialStation()}
        show={makeShow()}
        ov={0}
        isActive={false}
        isSampling={false}
        onTuneIn={vi.fn()}
        popLine={popLine}
      />,
    );
    // New link semantics: dotted underline is reserved for navigation. The
    // add/seed action is an explicit small `+` button beside the name.
    const addable = screen.getByRole("button", { name: /add artist 1/i });
    expect(addable.className).toContain("dial-addplus");
    expect(addable.textContent).toBe("+");
    // The name itself is plain text, not an add button.
    const name = document.querySelector(".fdrow__artist--other");
    expect(name?.textContent).toBe("Artist 1");
    expect(name?.tagName).not.toBe("BUTTON");
    fireEvent.click(addable);
    expect(onAdd).toHaveBeenCalledWith("Artist 1");
  });

  it("exposes the active current-set expansion state", () => {
    const { container: _container } = render(
      <FrontDoorRow
        ds={makeDialStation()}
        show={makeShow({
          crossings: 1,
          topArtists: ["Artist 1"],
          currentTrack: null,
        })}
        ov={0}
        isActive={false}
        isSampling={false}
        onTuneIn={vi.fn()}
        setArtists={popularArtists(10).map((artist) => ({
          ...artist,
          popular: false,
          debut: false,
          heard: false,
        }))}
        seedsLower={new Set()}
        onAddArtist={vi.fn()}
      />,
    );

    const more = screen.getByRole("button", { name: /this set/i });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(more);
    expect(screen.getByRole("button", { name: /this set/i }).getAttribute("aria-expanded")).toBe("true");

    expect(document.querySelector(".fdrow__also-block")?.textContent).toContain("Artist 10");
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
  it("keeps the useful weak-match reason when no live show exists", () => {
    const { container } = renderRow(makeDialStation(), null);
    expect(leadingSentence(container).textContent).toContain("Lore can't see who's playing");
  });

  it("has one row-level tune-in target and no nested entity links", () => {
    const { container } = render(
      <FrontDoorRow ds={makeDialStation()} show={makeShow({ currentTrack: makeSpin() })}
        ov={0} isActive={false} isSampling={false} onTuneIn={vi.fn()} onEarlier={vi.fn()} />,
    );
    expect(container.querySelectorAll("a")).toHaveLength(0);
    expect(container.querySelectorAll("[role=button]")).toHaveLength(1);
  });

  it("opens the persistent queue with the full ordered set when its set affordance is clicked", () => {
    const onSetExpand = vi.fn();
    const onTuneIn = vi.fn();
    render(
      <FrontDoorRow
        ds={makeDialStation()}
        show={makeShow({
          crossings: 1,
          topArtists: ["First Artist"],
          currentTrack: makeSpin({ artist: "Current Artist", isLibraryHit: false }),
        })}
        ov={0}
        isActive={false}
        isSampling={false}
        onTuneIn={onTuneIn}
        setArtists={[
          { name: "First Artist", inLibrary: false, popular: false, debut: false, heard: false },
          { name: "Current Artist", inLibrary: false, popular: false, debut: false, heard: false },
          { name: "Final Artist", inLibrary: false, popular: false, debut: false, heard: false },
        ]}
        seedsLower={new Set()}
        onAddArtist={vi.fn()}
        onSetExpand={onSetExpand}
      />,
    );

    fireEvent.click(screen.getByText("in the current set"));
    expect(onSetExpand).toHaveBeenCalledOnce();
    expect(onTuneIn).not.toHaveBeenCalled();
    expect(document.querySelector(".fdrow__also-block")).toBeNull();
  });

  it("does not render a secondary byline caption for weak-match rows", () => {
    // ov-caption and np-line were removed — provenance is in the sentence itself.
    const { container } = renderRow(makeDialStation(), null, 7);
    expect(container.querySelector(".fdrow__ov-caption")).toBeNull();
  });

});

describe("attribution-only stations (no stream, no relay)", () => {
  it("renders a Listen-on-site link instead of a tune-in click target", () => {
    const onTuneIn = vi.fn();
    const { container } = render(
      <FrontDoorRow
        ds={makeDialStation({ streamUrl: null, homepageUrl: "https://wvum.org" } as Partial<DialStation["station"]>)}
        show={makeShow({ currentTrack: makeSpin() })}
        ov={0} isActive={false} isSampling={false} onTuneIn={onTuneIn} onEarlier={vi.fn()}
      />,
    );
    const link = container.querySelector(".fdrow__site-link") as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.getAttribute("href")).toBe("https://wvum.org/");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");

    // Clicking the row body never tunes — the safety-net error is unreachable.
    fireEvent.click(container.querySelector(".fdrow")!);
    expect(onTuneIn).not.toHaveBeenCalled();
  });

  it("omits the link when the station has no homepage, and still never tunes", () => {
    const onTuneIn = vi.fn();
    const { container } = render(
      <FrontDoorRow
        ds={makeDialStation({ streamUrl: null, homepageUrl: null } as Partial<DialStation["station"]>)}
        show={makeShow({ currentTrack: makeSpin() })}
        ov={0} isActive={false} isSampling={false} onTuneIn={onTuneIn} onEarlier={vi.fn()}
      />,
    );
    expect(container.querySelector(".fdrow__site-link")).toBeNull();
    fireEvent.click(container.querySelector(".fdrow")!);
    expect(onTuneIn).not.toHaveBeenCalled();
  });

  it("keeps the normal tune-in behavior for stations with a relay", () => {
    const onTuneIn = vi.fn();
    const { container } = render(
      <FrontDoorRow
        ds={makeDialStation({ streamUrl: null, relayUrl: "/api/stations/x/relay" } as Partial<DialStation["station"]>)}
        show={makeShow({ currentTrack: makeSpin() })}
        ov={0} isActive={false} isSampling={false} onTuneIn={onTuneIn} onEarlier={vi.fn()}
      />,
    );
    expect(container.querySelector(".fdrow__site-link")).toBeNull();
    fireEvent.click(container.querySelector(".fdrow")!);
    expect(onTuneIn).toHaveBeenCalledTimes(1);
  });

  it("keeps the normal tune-in behavior for stations with a direct stream", () => {
    const onTuneIn = vi.fn();
    const { container } = render(
      <FrontDoorRow
        ds={makeDialStation({ streamUrl: "https://example.com/stream" } as Partial<DialStation["station"]>)}
        show={makeShow({ currentTrack: makeSpin() })}
        ov={0} isActive={false} isSampling={false} onTuneIn={onTuneIn} onEarlier={vi.fn()}
      />,
    );
    expect(container.querySelector(".fdrow__site-link")).toBeNull();
    fireEvent.click(container.querySelector(".fdrow")!);
    expect(onTuneIn).toHaveBeenCalledTimes(1);
  });
});

describe("compact Dial feed identity", () => {
  it("renders fixed identity cells and keeps the row label in sync", () => {
    const { container } = renderCompactRow(
      makeDialStation({ name: "KEXP" }),
      makeShow({
        djName: "DJ Test",
        showName: "Morning Show",
        currentTrack: makeSpin({ artist: "The Long Winters" }),
      }),
    );

    const identity = container.querySelector(".fdrow__compact-identity");
    expect(identity).not.toBeNull();
    expect(identity?.querySelector(".fdrow__compact-artist")?.textContent).toBe("The Long Winters");
    expect(identity?.querySelector(".fdrow__compact-separator")?.textContent).toBe("·");
    // Station only between the dots — no DJ or show name in compact mode.
    expect(identity?.querySelector(".fdrow__compact-station")?.textContent).toBe("KEXP");
    expect(identity?.textContent).toContain("The Long Winters");
    expect(identity?.textContent).toContain("KEXP");
    expect(container.querySelector(".fdrow")?.getAttribute("aria-label")).toBe(
      "The Long Winters · KEXP",
    );
    expect(identity?.textContent).not.toMatch(/is playing|is on air/);
    expect(identity?.textContent).not.toMatch(/\blive\b/i);
    expect(identity?.querySelector(".fdrow__compact-live")).toBeNull();
    expect(identity?.querySelector(".fdrow__compact-live-dot")).toBeNull();
  });

  it("preserves the compact columns without inventing an artist", () => {
    const { container } = renderCompactRow(
      makeDialStation({ name: "KEXP" }),
      makeShow({ djName: "DJ Test", showName: "Morning Show", currentTrack: null }),
    );
    expect(container.querySelector(".fdrow__compact-artist")?.textContent).toBe("");
    // No artist → no dot separator (station reads on its own).
    expect(container.querySelector(".fdrow__compact-separator")).toBeNull();
    expect(container.querySelector(".fdrow__compact-station")?.textContent).toBe("KEXP");
    expect(container.querySelector(".fdrow")?.getAttribute("aria-label")).toBe("KEXP");
  });

  it("keeps the now-playing artist primary on a live crossing hit (no ', now' words)", () => {
    const { container } = renderCompactRow(
      makeDialStation({ name: "KCRW" }),
      makeShow({
        djName: "Jane Kamikazie",
        showName: "The Morning Show",
        currentTrack: makeSpin({ artist: "Wet Leg", isArtistHit: true }),
      }),
      { hasCrossing: true },
    );
    // No crossing sentence — the identity stays plain artist · station.
    expect(container.querySelector(".fdrow__compact-crossing")).toBeNull();
    expect(container.querySelector(".fdrow__compact-artist")?.textContent).toBe("Wet Leg");
    expect(container.querySelector(".fdrow__compact-station")?.textContent).toBe("KCRW");
    expect(container.querySelector(".fdrow")?.getAttribute("aria-label")).toBe(
      "Wet Leg · KCRW",
    );
    // Crossing meaning is carried by the ⬤ dot instead.
    expect(container.querySelector(".fdrow__crossing-dot")).not.toBeNull();
  });

  it("never replaces the now-playing artist with set-crossing artist names", () => {
    const { container } = renderCompactRow(
      makeDialStation({ name: "KCRW" }),
      makeShow({
        djName: "Jane Kamikazie",
        showName: "The Morning Show",
        crossings: 4,
        topArtists: ["Wet Leg", "Deftones", "Weezer", "Pavement"],
        currentTrack: makeSpin({ artist: "Someone Else" }),
      }),
      { hasCrossing: true },
    );
    expect(container.querySelector(".fdrow__compact-crossing")).toBeNull();
    expect(container.querySelector(".fdrow__compact-artist")?.textContent).toBe("Someone Else");
    expect(container.querySelector(".fdrow")?.getAttribute("aria-label")).toBe(
      "Someone Else · KCRW",
    );
    expect(container.textContent).not.toContain("this set");
    expect(container.querySelector(".fdrow__crossing-dot")).not.toBeNull();
  });

  it("renders no ⬤ dot when hasCrossing is false", () => {
    const { container } = renderCompactRow(
      makeDialStation({ name: "KCRW" }),
      makeShow({
        showName: "The Morning Show",
        crossings: 2,
        topArtists: ["Wet Leg", "Deftones"],
        currentTrack: null,
      }),
      { hasCrossing: false },
    );
    expect(container.querySelector(".fdrow__crossing-dot")).toBeNull();
    expect(container.textContent).not.toContain("this set");
  });

  it("renders no ⬤ dot when crossings are suppressed (/radio)", () => {
    const { container } = renderCompactRow(
      makeDialStation({ name: "KCRW" }),
      makeShow({
        currentTrack: makeSpin({ artist: "Wet Leg", isArtistHit: true }),
      }),
      { hasCrossing: true, suppressCrossings: true },
    );
    expect(container.querySelector(".fdrow__crossing-dot")).toBeNull();
  });

  it("⬤ dot toggles the inline crossing detail without tuning or expanding", () => {
    const onTuneIn = vi.fn();
    const onCrossingDetail = vi.fn();
    const ds = makeDialStation(
      { name: "KCRW", streamUrl: "https://example.com/stream" },
      { crossings: 3, artistCrossings: 1, topArtistNames: ["Wet Leg", "Deftones"] },
    );
    const show = makeShow({
      crossings: 2,
      artistCrossings: 0,
      topArtists: ["Wet Leg", "Deftones"],
      currentTrack: makeSpin({ artist: "Someone Else" }),
    });
    ds.shows = [show];
    const { container } = renderCompactRow(ds, show, {
      hasCrossing: true, crossingScope: "set", onTuneIn, onCrossingDetail,
    });
    const dot = container.querySelector(".fdrow__crossing-dot")!;
    fireEvent.click(dot);
    expect(onCrossingDetail).toHaveBeenCalledTimes(1);
    expect(onTuneIn).not.toHaveBeenCalled();
    // The row did not expand — the dot owns its own click.
    expect(container.querySelector(".fdrow")?.getAttribute("aria-expanded")).toBe("false");
    const detail = container.querySelector(".fdrow__crossing-detail")!;
    expect(detail).not.toBeNull();
    expect(detail.querySelector(".fdrow__crossing-detail-scope")?.textContent).toBe("this set");
    expect(detail.textContent).toContain("Wet Leg");
    expect(detail.textContent).toContain("Deftones");
    expect(detail.textContent).toContain("2 crossings");
    // Second tap collapses.
    fireEvent.click(dot);
    expect(container.querySelector(".fdrow__crossing-detail")).toBeNull();
  });

  it("tuning in collapses the inline crossing detail", () => {
    const onTuneIn = vi.fn();
    const ds = makeDialStation(
      { name: "KEXP", streamUrl: "https://example.com/stream" },
      { crossings: 1, topArtistNames: ["Wet Leg"] },
    );
    const show = makeShow({ crossings: 1, topArtists: ["Wet Leg"], currentTrack: makeSpin({ artist: "Broadcast" }) });
    ds.shows = [show];
    const { container } = renderCompactRow(ds, show, { hasCrossing: true, onTuneIn });
    fireEvent.click(container.querySelector(".fdrow__crossing-dot")!);
    expect(container.querySelector(".fdrow__crossing-detail")).not.toBeNull();
    const row = container.querySelector(".fdrow")!;
    fireEvent.click(row); // expand
    fireEvent.click(row); // tune in
    expect(onTuneIn).toHaveBeenCalledOnce();
    expect(container.querySelector(".fdrow__crossing-detail")).toBeNull();
  });

  it("keeps attribution-only site-link behavior on compact rows (never tunes)", () => {
    const onTuneIn = vi.fn();
    const { container } = renderCompactRow(
      makeDialStation({ name: "WVUM", homepageUrl: "https://wvum.org" } as Partial<DialStation["station"]>),
      makeShow({ currentTrack: makeSpin({ artist: "Broadcast" }) }),
      { onTuneIn },
    );
    const row = container.querySelector(".fdrow")!;
    fireEvent.click(row);
    expect(onTuneIn).not.toHaveBeenCalled();
    expect(container.querySelector(".fdrow__site-link")?.textContent).toContain("Listen on site");
  });

  it("first tap expands a playable compact row; second tap tunes in", () => {
    const onTuneIn = vi.fn();
    const { container } = renderCompactRow(
      makeDialStation({ name: "KEXP", streamUrl: "https://example.com/stream" }),
      makeShow({ currentTrack: makeSpin({ artist: "Broadcast" }) }),
      { onTuneIn },
    );
    const row = container.querySelector(".fdrow")!;

    // First tap: expands — no tune-in, aria-expanded=true, no ticker cycling.
    fireEvent.click(row);
    expect(onTuneIn).not.toHaveBeenCalled();
    expect(row.getAttribute("aria-expanded")).toBe("true");
    // No auto-cycling ticker in the new design.
    expect(container.querySelector(".fdrow__ticker")).toBeNull();

    // Second tap: tunes in.
    fireEvent.click(row);
    expect(onTuneIn).toHaveBeenCalledOnce();
  });

  it("collapsed compact row starts with aria-expanded=false and no byline or detail", () => {
    const { container } = renderCompactRow(
      makeDialStation({ name: "KEXP", streamUrl: "https://example.com/stream" }),
      makeShow({ djName: "DJ Test", currentTrack: makeSpin({ artist: "Broadcast" }) }),
    );
    const row = container.querySelector(".fdrow")!;
    expect(row.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector(".fdrow__byline")).toBeNull();
    expect(container.querySelector(".fdrow__detail")).toBeNull();
  });

  it("expanded row shows DJ · Show byline and song title + site link in detail panel", () => {
    const blurb = "Independent radio for adventurous listeners.";
    const { container } = renderCompactRow(
      makeDialStation({
        name: "KEXP",
        streamUrl: "https://example.com/stream",
        homepageUrl: "https://kexp.org",
        homepageBlurb: blurb,
      } as Partial<DialStation["station"]>),
      makeShow({
        djName: "John Richards",
        showName: "Morning Show",
        currentTrack: makeSpin({ artist: "Broadcast", title: "Come On Let's Go" }),
      }),
    );
    fireEvent.click(container.querySelector(".fdrow")!);

    // Byline: DJ · Show
    const byline = container.querySelector(".fdrow__byline");
    expect(byline).not.toBeNull();
    expect(byline?.querySelector(".fdrow__byline-dj")?.textContent).toBe("John Richards");
    expect(byline?.querySelector(".fdrow__byline-show")?.textContent).toBe("Morning Show");

    // Detail panel: title, blurb, link
    const detail = container.querySelector(".fdrow__detail");
    expect(detail).not.toBeNull();
    expect(detail?.querySelector(".fdrow__detail-title")?.textContent).toBe("Come On Let's Go");
    expect(detail?.querySelector(".fdrow__detail-blurb")?.textContent).toBe(blurb);
    const link = detail?.querySelector(".fdrow__detail-link") as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.getAttribute("href")).toBe("https://kexp.org/");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(link.textContent).toContain("KEXP");
  });

  it("byline omits show when it echoes the station name", () => {
    const { container } = renderCompactRow(
      makeDialStation({ name: "KEXP", streamUrl: "https://example.com/stream" }),
      makeShow({
        djName: "DJ Test",
        showName: "KEXP", // echoes station name — filtered out
        currentTrack: makeSpin({ artist: "Broadcast", title: "Come On Let's Go" }),
      }),
    );
    fireEvent.click(container.querySelector(".fdrow")!);
    const byline = container.querySelector(".fdrow__byline");
    expect(byline?.querySelector(".fdrow__byline-dj")?.textContent).toBe("DJ Test");
    expect(byline?.querySelector(".fdrow__byline-show")).toBeNull();
  });

  it("no byline rendered when neither DJ nor show name is available", () => {
    const { container } = renderCompactRow(
      makeDialStation({ name: "KEXP", streamUrl: "https://example.com/stream" }),
      makeShow({
        djName: null,
        showName: "KEXP", // echoes station name — filtered out
        currentTrack: makeSpin({ artist: "Broadcast", title: "Come On Let's Go" }),
      }),
    );
    fireEvent.click(container.querySelector(".fdrow")!);
    expect(container.querySelector(".fdrow__byline")).toBeNull();
  });

  it("shows an intentional live-broadcast state when no station detail is available", () => {
    const { container } = renderCompactRow(
      makeDialStation({
        name: "KEXP",
        streamUrl: "https://example.com/stream",
        homepageBlurb: "   ",
      }),
      makeShow({
        showName: "KEXP", // echoes the station name — filtered out
        currentTrack: makeSpin({ artist: "Broadcast", title: null as unknown as string }),
      }),
    );
    fireEvent.click(container.querySelector(".fdrow")!);
    // Whitespace blurb is excluded, but the expanded disclosure is never blank.
    expect(container.querySelector(".fdrow__detail-blurb")).toBeNull();
    expect(container.querySelector(".fdrow__detail-empty")?.textContent)
      .toBe("Live broadcast — tune in for the set.");
  });

  it("station name stays pinned in the right cluster in both modes", () => {
    const { container } = renderCompactRow(
      makeDialStation({ name: "KEXP", streamUrl: "https://example.com/stream" }),
      makeShow({ currentTrack: makeSpin({ artist: "Broadcast" }) }),
    );
    const stationIn = () =>
      container.querySelector(".fdrow__compact-right .fdrow__compact-station")?.textContent;
    expect(stationIn()).toBe("KEXP");
    fireEvent.click(container.querySelector(".fdrow")!); // meta mode
    expect(stationIn()).toBe("KEXP");
  });

  it("expanded byline shows Keep button only when onKeep is provided", () => {
    const onKeep = vi.fn();
    const { container } = renderCompactRow(
      makeDialStation({ name: "KEXP", streamUrl: "https://example.com/stream" }),
      makeShow({ currentTrack: makeSpin({ artist: "Broadcast", title: "Come On Let's Go" }) }),
      { onKeep },
    );
    // Before expand: no Keep button
    expect(container.querySelector(".fdrow__keep")).toBeNull();

    fireEvent.click(container.querySelector(".fdrow")!);
    const keepBtn = container.querySelector(".fdrow__keep");
    expect(keepBtn).not.toBeNull();
    expect(keepBtn?.textContent).toBe("+ Keep");

    // Clicking Keep calls the callback and does not trigger tune-in
    fireEvent.click(keepBtn!);
    expect(onKeep).toHaveBeenCalledOnce();
  });

  it("no Keep button appears on the byline when onKeep is not provided", () => {
    const { container } = renderCompactRow(
      makeDialStation({ name: "KEXP", streamUrl: "https://example.com/stream" }),
      makeShow({ currentTrack: makeSpin({ artist: "Broadcast" }) }),
    );
    fireEvent.click(container.querySelector(".fdrow")!);
    expect(container.querySelector(".fdrow__keep")).toBeNull();
  });

  it("shows ✳ coverage marker when hasInvestigationSources is true", () => {
    const onOpenArtistInvestigation = vi.fn();
    const { container } = renderCompactRow(
      makeDialStation({ name: "KEXP", streamUrl: "https://example.com/stream" }),
      makeShow({ currentTrack: makeSpin({ artist: "Broadcast" }) }),
      { hasInvestigationSources: true, onOpenArtistInvestigation },
    );
    const marker = container.querySelector(".fdrow__coverage-marker");
    expect(marker).not.toBeNull();
    expect(marker?.textContent).toBe("✳");
    fireEvent.click(marker!);
    expect(onOpenArtistInvestigation).toHaveBeenCalledOnce();
  });

  it("omits ✳ coverage marker when hasInvestigationSources is false", () => {
    const { container } = renderCompactRow(
      makeDialStation({ name: "KEXP" }),
      makeShow({ currentTrack: makeSpin({ artist: "Broadcast" }) }),
    );
    expect(container.querySelector(".fdrow__coverage-marker")).toBeNull();
  });

  it("adds fdrow--expanded class when compact row is expanded", () => {
    const { container } = renderCompactRow(
      makeDialStation({ name: "KEXP", streamUrl: "https://example.com/stream" }),
      makeShow({ currentTrack: makeSpin({ artist: "Broadcast" }) }),
    );
    const row = container.querySelector(".fdrow")!;
    expect(row.classList.contains("fdrow--expanded")).toBe(false);
    fireEvent.click(row);
    expect(row.classList.contains("fdrow--expanded")).toBe(true);
  });

  it("Space on the Keep button does not expand or tune the row", () => {
    const onTuneIn = vi.fn();
    const onKeep = vi.fn();
    const { container } = renderCompactRow(
      makeDialStation({ name: "KEXP", streamUrl: "https://example.com/stream" }),
      makeShow({ currentTrack: makeSpin({ artist: "Broadcast", title: "Come On Let's Go" }) }),
      { onTuneIn, onKeep },
    );
    const row = container.querySelector(".fdrow")!;
    // Expand the row first.
    fireEvent.click(row);
    expect(container.querySelector(".fdrow__keep")).not.toBeNull();

    // Space on the Keep button should not bubble to the row's keydown handler.
    const keepBtn = container.querySelector(".fdrow__keep")!;
    fireEvent.keyDown(keepBtn, { key: " " });
    // Row is still expanded (no second-tap tune-in happened).
    expect(row.classList.contains("fdrow--expanded")).toBe(true);
    expect(onTuneIn).not.toHaveBeenCalled();
  });

  it("Space on the ✳ marker does not expand or tune the row", () => {
    const onOpenArtistInvestigation = vi.fn();
    const { container } = renderCompactRow(
      makeDialStation({ name: "KEXP", streamUrl: "https://example.com/stream" }),
      makeShow({ currentTrack: makeSpin({ artist: "Broadcast" }) }),
      { hasInvestigationSources: true, onOpenArtistInvestigation },
    );
    const row = container.querySelector(".fdrow")!;
    // Row is collapsed — Space on the marker button should not expand it.
    const marker = container.querySelector(".fdrow__coverage-marker")!;
    fireEvent.keyDown(marker, { key: " " });
    expect(row.classList.contains("fdrow--expanded")).toBe(false);
  });

  it("pointerdown on the ✳ marker does not arm the long-press tune timer", () => {
    // Verify that pointerDown is stopped at the marker so the row never
    // fires its long-press tune-in path when the marker is pressed.
    const onTuneIn = vi.fn();
    const onOpenArtistInvestigation = vi.fn();
    const { container } = renderCompactRow(
      makeDialStation({ name: "KEXP", streamUrl: "https://example.com/stream" }),
      makeShow({ currentTrack: makeSpin({ artist: "Broadcast" }) }),
      { onTuneIn, hasInvestigationSources: true, onOpenArtistInvestigation },
    );
    const marker = container.querySelector(".fdrow__coverage-marker")!;
    // PointerDown on the marker is stopped at the button itself; the row
    // never receives it, so no long-press timer is armed.
    fireEvent.pointerDown(marker);
    // Simulate the timeout interval passing without cancelLongPress being called.
    // Since no timer was armed, nothing should call onTuneIn.
    expect(onTuneIn).not.toHaveBeenCalled();
  });
});
describe("expanded row station link", () => {
  it("shows a clickable ↗ station link in the detail panel for a playable station with a homepage", () => {
    const onTuneIn = vi.fn();
    const { container } = renderCompactRow(
      makeDialStation({
        name: "KEXP",
        streamUrl: "https://example.com/stream",
        homepageUrl: "https://kexp.org",
      } as Partial<DialStation["station"]>),
      makeShow({ djName: "DJ Test", currentTrack: makeSpin({ artist: "Broadcast" }) }),
      { onTuneIn },
    );
    const row = container.querySelector(".fdrow")!;
    // Collapsed playable row: no link anywhere (tier-1 link is reserved
    // for attribution-only stations).
    expect(container.querySelector(".fdrow__detail-link")).toBeNull();
    expect(container.querySelector(".fdrow__site-link")).toBeNull();

    // Expand: the detail panel carries the station link.
    fireEvent.click(row);
    const link = container.querySelector(".fdrow__detail-link") as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.getAttribute("href")).toBe("https://kexp.org/");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(link.textContent).toContain("KEXP");

    // Clicking the link never triggers the tune-in handler.
    fireEvent.click(link);
    expect(onTuneIn).not.toHaveBeenCalled();
  });

  it("never renders a detail link for a playable station without a homepage", () => {
    const { container } = renderCompactRow(
      makeDialStation({ name: "KEXP", streamUrl: "https://example.com/stream" }),
      makeShow({ djName: "DJ Test", currentTrack: makeSpin({ artist: "Broadcast" }) }),
    );
    fireEvent.click(container.querySelector(".fdrow")!);
    expect(container.querySelector(".fdrow__detail-link")).toBeNull();
  });

  it("keeps the tier-1 site link for attribution-only stations (no playable source)", () => {
    const { container } = renderCompactRow(
      makeDialStation({ streamUrl: null, homepageUrl: "https://wvum.org" } as Partial<DialStation["station"]>),
      makeShow({ currentTrack: makeSpin() }),
    );
    expect(container.querySelector(".fdrow__site-link")).not.toBeNull();
    expect(container.querySelector(".fdrow__detail-link")).toBeNull();
  });
});
