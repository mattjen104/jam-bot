import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export interface StationFixtureAuditRow {
  id: number;
  slug: string;
  name: string;
  streamUrl: string;
  radioBrowserUuid: string | null;
  signals: string[];
}

export function hasStationFixtureEvidence(input: {
  slug: string;
  streamUrl: string;
  homepageUrl?: string | null;
  radioBrowserUuid?: string | null;
}): boolean {
  const fixtureSlug = /^(test-|fixture-|scov-|station-test-|rb-test-)/.test(input.slug);
  const placeholderUrl = (value: string | null | undefined) =>
    /^https?:\/\/([^/]*\.)?(example\.invalid|example\.com)(\/|$)/.test(value ?? "");
  const syntheticUuid = /^(test-|fixture-|permremove-|rb-uuid-)/.test(
    input.radioBrowserUuid ?? "",
  );
  return fixtureSlug && (
    placeholderUrl(input.streamUrl) ||
    placeholderUrl(input.homepageUrl) ||
    syntheticUuid
  );
}

/**
 * Test stations must carry both an explicit fixture namespace and a reserved
 * external identity. Requiring independent signals keeps ordinary stations
 * with words such as "test" in their display name out of cleanup scope.
 */
export async function auditStationFixtures(): Promise<StationFixtureAuditRow[]> {
  const result = await db.execute<{
    id: number;
    slug: string;
    name: string;
    stream_url: string;
    radio_browser_uuid: string | null;
    signals: string[];
  }>(sql`
    WITH candidates AS (
      SELECT
        s.id,
        s.slug,
        s.name,
        s.stream_url,
        rb.radio_browser_uuid,
        array_remove(ARRAY[
          CASE WHEN s.slug ~ '^(test-|fixture-|scov-|station-test-|rb-test-)' THEN 'fixture_slug' END,
          CASE WHEN s.stream_url ~ '^https?://([^/]*\.)?(example\.invalid|example\.com)(/|$)' THEN 'placeholder_stream' END,
          CASE WHEN coalesce(s.homepage_url, '') ~ '^https?://([^/]*\.)?(example\.invalid|example\.com)(/|$)' THEN 'placeholder_homepage' END,
          CASE WHEN coalesce(rb.radio_browser_uuid, '') ~ '^(test-|fixture-|permremove-|rb-uuid-)' THEN 'synthetic_radio_browser_uuid' END
        ], NULL) AS signals
      FROM stations s
      LEFT JOIN radio_browser_stations rb ON rb.station_id = s.id
    )
    SELECT id, slug, name, stream_url, radio_browser_uuid, signals
    FROM candidates
    WHERE 'fixture_slug' = ANY(signals)
      AND cardinality(signals) >= 2
    ORDER BY id
  `);

  return result.rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    streamUrl: row.stream_url,
    radioBrowserUuid: row.radio_browser_uuid,
    signals: row.signals,
  }));
}

/** Delete known fixture rows and all station-linked dependents in FK-safe order. */
export async function cleanupStationFixtures(ids?: readonly number[]): Promise<number> {
  const auditedIds = new Set((await auditStationFixtures()).map((row) => row.id));
  const fixtureIds = ids
    ? [...new Set(ids)].filter((id) => auditedIds.has(id))
    : [...auditedIds];
  if (fixtureIds.length === 0) return 0;

  // These station foreign keys are otherwise expensive full-table scans during
  // cleanup (embed_resolution_queue is large in long-running environments).
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS embed_resolution_queue_station_idx
    ON embed_resolution_queue (station_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS listen_sessions_station_idx
    ON listen_sessions (station_id)
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS attendance_spin_idx ON attendance (spin_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS listens_spin_idx ON listens (spin_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS library_items_spin_idx ON library_items (spin_id)`);

  const fixtureIdList = sql.join(fixtureIds.map((id) => sql`${id}`), sql`, `);
  await db.execute(sql`DELETE FROM attendance WHERE spin_id IN (SELECT id FROM spins WHERE station_id IN (${fixtureIdList}))`);
  await db.execute(sql`UPDATE listens SET spin_id = NULL WHERE spin_id IN (SELECT id FROM spins WHERE station_id IN (${fixtureIdList}))`);
  await db.execute(sql`UPDATE listens SET show_id = NULL WHERE show_id IN (SELECT id FROM shows WHERE station_id IN (${fixtureIdList}))`);
  await db.execute(sql`UPDATE library_items SET spin_id = NULL WHERE spin_id IN (SELECT id FROM spins WHERE station_id IN (${fixtureIdList}))`);

  async function deleteHistoryChunk(table: "embed_resolution_queue" | "spins" | "segue_edges") {
    while (true) {
      const result = await db.execute(sql.raw(`
        WITH victims AS (
          SELECT id FROM ${table}
          WHERE station_id IN (${fixtureIds.map((id) => Number(id)).join(",")})
          LIMIT 10000
        )
        DELETE FROM ${table} target
        USING victims
        WHERE target.id = victims.id
      `));
      if ((result.rowCount ?? 0) < 10_000) return;
    }
  }

  await deleteHistoryChunk("embed_resolution_queue");
  await deleteHistoryChunk("spins");
  await deleteHistoryChunk("segue_edges");
  await db.execute(sql`UPDATE spins SET show_id = NULL WHERE show_id IN (SELECT id FROM shows WHERE station_id IN (${fixtureIdList}))`);

  let deleted = 0;
  for (let offset = 0; offset < fixtureIds.length; offset += 10) {
    const batch = fixtureIds.slice(offset, offset + 10);
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        CREATE TEMP TABLE fixture_station_ids (id integer PRIMARY KEY) ON COMMIT DROP
      `);
      await tx.execute(sql`
        INSERT INTO fixture_station_ids (id)
        VALUES ${sql.join(batch.map((id) => sql`(${id})`), sql`, `)}
      `);
      await tx.execute(sql`DELETE FROM listen_sessions WHERE station_id IN (SELECT id FROM fixture_station_ids)`);
      await tx.execute(sql`DELETE FROM song_bottles WHERE station_id IN (SELECT id FROM fixture_station_ids)`);
      await tx.execute(sql`UPDATE list_sources SET station_id = NULL WHERE station_id IN (SELECT id FROM fixture_station_ids)`);
      await tx.execute(sql`DELETE FROM embed_resolution_metrics WHERE station_id IN (SELECT id FROM fixture_station_ids)`);
      await tx.execute(sql`DELETE FROM shows WHERE station_id IN (SELECT id FROM fixture_station_ids)`);
      await tx.execute(sql`DELETE FROM radio_browser_stations WHERE station_id IN (SELECT id FROM fixture_station_ids)`);
      await tx.execute(sql`DELETE FROM station_quality WHERE station_id IN (SELECT id FROM fixture_station_ids)`);
      await tx.execute(sql`DELETE FROM scraped_shows WHERE station_id IN (SELECT id FROM fixture_station_ids)`);
      await tx.execute(sql`DELETE FROM scraped_show_exceptions WHERE station_id IN (SELECT id FROM fixture_station_ids)`);
      const result = await tx.execute(sql`DELETE FROM stations WHERE id IN (SELECT id FROM fixture_station_ids)`);
      deleted += result.rowCount ?? 0;
    });
  }
  return deleted;
}
