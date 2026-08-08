// @vitest-environment jsdom
import React, { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  SetQueueList,
  chooseDialHeroQueueLayout,
  useLivePanelSync,
  computeLivePanel,
} from "../src/components/DialView";

// ── Minimal data factories ───────────────────────────────────────────────────

// Minimal DialSpin — only the fields the hook and computeLivePanel read.
function spin(artist: string, playedAt: string, lib = false) {
  return {
    mbid: null, artistMbid: null, title: "", artist, playedAt,
    isLibraryHit: lib, isArtistHit: false, isFirstSpin: false,
  };
}

// Minimal DialStation.
function station(slug: string, name = slug) {
  return {
    station: { slug, name, id: 1 }, isLive: true, shows: [],
    crossings: 0, artistCrossings: 0, weekCrossings: 0, weekArtistCrossings: 0,
    monthCrossings: 0, monthArtistCrossings: 0, lifetimeCrossings: 0, lifetimeArtistCrossings: 0,
  };
}

// Minimal DialShow.
function show(spins: ReturnType<typeof spin>[], currentIdx: number | null) {
  return {
    runId: null, showName: "Live Show", djName: null,
    startedAt: "2026-08-07T20:00:00Z", endedAt: "2026-08-07T22:00:00Z",
    state: "live" as const, spins, crossings: 0, artistCrossings: 0,
    topArtists: [], topArtistNames: [],
    currentTrack: currentIdx !== null ? spins[currentIdx] : null,
    isPickerShow: false, pickerId: null,
  };
}

type LiveRow = {
  ds: ReturnType<typeof station>;
  show: ReturnType<typeof show> | null;
};

// ── SyncHarness ──────────────────────────────────────────────────────────────
// Thin wrapper that wires useLivePanelSync into real component state, exactly
// as DialView does. Tests drive it by updating `liveRows` via rerender.

interface HarnessProps {
  slug: string;
  artists: { name: string; inLibrary: boolean }[];
  initialProgress: number;
  liveRows: LiveRow[];
}

function SyncHarness({ slug, artists, initialProgress, liveRows }: HarnessProps) {
  const [progress, setProgress] = useState(initialProgress);

  // The panel object mirrors the shape DialView stores in setPanel.
  const panel = { slug, artists };

  useLivePanelSync(panel, liveRows, setProgress);

  return (
    <SetQueueList
      artists={artists}
      seedsLower={new Set()}
      onAdd={vi.fn()}
      onRemove={vi.fn()}
      progress={progress}
    />
  );
}

// ── Tests ────────────────────────────────────────────────────────────────────

afterEach(() => cleanup());

