// @vitest-environment jsdom
/**
 * LastSetScanner — the station "last set" sheet: paged tracklist by density,
 * hour jumps + scrubber, lazy previews (one at a time, bounded prefetch),
 * unified Keep wiring, crossing art, and scan-memory resume/coverage.
 *
 * fetch, the preview cache, and KeepButton are mocked; the scan-memory store
 * is real (localStorage) so resume/coverage behavior is exercised end to end.
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { clearScanMemory, recordSetScan } from "../src/lib/scanMemory";

const { mockGetPreview, mockFetch, keepProps } = vi.hoisted(() => ({
  mockGetPreview: vi.fn(),
  mockFetch: vi.fn(),
  keepProps: [] as Array<Record<string, unknown>>,
}));

vi.mock("../src/player/previewCache", () => ({
  getPreviewCached: (mbid: string) => mockGetPreview(mbid),
}));

vi.mock("../src/components/KeepButton", () => ({
  KeepButton: (props: Record<string, unknown>) => {
    keepProps.push(props);
    return (
      <button type="button" data-testid={`keep-${String(props.spinId)}`}>
        Keep
      </button>
    );
  },
}));

import { LastSetScanner } from "../src/components/LastSetScanner";

const SLUG = "kxyz";

/** 12 tracks across three local hours (5 at 15:xx, 5 at 16:xx, 2 at 17:xx). */
function makeSet() {
  const tracks = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(2026, 0, 5, 15 + Math.floor(i / 5), (i * 3) % 60, 0);
    return {
      spinId: 1000 + i,
      position: i,
      playedAt: d.toISOString(),
      artist: `Artist ${i}`,
      title: `Song ${i}`,
      mbid: `mbid-${i}`,
      artworkUrl: null as string | null,
    };
  });
  return {
    station: { slug: SLUG, name: "KXYZ" },
    run: {
      runId: 555,
      date: "2026-01-05",
      show: { name: "Afternoon Set", djName: "DJ Test" },
      spinCount: 12,
      resolvedCount: 12,
      startedAt: tracks[0]!.playedAt,
      endedAt: tracks[11]!.playedAt,
    },
    tracks,
  };
}

function stubFetch(body: unknown, status = 200) {
  mockFetch.mockImplementation(() =>
    Promise.resolve({
      status,
      ok: status >= 200 && status < 300,
      json: () => Promise.resolve(body),
    }),
  );
}

function renderScanner(overrides: Partial<Parameters<typeof LastSetScanner>[0]> = {}) {
  return render(
    <LastSetScanner
      slug={SLUG}
      density="normal"
      libraryArtwork={new Map()}
      lifetimeCrossings={0}
      onClose={vi.fn()}
      {...overrides}
    />,
  );
}

async function flush() {
  await act(async () => {});
}

