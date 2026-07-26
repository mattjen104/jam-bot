import { db, stationsTable, type Station } from "@workspace/db";
import { eq, or, and } from "drizzle-orm";
import { MIN_BITRATE_KBPS } from "./radio-browser.js";

/**
 * Stream health worker.
 *
 * Periodically HEAD-checks every station's stream URL and updates:
 *   - last_alive_at   — timestamp of last successful probe
 *   - health_failures — consecutive failure count (reset to 0 on success)
 *   - active          — demoted to false after 3 consecutive failures (longtail
 *                       only; flagship stations are flagged-only, never demoted)
 *   - bitrate / codec — updated from response headers when detectable
 *
 * Promotion: inactive longtail candidates that pass their first health check
 * AND meet the minimum bitrate threshold are promoted to active=true.
 *
 * Flagship stations (tier='flagship') are NEVER set inactive — they are logged
 * as degraded and left for a human to review.
 */

const HEAD_TIMEOUT_MS = 8_000;
const MAX_FAILURES = 3;
const STAGGER_MS = 200; // between individual probes

const DEFAULT_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4h
const WARMUP_MS = 15 * 60 * 1000; // 15min after boot

let started = false;
let timer: NodeJS.Timeout | null = null;
let warmup: NodeJS.Timeout | null = null;

function intervalMs(): number {
  const raw = process.env["STREAM_HEALTH_INTERVAL_MS"];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_INTERVAL_MS;
}

/**
 * Probe a single stream URL using HEAD with a GET fallback.
 *
 * Strategy:
 *  1. Try HEAD — cheap, no body download.
 *  2. If HEAD returns 405 (Method Not Allowed) OR throws a network/timeout
 *     error, fall through to a GET probe with an immediate abort after headers
 *     arrive — this handles shoutcast/icecast servers that reject HEAD.
 *  3. Any other non-ok HEAD response (4xx/5xx) is treated as dead immediately.
 *
 * Never throws — all paths return the result object.
 */
export async function probeStream(
  url: string,
  opts: { fetchFn?: typeof fetch; timeoutMs?: number } = {},
): Promise<{
  alive: boolean;
  bitrateKbps: number | null;
  codec: string | null;
}> {
  const fetchFn = opts.fetchFn ?? fetch;
  const timeoutMs = opts.timeoutMs ?? HEAD_TIMEOUT_MS;

  // ---- Step 1: HEAD -------------------------------------------------------
  let headFailed = false; // true when HEAD should be followed up with GET
  try {
    const res = await fetchFn(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "Icy-MetaData": "0" },
    });
    if (res.ok) {
      return {
        alive: true,
        bitrateKbps: extractBitrate(res.headers),
        codec: extractCodec(res.headers),
      };
    }
    // 405 = server doesn't support HEAD → try GET fallback
    if (res.status === 405) {
      headFailed = true;
    } else {
      // Any other error (404, 503…) → stream is genuinely down
      return { alive: false, bitrateKbps: null, codec: null };
    }
  } catch {
    // Network or timeout error on HEAD → try GET fallback
    headFailed = true;
  }

  if (!headFailed) return { alive: false, bitrateKbps: null, codec: null };

  // ---- Step 2: GET fallback -----------------------------------------------
  // We abort immediately after receiving the response headers to avoid
  // pulling the full audio stream. A timeout signal is composed with our
  // own controller so the probe is always bounded even if headers never arrive.
  //
  // `gotResponse` tracks whether the fetch() promise resolved (headers received).
  // If an AbortError is caught WITH gotResponse=true → it's our intentional
  // controller.abort() → stream is alive.
  // If AbortError is caught WITH gotResponse=false → it's the timeout firing
  // before headers arrived → stream is dead (treat same as network error).
  const controller = new AbortController();
  let gotResponse = false;
  try {
    const res = await fetchFn(url, {
      method: "GET",
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)]),
      headers: { "Icy-MetaData": "0", Range: "bytes=0-4095" },
    });
    // Headers received — record this before aborting the body download.
    gotResponse = true;
    controller.abort();
    if (!res.ok && res.status !== 206) {
      return { alive: false, bitrateKbps: null, codec: null };
    }
    return {
      alive: true,
      bitrateKbps: extractBitrate(res.headers),
      codec: extractCodec(res.headers),
    };
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError" && gotResponse) {
      // Our own controller.abort() fired after headers were received — alive.
      return { alive: true, bitrateKbps: null, codec: null };
    }
    // Timeout abort (gotResponse=false) or genuine network error — dead.
    return { alive: false, bitrateKbps: null, codec: null };
  }
}

