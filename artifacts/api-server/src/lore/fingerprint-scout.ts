import { db, stationsTable, fingerprintScoutTalliesTable } from "@workspace/db";
import { sql, eq } from "drizzle-orm";
import {
  auddAvailable,
  recognizeStream,
} from "./audd.js";
import { logSpinIfChanged } from "./resolve.js";

/**
 * Rotating audio-fingerprint scout.
 *
 * Cycles through metadata-dark stations — those whose radio_browser rows are
 * ALL icy_unsupported — fingerprinting ONE station per tick (~2 min cadence)
 * via AudD. The point is triage on a fixed budget, not now-playing coverage:
 * each station is sampled a handful of times a day and the aggregated scout
 * report tells the admin which stations are worth keeping.
 *
 * Recognized tracks are logged as ordinary spins tagged source='audd_scout'
 * so the existing resolution/crossing machinery applies; per-station tallies
 * (samples/recognitions) persist in fingerprint_scout_tallies so the report
 * survives restarts.
 *
 * Eligibility excludes hidden stations, sleep stations (sleep_mode=true),
 * and nature/ambient-noise stations by name — there is nothing to
 * fingerprint there.
 *
 * Fails closed: without AUDD_API_KEY the scheduler never starts and logs a
 * single info line. Perpetual-scheduler conventions: idempotent start, owned
 * timeout handle, active-flag re-arm guard.
 */

export const SCOUT_SPIN_SOURCE = "audd_scout";

const DEFAULT_TICK_MS = 2 * 60_000;

/**
 * Name substrings (case-insensitive) that classify a station as
 * nature/ambient-noise — excluded from the scout rotation entirely.
 * (Sleep-classified stations are already excluded via sleep_mode=true;
 * these patterns catch noise stations that escaped sleep classification.)
 */
export const NATURE_NOISE_PATTERNS = Object.freeze([
  "nature",
  "birdsong",
  "bird song",
  "rainforest",
  "rain sounds",
  "rain radio",
  "ocean",
  "waves",
  "thunder",
  "white noise",
  "brown noise",
  "pink noise",
  "ambient noise",
  "asmr",
] as const);

/** Pure: does the station name classify as nature/ambient noise? */
export function isNatureNoiseName(name: string | null | undefined): boolean {
  const lower = (name ?? "").toLowerCase();
  return NATURE_NOISE_PATTERNS.some((p) => lower.includes(p));
}

export type ScoutFlag = "promote" | "remove" | "scouting";

/** Samples required before the scout dares a remove verdict. */
export const SCOUT_VERDICT_MIN_SAMPLES = 8;

/**
 * Pure: compute the promote/remove/still-scouting flag from tallies + spin
 * stats. The report only FLAGS — the admin decides; nothing auto-removes.
 *
 *  - promote: recognitions exist and produced at least one taste crossing or
 *    several first plays — the station is playing music the listener cares
 *    about (or genuinely new to Lore).
 *  - remove: enough samples taken and either nothing was ever recognized or
 *    nothing recognized was interesting (no crossings, no first plays).
 *  - scouting: everything else — not enough evidence yet.
 */
export function computeScoutFlag(stats: {
  samples: number;
  recognitions: number;
  crossings: number;
  firstPlays: number;
}): ScoutFlag {
  const { samples, recognitions, crossings, firstPlays } = stats;
  if (recognitions > 0 && (crossings >= 1 || firstPlays >= 3)) return "promote";
  if (samples >= SCOUT_VERDICT_MIN_SAMPLES && recognitions === 0) return "remove";
  if (
    samples >= SCOUT_VERDICT_MIN_SAMPLES &&
    crossings === 0 &&
    firstPlays === 0
  ) {
    return "remove";
  }
  return "scouting";
}

interface PoolStation {
  id: number;
  name: string;
  streamUrl: string;
}

/**
 * Build the eligible pool: stations linked from radio_browser_stations where
 * EVERY rb row is icy_unsupported, with a stream URL, not hidden, not sleep,
 * then name-filtered against the nature/noise patterns in JS.
 */
export async function buildScoutPool(): Promise<PoolStation[]> {
  const result = await db.execute<{
    id: number;
    name: string;
    stream_url: string;
  }>(sql`
    SELECT s.id, s.name, s.stream_url
    FROM stations s
    WHERE s.hidden = false
      AND s.sleep_mode = false
      AND COALESCE(s.stream_url, '') <> ''
      AND EXISTS (
        SELECT 1 FROM radio_browser_stations rb WHERE rb.station_id = s.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM radio_browser_stations rb
        WHERE rb.station_id = s.id AND rb.icy_status <> 'icy_unsupported'
      )
  `);
  return result.rows
    .filter((r) => !isNatureNoiseName(r.name))
    .map((r) => ({ id: r.id, name: r.name, streamUrl: r.stream_url }));
}

