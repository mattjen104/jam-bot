import {
  db,
  spinsTable,
  segueEdgesTable,
  recordingsTable,
  stationsTable,
  showsTable,
  type InsertSegueEdge,
} from "@workspace/db";
import { eq, asc, desc } from "drizzle-orm";

/**
 * Segue edges — the "song A was followed by song B on this station/show" graph
 * that powers Segue mode. Derived nightly from consecutive resolved spins whose
 * gap is under the segue threshold; both endpoints must be on the MBID spine.
 * Kept OFF the ingest hot path so continuous logging is never blocked.
 */

/** A spin, reduced to what edge derivation needs. */
export interface SpinForSegue {
  mbid: string | null;
  playedAt: Date;
  stationId: number;
  showId: number | null;
}

/** Max gap between two spins for them to count as a segue (DJ transition). */
export const SEGUE_GAP_MS = 10 * 60 * 1000;

/**
 * Pure: derive segue edges from spins. Spins are grouped by (station, show) —
 * two tracks only segue if the same program played them back-to-back — then
 * ordered by time; each adjacent pair within `gapMs` and with two distinct
 * resolved MBIDs becomes one edge. Unresolved spins break the chain (we never
 * bridge across a hole). Deterministic and side-effect free so it can be unit
 * tested exhaustively.
 */
export function deriveEdges(
  spins: SpinForSegue[],
  gapMs: number = SEGUE_GAP_MS,
): InsertSegueEdge[] {
  const groups = new Map<string, SpinForSegue[]>();
  for (const s of spins) {
    const key = `${s.stationId}\u0000${s.showId ?? ""}`;
    const list = groups.get(key) ?? [];
    list.push(s);
    groups.set(key, list);
  }

  const edges: InsertSegueEdge[] = [];
  for (const list of groups.values()) {
    const sorted = [...list].sort(
      (a, b) => a.playedAt.getTime() - b.playedAt.getTime(),
    );
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!;
      const cur = sorted[i]!;
      if (!prev.mbid || !cur.mbid) continue;
      if (prev.mbid === cur.mbid) continue;
      const gap = cur.playedAt.getTime() - prev.playedAt.getTime();
      if (gap <= 0 || gap > gapMs) continue;
      edges.push({
        fromMbid: prev.mbid,
        toMbid: cur.mbid,
        stationId: cur.stationId,
        showId: cur.showId ?? null,
        playedAt: cur.playedAt,
      });
    }
  }
  return edges;
}

/**
 * Nightly job: derive segue edges from the full spin history and upsert them.
 * ALL spins are fetched — including unresolved ones (mbid null) — because an
 * unresolved spin between two resolved ones is a real hole that must break the
 * chain (otherwise we'd forge an A->C edge across a song we couldn't identify).
 * `deriveEdges` only emits an edge when both endpoints carry an MBID.
 * Idempotent — the unique (from,to,station,playedAt) index means re-running only
 * fills gaps, never duplicates. Returns the number of edges written. Never
 * throws.
 */
export async function runSegueDerivation(): Promise<number> {
  try {
    const rows = await db
      .select({
        mbid: spinsTable.mbid,
        playedAt: spinsTable.playedAt,
        stationId: spinsTable.stationId,
        showId: spinsTable.showId,
      })
      .from(spinsTable)
      .orderBy(asc(spinsTable.playedAt));

    const edges = deriveEdges(
      rows.map((r) => ({
        mbid: r.mbid,
        playedAt: r.playedAt,
        stationId: r.stationId,
        showId: r.showId,
      })),
    );
    if (!edges.length) return 0;

    let written = 0;
    // Chunk the insert so a very large history doesn't build one giant query.
    const CHUNK = 500;
    for (let i = 0; i < edges.length; i += CHUNK) {
      const slice = edges.slice(i, i + CHUNK);
      const inserted = await db
        .insert(segueEdgesTable)
        .values(slice)
        .onConflictDoNothing({
          target: [
            segueEdgesTable.fromMbid,
            segueEdgesTable.toMbid,
            segueEdgesTable.stationId,
            segueEdgesTable.playedAt,
          ],
        })
        .returning({ id: segueEdgesTable.id });
      written += inserted.length;
    }
    console.info(`[lore] segue derivation wrote ${written} new edge(s)`);
    return written;
  } catch (err) {
    console.error("[lore] segue derivation failed", err);
    return 0;
  }
}

