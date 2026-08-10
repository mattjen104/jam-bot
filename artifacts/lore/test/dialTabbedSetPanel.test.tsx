// @vitest-environment jsdom
import React, { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import {
  CONTEXT_TAB_ID,
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
      { name: "Fleetwood Mac", inLibrary: true, title: "Dreams" },
      { name: "New Band", inLibrary: false, title: "First Song" },
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
        renderArtistBody={(scope) => <div data-testid="artist-body">{scope.label ?? scope.value}</div>}
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
    const tabList = screen.getAllByRole("tab");
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
    // Station renders in the compact dial chip style, anchored last.
    expect(header.lastElementChild?.className).toContain("set-panel__station");
    expect(header.lastElementChild?.className).toContain("fdrow__station-chip");
    // The redundant date · time provenance row is gone — the tab chip
    // already carries time · station.
    expect(header.querySelector("time")).toBeNull();
  });

  it("carries per-track titles for the mobile one-line rows and collapses actions behind one toggle", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("open-first"));
    // Each played row carries an "— title" span (CSS shows it at phone widths).
    const titles = [...document.querySelectorAll(".set-queue__title")].map((n) => n.textContent);
    expect(titles).toEqual([" — Dreams", " — First Song"]);
    // One quiet toggle governs the Play/service/Export row on mobile.
    const toggle = screen.getByRole("button", { name: /show set actions/i });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector(".set-panel__actions")?.className).toContain("set-panel__actions--open");
    fireEvent.click(screen.getByRole("button", { name: /hide set actions/i }));
    expect(document.querySelector(".set-panel__actions")?.className).not.toContain("--open");
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
    // crossing artists rendered with the white/library treatment (yours =
    // white, no underline — no longer an add/remove button)
    const fleetwood = [...cards[2].querySelectorAll(".set-queue__artist")]
      .find((n) => n.textContent === "Fleetwood Mac")!;
    expect(fleetwood.className).toContain("set-queue__artist--library");
    expect(fleetwood.getAttribute("aria-label")).toMatch(/is in your library/i);
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

  it("opens an artist tab from a queue name click, focuses it, and dedups repeats", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("open-first"));
    // Names are navigation targets; add stays on the explicit leading `+`.
    const card = document.querySelector(".set-panel__card") as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: "New Band" }));

    let tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toContain("New Band");
    const artistTab = tabs.find((t) => t.textContent === "New Band")!;
    expect(artistTab.getAttribute("aria-selected")).toBe("true");
    // The artist tab renders its own body instead of set cards/actions.
    expect(screen.getByTestId("artist-body").textContent).toBe("New Band");
    expect(document.querySelector(".set-panel__card")).toBeNull();
    expect(document.querySelector(".set-panel__actions")).toBeNull();

    // Re-clicking the same artist focuses the existing tab, no duplicate.
    fireEvent.click(screen.getAllByRole("tab")[0]); // back to the set tab
    fireEvent.click(within(document.querySelector(".set-panel__card") as HTMLElement)
      .getByRole("button", { name: "New Band" }));
    tabs = screen.getAllByRole("tab");
    expect(tabs.filter((t) => t.textContent === "New Band")).toHaveLength(1);
    expect(tabs.find((t) => t.textContent === "New Band")!.getAttribute("aria-selected")).toBe("true");

    // Artist tabs close like any other tab.
    fireEvent.click(screen.getByRole("button", { name: /close New Band/i }));
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).not.toContain("New Band");
  });

  it("renders a leading + for non-yours queue artists and none for yours (white)", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("open-first"));
    const card = document.querySelector(".set-panel__card") as HTMLElement;
    // Non-yours: `+` precedes the name inside the wrap.
    const newBandWrap = within(card).getByRole("button", { name: "New Band" })
      .closest(".set-queue__artist-wrap")!;
    expect([...newBandWrap.children][0]!.className).toContain("dial-addplus");
    // Yours renders white with no `+` add affordance.
    const fleetwood = within(card).getByRole("button", { name: /Fleetwood Mac/ });
    expect(fleetwood.className).toContain("set-queue__artist--library");
    expect(within(card).queryByRole("button", { name: /add fleetwood mac/i })).toBeNull();
    // Yours names still navigate to the artist tab.
    fireEvent.click(fleetwood);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toContain("Fleetwood Mac");
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