// ── Scheduler ───────────────────────────────────────────────────────────────

let scoutActive = false;
let scoutHandle: NodeJS.Timeout | null = null;

/** Test seam: swap the recognizer without touching real streams/AudD. */
let runRecognize: typeof recognizeStream = recognizeStream;
export function _testOnly_setRecognizer(
  fn: typeof recognizeStream,
): () => void {
  const prev = runRecognize;
  runRecognize = fn;
  return () => {
    runRecognize = prev;
  };
}

/**
 * One scout tick: pick the eligible station sampled longest ago (never-sampled
 * first), fingerprint it, bump tallies, and log a recognized track as a spin.
 * Exported for tests; production calls arrive from the scheduler only.
 */
export async function scoutTick(): Promise<void> {
  const pool = await buildScoutPool();
  if (pool.length === 0) return;

  // Rotate by last_sampled_at: never-sampled stations first, then oldest.
  // Restart-safe — the rotation position lives in the tallies table.
  const tallies = await db
    .select({
      stationId: fingerprintScoutTalliesTable.stationId,
      lastSampledAt: fingerprintScoutTalliesTable.lastSampledAt,
    })
    .from(fingerprintScoutTalliesTable);
  const lastByStation = new Map<number, Date | null>(
    tallies.map((t) => [t.stationId, t.lastSampledAt]),
  );
  const next = [...pool].sort((a, b) => {
    const la = lastByStation.get(a.id)?.getTime() ?? 0;
    const lb = lastByStation.get(b.id)?.getTime() ?? 0;
    return la - lb || a.id - b.id;
  })[0];
  if (!next) return;

  const now = new Date();
  const outcome = await runRecognize(next.streamUrl);
  // Failed capture/provider/API attempts are operational failures, not
  // evidence the station plays nothing useful. Do not count them as samples,
  // or an AudD outage/quota exhaustion could falsely flag every station for
  // removal after the verdict threshold.
  if (outcome.kind === "failed") {
    console.warn(`[lore] audd scout: ${next.name} sample failed (${outcome.reason})`);
    return;
  }
  const recognition = outcome.kind === "recognized" ? outcome.recognition : null;

  await db
    .insert(fingerprintScoutTalliesTable)
    .values({
      stationId: next.id,
      samples: 1,
      recognitions: recognition ? 1 : 0,
      lastSampledAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: fingerprintScoutTalliesTable.stationId,
      set: {
        samples: sql`${fingerprintScoutTalliesTable.samples} + 1`,
        recognitions: sql`${fingerprintScoutTalliesTable.recognitions} + ${recognition ? 1 : 0}`,
        lastSampledAt: now,
        updatedAt: now,
      },
    });

  if (!recognition) return;

  const [station] = await db
    .select()
    .from(stationsTable)
    .where(eq(stationsTable.id, next.id))
    .limit(1);
  if (!station) return;

  const wrote = await logSpinIfChanged(
    station,
    {
      rawArtist: recognition.rawArtist,
      rawTitle: recognition.rawTitle,
      ...(recognition.isrc ? { isrc: recognition.isrc } : {}),
      ...(recognition.recordingId
        ? { recordingId: recognition.recordingId }
        : {}),
    },
    { source: SCOUT_SPIN_SOURCE },
  );
  if (wrote) {
    console.info(
      `[lore] audd scout: ${station.slug} recognized "${recognition.rawArtist} - ${recognition.rawTitle}"`,
    );
  }
}

/**
 * Start the rotating scout. Idempotent; no-op (with a single info line)
 * when AUDD_API_KEY is not configured.
 */
export async function startFingerprintScout(): Promise<void> {
  if (scoutActive) return;
  if (!auddAvailable()) {
    console.info("[lore] fingerprint scout: AUDD_API_KEY not set, scout disabled");
    return;
  }
  // runMigration intentionally swallows boot-migration failures so the API can
  // expose them via health. Do not start a perpetual job against a missing
  // tallies table in that case — verify it once and fail closed instead of
  // emitting a failed tick every two minutes.
  try {
    await db.execute(sql`SELECT 1 FROM fingerprint_scout_tallies LIMIT 1`);
  } catch (err) {
    console.error(
      `[lore] fingerprint scout disabled: tally table unavailable (${String(err)})`,
    );
    return;
  }
  scoutActive = true;
  const tickMs = Number(process.env.AUDD_SCOUT_TICK_MS) || DEFAULT_TICK_MS;

  const arm = () => {
    if (!scoutActive) return; // re-arm guard — stop() during a tick stays stopped
    scoutHandle = setTimeout(async () => {
      try {
        await scoutTick();
      } catch (err) {
        console.error("[lore] fingerprint scout tick failed:", err);
      }
      arm();
    }, tickMs);
  };
  arm();
  console.info(`[lore] fingerprint scout started (tick every ${tickMs}ms)`);
}

