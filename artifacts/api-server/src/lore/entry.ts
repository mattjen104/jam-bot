import { db, picksUnifiedView } from "@workspace/db";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { spinsForRecording } from "./segue.js";

/**
 * The source-agnostic entry-flow fallback ladder. Given a recording (and, ideally,
 * its artist), find the STRONGEST available human attribution for it and stop
 * there — we never fall through to algorithmic "similar tracks". The whole point
 * of Lore is that every entry is a real person's pick; when no human has touched
 * a track, we say so honestly and invite the listener to become its first picker,
 * rather than papering over the gap with a recommender.
 *
 * Rungs, strongest first:
 *   1. dj          — a radio DJ spun this exact track (richest attribution).
 *   2. label       — the label that released this exact track.
 *   3. blog/curator— a critic/curator championed or listed this exact track.
 *   4. collector/event — a collector catalogued it, or it played an event.
 *   5. artist      — no one picked THIS track, but a picker picked ANOTHER track
 *                    by the same artist (artist-level attribution).
 *   6. empty       — nobody has picked into this corner yet: "be the first".
 *
 * We deliberately stop at artist-level and DO NOT add a "scene"/neighbour rung:
 * the only way to reach an artist that no picker has ever touched is to infer
 * neighbours from acoustic/collaborative-filtering similarity, which is exactly
 * the algorithmic recommender Lore refuses to be. Rather than fake a human
 * pick, we land honestly on the empty rung and invite the listener to be first.
 *
 * Every rung is read through the unified picks model (`picks_unified`), so DJ
 * spins and every other picker type sit on ONE surface.
 */

export type EntryRung =
  | "dj"
  | "label"
  | "blog"
  | "curator"
  | "collector"
  | "event"
  | "series"
  | "artist"
  | "empty";

/** One attributed pick surfaced by the ladder. */
export interface EntryPick {
  source: string;
  pickerType: string;
  pickerName: string;
  pickerHandle: string;
  trustTier: number;
  mbid: string | null;
  artistMbid: string | null;
  context: string | null;
  sourceUrl: string | null;
  confidence: string;
  pickedAt: string | null;
}

export interface EntryResult {
  rung: EntryRung;
  /** Honest, human-readable framing of why these picks are shown. */
  framing: string;
  picks: EntryPick[];
  /** Present only on the empty rung — the "be the first" invitation. */
  invitation?: {
    message: string;
    /** The pick a listener would create to seed this corner. */
    seedSource: "user_seed";
  };
}

/** Map a picker_type + source to a ladder rung label. */
function rungForType(pickerType: string): EntryRung {
  switch (pickerType) {
    case "dj":
    case "label":
    case "blog":
    case "curator":
    case "collector":
    case "event":
    case "series":
      return pickerType;
    default:
      return "curator";
  }
}

type UnifiedRow = {
  source: string;
  pickerType: string;
  pickerName: string | null;
  pickerHandle: string | null;
  trustTier: number | null;
  mbid: string | null;
  artistMbid: string | null;
  context: string | null;
  sourceUrl: string | null;
  confidence: string;
  pickedAt: Date | null;
};

function toEntryPick(r: UnifiedRow): EntryPick {
  return {
    source: r.source,
    pickerType: r.pickerType,
    pickerName: r.pickerName ?? "Unknown",
    pickerHandle: r.pickerHandle ?? "",
    trustTier: r.trustTier ?? 3,
    mbid: r.mbid,
    artistMbid: r.artistMbid,
    context: r.context,
    sourceUrl: r.sourceUrl,
    confidence: r.confidence,
    pickedAt: r.pickedAt ? r.pickedAt.toISOString() : null,
  };
}

/** Rows in `picks_unified` for a given recording, excluding DJ spins. */
async function nonDjPicksForRecording(mbid: string): Promise<UnifiedRow[]> {
  return db
    .select()
    .from(picksUnifiedView)
    .where(
      and(
        eq(picksUnifiedView.mbid, mbid),
        ne(picksUnifiedView.pickerType, "dj"),
      ),
    )
    .orderBy(picksUnifiedView.trustTier, desc(picksUnifiedView.pickedAt));
}

