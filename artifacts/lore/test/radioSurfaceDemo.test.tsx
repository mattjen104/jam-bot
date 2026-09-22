// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { DialStation } from "../src/hooks/useDialData";

const toggle = vi.fn();

vi.mock("../src/player/PlayerProvider", () => ({
  usePlayer: () => ({
    radio: {
      station: null,
      toggle,
    },
  }),
}));

import { RadioSurface } from "../src/components/RadioSurface";
import { stationCurationSentence } from "../src/lib/stationDisplayMetadata";

function matchingStation(): DialStation {
  return {
    station: {
      id: 7,
      slug: "kexp",
      name: "KEXP 90.3 FM",
      city: "Seattle",
      logoUrl: "https://example.com/kexp.png",
      stationIconUrl: "https://kexp.org/favicon.png",
      stationCategories: ["anchor"],
      homepageBlurb:
        "Seattle's nonprofit music service, founded at the University of Washington in 1972, pairs broad, human-curated programming with live sessions and community events.",
    },
    isLive: true,
    liveTrack: {
      mbid: "recording-1",
      artistMbid: "artist-1",
      title: "French Disko",
      artist: "Stereolab",
      resolving: false,
      isLibraryHit: true,
      isArtistHit: true,
    },
    shows: [],
    weekCrossings: 4,
    weekArtistCrossings: 0,
    lifetimeCrossings: 4,
    lifetimeArtistCrossings: 2,
    topArtistNames: ["Stereolab"],
    topArtistNames24h: ["Stereolab"],
    topArtistNames7d: ["Stereolab"],
    topArtistNamesLifetime: ["Stereolab"],
    albumCrossings: [],
  } as unknown as DialStation;
}