/** Stop the scout (tests / shutdown). */
export function stopFingerprintScout(): void {
  scoutActive = false;
  if (scoutHandle) {
    clearTimeout(scoutHandle);
    scoutHandle = null;
  }
}

// ── Scout report ────────────────────────────────────────────────────────────

export interface ScoutReportRow {
  stationId: number;
  stationName: string;
  samples: number;
  recognitions: number;
  crossings: number;
  firstPlays: number;
  lastSampledAt: string | null;
  flag: ScoutFlag;
}

/**
 * Aggregate the scout report: per scouted station, tallies joined with
 * spin-derived stats over source='audd_scout' spins —
 *
 *  - crossings: scout spins whose artist matches the listener's taste
 *    (library artist MBIDs via kept recordings, or taste-seed names by
 *    normalized-lowercase match — same signals the crossing pipeline uses).
 *  - firstPlays: distinct artists whose FIRST appearance anywhere in Lore's
 *    spin log was a scout-logged spin (no earlier spin by that artist name).
 */
export async function getScoutReport(): Promise<ScoutReportRow[]> {
  const result = await db.execute<{
    station_id: number;
    station_name: string;
    samples: number;
    recognitions: number;
    last_sampled_at: string | null;
    crossings: string;
    first_plays: string;
  }>(sql`
    WITH scout_spins AS (
      SELECT
        sp.id,
        sp.station_id,
        sp.played_at,
        LOWER(TRIM(COALESCE(r.artist, sp.raw_artist, ''))) AS artist_key,
        r.artist_mbid
      FROM spins sp
      LEFT JOIN recordings r ON r.mbid = sp.mbid
      WHERE sp.source = ${SCOUT_SPIN_SOURCE}
    ),
    library_artists AS (
      SELECT DISTINCT r.artist_mbid
      FROM library_items li
      JOIN recordings r ON r.mbid = li.mbid
      WHERE li.removed_at IS NULL AND r.artist_mbid IS NOT NULL
    ),
    seed_names AS (
      SELECT DISTINCT LOWER(TRIM(artist_name)) AS artist_key FROM taste_seeds
    ),
    per_station AS (
      SELECT
        ss.station_id,
        COUNT(*) FILTER (
          WHERE (ss.artist_mbid IS NOT NULL AND ss.artist_mbid IN (SELECT artist_mbid FROM library_artists))
             OR (ss.artist_key <> '' AND ss.artist_key IN (SELECT artist_key FROM seed_names))
        ) AS crossings,
        COUNT(DISTINCT ss.artist_key) FILTER (
          WHERE ss.artist_key <> ''
            AND NOT EXISTS (
              SELECT 1
              FROM spins sp2
              LEFT JOIN recordings r2 ON r2.mbid = sp2.mbid
              WHERE sp2.played_at < ss.played_at
                AND LOWER(TRIM(COALESCE(r2.artist, sp2.raw_artist, ''))) = ss.artist_key
            )
        ) AS first_plays
      FROM scout_spins ss
      GROUP BY ss.station_id
    )
    SELECT
      t.station_id,
      s.name AS station_name,
      t.samples,
      t.recognitions,
      t.last_sampled_at,
      COALESCE(ps.crossings, 0) AS crossings,
      COALESCE(ps.first_plays, 0) AS first_plays
    FROM fingerprint_scout_tallies t
    JOIN stations s ON s.id = t.station_id
    LEFT JOIN per_station ps ON ps.station_id = t.station_id
    ORDER BY t.samples DESC, s.name ASC
  `);

  return result.rows.map((row) => {
    const samples = Number(row.samples);
    const recognitions = Number(row.recognitions);
    const crossings = Number(row.crossings);
    const firstPlays = Number(row.first_plays);
    return {
      stationId: row.station_id,
      stationName: row.station_name,
      samples,
      recognitions,
      crossings,
      firstPlays,
      lastSampledAt: row.last_sampled_at
        ? new Date(row.last_sampled_at).toISOString()
        : null,
      flag: computeScoutFlag({ samples, recognitions, crossings, firstPlays }),
    };
  });
}
