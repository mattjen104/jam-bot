// @vitest-environment jsdom
import React, { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import {
  TabbedSetPanel,
  shouldActivateReplayTab,
  buildSetExport,
  scopedSets,
  setPanelScopeId,
  setPanelTabLabel,
  SET_EXPORT_SERVICES,
  type SetPanelScope,
  type SetPanelSet,
  type SetPanelTab,
} from "../src/components/DialView";

afterEach(() => cleanup());

function makeSpin(artist: string, title: string, playedAt: string, hit = false) {
  return {
    mbid: `mbid-${artist}-${title}`.toLowerCase().replace(/\s+/g, "-"),
    artistMbid: null,
    title,
    artist,
    playedAt,
    isLibraryHit: hit,
    isArtistHit: false,
    isFirstSpin: false,
  };
}

const SETS: SetPanelSet[] = [
  {
    id: "kexp:2026-08-07T18:00:00Z",
    stationSlug: "kexp",
    stationName: "KEXP",
    startedAt: "2026-08-07T18:00:00Z",
    showName: "Drive Time",
    djNames: ["DJ Aster"],
    artists: [
      { name: "Fleetwood Mac", inLibrary: true },
      { name: "New Band", inLibrary: false },
    ],
    spins: [
      makeSpin("Fleetwood Mac", "Dreams", "2026-08-07T18:05:00Z", true),
      makeSpin("New Band", "First Song", "2026-08-07T18:10:00Z"),
    ],
    progress: 1,
  },
  {
    id: "kexp:2026-08-06T18:00:00Z",
    stationSlug: "kexp",
    stationName: "KEXP",
    startedAt: "2026-08-06T18:00:00Z",
    showName: "Drive Time",
    djNames: ["DJ Aster"],
    artists: [{ name: "Neko Case", inLibrary: true }],
    spins: [makeSpin("Neko Case", "Hold On", "2026-08-06T18:05:00Z", true)],
    progress: 1,
  },
  {
    // co-hosted set: must surface under EACH host's DJ drill
    id: "kexp:2026-08-05T18:00:00Z",
    stationSlug: "kexp",
    stationName: "KEXP",
    startedAt: "2026-08-05T18:00:00Z",
    showName: "Cohost Hour",
    djNames: ["DJ Aster", "DJ Vega"],
    artists: [{ name: "Stereolab", inLibrary: false }],
    spins: [makeSpin("Stereolab", "French Disko", "2026-08-05T18:05:00Z")],
    progress: 1,
  },
  {
    id: "wfmu:2026-08-07T20:00:00Z",
    stationSlug: "wfmu",
    stationName: "WFMU",
    startedAt: "2026-08-07T20:00:00Z",
    showName: "Night Drift",
    djNames: ["DJ Vega"],
    artists: [{ name: "Broadcast", inLibrary: false }],
    spins: [
      makeSpin("Broadcast", "Come On Let's Go", "2026-08-07T20:05:00Z"),
      { ...makeSpin("", "Untitled", "2026-08-07T20:10:00Z"), mbid: null },
    ],
    progress: 1,
  },
];

/** Harness mirroring DialView's controlled tab-state wiring. */
function Harness({ onPlay = vi.fn() }: { onPlay?: (sets: SetPanelSet[], label: string) => void }) {
  const [tabs, setTabs] = useState<SetPanelTab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const open = (scope: SetPanelScope, activate = true) => {
    const id = setPanelScopeId(scope);
    setTabs((cur) => cur.some((t) => t.id === id) ? cur : [...cur, { id, scope }]);
    if (activate) setActiveId(id);
  };
  const close = (id: string) => {
    setTabs((cur) => {
      const idx = cur.findIndex((t) => t.id === id);
      const next = cur.filter((t) => t.id !== id);
      setActiveId((a) => a === id ? (next[Math.max(0, idx - 1)]?.id ?? null) : a);
      return next;
    });
  };
  return (
    <div>
      <button type="button" onClick={() => open({ kind: "set", setId: SETS[0].id })}>open-first</button>
      <button type="button" onClick={() => open({ kind: "set", setId: SETS[3].id })}>open-second</button>
      <span data-testid="title">{tabs.find((t) => t.id === activeId) ? setPanelTabLabel(tabs.find((t) => t.id === activeId)!, SETS) : "Choose a live set"}</span>
      <TabbedSetPanel
        tabs={tabs}
        activeId={activeId}
        allSets={SETS}
        seedsLower={new Set()}
        onSelect={setActiveId}
        onClose={close}
        onScope={open}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
        onPlay={(sets, label) => {
          onPlay(sets, label);
          // Mirror DialView's ride-sync effect: the replay tab is opened in
          // the background and only takes focus when nothing is active.
          open({ kind: "set", setId: "replay" }, shouldActivateReplayTab(activeId));
        }}
      />
    </div>
  );
}

describe("Tabbed set panel", () => {
  it("opens sets as tabs, dedups, switches back via headers, and closes to a neighbor", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("open-first"));
    expect(screen.getAllByRole("tab")).toHaveLength(1);

    // second set opens an additional tab instead of replacing the view
    fireEvent.click(screen.getByText("open-second"));
    let tabList = screen.getAllByRole("tab");
    expect(tabList).toHaveLength(2);
    expect(tabList[1].getAttribute("aria-selected")).toBe("true");

    // reopening the same set does not duplicate the tab
    fireEvent.click(screen.getByText("open-second"));
    expect(screen.getAllByRole("tab")).toHaveLength(2);

    // navigating back happens via the tab header, first tab's set reappears
    fireEvent.click(tabList[0]);
    expect(screen.getAllByRole("tab")[0].getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("title").textContent).toContain("KEXP");
    expect(document.querySelector(".set-panel__cascade")?.textContent).toContain("DJ Aster");

    // closing the active tab activates its neighbor
    fireEvent.click(screen.getAllByRole("button", { name: /^close/i })[0]);
    expect(screen.getAllByRole("tab")).toHaveLength(1);
    expect(screen.getAllByRole("tab")[0].getAttribute("aria-selected")).toBe("true");
  });

  it("leads the header with DJ then show and anchors the station last on every card", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("open-first"));
    const header = document.querySelector(".set-panel__provenance")!;
    const cascade = within(header as HTMLElement).getAllByRole("button").map((b) => b.textContent);
    expect(cascade).toEqual(["DJ Aster", "Drive Time", "KEXP"]);
    expect(header.lastElementChild?.className).toContain("set-panel__station");
    expect(header.querySelector("time")?.textContent).toMatch(/·/);
  });

  it("drills a DJ scope to full chronological setlists with crossing artists highlighted", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("open-first"));
    fireEvent.click(within(document.querySelector(".set-panel__cascade") as HTMLElement).getByText("DJ Aster"));

    // scope tab opened and became active
    const tabList = screen.getAllByRole("tab");
    expect(tabList.map((t) => t.textContent)).toContain("DJ Aster");

    // every DJ Aster set shown — solo AND co-hosted — chronological, full setlists
    const cards = document.querySelectorAll(".set-panel__card");
    expect(cards).toHaveLength(3);
    expect(within(cards[0] as HTMLElement).getByText("Stereolab")).toBeTruthy(); // Aug 5 cohost set included
    expect(within(cards[1] as HTMLElement).getByText("Neko Case")).toBeTruthy();
    const thirdNames = [...cards[2].querySelectorAll(".set-queue__artist")].map((n) => n.textContent);
    expect(thirdNames).toEqual(["Fleetwood Mac", "New Band"]); // full setlist, not a crossing excerpt
    // crossing artists rendered with the white/library treatment
    expect(within(cards[2] as HTMLElement).getByRole("button", { name: /fleetwood mac is in your library/i }).className)
      .toContain("set-queue__artist--library");
  });

  it("plays the displayed setlist through the agnostic player", () => {
    const onPlay = vi.fn();
    render(<Harness onPlay={onPlay} />);
    fireEvent.click(screen.getByText("open-first"));
    fireEvent.click(screen.getByRole("button", { name: /play set/i }));
    expect(onPlay).toHaveBeenCalledTimes(1);
    const [sets, label] = onPlay.mock.calls[0];
    expect(sets.map((s: SetPanelSet) => s.id)).toEqual([SETS[0].id]);
    expect(label).toContain("KEXP");
  });

  it("keeps the selected scope in focus when playback starts and the replay queue updates", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("open-first"));
    fireEvent.click(within(document.querySelector(".set-panel__cascade") as HTMLElement).getByText("DJ Aster"));
    const activeBefore = screen.getAllByRole("tab").find((t) => t.getAttribute("aria-selected") === "true");
    expect(activeBefore?.textContent).toBe("DJ Aster");

    // starting playback opens the replay tab in the BACKGROUND
    fireEvent.click(screen.getByRole("button", { name: /play set/i }));
    const tabsAfter = screen.getAllByRole("tab");
    expect(tabsAfter.map((t) => t.textContent)).toContain("Set"); // replay tab exists…
    const activeAfter = tabsAfter.find((t) => t.getAttribute("aria-selected") === "true");
    expect(activeAfter?.textContent).toBe("DJ Aster"); // …but the scope stays visible
    // the DJ's full sets are still on screen
    expect(document.querySelectorAll(".set-panel__card")).toHaveLength(3);
  });

  it("exports to a chosen service including Qobuz and reports skipped tracks", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("open-second"));
    const select = screen.getByLabelText("Export service") as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toContain("Qobuz");
    fireEvent.change(select, { target: { value: "Qobuz" } });
    fireEvent.click(screen.getByRole("button", { name: /export/i }));

    const links = [...document.querySelectorAll(".set-panel__export a")];
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("https://www.qobuz.com/search?q=Broadcast%20Come%20On%20Let's%20Go");
    // the artist-less spin degrades gracefully into a skip note
    expect(document.querySelector(".set-panel__export-skips")?.textContent).toContain("1 track");
  });
});