describe("Dial set queue", () => {
  it("keeps spin order, renders yours white, and adds/removes via explicit affordances", () => {
    const onAdd = vi.fn();
    const onRemove = vi.fn();
    render(
      <SetQueueList
        artists={[
          { name: "First Artist", inLibrary: false },
          { name: "Second Artist", inLibrary: true },
          { name: "Third Artist", inLibrary: false },
        ]}
        seedsLower={new Set(["third artist"])}
        onAdd={onAdd}
        onRemove={onRemove}
        progress={2 / 3}
      />,
    );

    const names = [...document.querySelectorAll(".set-queue__artist")].map((node) => node.textContent);
    expect(names).toEqual(["First Artist", "Second Artist", "Third Artist"]);
    // New link semantics: names never add — add/seed is an explicit `+`
    // button beside the name; seeded names get an explicit `×` remove.
    const addPlus = screen.getByRole("button", { name: /add first artist/i });
    expect(addPlus.className).toContain("dial-addplus");
    expect(addPlus.textContent).toBe("+");
    // Non-yours name is plain gray text with no dotted-underline add class.
    const firstName = [...document.querySelectorAll(".set-queue__artist")][0]!;
    expect(firstName.tagName).not.toBe("BUTTON");
    expect(firstName.className).toContain("set-queue__artist--other");
    expect(firstName.className).not.toContain("dial-artist--add");
    // Yours (library and seeded) render white with the library treatment.
    const second = [...document.querySelectorAll(".set-queue__artist")][1]!;
    expect(second.className).toContain("set-queue__artist--library");
    expect(second.className).toContain("dial-artist--complete");
    const third = [...document.querySelectorAll(".set-queue__artist")][2]!;
    expect(third.className).toContain("set-queue__artist--library");
    expect(third.className).toContain("dial-artist--complete");

    fireEvent.click(addPlus);
    fireEvent.click(screen.getByRole("button", { name: /remove third artist/i }));
    expect(onAdd).toHaveBeenCalledWith("First Artist");
    expect(onRemove).toHaveBeenCalledWith("Third Artist");
    expect(document.querySelector(".set-queue__progress")?.getAttribute("style")).toContain("width: 66.666");
  });

  it("keeps the live set visible and updates progress proportionally as the now-playing spin advances", () => {
    // Use a station that would sit outside Zone 1 (e.g. Zone 3 / djBand) to
    // confirm the fix covers all zones, not just zone1Display.
    const ds = station("kexp", "KEXP");
    const spins = [
      spin("Artist A", "2026-08-07T20:00:00Z"),
      spin("Artist B", "2026-08-07T20:30:00Z", true),
      spin("Artist C", "2026-08-07T21:00:00Z"),
    ];
    const artists = computeLivePanel({ ds, show: show(spins, 0) }).artists;

    // Open the panel at the first spin.  liveRows represents sortedRows — ALL
    // live rows, not just Zone 1 — matching the production wiring.
    const liveRows1: LiveRow[] = [{ ds, show: show(spins, 0) }];

    const { rerender } = render(
      <SyncHarness
        slug="kexp"
        artists={artists}
        initialProgress={1 / 3}
        liveRows={liveRows1}
      />,
    );

    // Artist list is intact and progress bar at ~33%.
    expect([...document.querySelectorAll(".set-queue__artist")].map((n) => n.textContent))
      .toEqual(["Artist A", "Artist B", "Artist C"]);
    expect(document.querySelector(".set-queue__progress")?.getAttribute("style"))
      .toContain("width: 33.333");

    // Live data refreshes: now-playing advances to the second spin.
    // useLivePanelSync detects the currentTrack change via the liveRows dep and
    // calls onProgress, updating the internal progress state.
    rerender(
      <SyncHarness
        slug="kexp"
        artists={artists}
        initialProgress={1 / 3}
        liveRows={[{ ds, show: show(spins, 1) }]}
      />,
    );

    // Artists unchanged; progress jumped to ~67%.
    expect([...document.querySelectorAll(".set-queue__artist")].map((n) => n.textContent))
      .toEqual(["Artist A", "Artist B", "Artist C"]);
    expect(document.querySelector(".set-queue__progress")?.getAttribute("style"))
      .toContain("width: 66.666");

    // Now-playing advances to the final spin.
    rerender(
      <SyncHarness
        slug="kexp"
        artists={artists}
        initialProgress={1 / 3}
        liveRows={[{ ds, show: show(spins, 2) }]}
      />,
    );

    expect([...document.querySelectorAll(".set-queue__artist")].map((n) => n.textContent))
      .toEqual(["Artist A", "Artist B", "Artist C"]);
    expect(document.querySelector(".set-queue__progress")?.getAttribute("style"))
      .toContain("width: 100");

    // Station transitions out of the live-row list entirely (e.g. crossing
    // classification flips it to a different zone that drops it from sortedRows).
    // The panel should remain visible and not crash; progress simply stops updating.
    rerender(
      <SyncHarness
        slug="kexp"
        artists={artists}
        initialProgress={1 / 3}
        liveRows={[]}
      />,
    );

    expect([...document.querySelectorAll(".set-queue__artist")].map((n) => n.textContent))
      .toEqual(["Artist A", "Artist B", "Artist C"]);
    // Progress retains the last computed value (100%) — no crash, no blank panel.
    expect(document.querySelector(".set-queue__progress")?.getAttribute("style"))
      .toContain("width: 100");
  });
});

describe("Dial hero queue layout", () => {
  it("uses the side queue only when it preserves the larger album square", () => {
    expect(chooseDialHeroQueueLayout({
      viewportWidth: 1440,
      viewportHeight: 900,
      shellHeight: 80,
      dialColumnWidth: 440,
    })).toBe("side");

    expect(chooseDialHeroQueueLayout({
      viewportWidth: 800,
      viewportHeight: 900,
      shellHeight: 80,
      dialColumnWidth: 300,
    })).toBe("below");
  });

  it("matches the side queue's responsive min(360px, 30vw) width at medium landscape sizes", () => {
    // CSS uses --hero-queue-w: min(360px, 30vw). At 1000px, that is 300px:
    // side art is min(570, 1000 - 300 - 300) = 400px; below art is
    // min(700, 570 - 220) = 350px, so side must win.
    expect(chooseDialHeroQueueLayout({
      viewportWidth: 1000,
      viewportHeight: 570,
      shellHeight: 0,
      dialColumnWidth: 300,
    })).toBe("side");

    // At narrower landscape widths the responsive 30vw queue cap still wins
    // over below mode when it leaves the larger album square.
    expect(chooseDialHeroQueueLayout({
      viewportWidth: 800,
      viewportHeight: 450,
      shellHeight: 0,
      dialColumnWidth: 300,
    })).toBe("side");
  });

  it("accounts for measured shell height rather than assuming viewport height is free", () => {
    // With no shell height, the tall viewport makes below-mode the bigger square.
    expect(chooseDialHeroQueueLayout({
      viewportWidth: 1000,
      viewportHeight: 700,
      shellHeight: 0,
      dialColumnWidth: 300,
    })).toBe("below");
    // A large shell-h (e.g. a fixed player bar) eats into available height, shrinking
    // the below-square more than the side-square — the function flips to side.
    expect(chooseDialHeroQueueLayout({
      viewportWidth: 1000,
      viewportHeight: 700,
      shellHeight: 300,
      dialColumnWidth: 300,
    })).toBe("side");
  });
});
