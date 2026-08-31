// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { DialLaneRow } from "../src/components/dial/DialFeedLane";
import { MinimalRadioSurface } from "../src/components/MinimalRadioSurface";

const { toggle, keepMutate } = vi.hoisted(() => ({
  toggle: vi.fn(),
  keepMutate: vi.fn(),
}));

vi.mock("../src/player/PlayerProvider", () => ({
  usePlayer: () => ({
    radio: { station: null, status: "idle", toggle },
  }),
}));

vi.mock("../src/lib/meHooks", () => ({
  useMutationKeep: () => ({ mutate: keepMutate, isPending: false }),
}));

vi.mock("../src/lib/dialFilterState", () => ({
  useDialSkipped: () => ({ isSkipped: () => false, toggleSkip: vi.fn() }),
}));

function row(slug: string, name: string, nowHit: boolean, lifetime: number): DialLaneRow {
  return {
    ds: {
      station: {
        id: lifetime,
        slug,
        name,
        streamUrl: `https://stream.example/${slug}`,
        relayUrl: null,
      },
      isLive: true,
      shows: [],
      crossings: 0,
      artistCrossings: 0,
      firstPlayCrossings: 0,
      weekCrossings: 0,
      weekArtistCrossings: 0,
      weekFirstPlayCrossings: 0,
      monthCrossings: 0,
      monthArtistCrossings: 0,
      lifetimeCrossings: lifetime,
      lifetimeArtistCrossings: 0,
      lifetimeFirstPlayCrossings: 0,
      topArtistNames: [],
      topArtistNames24h: [],
      topArtistNames7d: [],
      topArtistNamesLifetime: [],
      liveTrack: {
        mbid: `${slug}-mbid`,
        artistMbid: null,
        title: `${name} track`,
        artist: `${name} artist`,
        playedAt: new Date().toISOString(),
        isLibraryHit: nowHit,
        isArtistHit: false,
        isFirstSpin: false,
        releaseYear: null,
        ageTier: null,
      },
    },
    show: null,
    effectiveDjName: null,
  } as DialLaneRow;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("MinimalRadioSurface", () => {
  it("shows one card, changes it from the remote, and never plays from remote selection", () => {
    render(
      <MinimalRadioSurface
        rows={[row("alpha", "Alpha", true, 1), row("beta", "Beta", false, 5)]}
        libraryItems={[]}
        preset="now"
        activeCategories={new Set(["campus"])}
        onToggleCategory={vi.fn()}
      />,
    );
    expect(screen.getAllByTestId("minimal-radio-card")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Alpha" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Now" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Lifetime" })).toBeNull();
    expect(screen.getByRole("button", { name: /^Station type/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Select Alpha" }).textContent).toBe("Alpha");
    fireEvent.click(screen.getByTitle("Select Beta"));
    expect(screen.getByRole("heading", { name: "Beta" })).toBeTruthy();
    expect(toggle).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Tune in to Beta" }));
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it("uses previous/next controls and exposes no crossing chips or counts", () => {
    render(
      <MinimalRadioSurface
        rows={[row("alpha", "Alpha", true, 1), row("beta", "Beta", false, 5)]}
        libraryItems={[]}
        preset="now"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Next station" }));
    expect(screen.getByRole("heading", { name: "Beta" })).toBeTruthy();
    expect(document.querySelector(".fdrow__crossing-dot")).toBeNull();
    expect(screen.queryByText(/crossing/i)).toBeNull();
  });
});