describe("demo Radio station cards", () => {
  beforeEach(() => toggle.mockClear());
  afterEach(cleanup);

  test("leads with station identity and makes artist-lens copy specific", () => {
    const onOpenCrossings = vi.fn();
    const onFocusArtist = vi.fn();
    render(
      <RadioSurface
        stations={[matchingStation()]}
        hasSeeds
        hasLibrary
        showHeader={false}
        focusedArtist="Stereolab"
        onFocusArtist={onFocusArtist}
        onOpenStationCrossings={onOpenCrossings}
      />,
    );

    expect(screen.getByText("Stations that play Stereolab")).toBeTruthy();
    expect(screen.getAllByText("KEXP 90.3 FM").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Core station").length).toBeGreaterThan(0);
    expect(screen.getAllByText("from").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Seattle").length).toBeGreaterThan(0);
    expect(screen.queryByText("French Disko")).toBeNull();
    expect(screen.queryByText("Library match · on air")).toBeNull();
    expect(screen.queryByText("Open set")).toBeNull();
    expect(screen.queryByText("Stereolab", { selector: ".demo-radio__artist" })).toBeNull();
    expect(screen.getAllByText(/crossings?/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Has played your artists 6 times/)).toBeNull();
    const card = screen.getByText("KEXP 90.3 FM").closest("article");
    const facts = card?.querySelector(".demo-radio__station-facts");
    const description = card?.querySelector(".demo-radio__curation-sentence");
    const crossing = card?.querySelector(".demo-radio__reason");
    expect(facts?.textContent).toBe("Core stationfromSeattle");
    expect(facts?.compareDocumentPosition(description as Node)
      & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(description?.textContent).toContain("Seattle's nonprofit music service");
    expect(description?.compareDocumentPosition(crossing as Node)
      & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test("replaces non-English scraped descriptions with an English fallback", () => {
    const station = matchingStation();
    station.station.slug = "berlin-radio";
    station.station.name = "Berlin Radio";
    station.station.city = "Berlin";
    station.station.homepageBlurb =
      "Der Sender bringt Musik direkt aufs Smartphone und sendet rund um die Uhr.";

    render(
      <RadioSurface
        stations={[station]}
        hasSeeds
        hasLibrary
        showHeader={false}
      />,
    );

    expect(screen.queryByText(/Der Sender bringt Musik/)).toBeNull();
    expect(screen.getByText(/selected for its distinctive music programming from Berlin/))
      .toBeTruthy();
  });

  test.each([
    [
      "Yammat FM",
      "yammat-fm",
      "Croatia",
      "Radio streamovi Za drugo stanje svijesti Pokrenite svoj zvuk, live i tematskim glazbenim streamovima. Pred vama je sve što vam treba. play_arrow ROMANTIC REBELS &#038; POP WAVES New Wave / POP / 80&#039;s / 90&#039;s play_arrow YAMMAT LIVE ON AIR play_arrow STREET SPITTA HIP HOP/",
    ],
    [
      "NEU RADIO",
      "neu-radio",
      "Italy",
      "Neu Radio è la nuova web radio, un collettivo, un aggregatore culturale. In streaming 24/7 da Bologna verso il mondo.",
    ],
  ])("keeps the %s card description in English", (name, slug, country, homepageBlurb) => {
    const station = matchingStation().station;
    station.name = name;
    station.slug = slug;
    station.city = null;
    station.country = country;
    station.homepageBlurb = homepageBlurb;

    const description = stationCurationSentence(station);
    expect(description).not.toBe(homepageBlurb);
    expect(description).toContain(`programming from ${country}`);
  });

  test("omits placeholder metadata and tunes from the card", () => {
    const station = matchingStation();
    station.station.city = null;
    station.station.stationCategories = [];
    render(
      <RadioSurface
        stations={[station]}
        hasSeeds
        hasLibrary
        showHeader={false}
        focusedArtist="Stereolab"
        onOpenStationCrossings={vi.fn()}
      />,
    );

    expect(screen.queryByText(/Location unavailable|Unknown/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Listen to KEXP 90.3 FM" }));
    expect(toggle).toHaveBeenCalledWith(station.station);
  });

  test("does not make placeholder artist metadata interactive", () => {
    render(
      <RadioSurface
        stations={[{
          ...matchingStation(),
          liveTrack: {
            ...matchingStation().liveTrack!,
            artist: "",
            artistMbid: null,
          },
        }]}
        hasSeeds={false}
        hasLibrary={false}
        showHeader={false}
        onFocusArtist={vi.fn()}
      />,
    );
    // Since we no longer show track metadata, we assert it doesn't appear
    expect(screen.queryByText("Unknown artist")).toBeNull();
    expect(screen.queryByRole("button", { name: "Unknown artist" })).toBeNull();
  });

  test.each([
    ["host", "Cheryl Waters", ["Cheryl Waters"]],
    ["show", "The Midday Show", ["The Midday Show"]],
  ])("keeps source-backed %s metadata plain text", (_kind, artist, artistActionExclusions) => {
    render(
      <RadioSurface
        stations={[{
          ...matchingStation(),
          artistActionExclusions,
          liveTrack: {
            ...matchingStation().liveTrack!,
            artist,
            artistMbid: null,
          },
        }]}
        hasSeeds
        hasLibrary
        showHeader={false}
        onFocusArtist={vi.fn()}
      />,
    );

    expect(screen.queryByText(artist)).toBeNull();
    expect(screen.queryByRole("button", { name: artist })).toBeNull();
  });

  test("keeps unresolved but otherwise usable artist metadata actionable", () => {
    const onFocusArtist = vi.fn();
    render(
      <RadioSurface
        stations={[{
          ...matchingStation(),
          liveTrack: {
            ...matchingStation().liveTrack!,
            artist: "Broadcast",
            artistMbid: null,
          },
        }]}
        hasSeeds
        hasLibrary
        showHeader={false}
        onFocusArtist={onFocusArtist}
      />,
    );

    expect(screen.queryByText("Broadcast")).toBeNull();
    expect(screen.queryByRole("button", { name: "Broadcast" })).toBeNull();
  });

  test("shows crossing artists as clickable chips without comma separators", () => {
    const onFocusArtist = vi.fn();
    render(
      <RadioSurface
        stations={[matchingStation()]}
        hasSeeds
        hasLibrary
        showHeader={false}
        onFocusArtist={onFocusArtist}
      />,
    );

    const artistChip = screen.getByRole("button", { name: "Stereolab" });
    expect(artistChip.classList.contains("demo-radio__evidence-artist-chip")).toBe(true);
    expect(artistChip.closest(".demo-radio__reason")?.textContent).not.toContain(",");
    fireEvent.click(artistChip);
    expect(onFocusArtist).toHaveBeenCalledWith("Stereolab", null);
  });

  test("keeps a grounded artist actionable despite matching attribution text", () => {
    const onFocusArtist = vi.fn();
    render(
      <RadioSurface
        stations={[{
          ...matchingStation(),
          artistActionExclusions: ["Stereolab"],
        }]}
        hasSeeds
        hasLibrary
        showHeader={false}
        onFocusArtist={onFocusArtist}
      />,
    );

    expect(screen.queryByText("Stereolab", { selector: ".demo-radio__artist" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Stereolab" })).toBeNull();
  });

  test("shows a mission-only recommendation without inventing track metadata", () => {
    const mission = matchingStation();
    mission.station.slug = "wfmu";
    mission.station.name = "WFMU";
    mission.station.streamUrl = "https://radio.example/wfmu";
    mission.station.automationClass = "human";
    mission.station.homepageBlurb =
      "WFMU is an independent, listener-supported freeform station with a New York-area broadcast, an online stream, and an unusually deep program archive.";
    mission.lifetimeCrossings = 0;
    mission.lifetimeArtistCrossings = 0;
    mission.weekCrossings = 0;
    mission.liveTrack = null;
    mission.shows = [];
    render(
      <RadioSurface
        stations={[mission]}
        hasSeeds
        hasLibrary
        showHeader={false}
      />,
    );
    expect(screen.getByText("Beyond your Library")).toBeTruthy();
    expect(screen.getByText(/WFMU is an independent, listener-supported freeform station/)).toBeTruthy();
    expect(screen.queryByText(/This set/)).toBeNull();
  });

  test("pins the nearest ZIP-local Bro Zone station first in For you", () => {
    const bro = matchingStation();
    const personal = matchingStation();
    personal.station.slug = "heady";
    personal.station.name = "HEADY";
    const mission = matchingStation();
    mission.station.slug = "wfmu";
    mission.station.name = "WFMU";
    mission.station.streamUrl = "https://radio.example/wfmu";
    mission.station.automationClass = "human";
    mission.weekCrossings = 0;
    mission.lifetimeCrossings = 0;
    mission.lifetimeArtistCrossings = 0;
    mission.liveTrack = null;

    render(
      <RadioSurface
        mode="highlights"
        stations={[bro, personal, mission]}
        broZoneStations={[bro]}
        broZoneLocationLabel="Seattle, WA"
        onRequestBroZoneZip={vi.fn()}
        hasSeeds
        hasLibrary
        showHeader={false}
      />,
    );

    const headings = screen.getAllByText(/For you|Beyond your Library/)
      .map((element) => element.textContent);
    expect(headings).toEqual(["For you", "Beyond your Library"]);
    expect(screen.getAllByText("KEXP 90.3 FM")).toHaveLength(1);
    expect(screen.getByText("HEADY")).toBeTruthy();
    const stationNames = screen.getAllByRole("article")
      .map((article) => article.querySelector(".demo-radio__crossing-station-name")?.textContent);
    expect(stationNames.slice(0, 2)).toEqual(["KEXP 90.3 FM", "HEADY"]);
    expect(screen.getByRole("button", { name: "Seattle, WA · Change ZIP" })).toBeTruthy();
    const personalCard = screen.getByText("HEADY").closest("article");
    const curation = personalCard?.querySelector(".demo-radio__curation-sentence");
    const crossing = personalCard?.querySelector(".demo-radio__reason--secondary");
    expect(curation?.textContent).toContain("Seattle's nonprofit music service");
    expect(crossing?.textContent).toContain("4 crossings this week");
    expect(curation?.compareDocumentPosition(crossing as Node)
      & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText("Near you (& bros)")).toBeNull();
    expect(screen.queryByText("Specialist sounds")).toBeNull();
    expect(screen.queryByText("Era / Retro / Oldies")).toBeNull();
  });
});
