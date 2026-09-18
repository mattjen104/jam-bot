/* eslint-disable no-console -- research manifest generator */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  ROCKSKY_COMPATIBILITY_SCHEMA_VERSION,
  type RockskyManifest,
  type RockskyManifestItem,
} from "../lore/rocksky-compatibility.js";

const ROOT = resolve(import.meta.dirname, "../../../../");
const DEFAULT_OUTPUT = resolve(ROOT, "research/rocksky-compatibility-manifest.json");
const STRATA: RockskyManifestItem["stratum"][] = [
  "recording_id", "isrc", "text", "unresolved", "library", "difficult",
];

function argValue(name: string): string | undefined {
  return process.argv.slice(2).find((arg) => arg.startsWith(`--${name}=`))?.split("=", 2)[1];
}

function targetPerStratum(): number {
  const value = Number(argValue("per-stratum") ?? 50);
  if (!Number.isSafeInteger(value) || value < 1 || value > 100) {
    throw new Error("--per-stratum must be an integer from 1 to 100");
  }
  return value;
}

async function main(): Promise<void> {
  if (process.argv.includes("--write") || process.argv.includes("--apply")) {
    throw new Error("Manifest generation is read-only; write/apply flags are prohibited");
  }
  const perStratum = targetPerStratum();
  const output = resolve(ROOT, argValue("output") ?? DEFAULT_OUTPUT);
  const result = await db.execute(sql`
    WITH candidates AS (
      SELECT
        s.id AS spin_id,
        s.station_id,
        s.played_at,
        s.confidence,
        s.raw_artist,
        s.raw_title,
        s.mbid,
        r.isrc,
        r.artist AS recording_artist,
        r.title AS recording_title,
        COALESCE(r.duration_ms, s.duration_ms) AS duration_ms,
        EXISTS (
          SELECT 1 FROM library_items li
          WHERE li.mbid = s.mbid AND li.removed_at IS NULL
        ) AS active_library_item,
        CASE
          WHEN s.mbid LIKE 'sp:%'
            OR COALESCE(s.raw_title, r.title, '') ~* '(remix|remaster|live|version|edit|mix|movement|symphony|concerto)'
            THEN 'difficult'
          WHEN EXISTS (
            SELECT 1 FROM library_items li
            WHERE li.mbid = s.mbid AND li.removed_at IS NULL
          ) THEN 'library'
          WHEN s.mbid IS NULL THEN 'unresolved'
          WHEN s.confidence = 'recording_id' THEN 'recording_id'
          WHEN s.confidence = 'isrc' OR r.isrc IS NOT NULL THEN 'isrc'
          ELSE 'text'
        END AS stratum,
        row_number() OVER (
          PARTITION BY CASE
            WHEN s.mbid LIKE 'sp:%'
              OR COALESCE(s.raw_title, r.title, '') ~* '(remix|remaster|live|version|edit|mix|movement|symphony|concerto)'
              THEN 'difficult'
            WHEN EXISTS (
              SELECT 1 FROM library_items li
              WHERE li.mbid = s.mbid AND li.removed_at IS NULL
            ) THEN 'library'
            WHEN s.mbid IS NULL THEN 'unresolved'
            WHEN s.confidence = 'recording_id' THEN 'recording_id'
            WHEN s.confidence = 'isrc' OR r.isrc IS NOT NULL THEN 'isrc'
            ELSE 'text'
          END
          ORDER BY md5(s.id::text || ':rocksky-compatibility-v1')
        ) AS stratum_rank
      FROM spins s
      LEFT JOIN recordings r ON r.mbid = s.mbid
      WHERE s.raw_artist IS NOT NULL
        AND s.raw_title IS NOT NULL
    )
    SELECT * FROM candidates
    WHERE stratum_rank <= ${perStratum}
    ORDER BY stratum, stratum_rank
  `);

  const rows = result.rows as Array<Record<string, unknown>>;
  const items: RockskyManifestItem[] = rows.map((row) => ({
    sampleId: `${String(row["stratum"])}:${String(row["spin_id"])}`,
    stratum: String(row["stratum"]) as RockskyManifestItem["stratum"],
    spinId: Number(row["spin_id"]),
    stationId: Number(row["station_id"]),
    playedAt: new Date(String(row["played_at"])).toISOString(),
    confidence: String(row["confidence"]),
    rawArtist: row["raw_artist"] == null ? null : String(row["raw_artist"]),
    rawTitle: row["raw_title"] == null ? null : String(row["raw_title"]),
    mbid: row["mbid"] == null ? null : String(row["mbid"]),
    isrc: row["isrc"] == null ? null : String(row["isrc"]),
    recordingArtist: row["recording_artist"] == null ? null : String(row["recording_artist"]),
    recordingTitle: row["recording_title"] == null ? null : String(row["recording_title"]),
    durationMs: row["duration_ms"] == null ? null : Number(row["duration_ms"]),
    activeLibraryItem: Boolean(row["active_library_item"]),
  }));
  const counts = Object.fromEntries(STRATA.map((stratum) => [
    stratum, items.filter((item) => item.stratum === stratum).length,
  ]));
  const manifest: RockskyManifest = {
    schemaVersion: ROCKSKY_COMPATIBILITY_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    method: "deterministic_stratified_hash_v1",
    targetPerStratum: perStratum,
    productionWrites: 0,
    items,
  };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify({ output, total: items.length, counts, productionWrites: 0 }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
