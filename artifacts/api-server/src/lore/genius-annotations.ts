import {
  db,
  recordingsTable,
  lyricLinesTable,
  trackClaimsTable,
  geniusAnnotationDraftsTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { fetchGeniusSongId, fetchGeniusReferents, geniusEnabled } from "@workspace/song-enrichment";

/**
 * Genius annotation → timestamp projection pipeline.
 *
 * After LRCLIB synced lyrics are stored for a recording, this module:
 *  1. Looks up the Genius song id by title + artist (search API).
 *  2. Fetches qualifying referents (fragment anchors + annotations, filtered
 *     to votes >= 5 OR verified=true).
 *  3. Fuzzy-matches each fragment against the LRCLIB lyric_lines rows to
 *     assign an `offset_ms` anchor.
 *  4. Stores draft rows in `genius_annotation_drafts` for admin review.
 *
 * Policy:
 *  - Never store the verbatim annotation text — only the fragment.
 *  - All drafts start as status='draft'; publishing is admin-gated.
 *  - Idempotent: rows are deduplicated by geniusAnnotationId (unique index).
 *  - Fails safely: any network error degrades silently; the lyrics pipeline
 *    is never blocked.
 */

/** Normalise a string for fuzzy comparison: lowercase, strip non-alphanumeric. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Jaccard token-overlap similarity between two normalised strings.
 * Returns a value in [0, 1]. Words shorter than 3 chars are ignored.
 */
function jaccardSimilarity(a: string, b: string): number {
  const tokA = new Set(a.split(" ").filter((t) => t.length >= 3));
  const tokB = new Set(b.split(" ").filter((t) => t.length >= 3));
  if (!tokA.size || !tokB.size) return 0;
  let intersection = 0;
  for (const t of tokA) {
    if (tokB.has(t)) intersection++;
  }
  const union = tokA.size + tokB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Match a Genius lyric fragment against an array of LRCLIB lines.
 * Returns the offsetMs of the best-matching line, or null if confidence
 * is below threshold.
 *
 * Strategy:
 *  1. Normalise fragment (may span multiple lines → split on newline/semicolon).
 *  2. For each sub-fragment, find the line with the highest Jaccard similarity.
 *  3. Accept the match when similarity >= 0.5 (≥ 50% token overlap).
 */
export function projectFragment(
  fragment: string,
  lines: { offsetMs: number; text: string }[],
): number | null {
  if (!lines.length || !fragment.trim()) return null;

  const subFragments = fragment
    .split(/[\n;]/)
    .map((f) => norm(f))
    .filter((f) => f.length >= 4);

  if (!subFragments.length) return null;

  let bestOffset: number | null = null;
  let bestScore = 0;

  for (const sub of subFragments) {
    for (const line of lines) {
      const normLine = norm(line.text);
      if (!normLine) continue;

      let score = jaccardSimilarity(sub, normLine);

      if (score < 0.5) {
        if (normLine.includes(sub) || sub.includes(normLine)) score = 0.8;
      }

      if (score > bestScore) {
        bestScore = score;
        bestOffset = line.offsetMs;
      }
    }
  }

  return bestScore >= 0.5 ? bestOffset : null;
}

/**
 * Ingest Genius annotations for a recording that has LRCLIB lyrics.
 *
 * - Looks up the Genius song id (title + artist search).
 * - Fetches qualifying referents (votes >= 5 || verified).
 * - Projects each fragment against the stored lyric lines.
 * - Upserts draft rows (idempotent via `onConflictDoNothing`).
 *
 * Returns the number of drafts inserted (0 = nothing new or not configured).
 * Never throws — all errors are caught and logged.
 */
export async function ingestGeniusAnnotations(mbid: string): Promise<number> {
  if (!geniusEnabled()) return 0;

  try {
    const [rec] = await db
      .select({
        title: recordingsTable.title,
        artist: recordingsTable.artist,
        isrc: recordingsTable.isrc,
      })
      .from(recordingsTable)
      .where(eq(recordingsTable.mbid, mbid))
      .limit(1);

    if (!rec) return 0;

    const songId = await fetchGeniusSongId(rec.title, rec.artist, rec.isrc);
    if (!songId) return 0;

    const referents = await fetchGeniusReferents(songId);
    if (!referents.length) return 0;

    const lyricRows = await db
      .select({ offsetMs: lyricLinesTable.offsetMs, text: lyricLinesTable.text })
      .from(lyricLinesTable)
      .where(and(eq(lyricLinesTable.mbid, mbid), eq(lyricLinesTable.offsetMs, lyricLinesTable.offsetMs)))
      .orderBy(lyricLinesTable.offsetMs);

    const lines = lyricRows.filter((r) => r.offsetMs >= 0);

    let inserted = 0;
    for (const ref of referents) {
      const offsetMs = projectFragment(ref.fragment, lines);
      const anchorType = offsetMs !== null ? "timestamp" : "none";

      const result = await db
        .insert(geniusAnnotationDraftsTable)
        .values({
          mbid,
          geniusSongId: songId,
          geniusAnnotationId: ref.geniusAnnotationId,
          fragment: ref.fragment,
          anchorType,
          offsetMs: offsetMs ?? null,
          geniusUrl: ref.geniusUrl,
          verified: ref.verified,
          voteCount: ref.voteCount,
          status: "draft",
        })
        .onConflictDoNothing();

      if ((result.rowCount ?? 0) > 0) inserted++;
    }

    if (inserted > 0) {
      console.info(
        `[lore] genius ${rec.artist} – ${rec.title}: ${inserted} annotation draft(s) (${referents.length} fetched)`,
      );
    }

    return inserted;
  } catch (err) {
    console.warn("[lore] genius annotation ingest error", mbid, err);
    return 0;
  }
}

/**
 * Promote a draft to a published track_claim.
 *
 * Admin-supplied `text` is the paraphrase (never verbatim annotation text).
 * On success, updates the draft status to 'published' and inserts the claim.
 * Returns the new claim id on success, or null when the draft isn't found.
 */
export async function publishGeniusDraft(
  draftId: number,
  paraphrase: string,
): Promise<number | null> {
  const [draft] = await db
    .select()
    .from(geniusAnnotationDraftsTable)
    .where(eq(geniusAnnotationDraftsTable.id, draftId))
    .limit(1);

  if (!draft || draft.status !== "draft") return null;

  const sourceLabel = draft.verified ? "Genius · Verified" : "Genius";
  const externalId = `genius:${draft.geniusAnnotationId}`;

  const [claim] = await db
    .insert(trackClaimsTable)
    .values({
      mbid: draft.mbid,
      positionMs: draft.offsetMs ?? null,
      text: paraphrase,
      sourceLabel,
      sourceUrl: draft.geniusUrl,
      sourceHandle: "genius",
      externalId,
      verified: draft.verified,
    })
    .onConflictDoNothing()
    .returning({ id: trackClaimsTable.id });

  await db
    .update(geniusAnnotationDraftsTable)
    .set({ status: "published", updatedAt: new Date() })
    .where(eq(geniusAnnotationDraftsTable.id, draftId));

  return claim?.id ?? null;
}

/**
 * Reject a draft. Sets status to 'rejected' so it won't appear in the admin
 * queue again. Idempotent — rejecting an already-rejected draft is a no-op.
 */
export async function rejectGeniusDraft(draftId: number): Promise<boolean> {
  const [draft] = await db
    .select({ id: geniusAnnotationDraftsTable.id })
    .from(geniusAnnotationDraftsTable)
    .where(eq(geniusAnnotationDraftsTable.id, draftId))
    .limit(1);

  if (!draft) return false;

  await db
    .update(geniusAnnotationDraftsTable)
    .set({ status: "rejected", updatedAt: new Date() })
    .where(eq(geniusAnnotationDraftsTable.id, draftId));

  return true;
}