describe("set panel scope model", () => {
  it("scopes by dj/show/station in whole chronological sets", () => {
    const dj = scopedSets({ kind: "dj", value: "DJ Aster" }, SETS);
    expect(dj.map((s) => s.id)).toEqual([
      "kexp:2026-08-05T18:00:00Z", // co-hosted set counts for each host
      "kexp:2026-08-06T18:00:00Z",
      "kexp:2026-08-07T18:00:00Z",
    ]);
    const vega = scopedSets({ kind: "dj", value: "DJ Vega" }, SETS);
    expect(vega.map((s) => s.id)).toEqual(["kexp:2026-08-05T18:00:00Z", "wfmu:2026-08-07T20:00:00Z"]);
    const show = scopedSets({ kind: "show", value: "Night Drift" }, SETS);
    expect(show.map((s) => s.stationSlug)).toEqual(["wfmu"]);
    const station = scopedSets({ kind: "station", value: "kexp" }, SETS);
    expect(station).toHaveLength(3);
  });

  it("only lets the replay tab take focus when the panel is empty", () => {
    expect(shouldActivateReplayTab(null)).toBe(true);
    expect(shouldActivateReplayTab("dj:DJ Aster")).toBe(false);
    expect(shouldActivateReplayTab("set:kexp:2026-08-07T18:00:00Z")).toBe(false);
  });

  it("builds per-service search links for every supported service", () => {
    for (const service of SET_EXPORT_SERVICES) {
      const { entries, skipped } = buildSetExport([SETS[0]], service);
      expect(entries).toHaveLength(2);
      expect(entries[0].url).toContain(encodeURIComponent("Fleetwood Mac Dreams").split("%20")[0]);
      expect(skipped).toBe(0);
    }
    expect(buildSetExport([SETS[0]], "Spotify").entries[0].url)
      .toBe("https://open.spotify.com/search/Fleetwood%20Mac%20Dreams");
  });
});
