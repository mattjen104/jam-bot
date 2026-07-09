import { eq, sql } from "drizzle-orm";
import { db, stationsTable, type Station } from "@workspace/db";

/**
 * Cheap ad detection, piggybacked on metadata we already fetch every polling
 * tick — no extra audio capture/fingerprinting needed. Longtail ICY/RadioBrowser
 * stations frequently announce ad breaks straight in their StreamTitle
 * metadata (e.g. "THIS STATION WILL CONTINUE AFTER THIS BREAK", a sponsor
 * read, or a network promo), so a regex over the raw now-playing text catches
 * the overwhelming majority of ad breaks for ~free.
 *
 * This is a signal, not a certainty: it flags "may have ads" for the
 * directory, not "definitely has ads right now".
 */

/** Consecutive ad-like signals required before a station is flagged. Small
 * (not 1) so a single coincidental title match doesn't mislabel a station,
 * but small enough that a station running real ad breaks gets caught within
 * one or two breaks (most breaks announce 2-4 distinct ad slugs in a row). */
export const AD_SIGNAL_THRESHOLD = 2;

const AD_PATTERNS: RegExp[] = [
  /\bthis station will continue after this (this )?break\b/i,
  /\b(commercial|advertisement|ad)\s*break\b/i,
  /\bstation\s*id(ent)?\b/i,
  /\bbrought to you by\b/i,
  /\b(paid|sponsored) (advertisement|content|programming)\b/i,
  /\bsponsored by\b/i,
  /\bnow a word from our sponsors?\b/i,
  /\bcommercial free\b/i, // ironic but common false-positive guard below negates it
  /\byou'?re listening to\b.{0,40}\bcommercial\b/i,
  /\b(back|more)\s+after (this|the) break\b/i,
  /\bstay tuned\b/i,
];

/** Patterns that should NEVER count as an ad even if they match a phrase
 * above loosely — stations proudly branding themselves "commercial-free". */
const NEGATION_PATTERNS: RegExp[] = [/\bcommercial[\s-]?free\b/i];

/**
 * Returns true when a raw now-playing title/artist pair looks like an ad
 * break rather than a real song. Pure string matching — no network calls.
 */
export function detectAdSignal(rawArtist: string | null | undefined, rawTitle: string | null | undefined): boolean {
  const artist = (rawArtist ?? "").trim();
  const title = (rawTitle ?? "").trim();
  if (!artist && !title) return false;
  const combined = `${artist} — ${title}`;

  if (NEGATION_PATTERNS.some((p) => p.test(combined))) return false;

  // A very common ICY ad pattern: the artist and title fields are IDENTICAL
  // generic filler text (a real song virtually never repeats itself as both
  // fields). Combined with any promo-ish keyword, this is a strong signal.
  const sameFieldFiller =
    artist.length > 0 &&
    artist.toLowerCase() === title.toLowerCase() &&
    /\b(break|station|continue|sponsor|advertisement|commercial|promo)\b/i.test(combined);

  return sameFieldFiller || AD_PATTERNS.some((p) => p.test(combined));
}

/**
 * Updates the station's rolling ad-signal streak given the latest now-playing
 * text, flagging `mayHaveAds` (sticky) once AD_SIGNAL_THRESHOLD consecutive
 * ad-like signals are seen in a row. Never throws — a failure here must never
 * take down the polling tick that called it.
 */
export async function recordAdSignal(
  station: Pick<Station, "id" | "adSignalStreak" | "mayHaveAds">,
  rawArtist: string | null | undefined,
  rawTitle: string | null | undefined,
): Promise<boolean> {
  try {
    const isAd = detectAdSignal(rawArtist, rawTitle);
    if (!isAd) {
      if (station.adSignalStreak !== 0) {
        await db
          .update(stationsTable)
          .set({ adSignalStreak: 0, updatedAt: sql`now()` })
          .where(eq(stationsTable.id, station.id));
      }
      return false;
    }

    const nextStreak = station.adSignalStreak + 1;
    const justCrossed = !station.mayHaveAds && nextStreak >= AD_SIGNAL_THRESHOLD;

    await db
      .update(stationsTable)
      .set({
        adSignalStreak: nextStreak,
        ...(justCrossed ? { mayHaveAds: true, adDetectedAt: sql`now()` } : {}),
        updatedAt: sql`now()`,
      })
      .where(eq(stationsTable.id, station.id));

    return true;
  } catch (err) {
    console.error("[lore] recordAdSignal failed", station.id, err);
    return false;
  }
}
