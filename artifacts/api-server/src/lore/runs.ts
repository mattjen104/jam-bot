import { db, picksTable } from "@workspace/db";
import { eq, and, or, sql } from "drizzle-orm";

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
