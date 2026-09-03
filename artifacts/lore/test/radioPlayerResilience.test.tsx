// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Station } from "@workspace/api-client-react";
import {
  resolvePlaybackCandidates,
  useRadioPlayer,
} from "../src/hooks/useRadioPlayer";

const hlsState = vi.hoisted(() => ({
  instances: [] as Array<{
    handlers: Map<string, (event: string, data: unknown) => void>;
    startLoad: ReturnType<typeof vi.fn>;
    recoverMediaError: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock("hls.js", () => {
  class FakeHls {
    static Events = { ERROR: "error" };
    static isSupported() {
      return true;
    }
    handlers = new Map<string, (event: string, data: unknown) => void>();
    startLoad = vi.fn();
    recoverMediaError = vi.fn();
    destroy = vi.fn();
    loadSource = vi.fn();
    attachMedia = vi.fn();
    constructor() {
      hlsState.instances.push(this);
    }
    on(event: string, handler: (event: string, data: unknown) => void) {
      this.handlers.set(event, handler);
    }
  }
  return { default: FakeHls };
});

class FakeAudio extends EventTarget {
  preload = "none";
  volume = 1;
  paused = true;
  error: MediaError | null = null;
  src = "";
  playedSources: string[] = [];
  load = vi.fn();
  pause = vi.fn(() => {
    this.paused = true;
  });
  play = vi.fn(async () => {
    this.paused = false;
    this.playedSources.push(this.src);
  });
  canPlayType = vi.fn(() => "");
  removeAttribute = vi.fn((name: string) => {
    if (name === "src") this.src = "";
  });
}

const PRIMARY = "https://radio.test/live.mp3";
const ALTERNATE = "https://backup.test/live.aac";

function makeStation(overrides: Partial<Station> = {}): Station {
  return {
    id: 1,
    slug: "test-radio",
    name: "Test Radio",
    streamUrl: PRIMARY,
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
        url: PRIMARY,
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
    ...overrides,
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

describe("useRadioPlayer resilience", () => {
  let audio: FakeAudio;
  let api: ReturnType<typeof useRadioPlayer>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    audio = new FakeAudio();
    vi.stubGlobal("Audio", function AudioMock() {
      return audio;
    });
    hlsState.instances.length = 0;
    render(<Harness onApi={(value) => { api = value; }} />);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("retries once, then switches to only one sanctioned alternate", async () => {
    await act(async () => {
      await api.play(makeStation());
    });
    expect(audio.playedSources).toEqual([PRIMARY]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_750);
    });
    expect(audio.playedSources).toEqual([PRIMARY, PRIMARY]);
    expect(api.status).toBe("reconnecting");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_650);
    });
    expect(audio.playedSources).toEqual([PRIMARY, PRIMARY, ALTERNATE]);
    expect(api.status).toBe("recovering");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_750);
      await vi.advanceTimersByTimeAsync(8_750);
    });
    expect(api.status).toBe("error");
    expect(audio.playedSources).toHaveLength(4);
  });

  it("uses playing as the proof of startup and bounds stall recovery", async () => {
    await act(async () => {
      await api.play(makeStation());
      audio.dispatchEvent(new Event("playing"));
    });
    expect(api.status).toBe("playing");

    act(() => {
      audio.dispatchEvent(new Event("waiting"));
    });
    expect(api.status).toBe("reconnecting");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_750);
    });
    expect(audio.playedSources).toEqual([PRIMARY, PRIMARY]);
  });

  it("records one stall when waiting and stalled describe the same incident", async () => {
    vi.mocked(Math.random).mockReturnValue(0.1);
    const fetchMock = vi.fn(async () => new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => {
      await api.play(makeStation());
      audio.dispatchEvent(new Event("playing"));
      audio.dispatchEvent(new Event("waiting"));
      audio.dispatchEvent(new Event("stalled"));
    });
    const events = fetchMock.mock.calls.map(([, init]) =>
      JSON.parse(String(init?.body)).event,
    );
    expect(events.filter((event) => event === "stall")).toHaveLength(1);
  });

  it("reports only sampled, station-scoped playback fields", async () => {
    vi.mocked(Math.random).mockReturnValue(0.1);
    const fetchMock = vi.fn(async () => new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => {
      await api.play(makeStation());
      await vi.advanceTimersByTimeAsync(125);
      audio.dispatchEvent(new Event("playing"));
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/stations/test-radio/playback-events");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      event: "playing",
      transport: "https",
      format: "mp3",
      startupMs: 125,
    });
    expect(String(init?.body)).not.toMatch(/user|session|device|ip/i);
  });

  it("recovers an interrupted active stream online but not an explicit pause", async () => {
    await act(async () => {
      await api.play(makeStation());
      audio.dispatchEvent(new Event("playing"));
    });
    const beforeRecovery = audio.play.mock.calls.length;
    audio.paused = true;

    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    expect(audio.play.mock.calls.length).toBe(beforeRecovery + 1);

    act(() => api.pause());
    const afterPause = audio.play.mock.calls.length;
    await act(async () => {
      vi.setSystemTime(Date.now() + 10_000);
      window.dispatchEvent(new Event("online"));
      window.dispatchEvent(new PageTransitionEvent("pageshow"));
      await vi.runOnlyPendingTimersAsync();
    });
    expect(api.status).toBe("paused");
    expect(audio.play.mock.calls.length).toBe(afterPause);
  });

  it("does not revive a startup that already exhausted all candidates", async () => {
    await act(async () => {
      await api.play(makeStation());
      await vi.advanceTimersByTimeAsync(35_000);
    });
    expect(api.status).toBe("error");
    const attemptsAtError = audio.play.mock.calls.length;
    await act(async () => {
      vi.setSystemTime(Date.now() + 10_000);
      window.dispatchEvent(new Event("online"));
      window.dispatchEvent(new PageTransitionEvent("pageshow"));
      await vi.runOnlyPendingTimersAsync();
    });
    expect(api.status).toBe("error");
    expect(audio.play.mock.calls.length).toBe(attemptsAtError);
  });

  it("recovers one fatal HLS network error before using normal failover", async () => {
    await act(async () => {
      await api.play(
        makeStation({
          streamUrl: "https://radio.test/live.m3u8",
          streamFormat: "hls",
          playbackCandidates: [
            {
              url: "https://radio.test/live.m3u8",
              role: "primary",
              transport: "https",
              format: "hls",
              healthHint: "healthy",
            },
          ],
        } as Partial<Station>),
      );
    });
    const hls = hlsState.instances[0]!;
    act(() => {
      hls.handlers.get("error")?.("error", {
        fatal: true,
        type: "networkError",
      });
    });
    expect(hls.startLoad).toHaveBeenCalledTimes(1);
    expect(api.status).toBe("reconnecting");

    act(() => {
      hls.handlers.get("error")?.("error", {
        fatal: true,
        type: "networkError",
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(750);
    });
    expect(hls.destroy).toHaveBeenCalled();
  });

  it("stops the previous station before reporting a no-source error", async () => {
    await act(async () => {
      await api.play(makeStation());
      audio.dispatchEvent(new Event("playing"));
      await api.play(
        makeStation({
          slug: "silent-station",
          streamUrl: null,
          playbackCandidates: [],
        } as Partial<Station>),
      );
    });
    expect(audio.pause).toHaveBeenCalled();
    expect(audio.src).toBe("");
    expect(api.status).toBe("error");
    expect(api.station?.slug).toBe("silent-station");
  });

  it("ignores queued errors from a superseded audio element", async () => {
    const oldAudio = new FakeAudio();
    const currentAudio = new FakeAudio();
    const elements = [oldAudio, currentAudio];
    vi.stubGlobal("Audio", function AudioMock() {
      return elements.shift() ?? new FakeAudio();
    });

    await act(async () => {
      await api.play(makeStation());
      await api.play(
        makeStation({
          slug: "new-radio",
          streamUrl: ALTERNATE,
          playbackCandidates: [
            {
              url: ALTERNATE,
              role: "primary",
              transport: "https",
              format: "aac",
              healthHint: "healthy",
            },
          ],
        } as Partial<Station>),
      );
      oldAudio.dispatchEvent(new Event("error"));
    });

    expect(currentAudio.play).toHaveBeenCalledTimes(1);
    expect(api.station?.slug).toBe("new-radio");
    expect(api.status).toBe("loading");
  });
});

describe("resolvePlaybackCandidates", () => {
  it("honors the published order and removes duplicate or unsafe candidates", () => {
    const station = makeStation({
      playbackCandidates: [
        {
          url: "/api/stations/test-radio/relay",
          role: "primary",
          transport: "relay",
          format: "mp3",
          healthHint: "healthy",
        },
        {
          url: "/api/stations/test-radio/relay",
          role: "alternate",
          transport: "relay",
          format: "mp3",
          healthHint: "unknown",
        },
        {
          url: "javascript:alert(1)",
          role: "alternate",
          transport: "https",
          format: "mp3",
          healthHint: "unknown",
        },
        {
          url: ALTERNATE,
          role: "alternate",
          transport: "https",
          format: "aac",
          healthHint: "unknown",
        },
      ],
    } as Partial<Station>);
    expect(resolvePlaybackCandidates(station).map((candidate) => candidate.url))
      .toEqual(["/api/stations/test-radio/relay", ALTERNATE]);
  });
});