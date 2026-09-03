import { spawn } from "node:child_process";

/**
 * AudD music recognition for the rotating fingerprint scout.
 *
 * Samples ~10 seconds of audio from a live stream URL via an ffmpeg
 * subprocess (bounded: hard abort after 20s or 200KB of output), POSTs the
 * clip to AudD's recognize endpoint with `return=musicbrainz`, and shapes the
 * response into a minimal recognition record.
 *
 * Availability is gated on the AUDD_API_KEY environment variable — absent
 * key means `auddAvailable()` is false and `recognizeStream` returns a
 * `failed` outcome immediately. The module NEVER throws. It deliberately
 * distinguishes provider/capture failure from AudD's genuine no-match:
 * failures must never count toward a station's removal recommendation.
 *
 * This deliberately parallels the ACRCloud path in stream-fingerprint.ts but
 * stays independent: the scout's budget/caps differ (10s clip, 200KB cap vs
 * 8s/5MB), AudD is keyed by a single token, and scout failures must be
 * swallowed rather than surfaced to a request handler.
 */

const CLIP_DURATION_S = 10;
const FFMPEG_TIMEOUT_MS = 20_000;
const MAX_CLIP_BYTES = 200 * 1024; // 200 KB cap — ~12s of 128kbps MP3

const AUDD_ENDPOINT = "https://api.audd.io/";

export interface AuddRecognition {
  rawArtist: string;
  rawTitle: string;
  isrc?: string;
  /** MusicBrainz recording id, when AudD's musicbrainz enrichment has one. */
  recordingId?: string;
  /**
   * Capture clock only. AudD's identity response does not include a track
   * position, so these timestamps must never be converted into an offset.
   */
  capture?: CaptureWindow;
}

export interface CaptureWindow {
  startedAt: Date;
  endedAt: Date;
  midpointAt: Date;
  monotonic: {
    startedMs: number;
    endedMs: number;
    midpointMs: number;
  };
}

export type AuddRecognitionOutcome =
  | { kind: "recognized"; recognition: AuddRecognition }
  | { kind: "no_match" }
  | { kind: "failed"; reason: string };

/** True when an AudD API key is configured. */
export function auddAvailable(): boolean {
  return !!process.env.AUDD_API_KEY?.trim();
}

/**
 * Pure: shape an AudD API response body into an AuddRecognition.
 * Returns null for error responses, no-match responses, or junk shapes.
 * Exported for tests.
 */
export function parseAuddResponse(body: unknown): AuddRecognition | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (b.status !== "success") return null;
  const result = b.result;
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  const rawArtist = typeof r.artist === "string" ? r.artist.trim() : "";
  const rawTitle = typeof r.title === "string" ? r.title.trim() : "";
  if (!rawArtist || !rawTitle) return null;
  const out: AuddRecognition = { rawArtist, rawTitle };
  if (typeof r.isrc === "string" && r.isrc.trim()) out.isrc = r.isrc.trim();
  const mb = r.musicbrainz;
  if (Array.isArray(mb) && mb.length > 0) {
    const first = mb[0] as Record<string, unknown> | null;
    if (first && typeof first.id === "string" && first.id.trim()) {
      out.recordingId = first.id.trim();
    }
  }
  return out;
}

/**
 * Capture a bounded clip from the stream and recognize it via AudD.
 * Never throws. A completed AudD response with no result returns no_match;
 * unavailable/capture/network/API failures return failed. This distinction is
 * critical for the scout: only completed AudD samples may count toward its
 * removal threshold.
 */
export async function recognizeStream(
  streamUrl: string,
): Promise<AuddRecognitionOutcome> {
  const apiKey = process.env.AUDD_API_KEY?.trim();
  if (!apiKey) return { kind: "failed", reason: "AUDD_API_KEY not configured" };

  let clip: { bytes: Buffer; window: CaptureWindow };
  try {
    clip = await captureClip(streamUrl);
  } catch (err) {
    console.warn(
      `[lore] audd scout: capture failed for ${streamUrl}: ${String(err)}`,
    );
    return { kind: "failed", reason: "capture failed" };
  }

  try {
    const form = new FormData();
    form.append("api_token", apiKey);
    form.append("return", "musicbrainz");
    form.append(
      "file",
      new Blob([new Uint8Array(clip.bytes)], { type: "audio/mpeg" }),
      "clip.mp3",
    );

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    let body: unknown;
    try {
      const res = await fetch(AUDD_ENDPOINT, {
        method: "POST",
        body: form,
        signal: controller.signal,
      });
      if (!res.ok) {
        console.warn(`[lore] audd scout: HTTP ${res.status} from AudD`);
        return { kind: "failed", reason: `AudD HTTP ${res.status}` };
      }
      body = await res.json();
    } finally {
      clearTimeout(timer);
    }
    const recognition = parseAuddResponse(body);
    if (recognition) recognition.capture = clip.window;
    return recognition ? { kind: "recognized", recognition } : { kind: "no_match" };
  } catch (err) {
    console.warn(`[lore] audd scout: recognize failed: ${String(err)}`);
    return { kind: "failed", reason: "AudD request failed" };
  }
}

/**
 * Capture CLIP_DURATION_S seconds of the stream as MP3 via ffmpeg.
 * Rejects on timeout (>20s wall clock), size overrun (>200KB), spawn error,
 * or empty output — callers convert rejection to a null recognition.
 */
function captureClip(
  streamUrl: string,
): Promise<{ bytes: Buffer; window: CaptureWindow }> {
  return new Promise((resolve, reject) => {
    const startedAt = new Date();
    const startedMs = performance.now();
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill("SIGKILL");
        reject(new Error(`ffmpeg capture timed out after ${FFMPEG_TIMEOUT_MS}ms`));
      }
    }, FFMPEG_TIMEOUT_MS);

    const proc = spawn("ffmpeg", [
      "-loglevel", "quiet",
      "-i", streamUrl,
      "-t", String(CLIP_DURATION_S),
      "-f", "mp3",
      "pipe:1",
    ]);

    proc.stdout.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_CLIP_BYTES) {
        // We have more than enough audio to fingerprint — stop the capture
        // and use what we already collected rather than failing.
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          proc.kill("SIGKILL");
          chunks.push(chunk);
          const endedAt = new Date();
          const endedMs = performance.now();
          resolve({
            bytes: Buffer.concat(chunks).subarray(0, MAX_CLIP_BYTES),
            window: captureWindow(startedAt, startedMs, endedAt, endedMs),
          });
        }
        return;
      }
      chunks.push(chunk);
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      const buf = Buffer.concat(chunks);
      if (buf.length === 0) {
        reject(new Error(`ffmpeg produced no output (exit ${code ?? "?"})`));
      } else {
        const endedAt = new Date();
        const endedMs = performance.now();
        resolve({
          bytes: buf,
          window: captureWindow(startedAt, startedMs, endedAt, endedMs),
        });
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(new Error(`ffmpeg spawn error: ${String(err)}`));
      }
    });
  });
}

export function captureWindow(
  startedAt: Date,
  startedMs: number,
  endedAt: Date,
  endedMs: number,
): CaptureWindow {
  return {
    startedAt,
    endedAt,
    midpointAt: new Date(
      startedAt.getTime() + (endedAt.getTime() - startedAt.getTime()) / 2,
    ),
    monotonic: {
      startedMs,
      endedMs,
      midpointMs: startedMs + (endedMs - startedMs) / 2,
    },
  };
}
