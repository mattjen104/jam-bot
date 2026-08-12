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
    // Full provenance returns between the dots: DJ | Show | Station.
    expect(identity?.querySelector(".fdrow__compact-provenance")?.textContent).toBe(
      "DJ Test | Morning Show | KEXP",
    );
    expect(identity?.querySelector(".fdrow__compact-station")?.textContent).toBe("KEXP");
    expect(identity?.textContent).toContain("The Long Winters");
    expect(identity?.textContent).toContain("KEXP");
    expect(container.querySelector(".fdrow")?.getAttribute("aria-label")).toBe(
      "The Long Winters · DJ Test | Morning Show | KEXP",
    );
    expect(identity?.textContent).not.toMatch(/is playing|is on air/);
  });

  it("preserves the compact columns without inventing an artist", () => {
    const { container } = renderCompactRow(
      makeDialStation({ name: "KEXP" }),
      makeShow({ djName: "DJ Test", showName: "Morning Show", currentTrack: null }),
    );
    expect(container.querySelector(".fdrow__compact-artist")?.textContent).toBe("");
    // No artist → no dot separator (provenance reads on its own).
    expect(container.querySelector(".fdrow__compact-separator")).toBeNull();
    expect(container.querySelector(".fdrow__compact-provenance")?.textContent).toBe(
      "DJ Test | Morning Show | KEXP",
    );
    expect(container.querySelector(".fdrow__compact-station")?.textContent).toBe("KEXP");
    expect(container.querySelector(".fdrow")?.getAttribute("aria-label")).toBe(
      "DJ Test | Morning Show | KEXP",
    );
  });

  it("marks a live crossing hit with ', now'", () => {
    const { container } = renderCompactRow(
      makeDialStation({ name: "KCRW" }),
      makeShow({
        djName: "Jane Kamikazie",
        showName: "The Morning Show",
        currentTrack: makeSpin({ artist: "Wet Leg", isArtistHit: true }),
      }),
    );
    const crossing = container.querySelector(".fdrow__compact-crossing");
    expect(crossing?.textContent).toBe("Wet Leg, now");
    expect(container.querySelector(".fdrow__compact-provenance")?.textContent).toBe(
      "Jane Kamikazie | The Morning Show | KCRW",
    );
    expect(container.querySelector(".fdrow")?.getAttribute("aria-label")).toBe(
      "Wet Leg, now · Jane Kamikazie | The Morning Show | KCRW",
    );
  });

  it("lists up to three set-crossing artists with ', this set'", () => {
    const { container } = renderCompactRow(
      makeDialStation({ name: "KCRW" }),
      makeShow({
        djName: "Jane Kamikazie",
        showName: "The Morning Show",
        crossings: 4,
        topArtists: ["Wet Leg", "Deftones", "Weezer", "Pavement"],
        currentTrack: makeSpin({ artist: "Someone Else" }),
      }),
    );
    const crossing = container.querySelector(".fdrow__compact-crossing");
    // Oxford comma, capped at three names, set-level suffix.
    expect(crossing?.textContent).toBe("Wet Leg, Deftones, and Weezer, this set");
    expect(container.querySelector(".fdrow")?.getAttribute("aria-label")).toBe(
      "Wet Leg, Deftones, and Weezer, this set · Jane Kamikazie | The Morning Show | KCRW",
    );
  });

  it("uses plain 'and' for two set-crossing artists", () => {
    const { container } = renderCompactRow(
      makeDialStation({ name: "KCRW" }),
      makeShow({
        showName: "The Morning Show",
        crossings: 2,
        topArtists: ["Wet Leg", "Deftones"],
        currentTrack: null,
      }),
    );
    expect(container.querySelector(".fdrow__compact-crossing")?.textContent).toBe(
      "Wet Leg and Deftones, this set",
    );
  });

  it("keeps tune-in and attribution-only site-link behavior on compact rows", () => {
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

    cleanup();
    const playableTuneIn = vi.fn();
    const { container: playable } = renderCompactRow(
      makeDialStation({ name: "KEXP", streamUrl: "https://example.com/stream" }),
      makeShow({ currentTrack: makeSpin({ artist: "Broadcast" }) }),
      { onTuneIn: playableTuneIn },
    );
    fireEvent.click(playable.querySelector(".fdrow")!);
    expect(playableTuneIn).toHaveBeenCalledOnce();
  });
});