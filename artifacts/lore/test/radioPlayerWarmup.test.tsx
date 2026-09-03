// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Station } from "@workspace/api-client-react";
import { useRadioPlayer } from "../src/hooks/useRadioPlayer";

class FakeAudio extends EventTarget {
  preload = "none";
  volume = 1;
  paused = true;
  error: MediaError | null = null;
  src = "";
  load = vi.fn();
  pause = vi.fn(() => {
    this.paused = true;
  });
  play = vi.fn(async () => {
    this.paused = false;
  });
  canPlayType = vi.fn(() => "");
  removeAttribute = vi.fn((name: string) => {
    if (name === "src") this.src = "";
  });
}

const PRIMARY = "https://radio.test/live.mp3";
const ALTERNATE = "https://backup.test/live.aac";

function makeStation(
  slug = "test-radio",
  primary = PRIMARY,
): Station {
  return {
    id: 1,
    slug,
    name: "Test Radio",
    streamUrl: primary,
    streamFormat: "mp3",
    mode: "live",
    attribution: true,
    mayHaveAds: false,
    votes: 0,
    clickcount: 0,
    upcomingShowCount: 0,
    stationCategories: [],
    playbackCandidates: [
      {
        url: primary,
        role: "primary",
        transport: "https",
        format: "mp3",
        healthHint: "healthy",
      },
      {
        url: ALTERNATE,
        role: "alternate",
        transport: "https",
        format: "aac",
        healthHint: "unknown",
      },
    ],
  } as Station;
}

function Harness({
  onApi,
}: {
  onApi: (api: ReturnType<typeof useRadioPlayer>) => void;
}) {
  onApi(useRadioPlayer());
  return null;
}

describe("useRadioPlayer press warmup", () => {
  let api: ReturnType<typeof useRadioPlayer>;
  let created: FakeAudio[];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.1);
    created = [];
    vi.stubGlobal("Audio", function AudioMock() {
      const audio = new FakeAudio();
      created.push(audio);
      return audio;
    });
    render(<Harness onApi={(value) => { api = value; }} />);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("opens only candidate 0 without playing and promotes it on click", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    const station = makeStation();

    act(() => api.warmup(station));
    expect(created).toHaveLength(1);
    expect(created[0]!.src).toBe(PRIMARY);
    expect(created[0]!.src).not.toBe(ALTERNATE);
    expect(created[0]!.preload).toBe("auto");
    expect(created[0]!.load).toHaveBeenCalledTimes(1);
    expect(created[0]!.play).not.toHaveBeenCalled();

    act(() => api.releaseWarmup());
    await act(async () => {
      await api.toggle(station);
      await vi.advanceTimersByTimeAsync(125);
      created[0]!.dispatchEvent(new Event("playing"));
    });

    expect(created).toHaveLength(1);
    expect(created[0]!.play).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      event: "playing",
      warmed: true,
      startupMs: 125,
    });
  });

  it("closes released or cancelled warm sources promptly without playing", async () => {
    const station = makeStation();

    act(() => {
      api.warmup(station);
      api.releaseWarmup();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(249);
    });
    expect(created[0]!.src).toBe(PRIMARY);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(created[0]!.src).toBe("");
    expect(created[0]!.play).not.toHaveBeenCalled();

    act(() => {
      api.warmup(station);
      api.cancelWarmup();
    });
    expect(created[1]!.src).toBe("");
    expect(created[1]!.play).not.toHaveBeenCalled();
  });

  it("warms a different station without pausing current playback", async () => {
    const current = makeStation();
    const next = makeStation("next-radio", "https://next.test/live.mp3");

    await act(async () => {
      await api.play(current);
      created[0]!.dispatchEvent(new Event("playing"));
    });
    const activePauseCount = created[0]!.pause.mock.calls.length;

    act(() => api.warmup(next));

    expect(created).toHaveLength(2);
    expect(created[0]!.pause).toHaveBeenCalledTimes(activePauseCount);
    expect(created[0]!.src).toBe(PRIMARY);
    expect(created[1]!.src).toBe("https://next.test/live.mp3");
    expect(created[1]!.play).not.toHaveBeenCalled();
  });
});