/** Harness mirroring DialView's context-tab wiring: entering context mode
 * opens/focuses the tab; closing the tab "exits context" (here: removes it and
 * records the exit), matching DialView's surface.dial() intercept. */
function ContextHarness({ onExitContext = vi.fn() }: { onExitContext?: () => void }) {
  const [tabs, setTabs] = useState<SetPanelTab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const open = (scope: SetPanelScope) => {
    const id = setPanelScopeId(scope);
    setTabs((cur) => cur.some((t) => t.id === id) ? cur : [...cur, { id, scope }]);
    setActiveId(id);
  };
  const enterContext = () => {
    setTabs((cur) => cur.some((t) => t.id === CONTEXT_TAB_ID)
      ? cur
      : [{ id: CONTEXT_TAB_ID, scope: { kind: "context", value: "kexp" } }, ...cur]);
    setActiveId(CONTEXT_TAB_ID);
  };
  const close = (id: string) => {
    if (id === CONTEXT_TAB_ID) {
      onExitContext();
      // DialView removes the tab via the context-mode effect; mirror that.
      setTabs((cur) => {
        const idx = cur.findIndex((t) => t.id === id);
        const next = cur.filter((t) => t.id !== id);
        setActiveId((a) => a === id ? (next[Math.max(0, idx - 1)]?.id ?? null) : a);
        return next;
      });
      return;
    }
    setTabs((cur) => {
      const idx = cur.findIndex((t) => t.id === id);
      const next = cur.filter((t) => t.id !== id);
      setActiveId((a) => a === id ? (next[Math.max(0, idx - 1)]?.id ?? null) : a);
      return next;
    });
  };
  return (
    <div>
      <button type="button" onClick={enterContext}>tune-in</button>
      <button type="button" onClick={() => open({ kind: "set", setId: SETS[0].id })}>open-first</button>
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
        onPlay={vi.fn()}
        contextLabel="KEXP"
        contextBody={<div data-testid="context-body">breadcrumb + summary + rail</div>}
      />
    </div>
  );
}

describe("station-context tab", () => {
  it("opens the context tab on tune-in, renders its body, and coexists with set tabs", () => {
    render(<ContextHarness />);
    fireEvent.click(screen.getByText("tune-in"));

    // One context tab, focused, labelled with the station name.
    const tabsAfterTune = screen.getAllByRole("tab");
    expect(tabsAfterTune).toHaveLength(1);
    expect(tabsAfterTune[0].textContent).toBe("KEXP");
    expect(tabsAfterTune[0].getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("context-body")).toBeTruthy();
    // Context body shows INSTEAD of set affordances — no actions, no cards.
    expect(document.querySelector(".set-panel__actions")).toBeNull();
    expect(document.querySelector(".set-panel__card")).toBeNull();

    // A set tab opens alongside and takes focus like any tab switch.
    fireEvent.click(screen.getByText("open-first"));
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByTestId("context-body")).toBeNull();
    expect(document.querySelectorAll(".set-panel__card").length).toBeGreaterThan(0);

    // Switching back to the context tab restores its body.
    fireEvent.click(tabs[0]);
    expect(screen.getByTestId("context-body")).toBeTruthy();
    expect(document.querySelector(".set-panel__card")).toBeNull();
  });

  it("closing the context tab exits context and focuses a neighboring set tab", () => {
    const onExitContext = vi.fn();
    render(<ContextHarness onExitContext={onExitContext} />);
    fireEvent.click(screen.getByText("tune-in"));
    fireEvent.click(screen.getByText("open-first"));
    fireEvent.click(screen.getAllByRole("tab")[0]); // focus context

    fireEvent.click(screen.getByRole("button", { name: /close KEXP/i }));
    expect(onExitContext).toHaveBeenCalledTimes(1);
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(1);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByTestId("context-body")).toBeNull();
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
