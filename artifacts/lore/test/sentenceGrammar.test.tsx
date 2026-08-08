// @vitest-environment jsdom
/**
 * Grammar module tests — link policy and forbidden content.
 *
 * The grammar module is the ONE place link rules live:
 *   - linkable roles: artist + DJ (dotted underline = navigate → lens)
 *   - add/seed is an explicit `+` affordance, never the name itself
 *   - yours (library/seeded) = bright white, no underline
 *   - station/show are structural attribution BELOW the sentence
 *   - SONG TITLES NEVER APPEAR in radio sentences (enforced here)
 */
import React, { type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import {
  RADIO_LINK_POLICY,
  radioSummarySentence,
  artistNode,
  djNode,
  attributionLine,
  crossingSentence,
  reason,
} from "../src/dial/grammar";
import type { DialShow, DialSpin } from "../src/hooks/useDialData";

function makeShow(overrides: Partial<DialShow> = {}): DialShow {
  return {
    runId: 1,
    showName: "Morning Mix",
    djName: null,
    startedAt: new Date(Date.now() - 30 * 60_000).toISOString(),
    endedAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    ianaTimezone: "America/Los_Angeles",
    state: "live",
    spins: [],
    crossings: 0,
    artistCrossings: 0,
    topArtists: [],
    topArtistNames: [],
    currentTrack: null,
    isPickerShow: false,
    pickerId: null,
    ...overrides,
  } as DialShow;
}

function makeSpin(overrides: Partial<DialSpin> = {}): DialSpin {
  return {
    mbid: "mbid-test",
    artistMbid: null,
    title: "SECRET SONG TITLE",
    artist: "Test Artist",
    playedAt: new Date().toISOString(),
    isLibraryHit: false,
    isArtistHit: false,
    isFirstSpin: false,
    ...overrides,
  } as DialSpin;
}

function text(node: ReactNode): string {
  return renderToStaticMarkup(<>{node}</>).replace(/<[^>]+>/g, "");
}

describe("link policy constant", () => {
  it("declares artist/dj linkable, station/show attribution, song titles forbidden", () => {
    expect([...RADIO_LINK_POLICY.linkableRoles]).toEqual(["artist", "dj"]);
    expect([...RADIO_LINK_POLICY.attributionRoles]).toEqual(["show", "station"]);
    expect([...RADIO_LINK_POLICY.forbiddenContent]).toEqual(["songTitle"]);
  });
});

describe("radio sentences never contain song titles", () => {
  const TITLE = "SECRET SONG TITLE";

  it("radioSummarySentence never surfaces the current track title", () => {
    const show = makeShow({
      djName: "Tom Schnabel",
      currentTrack: makeSpin({ artist: "Björk", isLibraryHit: true, title: TITLE }),
      crossings: 1,
      topArtists: ["Björk"],
    });
    const { sentence, attribution } = radioSummarySentence({ stationName: "KCRW", show });
    expect(text(sentence)).not.toContain(TITLE);
    expect(text(attribution)).not.toContain(TITLE);
    expect(text(sentence)).toContain("Björk");
  });

  it("crossingSentence never surfaces the current track title", () => {
    const show = makeShow({
      crossings: 1,
      topArtists: ["Portishead"],
      currentTrack: makeSpin({ artist: "Portishead", isLibraryHit: true, title: TITLE }),
    });
    const result = crossingSentence("KCRW", show);
    expect(text(result!.node)).not.toContain(TITLE);
  });

  it("reason ladder never surfaces the current track title at any rung", () => {
    const spins = [
      makeShow({ currentTrack: makeSpin({ isLibraryHit: true, title: TITLE }) }),
      makeShow({ currentTrack: makeSpin({ isArtistHit: true, title: TITLE }) }),
      makeShow({ crossings: 2, topArtists: ["A"], currentTrack: makeSpin({ title: TITLE }) }),
      makeShow({ djName: "DJ X", currentTrack: makeSpin({ title: TITLE }) }),
    ];
    for (const show of spins) {
      expect(text(reason(show, 0).node)).not.toContain(TITLE);
    }
  });
});

describe("sentence link semantics", () => {
  afterEach(() => cleanup());

  it("artists and DJs render as dotted-underline navigation buttons when linked", () => {
    const onArtist = vi.fn();
    const onDj = vi.fn();
    const show = makeShow({
      djName: "Tom Schnabel",
      crossings: 2,
      topArtists: ["Portishead", "Broadcast"],
    });
    const { sentence } = radioSummarySentence({
      stationName: "KCRW",
      show,
      links: { onArtist, onDj },
    });
    render(<p>{sentence}</p>);
    const artistBtn = screen.getByRole("button", { name: "Portishead" });
    expect(artistBtn.className).toContain("gram-link--nav");
    fireEvent.click(artistBtn);
    expect(onArtist).toHaveBeenCalledWith("Portishead");
    const djBtn = screen.getByRole("button", { name: "Tom Schnabel" });
    expect(djBtn.className).toContain("gram-link--nav");
    fireEvent.click(djBtn);
    expect(onDj).toHaveBeenCalledWith("Tom Schnabel");
  });

  it("add/seed is an explicit + affordance; yours renders white without one", () => {
    const onAddArtist = vi.fn();
    const links = {
      onAddArtist,
      isYours: (name: string) => name === "Yours Band",
    };
    render(<p>{artistNode("New Band", links)}{artistNode("Yours Band", links)}</p>);
    const plus = screen.getByRole("button", { name: /add new band to your artists/i });
    expect(plus.textContent).toBe("+");
    fireEvent.click(plus);
    expect(onAddArtist).toHaveBeenCalledWith("New Band");
    // yours: white class, no add affordance, no dotted nav class
    expect(screen.queryByRole("button", { name: /add yours band/i })).toBeNull();
    const yours = [...document.querySelectorAll(".gram__artist")].find((n) => n.textContent === "Yours Band")!;
    expect(yours.className).toContain("gram--yours");
    expect(yours.className).not.toContain("gram-link--nav");
  });

  it("unlinked names render as plain <b>, never navigation buttons", () => {
    render(<p>{artistNode("Plain Band")}{djNode("Plain DJ")}</p>);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("structural attribution", () => {
  it("station and show live below the sentence, not inside it", () => {
    const show = makeShow({ crossings: 1, topArtists: ["Portishead"] });
    const { sentence, attribution } = radioSummarySentence({ stationName: "KCRW", show });
    expect(text(sentence)).not.toContain("KCRW");
    expect(text(sentence)).not.toContain("Morning Mix");
    expect(text(attribution)).toContain("KCRW");
    expect(text(attribution)).toContain("Morning Mix");
  });

  it("attribution handlers make show a dotted navigation target", () => {
    const onShow = vi.fn();
    render(<p>{attributionLine("KCRW", "Morning Mix", { onShow })}</p>);
    const btn = screen.getByRole("button", { name: "Morning Mix" });
    expect(btn.className).toContain("gram-link--nav");
    fireEvent.click(btn);
    expect(onShow).toHaveBeenCalledWith("Morning Mix");
  });
});
