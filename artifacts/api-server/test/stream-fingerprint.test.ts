import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";

/**
 * fingerprintStream timestamp contract:
 * ACRCloud's play_offset_ms is the position in the matched ORIGINAL track at
 * the END of the recognized clip, so `clipEndedAt` must be stamped when the
 * ffmpeg capture finishes — NOT when it starts, and NOT after the ACR
 * round-trip. Pairing an end-of-clip offset with the capture-start time would
 * overstate elapsed play time by the whole clip duration (8s) and make the
 * expiry estimator fire boundary re-checks early.
 */

const CLIP_MS = 8_000;
const ACR_LATENCY_MS = 2_500;

const fakeMatch = {
  title: "T",
  artist: "A",
  album: "",
  playOffsetMs: 120_000,
};

let spawnMock: ReturnType<typeof vi.fn>;

vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

vi.mock("../src/lore/acrcloud.js", () => ({
  acrCredentials: () => ({ host: "h", accessKey: "k", accessSecret: "s" }),
  identifyAudio: vi.fn(
    () => new Promise((resolve) => setTimeout(() => resolve(fakeMatch), ACR_LATENCY_MS)),
  ),
}));

function fakeFfmpegProc(clipMs: number): EventEmitter & { stdout: EventEmitter; kill: () => void } {
  const proc = new EventEmitter() as EventEmitter & { stdout: EventEmitter; kill: () => void };
  proc.stdout = new EventEmitter();
  proc.kill = vi.fn();
  // Emit one data chunk immediately, then close when the clip duration elapses.
  setTimeout(() => proc.stdout.emit("data", Buffer.from("mp3-bytes")), 0);
  setTimeout(() => proc.emit("close", 0), clipMs);
  return proc;
}

describe("fingerprintStream clip-end timestamp", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    spawnMock = vi.fn(() => fakeFfmpegProc(CLIP_MS));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
  });

  it("stamps clipEndedAt at capture end — not start, not after the ACR call", async () => {
    const { fingerprintStream } = await import("../src/lore/stream-fingerprint.js");
    const startMs = Date.now();

    const pending = fingerprintStream("http://example.invalid/stream");
    await vi.advanceTimersByTimeAsync(CLIP_MS + ACR_LATENCY_MS + 100);
    const result = await pending;

    expect(result.match).toEqual(fakeMatch);
    const endedMs = result.clipEndedAt.getTime();
    // Exactly the 8s capture window after start (fake timers are exact)…
    expect(endedMs - startMs).toBe(CLIP_MS);
    // …and strictly before the ACR round-trip completed.
    expect(endedMs).toBeLessThan(startMs + CLIP_MS + ACR_LATENCY_MS);
  });
});