/** Artist-level picks: another track by the same artist, any picker type. */
async function picksForArtist(
  artistMbid: string,
  excludeMbid: string,
  limit = 20,
): Promise<UnifiedRow[]> {
  return db
    .select()
    .from(picksUnifiedView)
    .where(
      and(
        eq(picksUnifiedView.artistMbid, artistMbid),
        ne(picksUnifiedView.mbid, excludeMbid),
      ),
    )
    .orderBy(picksUnifiedView.trustTier, desc(picksUnifiedView.pickedAt))
    .limit(limit);
}

/**
 * Walk the ladder for a recording. `artistMbid` (when known) powers the
 * artist-level rung; without it the ladder simply stops one rung earlier and
 * lands on "empty". Never throws — a read failure degrades to the empty rung.
 */
export async function resolveEntry(
  mbid: string,
  artistMbid?: string,
): Promise<EntryResult> {
  try {
    // Rung 1: DJ spins — richest attribution, read through the dedicated path.
    const spins = await spinsForRecording(mbid, 10);
    if (spins.length > 0) {
      return {
        rung: "dj",
        framing:
          "Spun on the radio — you're riding a DJ's selection, in their words and their sequence.",
        picks: spins.map((s) => ({
          source: "spin",
          pickerType: "dj",
          pickerName: s.show?.djName || s.station.name,
          pickerHandle: s.station.slug,
          trustTier: 3,
          mbid,
          artistMbid: artistMbid ?? null,
          context: s.show?.name ?? s.station.name,
          sourceUrl: null,
          confidence: s.confidence,
          pickedAt: s.playedAt ? s.playedAt.toISOString() : null,
        })),
      };
    }

    // Rungs 2-4: label, then blog/curator, then collector/event — all non-DJ
    // picks for this exact recording, already ordered strongest-first.
    const exact = await nonDjPicksForRecording(mbid);
    if (exact.length > 0) {
      const top = exact[0]!;
      const rung = rungForType(top.pickerType);
      return {
        rung,
        framing: framingForRung(rung),
        picks: exact.map(toEntryPick),
      };
    }

    // Rung 5: artist-level — no one picked THIS track, but a picker picked
    // another track by the same artist.
    if (artistMbid) {
      const artistPicks = await picksForArtist(artistMbid, mbid);
      if (artistPicks.length > 0) {
        return {
          rung: "artist",
          framing:
            "No one has picked this exact track yet — but here's who's championed this artist elsewhere.",
          picks: artistPicks.map(toEntryPick),
        };
      }
    }

    // Rung 7: empty — nobody has picked into this corner. Invite, never invent.
    return {
      rung: "empty",
      framing:
        "No human has picked this track yet. Lore never guesses with an algorithm — so this corner is empty until someone rides in.",
      picks: [],
      invitation: {
        message:
          "Be the first to pick this track — log it and become the picker others ride from.",
        seedSource: "user_seed",
      },
    };
  } catch (err) {
    console.error("[lore] resolveEntry failed", mbid, err);
    return {
      rung: "empty",
      framing:
        "No human has picked this track yet. Lore never guesses with an algorithm.",
      picks: [],
      invitation: {
        message: "Be the first to pick this track.",
        seedSource: "user_seed",
      },
    };
  }
}

function framingForRung(rung: EntryRung): string {
  switch (rung) {
    case "label":
      return "Released on this label — you're riding the roster of the people who put it out.";
    case "blog":
      return "Championed by a critic — a blog put this in front of listeners on purpose.";
    case "curator":
      return "Hand-picked onto a curator's list — a person chose to place this here.";
    case "collector":
      return "Catalogued by a collector — this sits in someone's carefully kept crate.";
    case "event":
      return "Played at an event — this made a real room's lineup.";
    default:
      return "Picked by a real person.";
  }
}

/**
 * Whether ANY human attribution (of any picker type) exists for a recording.
 * Reads the unified view so it counts spins too. Used to decide the entry CTA
 * without pulling every pick.
 */
export async function hasAnyPick(mbid: string): Promise<boolean> {
  try {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(picksUnifiedView)
      .where(eq(picksUnifiedView.mbid, mbid));
    return (row?.n ?? 0) > 0;
  } catch {
    return false;
  }
}
