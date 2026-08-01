/**
 * Step 0 — Zone distribution data check (one-off gating script).
 *
 * Queries the spin archive for the distribution of live-station counts
 * landing in each dial front-door zone over a representative 7-day window,
 * bucketed by hour-of-day.  Prints p50, p90, and max for each zone.
 *
 * Run:
 *   cd artifacts/api-server && npx tsx ../../scripts/zoneDistribution.ts
 *
 * The script requires DATABASE_URL in the environment (same as api-server).
 */

import { drizzle } from "drizzle-orm/node-postgres";
import pkg from "pg";
const { Pool } = pkg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

// ---------------------------------------------------------------------------
// We approximate zone membership by counting stations that had at least one
// spin in the last 7 days and, for Zone 1, had library-artist crossings.
// Since we don't have per-session live snapshots we bucket by calendar hour.
// ---------------------------------------------------------------------------

const sql = `
WITH hourly_spins AS (
  SELECT
    station_id,
    date_trunc('hour', played_at) AS hour,
    COUNT(*) AS spins
  FROM spins
  WHERE played_at >= NOW() - INTERVAL '7 days'
  GROUP BY 1, 2
),
station_crossings AS (
  -- Proxy for Zone 1: stations with any library-artist crossing in the window
  SELECT DISTINCT station_id
  FROM spins s
  JOIN recordings r ON r.mbid = s.mbid
  WHERE s.played_at >= NOW() - INTERVAL '7 days'
    AND r.mbid IS NOT NULL
),
hourly_counts AS (
  SELECT
    hs.hour,
    COUNT(*) FILTER (WHERE sc.station_id IS NOT NULL) AS zone1_count,
    COUNT(*) FILTER (WHERE sc.station_id IS NULL)     AS zone3_count
  FROM hourly_spins hs
  LEFT JOIN station_crossings sc USING (station_id)
  GROUP BY 1
)
SELECT
  percentile_disc(0.50) WITHIN GROUP (ORDER BY zone1_count)::int AS zone1_p50,
  percentile_disc(0.90) WITHIN GROUP (ORDER BY zone1_count)::int AS zone1_p90,
  MAX(zone1_count)::int                                           AS zone1_max,
  percentile_disc(0.50) WITHIN GROUP (ORDER BY zone3_count)::int AS zone3_p50,
  percentile_disc(0.90) WITHIN GROUP (ORDER BY zone3_count)::int AS zone3_p90,
  MAX(zone3_count)::int                                           AS zone3_max
FROM hourly_counts;
`;

async function main() {
  const { rows } = await pool.query(sql);
  const r = rows[0];
  console.log("=== Zone distribution over last 7 days (by hour bucket) ===");
  console.log("");
  console.log("Zone 1 (with crossing evidence):");
  console.log(`  p50=${r.zone1_p50}  p90=${r.zone1_p90}  max=${r.zone1_max}`);
  console.log("");
  console.log("Zone 3 (also on air / dark):");
  console.log(`  p50=${r.zone3_p50}  p90=${r.zone3_p90}  max=${r.zone3_max}`);
  console.log("");
  if ((r.zone1_p90 ?? 0) > 5) {
    console.log("✓ Zone 1 p90 > 5 — truncation is worth shipping.");
  } else {
    console.log("⚠  Zone 1 p90 ≤ 5 — truncation would be mostly dead code.");
  }
  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
