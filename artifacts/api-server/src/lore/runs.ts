import { db, picksTable, spinsTable } from "@workspace/db";
import { eq, and, or, sql } from "drizzle-orm";

/**
 * UTC broadcast day of a spin as YYYY-MM-DD — the run grouping key.
 * Defined here (not in the routes layer) so lore-layer code (segue.ts etc.)
 * can import it without a cross-layer dependency.
 */
export const spinDayExpr = sql<string>`to_char(${spinsTable.playedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`;

/**
 * The run's stable id for a station broadcast group: smallest spin id within
 * its (station + show + UTC broadcast day) partition.  Use this expression
 * everywhere you GROUP BY a station run so the derivation is never duplicated.
 */
export const spinRunIdExpr = sql<number>`min(${spinsTable.id})`;

/**
 * Given a list of resolved spin-group keys (stationId, showId, day), look up
 * the anchor spin id for each group — i.e. min(spin.id) for that partition.
 * Returns Map<"stationId|showId|day", runId>.
 *
 * Useful when the caller already knows which groups exist and needs their
 * runIds without re-running the full aggregation query.
 */
export async function resolveSpinRunAnchors(
  keys: Array<{ stationId: number; showId: number | null; day: string }>,
): Promise<Map<string, number>> {
  if (keys.length === 0) return new Map();

  const rows = await db
    .select({
      stationId: spinsTable.stationId,
      showId: spinsTable.showId,
      day: sql<string>`to_char(${spinsTable.playedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`,
      runId: sql<number>`min(${spinsTable.id})`,
    })
    .from(spinsTable)
    .where(
      or(
        ...keys.map((k) =>
          and(
            eq(spinsTable.stationId, k.stationId),
            k.showId == null
              ? sql`${spinsTable.showId} is null`
              : eq(spinsTable.showId, k.showId),
            sql`to_char(${spinsTable.playedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD') = ${k.day}`,
          ),
        ),
      )!,
    )
    .groupBy(
      spinsTable.stationId,
      spinsTable.showId,
      sql`to_char(${spinsTable.playedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`,
    );

  const result = new Map<string, number>();
  for (const r of rows) {
    result.set(`${r.stationId}|${r.showId ?? "null"}|${r.day}`, r.runId);
  }
  return result;
}

/**
 * Run-anchor resolution for picker lists.
 *
 * A "run" is a picker+sourceUrl group — all picks sharing the same
 * (picker_id, source_url) form one replayable list. The run's stable id is
 * `min(picks.id)` across that group, matching the archive's derivation exactly.
 *
 * Uses exact (picker_id, source_url) pair filtering so the query scans only
 * groups that actually exist — no cartesian (inArray(pids) AND inArray(urls)).
 */
export async function resolvePickRunAnchors(
  pairs: Array<{ pickerId: number; sourceUrl: string }>,
): Promise<Map<string, { runId: number; trackCount: number }>> {
  if (pairs.length === 0) return new Map();

  const anchors = await db
    .select({
      pickerId: picksTable.pickerId,
      sourceUrl: picksTable.sourceUrl,
      runId: sql<number>`min(${picksTable.id})`,
      trackCount: sql<number>`count(*)::int`,
    })
    .from(picksTable)
    .where(
      or(
        ...pairs.map((p) =>
          and(
            eq(picksTable.pickerId, p.pickerId),
            eq(picksTable.sourceUrl, p.sourceUrl),
          ),
        ),
      )!,
    )
    .groupBy(picksTable.pickerId, picksTable.sourceUrl);

  const result = new Map<string, { runId: number; trackCount: number }>();
  for (const a of anchors) {
    if (a.sourceUrl != null) {
      result.set(`${a.pickerId}|${a.sourceUrl}`, {
        runId: a.runId,
        trackCount: a.trackCount,
      });
    }
  }
  return result;
}

/**
 * Variant used by /picks/contains — resolves runId only (no trackCount needed).
 */
export async function resolvePickRunIds(
  pairs: Array<{ pickerId: number; sourceUrl: string }>,
): Promise<Map<string, number>> {
  if (pairs.length === 0) return new Map();

  const anchors = await db
    .select({
      pickerId: picksTable.pickerId,
      sourceUrl: picksTable.sourceUrl,
      runId: sql<number>`min(${picksTable.id})`,
    })
    .from(picksTable)
    .where(
      or(
        ...pairs.map((p) =>
          and(
            eq(picksTable.pickerId, p.pickerId),
            eq(picksTable.sourceUrl, p.sourceUrl),
          ),
        ),
      )!,
    )
    .groupBy(picksTable.pickerId, picksTable.sourceUrl);

  const result = new Map<string, number>();
  for (const a of anchors) {
    if (a.sourceUrl != null) {
      result.set(`${a.pickerId}|${a.sourceUrl}`, a.runId);
    }
  }
  return result;
}
