import { spawn } from "node:child_process";
import { acrCredentials, identifyAudio, type AcrMatch } from "./acrcloud.js";

/**
 * Capture a short audio clip from a live stream URL via ffmpeg, then
 * fingerprint it against ACRCloud.
 *
 * ffmpeg reads just enough data to fill the requested clip duration, then
 * exits. No audio is written to disk — the bytes are piped to a Buffer and
 * passed directly to identifyAudio.
 *
 * Returns null when ACRCloud has no match. Throws when ffmpeg or ACRCloud
 * fail with a hard error so the caller can decide whether to swallow or log.
 */

const CLIP_DURATION_S = 8;
const FFMPEG_TIMEOUT_MS = 20_000;
const MAX_CLIP_BYTES = 5 * 1024 * 1024; // 5 MB safety cap

export { type AcrMatch };

/** True when both ffmpeg and ACRCloud credentials are available. */
export function fingerprintAvailable(): boolean {
  return !!acrCredentials();
}

export async function fingerprintStream(streamUrl: string): Promise<AcrMatch | null> {
  const creds = acrCredentials();
  if (!creds) throw new Error("ACRCloud is not configured");

  // Capture CLIP_DURATION_S seconds from the live stream as raw MP3.
  // -loglevel quiet  — suppress ffmpeg progress noise
  // -t <s>           — stop after N seconds of decoded audio
  // -f mp3           — output as MP3 (compact, ACRCloud accepts it)
  // pipe:1           — write to stdout
  const clip = await captureClip(streamUrl);
  return identifyAudio(clip, creds);
}

function captureClip(streamUrl: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill("SIGKILL");
        reject(new Error(`ffmpeg stream capture timed out after ${FFMPEG_TIMEOUT_MS}ms`));
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
        if (!settled) {
          settled = true;
          proc.kill("SIGKILL");
          clearTimeout(timer);
          reject(new Error("stream clip exceeded max size"));
        }
        return;
      }
      chunks.push(chunk);
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      // ffmpeg exits 0 on clean stop; it also exits non-zero if the stream
      // closes before the clip is full (which is fine — we use what we got).
      const buf = Buffer.concat(chunks);
      if (buf.length === 0) {
        reject(new Error(`ffmpeg produced no output (exit ${code ?? "?"})`));
      } else {
        resolve(buf);
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
