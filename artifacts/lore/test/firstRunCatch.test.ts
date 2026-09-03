import { afterEach, describe, expect, it, vi } from "vitest";

import { catchNextSong, CATCH_MAX_WAIT_MS } from "../src/lib/firstRunCatch";
import type { DialStation } from "../src/hooks/useDialData";

const dialStation = {
  station: { slug: "kexp", name: "KEXP" },
} as DialStation;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("catchNextSong", () => {
  it("falls back immediately when the boundary estimate is not trustworthy", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      now: { mbid: "one", artist: "A", title: "One", likelyExpiring: false, estimatedRemainingMs: null },
    }))));
    const play = vi.fn();
    const wait = vi.fn(async () => undefined);
    const message = await catchNextSong(dialStation, play, wait);
    expect(play).toHaveBeenCalledWith(dialStation);
    expect(wait).not.toHaveBeenCalled();
    expect(message).toMatch(/playing now/i);
  });

  it("waits for a trustworthy boundary and starts on the changed track", async () => {
    const responses = [
      { mbid: "one", artist: "A", title: "One", likelyExpiring: true, estimatedRemainingMs: 4_000 },
      { mbid: "two", artist: "B", title: "Two", likelyExpiring: false, estimatedRemainingMs: null },
    ];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ now: responses.shift() }))));
    const play = vi.fn();
    let clock = 0;
    const wait = vi.fn(async (milliseconds: number) => { clock += milliseconds; });
    const message = await catchNextSong(dialStation, play, wait, () => clock);
    expect(wait).toHaveBeenCalledWith(5_500);
    expect(play).toHaveBeenCalledWith(dialStation);
    expect(message).toBe("The next song just started.");
  });

  it("never waits beyond the bounded fallback window", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      now: { mbid: "one", artist: "A", title: "One", likelyExpiring: true, estimatedRemainingMs: 1_000 },
    }))));
    const play = vi.fn();
    let clock = 0;
    const wait = vi.fn(async (milliseconds: number) => { clock += milliseconds; });
    const message = await catchNextSong(dialStation, play, wait, () => clock);
    expect(clock).toBeGreaterThanOrEqual(CATCH_MAX_WAIT_MS);
    expect(clock).toBeLessThan(CATCH_MAX_WAIT_MS + 2_000);
    expect(play).toHaveBeenCalledOnce();
    expect(message).toMatch(/uncertain/i);
  });

  it("does not wait on a receipt-only timestamp", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      now: {
        mbid: "one",
        artist: "A",
        title: "One",
        likelyExpiring: true,
        estimatedRemainingMs: 4_000,
        timestampKind: "receipt",
        timingConfidence: "unknown",
      },
    }))));
    const play = vi.fn();
    const wait = vi.fn(async () => undefined);
    await catchNextSong(dialStation, play, wait);
    expect(wait).not.toHaveBeenCalled();
    expect(play).toHaveBeenCalledOnce();
  });
});