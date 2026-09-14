import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SetContextSheet } from "../src/components/SetContextSheet";
import type { SetContext } from "../src/lib/setContexts";

const duck = vi.fn();
const restoreDuck = vi.fn();
const togglePreview = vi.fn();

vi.mock("../src/player/PlayerProvider", () => ({
  usePlayer: () => ({
    radio: {
      status: "playing",
      station: { slug: "other" },
      toggle: vi.fn(),
      duck,
      restoreDuck,
    },
  }),
}));

vi.mock("../src/player/inlinePreview", () => ({
  useInlinePreview: () => ({
    playingMbid: null,
    loadingMbid: null,
    toggle: togglePreview,
    stop: vi.fn(),
  }),
}));

vi.mock("../src/hooks/useDialData", () => ({
  useDialData: () => ({ stations: [] }),
}));

vi.mock("../src/lib/meHooks", () => ({
  useAppConfig: () => ({ data: { demoSurface: false } }),
}));

vi.mock("../src/components/KeepButton", () => ({
  KeepButton: ({ spinId }: { spinId: number }) => <button>Keep {spinId}</button>,
}));

const track = (spinId: number, title: string, previewUrl: string | null) => ({
  spinId,
  mbid: `mbid-${spinId}`,
  title,
  artist: "Iris Vale",
  artistMbid: null,
  albumTitle: "Long Weather",
  artworkUrl: null,
  releaseGroupMbid: null,
  playedAt: "2026-09-02T15:14:00Z",
  previewUrl,
  isKept: false,
  show: null,
});

const context: SetContext = {
  station: {
    slug: "kexp",
    name: "KEXP",
    city: "Seattle",
    homepageUrl: "https://kexp.org",
    donateUrl: null,
  },
  anchorKind: "spin",
  anchorIsLive: true,
  claim: { kind: "selected_by", dj: "Cheryl Waters" },
  before: track(1, "Pale Horse", "https://audio.example/preview.m4a"),
  anchor: track(2, "Slow Bloom", null),
  after: null,
};

describe("SetContextSheet", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it("renders real gaps and only previews tracks with a verified URL", () => {
    render(<SetContextSheet open onOpenChange={vi.fn()} context={context} />);
    expect(screen.getByText("Still on air")).toBeTruthy();
    expect(screen.getAllByLabelText("Preview")).toHaveLength(1);
    fireEvent.click(screen.getByLabelText("Preview"));
    expect(duck).toHaveBeenCalled();
    expect(togglePreview).toHaveBeenCalledWith("mbid-1", "https://audio.example/preview.m4a");
  });

  it("distinguishes a historical missing-after gap from a live anchor", () => {
    render(
      <SetContextSheet
        open
        onOpenChange={vi.fn()}
        context={{ ...context, anchorIsLive: false, before: null }}
      />,
    );
    expect(screen.getByText("Nothing logged before")).toBeTruthy();
    expect(screen.getByText("Nothing logged after")).toBeTruthy();
  });
});