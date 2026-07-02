import {
  db,
  spinsTable,
  segueEdgesTable,
  recordingsTable,
  stationsTable,
  showsTable,
  picksTable,
  pickersTable,
  type InsertSegueEdge,
} from "@workspace/db";
import { eq, asc, desc, and, isNotNull, inArray } from "drizzle-orm";

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

/** A picker whose ordered list produced a rideable pick-segue edge. */
export interface SeguePickerRef {
  name: string;
  handle: string;
  pickerType: string;
  trustTier: number;
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
  /** Stations where this transition was seen (DJ/spin attribution). */
  stations: Array<{ slug: string; name: string; stationClass: string }>;
  /**
   * Pickers whose ORDERED list places this song right after the queried one
   * (label release sequence, ranked curator list, event lineup). Present only
   * when the edge came from ordered picks rather than radio spins.
   */
  pickers?: SeguePickerRef[];
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

// ---- Pick-based segues (generalized beyond DJ spins) --------------------

/** A pick, reduced to what ordered-pick edge derivation needs. */
export interface PickForSegue {
  pickerId: number;
  mbid: string | null;
  /** Position within the picker's ordered list; null = unordered (no segue). */
  ordinal: number | null;
}

/** A rideable edge derived from two consecutive picks in one picker's list. */
export interface PickEdge {
  fromMbid: string;
  toMbid: string;
  pickerId: number;
}

/**
 * Pure: derive rideable edges from ORDERED picks, the generalization of
 * `deriveEdges` from radio spins to any sequenced source (a label's release
 * tracklist, a ranked curator list, an event lineup). Picks are grouped by
 * picker — two songs only segue if the SAME picker placed them back-to-back —
 * then ordered by `ordinal`; each adjacent pair of distinct resolved MBIDs
 * becomes one edge. A pick with no ordinal is unordered (ridden as a set, never
 * a sequence) and is skipped; an unresolved pick (mbid null) breaks the chain
 * exactly like an unresolved spin, so we never forge an edge across a hole.
 * Deterministic and side-effect free for exhaustive unit testing.
 */
export function deriveEdgesFromPicks(picks: PickForSegue[]): PickEdge[] {
  const groups = new Map<number, PickForSegue[]>();
  for (const p of picks) {
    if (p.ordinal === null || p.ordinal === undefined) continue;
    const list = groups.get(p.pickerId) ?? [];
    list.push(p);
    groups.set(p.pickerId, list);
  }

  const edges: PickEdge[] = [];
  for (const [pickerId, list] of groups) {
    const sorted = [...list].sort((a, b) => a.ordinal! - b.ordinal!);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!;
      const cur = sorted[i]!;
      if (!prev.mbid || !cur.mbid) continue;
      if (prev.mbid === cur.mbid) continue;
      edges.push({ fromMbid: prev.mbid, toMbid: cur.mbid, pickerId });
    }
  }
  return edges;
}

/**
 * Segue mode over ORDERED picks: given a song, the songs a picker's own
 * sequence places right after it, ranked by a trust-tier-weighted frequency
 * (lower tier = stronger, so a label's own release order outranks a looser
 * list). Computed on read (ordered lists are small) by re-deriving edges for
 * every picker that has this track in a sequence, so the "hole breaks the
 * chain" semantics match the pure deriver exactly. Best-effort — [] on failure.
 */
