// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeMeHooksMock } from "./helpers/meHooksMock";
import { ReplayExportCascade } from "../src/components/ReplayExportCascade";

const { targetsMock, jobMock } = vi.hoisted(() => ({
  targetsMock: vi.fn(() => ({ data: undefined as unknown, isLoading: false })),
  jobMock: vi.fn(() => ({ data: undefined as unknown, isLoading: false })),
}));

vi.mock("../src/lib/meHooks", async (importOriginal) =>
  makeMeHooksMock(importOriginal, {
    useReplayPlaylistTargets: targetsMock,
    useReplayMaterializationJob: jobMock,
  }),
);

afterEach(() => {
  cleanup();
  targetsMock.mockReset();
  targetsMock.mockReturnValue({ data: undefined, isLoading: false });
  jobMock.mockReset();
  jobMock.mockReturnValue({ data: undefined, isLoading: false });
});

const coverage = { total: 3, resolved: 2, unresolved: 1 };
const entries = [
  {
    position: 0,
    spinId: 1,
    playedAt: "2026-08-03T10:00:00Z",
    source: null,
    citation: null,
    rawArtist: "Artist One",
    rawTitle: "Track One",
    confidence: "recording_id",
    recording: { mbid: "one", title: "Track One", artist: "Artist One", artworkUrl: null, links: [] },
  },
  {
    position: 1,
    spinId: 2,
    playedAt: "2026-08-03T10:03:00Z",
    source: null,
    citation: null,
    rawArtist: "Gap Artist",
    rawTitle: "Gap Title",
    confidence: "unresolved",
    recording: null,
  },
  {
    position: 2,
    spinId: 3,
    playedAt: "2026-08-03T10:06:00Z",
    source: null,
    citation: null,
    rawArtist: "Artist Three",
    rawTitle: "Track Three",
    confidence: "text",
    recording: { mbid: "three", title: "Track Three", artist: "Artist Three", artworkUrl: null, links: [] },
  },
  // Cast: manifest entries carry more optional fields than the cascade reads.
] as unknown as Parameters<typeof ReplayExportCascade>[0]["entries"];

function renderCascade() {
  return render(
    <ReplayExportCascade replayId={41} coverage={coverage} entries={entries} />,
  );
}

describe("ReplayExportCascade", () => {
  it("orders the cascade: connected services, default-player handoff, then other formats", () => {
    renderCascade();
    const section = screen.getByTestId("replay-export-cascade");
    const order = ["cascade-tier-services", "cascade-tier-player", "cascade-tier-formats"].map(
      (id) => Array.from(section.querySelectorAll("[data-testid]")).findIndex(
        (el) => el.getAttribute("data-testid") === id,
      ),
    );
    expect(order[0]).toBeGreaterThanOrEqual(0);
    expect(order[0]).toBeLessThan(order[1]!);
    expect(order[1]).toBeLessThan(order[2]!);
  });

  it("shows a primary direct action for a connected, writable service", () => {
    targetsMock.mockReturnValue({
      data: {
        targets: [
          { service: "apple_music", displayName: "Apple Music", connected: true, canWrite: true, configured: true, authRequired: false },
        ],
      },
      isLoading: false,
    });
    renderCascade();
    expect(screen.getByTestId("materialize-apple_music")).toBeTruthy();
    expect(screen.queryByTestId("connect-apple_music")).toBeNull();
  });

  it("offers a connect action when the service is not connected", () => {
    targetsMock.mockReturnValue({
      data: {
        targets: [
          { service: "tidal", displayName: "Tidal", connected: false, canWrite: false, configured: true, authRequired: true },
        ],
      },
      isLoading: false,
    });
    renderCascade();
    expect(screen.getByTestId("connect-tidal")).toBeTruthy();
    expect(screen.queryByTestId("materialize-tidal")).toBeNull();
  });

  it("reports accepted and remaining entries factually after materialization", () => {
    jobMock.mockReturnValue({
      data: {
        status: "done",
        service: "apple_music",
        name: "KEXP replay",
        accepted: 2,
        total: 3,
        missing: 1,
        rejected: 0,
        playlistUrl: "https://music.example/playlist/1",
      },
      isLoading: false,
    });
    renderCascade();
    const status = screen.getByTestId("materialization-status");
    expect(status.textContent).toContain("2 of 3 broadcast entries added");
    expect(status.textContent).toContain("1 missing and 0 rejected");
  });

  it("presents the XSPF default-player handoff with download semantics and honest copy", () => {
    renderCascade();
    const link = screen.getByTestId("replay-export-xspf");
    expect(link.getAttribute("href")).toBe("/api/replay/41/export?format=xspf");
    expect(link.hasAttribute("download")).toBe(true);
    const tier = screen.getByTestId("cascade-tier-player");
    expect(tier.textContent).toContain("default media player");
    expect(tier.textContent).toContain("open the downloaded file");
    // Best-effort owned-library matching — no launch/control claims.
    expect(tier.textContent).toContain("may match entries against music you already own");
    expect(tier.textContent).toContain("cannot launch or control");
  });

  it("keeps JSPF, M3U8, and CSV reachable at the existing public URLs", () => {
    renderCascade();
    for (const format of ["jspf", "m3u8", "csv"]) {
      const link = screen.getByTestId(`replay-export-${format}`);
      expect(link.getAttribute("href")).toBe(`/api/replay/41/export?format=${format}`);
      expect(link.hasAttribute("download")).toBe(true);
    }
  });

  it("shows factual coverage counts and names unresolved entries — no percentages", () => {
    renderCascade();
    const section = screen.getByTestId("replay-export-cascade");
    expect(screen.getByTestId("cascade-coverage").textContent).toContain(
      "2 of 3 broadcast entries identified",
    );
    const gaps = screen.getByTestId("cascade-gaps");
    expect(within(gaps).getByText("Gap Artist — Gap Title")).toBeTruthy();
    expect(section.textContent).not.toContain("%");
  });

  it("omits the gap list when every entry resolved", () => {
    render(
      <ReplayExportCascade
        replayId={41}
        coverage={{ total: 2, resolved: 2, unresolved: 0 }}
        entries={entries.filter((entry) => entry.recording)}
      />,
    );
    expect(screen.queryByTestId("cascade-gaps")).toBeNull();
  });
});