/** Segue weight per station class — curated/community rank above commercial. */
export function stationClassWeight(stationClass: string | null): number {
  switch (stationClass) {
    case "commercial":
      return 1;
    case "community":
      return 2;
    case "curated":
    default:
      return 3;
  }
}

/** One candidate "what plays next" song, aggregated across observed segues. */
export interface SegueNext {
  mbid: string;
  title: string;
  artist: string;
  artworkUrl: string | null;
  /** Distinct times this transition was observed. */
  count: number;
  /** Class-weighted score used for ranking. */
  score: number;
  /** Stations where this transition was seen (for attribution). */
  stations: Array<{ slug: string; name: string; stationClass: string }>;
}

/**
 * Segue mode: given a song, the real next-songs observed after it, ranked by a
 * station-class-weighted frequency so a transition heard on curated/community
 * radio outranks one from a commercial feed. Best-effort — returns [] on
 * failure. Never throws.
 */
export async function nextSegues(
  fromMbid: string,
  limit = 10,
): Promise<SegueNext[]> {
  try {
    const rows = await db
      .select({
        toMbid: segueEdgesTable.toMbid,
        title: recordingsTable.title,
        artist: recordingsTable.artist,
        artworkUrl: recordingsTable.artworkUrl,
        stationSlug: stationsTable.slug,
        stationName: stationsTable.name,
        stationClass: stationsTable.stationClass,
      })
      .from(segueEdgesTable)
      .innerJoin(
        recordingsTable,
        eq(segueEdgesTable.toMbid, recordingsTable.mbid),
      )
      .innerJoin(
        stationsTable,
        eq(segueEdgesTable.stationId, stationsTable.id),
      )
      .where(eq(segueEdgesTable.fromMbid, fromMbid));

    const byTarget = new Map<string, SegueNext>();
    for (const r of rows) {
      const entry: SegueNext =
        byTarget.get(r.toMbid) ??
        {
          mbid: r.toMbid,
          title: r.title,
          artist: r.artist,
          artworkUrl: r.artworkUrl ?? null,
          count: 0,
          score: 0,
          stations: [],
        };
      entry.count += 1;
      entry.score += stationClassWeight(r.stationClass);
      if (!entry.stations.some((s) => s.slug === r.stationSlug)) {
        entry.stations.push({
          slug: r.stationSlug,
          name: r.stationName,
          stationClass: r.stationClass,
        });
      }
      byTarget.set(r.toMbid, entry);
    }

    return [...byTarget.values()]
      .sort((a, b) => b.score - a.score || b.count - a.count)
      .slice(0, limit);
  } catch (err) {
    console.error("[lore] nextSegues failed", fromMbid, err);
    return [];
  }
}

/** Recent spins of a recording, with station + show/DJ attribution. */
export interface RecordingSpin {
  playedAt: Date;
  source: string | null;
  confidence: string;
  station: { slug: string; name: string; stationClass: string };
  show: { name: string; djName: string | null } | null;
}

/**
 * Every place a recording has been heard, newest first, with station + show +
 * DJ attribution. This is the "queryable on a track page" surface. Never throws.
 */
export async function spinsForRecording(
  mbid: string,
  limit = 50,
): Promise<RecordingSpin[]> {
  try {
    const rows = await db
      .select({
        playedAt: spinsTable.playedAt,
        source: spinsTable.source,
        confidence: spinsTable.confidence,
        stationSlug: stationsTable.slug,
        stationName: stationsTable.name,
        stationClass: stationsTable.stationClass,
        showName: showsTable.name,
        djName: showsTable.djName,
      })
      .from(spinsTable)
      .innerJoin(stationsTable, eq(spinsTable.stationId, stationsTable.id))
      .leftJoin(showsTable, eq(spinsTable.showId, showsTable.id))
      .where(eq(spinsTable.mbid, mbid))
      .orderBy(desc(spinsTable.playedAt))
      .limit(limit);

    return rows.map((r) => ({
      playedAt: r.playedAt,
      source: r.source,
      confidence: r.confidence,
      station: {
        slug: r.stationSlug,
        name: r.stationName,
        stationClass: r.stationClass,
      },
      show: r.showName ? { name: r.showName, djName: r.djName ?? null } : null,
    }));
  } catch (err) {
    console.error("[lore] spinsForRecording failed", mbid, err);
    return [];
  }
}