export async function nextPickSegues(
  fromMbid: string,
  limit = 10,
): Promise<SegueNext[]> {
  try {
    // Pickers whose ordered list contains this exact track.
    const owners = await db
      .selectDistinct({ pickerId: picksTable.pickerId })
      .from(picksTable)
      .where(
        and(eq(picksTable.mbid, fromMbid), isNotNull(picksTable.ordinal)),
      );
    if (!owners.length) return [];
    const ownerIds = owners.map((o) => o.pickerId);

    // Every ordered pick for those pickers, so adjacency (incl. holes) is exact.
    const rows = await db
      .select({
        pickerId: picksTable.pickerId,
        mbid: picksTable.mbid,
        ordinal: picksTable.ordinal,
      })
      .from(picksTable)
      .where(
        and(
          inArray(picksTable.pickerId, ownerIds),
          isNotNull(picksTable.ordinal),
        ),
      );

    const edges = deriveEdgesFromPicks(rows).filter(
      (e) => e.fromMbid === fromMbid,
    );
    if (!edges.length) return [];

    const targetMbids = [...new Set(edges.map((e) => e.toMbid))];
    const [recs, pickers] = await Promise.all([
      db
        .select({
          mbid: recordingsTable.mbid,
          title: recordingsTable.title,
          artist: recordingsTable.artist,
          artworkUrl: recordingsTable.artworkUrl,
        })
        .from(recordingsTable)
        .where(inArray(recordingsTable.mbid, targetMbids)),
      db
        .select({
          id: pickersTable.id,
          name: pickersTable.name,
          handle: pickersTable.handle,
          pickerType: pickersTable.pickerType,
          trustTier: pickersTable.trustTier,
        })
        .from(pickersTable)
        .where(inArray(pickersTable.id, ownerIds)),
    ]);
    const recById = new Map(recs.map((r) => [r.mbid, r]));
    const pickerById = new Map(pickers.map((p) => [p.id, p]));

    const byTarget = new Map<string, SegueNext>();
    for (const e of edges) {
      const rec = recById.get(e.toMbid);
      if (!rec) continue; // target not on the spine yet — skip, never invent.
      const picker = pickerById.get(e.pickerId);
      const entry: SegueNext =
        byTarget.get(e.toMbid) ??
        {
          mbid: rec.mbid,
          title: rec.title,
          artist: rec.artist,
          artworkUrl: rec.artworkUrl ?? null,
          count: 0,
          score: 0,
          stations: [],
          pickers: [],
        };
      entry.count += 1;
      // Lower trustTier = stronger, so invert into a positive weight.
      entry.score += Math.max(1, 4 - (picker?.trustTier ?? 3));
      if (
        picker &&
        !entry.pickers!.some((p) => p.handle === picker.handle)
      ) {
        entry.pickers!.push({
          name: picker.name,
          handle: picker.handle,
          pickerType: picker.pickerType,
          trustTier: picker.trustTier,
        });
      }
      byTarget.set(e.toMbid, entry);
    }

    return [...byTarget.values()]
      .sort((a, b) => b.score - a.score || b.count - a.count)
      .slice(0, limit);
  } catch (err) {
    console.error("[lore] nextPickSegues failed", fromMbid, err);
    return [];
  }
}

/**
 * Unified "what plays next": radio-spin segues and ordered-pick segues merged
 * onto one surface, keyed by target song. A track that appears in both keeps
 * its station AND picker attribution and its scores sum, so DJ practice and
 * curatorial sequence reinforce each other. Ranked by combined score.
 */
export async function nextRideable(
  fromMbid: string,
  limit = 10,
): Promise<SegueNext[]> {
  const [spinNext, pickNext] = await Promise.all([
    nextSegues(fromMbid, limit * 2),
    nextPickSegues(fromMbid, limit * 2),
  ]);

  const byTarget = new Map<string, SegueNext>();
  for (const n of [...spinNext, ...pickNext]) {
    const existing = byTarget.get(n.mbid);
    if (!existing) {
      byTarget.set(n.mbid, { ...n });
      continue;
    }
    existing.count += n.count;
    existing.score += n.score;
    for (const s of n.stations) {
      if (!existing.stations.some((x) => x.slug === s.slug)) {
        existing.stations.push(s);
      }
    }
    if (n.pickers?.length) {
      existing.pickers = existing.pickers ?? [];
      for (const p of n.pickers) {
        if (!existing.pickers.some((x) => x.handle === p.handle)) {
          existing.pickers.push(p);
        }
      }
    }
  }

  return [...byTarget.values()]
    .sort((a, b) => b.score - a.score || b.count - a.count)
    .slice(0, limit);
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