beforeEach(() => {
  localStorage.clear();
  clearScanMemory();
  keepProps.length = 0;
  mockGetPreview.mockReset();
  mockGetPreview.mockResolvedValue({
    previewUrl: "https://audio.example/clip.mp3",
    artworkUrl: null,
    source: "itunes",
  });
  mockFetch.mockReset();
  vi.stubGlobal("fetch", mockFetch);
  vi.spyOn(window.HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(window.HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("LastSetScanner", () => {
  it("renders the set in broadcast order with hours, count, and lifetime crossings", async () => {
    stubFetch(makeSet());
    renderScanner({ lifetimeCrossings: 7 });
    expect(await screen.findByText("KXYZ — Last set")).toBeTruthy();
    expect(screen.getByText(/Afternoon Set/)).toBeTruthy();
    expect(screen.getByText(/12 tracks/)).toBeTruthy();
    expect(screen.getByText(/7 crossings all-time/)).toBeTruthy();
    // Normal density = 5 per page: track 5 is on page 2.
    expect(screen.getByTestId("setscanner-track-0").textContent).toContain("Artist 0");
    expect(screen.getByTestId("setscanner-track-4").textContent).toContain("Artist 4");
    expect(screen.queryByTestId("setscanner-track-5")).toBeNull();
  });

  it("pages by the active density — micro fits the whole 12-track set", async () => {
    stubFetch(makeSet());
    renderScanner({ density: "micro" });
    expect(await screen.findByTestId("setscanner-track-11")).toBeTruthy();
    expect(screen.queryByTestId("setscanner-page-2")).toBeNull();
  });

  it("marks pages as covered once every track on them is scanned", async () => {
    stubFetch(makeSet());
    renderScanner();
    await screen.findByTestId("setscanner-track-0");
    const page1 = screen.getByTestId("setscanner-page-1");
    expect(page1.className).not.toContain("setscanner__page--covered");
    for (let i = 0; i < 5; i++) {
      fireEvent.click(screen.getByTestId(`setscanner-preview-${i}`));
      await flush();
    }
    expect(screen.getByTestId("setscanner-page-1").className).toContain(
      "setscanner__page--covered",
    );
    // Scanned tracks carry the ✓ mark.
    expect(screen.getByLabelText("Song 2 already scanned")).toBeTruthy();
    // Page 2 is not covered.
    fireEvent.click(screen.getByTestId("setscanner-page-2"));
    await flush();
    expect(screen.getByTestId("setscanner-track-5")).toBeTruthy();
    expect(screen.getByTestId("setscanner-page-2").className).not.toContain("--covered");
  });

  it("jumps to an hour target's page", async () => {
    stubFetch(makeSet());
    renderScanner();
    await screen.findByTestId("setscanner-track-0");
    // Third distinct hour (17:xx) starts at track 10 → page 3.
    fireEvent.click(screen.getByTestId("setscanner-hour-2"));
    await flush();
    expect(screen.getByTestId("setscanner-track-10")).toBeTruthy();
    expect(screen.getByTestId("setscanner-page-3").getAttribute("aria-current")).toBe("true");
  });

  it("maps the scrubber index to a page and clamps to set bounds", async () => {
    stubFetch(makeSet());
    renderScanner();
    const scrubber = await screen.findByTestId("setscanner-scrubber");
    fireEvent.change(scrubber, { target: { value: "7" } });
    await flush();
    expect(screen.getByTestId("setscanner-track-7")).toBeTruthy();
    expect(screen.getByTestId("setscanner-page-2").getAttribute("aria-current")).toBe("true");
    fireEvent.change(scrubber, { target: { value: "999" } });
    await flush();
    // Clamped to the last track's page.
    expect(screen.getByTestId("setscanner-track-11")).toBeTruthy();
  });

  it("resumes at the first unscanned track after the furthest scanned one", async () => {
    for (const i of [0, 1, 2, 3, 4]) recordSetScan(SLUG, 555, i);
    stubFetch(makeSet());
    renderScanner();
    // resumeIndex 5 → page 2.
    expect(await screen.findByTestId("setscanner-track-5")).toBeTruthy();
    expect(screen.getByTestId("setscanner-page-2").getAttribute("aria-current")).toBe("true");
    expect(screen.queryByTestId("setscanner-track-0")).toBeNull();
  });

  it("starts a newer set fresh and notes the previous set was partly scanned", async () => {
    recordSetScan(SLUG, 999, 3); // progress for an OLDER run
    stubFetch(makeSet());
    renderScanner();
    expect(await screen.findByTestId("setscanner-stale-note")).toBeTruthy();
    expect(screen.getByTestId("setscanner-page-1").getAttribute("aria-current")).toBe("true");
    expect(screen.getByTestId("setscanner-track-0")).toBeTruthy();
  });

  it("plays one preview at a time", async () => {
    stubFetch(makeSet());
    renderScanner();
    await screen.findByTestId("setscanner-track-0");
    fireEvent.click(screen.getByTestId("setscanner-preview-0"));
    await flush();
    expect(screen.getByTestId("setscanner-preview-0").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByTestId("setscanner-preview-1"));
    await flush();
    expect(screen.getByTestId("setscanner-preview-0").getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByTestId("setscanner-preview-1").getAttribute("aria-pressed")).toBe("true");
    // Clicking the playing track stops it.
    fireEvent.click(screen.getByTestId("setscanner-preview-1"));
    await flush();
    expect(screen.getByTestId("setscanner-preview-1").getAttribute("aria-pressed")).toBe("false");
  });

  it("honestly reports tracks with no preview sample", async () => {
    mockGetPreview.mockResolvedValue({ previewUrl: null, artworkUrl: null, source: null });
    stubFetch(makeSet());
    renderScanner();
    await screen.findByTestId("setscanner-track-0");
    fireEvent.click(screen.getByTestId("setscanner-preview-0"));
    expect(await screen.findByText("no sample")).toBeTruthy();
    // The attempt still counts as scanned.
    expect(screen.getByLabelText("Song 0 already scanned")).toBeTruthy();
  });

  it("paints library art behind crossing rows only", async () => {
    stubFetch(makeSet());
    renderScanner({ libraryArtwork: new Map([["artist 0", "https://img.example/a.jpg"]]) });
    const crossing = await screen.findByTestId("setscanner-track-0");
    expect(crossing.className).toContain("setscanner__track--crossing");
    const art = crossing.querySelector("img.setscanner__track-bg-art");
    expect(art).toBeTruthy();
    expect(art!.getAttribute("src")).toContain("/api/art?src=");
    const plain = screen.getByTestId("setscanner-track-1");
    expect(plain.className).not.toContain("setscanner__track--crossing");
    expect(plain.querySelector("img.setscanner__track-bg-art")).toBeNull();
  });

  it("wires Keep to the same resolved/pending flow with station provenance", async () => {
    stubFetch(makeSet());
    renderScanner();
    await screen.findByTestId("setscanner-track-0");
    expect(screen.getByTestId("keep-1000")).toBeTruthy();
    const first = keepProps.find((p) => p.spinId === 1000);
    expect(first?.mbid).toBe("mbid-0");
    expect(first?.provenance).toMatchObject({ stationSlug: SLUG, stationName: "KXYZ" });
  });

  it("prefetches only the visible and adjacent pages", async () => {
    stubFetch(makeSet());
    renderScanner();
    await screen.findByTestId("setscanner-track-0");
    await flush();
    const called = mockGetPreview.mock.calls.map((c) => c[0] as string);
    // Normal density, page 1 → pages 1–2 (10 tracks) resolved; page 3 untouched.
    expect(called).toHaveLength(10);
    expect(called).toContain("mbid-0");
    expect(called).toContain("mbid-9");
    expect(called).not.toContain("mbid-10");
  });

  it("shows an honest empty state when the station has no completed set", async () => {
    stubFetch(null, 404);
    renderScanner();
    expect(await screen.findByTestId("setscanner-empty")).toBeTruthy();
  });

  it("closes via the button and stops playback", async () => {
    const onClose = vi.fn();
    stubFetch(makeSet());
    renderScanner({ onClose });
    await screen.findByTestId("setscanner-track-0");
    fireEvent.click(screen.getByTestId("setscanner-preview-0"));
    await flush();
    fireEvent.click(screen.getByLabelText("Close scanner"));
    expect(onClose).toHaveBeenCalled();
    expect(window.HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  });
});
