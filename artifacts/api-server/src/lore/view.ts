import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Create (or replace) the `picks_unified` read model. Defined as a DB view — not
 * a drizzle-kit-pushed object — so it never causes push drift and can join
 * freely across tables. It UNIONs real `picks` (each joined to its picker) with
 * a projection of `spins` into the same shape, so the entry-flow ladder reads
 * ONE surface: "spins read through the unified picks model" without rebuilding
 * the spin path or dual-writing rows.
 *
 * Spin rows are labelled `picker_type='dj'` with `trust_tier=3` (their finer
 * attribution — station/show/DJ — still lives in the spins/stations/shows
 * tables the ingest path maintains). Idempotent; safe to run on every boot.
 * Best-effort — logs and swallows on failure so boot never dies over a view.
 */
export async function ensurePicksUnifiedView(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE OR REPLACE VIEW picks_unified AS
        SELECT
          p.source            AS source,
          p.mbid              AS mbid,
          COALESCE(p.artist_mbid, r.artist_mbid) AS artist_mbid,
          p.picked_at         AS picked_at,
          p.context           AS context,
          p.source_url        AS source_url,
          p.confidence        AS confidence,
          p.ordinal           AS ordinal,
          pk.id               AS picker_id,
          pk.picker_type      AS picker_type,
          pk.name             AS picker_name,
          pk.handle           AS picker_handle,
          pk.trust_tier       AS trust_tier
        FROM picks p
        JOIN pickers pk ON pk.id = p.picker_id
        LEFT JOIN recordings r ON r.mbid = p.mbid
        UNION ALL
        SELECT
          'spin'              AS source,
          s.mbid              AS mbid,
          r.artist_mbid       AS artist_mbid,
          s.played_at         AS picked_at,
          sh.name             AS context,
          NULL::text          AS source_url,
          s.confidence        AS confidence,
          NULL::integer       AS ordinal,
          NULL::integer       AS picker_id,
          'dj'                AS picker_type,
          COALESCE(sh.dj_name, st.name) AS picker_name,
          st.slug             AS picker_handle,
          3                   AS trust_tier
        FROM spins s
        JOIN stations st ON st.id = s.station_id
        LEFT JOIN shows sh ON sh.id = s.show_id
        LEFT JOIN recordings r ON r.mbid = s.mbid
    `);
  } catch (err) {
    console.error("[lore] ensurePicksUnifiedView failed", err);
  }
}