/** Extract bitrate from Icy-Br or Content-Type headers, or null if absent. */
export function extractBitrate(headers: Headers): number | null {
  const icyBr = headers.get("icy-br");
  if (icyBr) {
    const n = parseInt(icyBr, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

/** Extract codec hint from Content-Type header, or null if not detectable. */
export function extractCodec(headers: Headers): string | null {
  const ct = headers.get("content-type") ?? "";
  if (/aac/i.test(ct)) return "AAC";
  if (/mpeg/i.test(ct) || /mp3/i.test(ct)) return "MP3";
  if (/ogg/i.test(ct)) return "OGG";
  if (/flac/i.test(ct)) return "FLAC";
  if (/mpegurl/i.test(ct)) return "HLS";
  return null;
}

/**
 * Apply a health probe result to a station row in the DB.
 * - Success: reset health_failures=0, set last_alive_at=now; promote longtail
 *   candidates if bitrate threshold met.
 * - Failure: increment health_failures; after MAX_FAILURES, demote longtail
 *   to active=false; flagship stations are only logged.
 */
export async function applyHealthResult(
  station: Station,
  result: { alive: boolean; bitrateKbps: number | null; codec: string | null },
): Promise<void> {
  const now = new Date();

  if (result.alive) {
    const newBitrate = result.bitrateKbps ?? station.bitrate;
    const newCodec = result.codec ?? station.codec;
    // Only promote when bitrate is known AND meets the threshold.
    // Unknown bitrate (null) → keep inactive until a future probe can confirm quality.
    const meetsQuality =
      newBitrate !== null && newBitrate >= MIN_BITRATE_KBPS;

    const shouldPromote =
      !station.active &&
      station.tier === "longtail" &&
      meetsQuality;

    await db
      .update(stationsTable)
      .set({
        lastAliveAt: now,
        healthFailures: 0,
        ...(newBitrate !== null ? { bitrate: newBitrate } : {}),
        ...(newCodec !== null ? { codec: newCodec } : {}),
        ...(shouldPromote ? { active: true } : {}),
        updatedAt: now,
      })
      .where(eq(stationsTable.id, station.id));

    if (shouldPromote) {
      console.info(
        `[stream-health] promoted longtail station "${station.slug}" (bitrate=${newBitrate ?? "unknown"} kbps)`,
      );
    }
    return;
  }

  const newFailures = (station.healthFailures ?? 0) + 1;
  const shouldDemote =
    newFailures >= MAX_FAILURES &&
    station.tier === "longtail" &&
    station.active;

  if (newFailures >= MAX_FAILURES && station.tier === "flagship") {
    console.warn(
      `[stream-health] FLAGSHIP station "${station.slug}" failed ${newFailures} consecutive checks — NOT demoting (manual review required)`,
    );
  }

  await db
    .update(stationsTable)
    .set({
      healthFailures: newFailures,
      ...(shouldDemote ? { active: false } : {}),
      updatedAt: now,
    })
    .where(eq(stationsTable.id, station.id));

  if (shouldDemote) {
    console.info(
      `[stream-health] demoted longtail station "${station.slug}" after ${newFailures} consecutive failures`,
    );
  }
}

/**
 * Run one full health sweep: probe all active stations plus inactive longtail
 * candidates (so they can be promoted on first success). Staggered to avoid
 * slamming all streams simultaneously.
 */
export async function runHealthSweep(
  opts: { fetchFn?: typeof fetch } = {},
): Promise<void> {
  let stations: Station[];
  try {
    stations = await db
      .select()
      .from(stationsTable)
      .where(
        and(
          eq(stationsTable.hidden, false),
          or(
            eq(stationsTable.active, true),
            and(
              eq(stationsTable.active, false),
              eq(stationsTable.tier, "longtail"),
            ),
          ),
        ),
      );
  } catch (err) {
    console.error("[stream-health] could not load stations for health sweep", err);
    return;
  }

  console.info(`[stream-health] sweeping ${stations.length} station(s)`);

  for (let i = 0; i < stations.length; i++) {
    const station = stations[i]!;
    const result = await probeStream(station.streamUrl, opts);
    await applyHealthResult(station, result);
    if (i < stations.length - 1) {
      await new Promise((r) => setTimeout(r, STAGGER_MS));
    }
  }

  console.info("[stream-health] sweep complete");
}

/**
 * Start the stream health worker. Idempotent. Runs once after warmup, then on
 * the configured interval. Errors never crash the server.
 */
export function startStreamHealthWorker(): void {
  if (started) return;
  started = true;

  warmup = setTimeout(() => {
    warmup = null;
    void runHealthSweep().catch((err) =>
      console.error("[stream-health] sweep failed", err),
    );
    timer = setInterval(() => {
      void runHealthSweep().catch((err) =>
        console.error("[stream-health] sweep failed", err),
      );
    }, intervalMs());
  }, WARMUP_MS);
}

/** Stop the worker (for tests / graceful shutdown). */
export function stopStreamHealthWorker(): void {
  if (warmup) {
    clearTimeout(warmup);
    warmup = null;
  }
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  started = false;
}
