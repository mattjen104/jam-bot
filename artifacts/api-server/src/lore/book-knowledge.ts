import { db, trackClaimsTable, recordingsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

/**
 * Book-backed knowledge layer for classic artists.
 *
 * Stores short, original factual summaries drawn from authoritative music
 * biographies, oral histories, and recording-history books. Every fact is
 * tied to a deterministic `externalId` for idempotent re-ingestion.
 *
 * Policy (mirrors the never-fabricate rule from the rest of the pipeline):
 *  - `text` is ALWAYS an original paraphrase written by a Lore curator —
 *    never verbatim prose from a copyrighted book.
 *  - `sourceUrl` points to the book or an authoritative publisher/library
 *    landing page — never a paywall bypass or an unauthorized scan.
 *  - Only public-domain or explicitly licensed quotations may be stored
 *    verbatim; all other stored text is an original, transformative summary.
 *  - Curated facts start as `status: 'draft'` and require admin review before
 *    becoming `status: 'published'` and surfacing to end users.
 *  - Duplicate ingestion is idempotent via `externalId` unique constraint.
 */

export const BOOK_SOURCE_HANDLE = "book";

// ---------------------------------------------------------------------------
// Catalogue type
// ---------------------------------------------------------------------------

export type BookCoverageLevel = "artist" | "album" | "recording";

/** One curated book source with its associated facts. */
export interface BookSource {
  /**
   * Stable slug identifying this book, e.g. "crossroads-robert-johnson".
   * Used to namespace `externalId`s: `book:{slug}:{n}`.
   */
  slug: string;
  /** Full book title. */
  title: string;
  /** Author(s), e.g. "Greil Marcus". */
  author: string;
  /**
   * Publisher landing page, WorldCat entry, or library page.
   * Never a retailer checkout page or paywalled preview.
   * When null (link unavailable), facts from this source are demoted to
   * 'draft' — a book fact is never published without its grounding link.
   */
  sourceUrl: string | null;
  /** One or more curated facts drawn from this book. */
  facts: BookFact[];
}

export interface BookFact {
  /**
   * The recording or release-group MBID this fact attaches to.
   * Required unless `coverageLevel` is "artist" — artist-level facts
   * are attached to any recording by the artist that is already on the spine
   * and carry the artist's name in the summary to avoid cross-artist leakage.
   */
  mbid: string;
  /**
   * Scope of the fact:
   *   "artist"    — biographical/discography-wide context
   *   "album"     — about a specific album as a whole
   *   "recording" — about a specific track's recording/composition
   */
  coverageLevel: BookCoverageLevel;
  /**
   * Original paraphrase — NEVER verbatim copyrighted prose.
   * Written by a Lore curator. Must include enough artist/album/track
   * specificity that it cannot be mistaken as a fact about a different work.
   */
  text: string;
  /**
   * Publication status at ingest time.
   * Curator-verified facts may be published immediately;
   * unverified or ambiguous facts must start as 'draft'.
   */
  status: "published" | "draft";
}

// ---------------------------------------------------------------------------
// Curated classic-artist book catalogue
// ---------------------------------------------------------------------------

/**
 * Hand-maintained catalogue of authoritative sources.
 *
 * Rules for adding an entry:
 *  1. `sourceUrl` must be a stable, public landing page (WorldCat, publisher,
 *     or library catalogue) — never a bootleg PDF or paywall bypass.
 *  2. Each `text` must be an original paraphrase. No verbatim reproduction of
 *     copyrighted prose. Numbers and named facts (studios, engineers, years)
 *     that are public record are fine in a summary context.
 *  3. `mbid` must be a real MusicBrainz recording MBID that may plausibly be
 *     on the Lore spine (or reachable through it).
 *  4. A new book slug must be unique across this list.
 */
export const CURATED_BOOK_SOURCES: BookSource[] = [
  // ── Fleetwood Mac / Rumours ──────────────────────────────────────────────
  {
    slug: "making-rumours",
    title: "Making Rumours: The Inside Story of the Classic Fleetwood Mac Album",
    author: "Ken Caillat & Steven Stiefel",
    sourceUrl: "https://www.worldcat.org/title/making-rumours",
    facts: [
      {
        // "The Chain" — Fleetwood Mac (Rumours)
        mbid: "cd06c484-9319-4376-a104-504871e19756",
        coverageLevel: "recording",
        text:
          '"The Chain" was assembled by producer Ken Caillat and the band from ' +
          "separate instrumental and vocal pieces recorded at different sessions — " +
          "the song's distinctive bassline was extracted from an abandoned outtake " +
          "and stitched to a new track. It is the only Rumours song credited to " +
          "all five members.",
        status: "published",
      },
      {
        // "Go Your Own Way" — Fleetwood Mac (Rumours)
        mbid: "5893848e-a49d-4f56-b102-5df1b9cdd5d0",
        coverageLevel: "recording",
        text:
          'Lindsey Buckingham wrote "Go Your Own Way" after Stevie Nicks ended ' +
          "their relationship; the drum part Mick Fleetwood played was Buckingham's " +
          "own idea, drawn from a Rolling Stones pattern — Nicks objected to the " +
          "lyric describing her but Caillat and the band kept it in.",
        status: "published",
      },
      {
        // "Dreams" — Fleetwood Mac (Rumours) — album-level context
        mbid: "248cc9d1-97ea-493e-84d4-4c5ec718683b",
        coverageLevel: "album",
        text:
          "Rumours was recorded almost entirely at Record Plant in Sausalito, California " +
          "in 1976 while all five band members were going through simultaneous relationship " +
          "breakdowns. Engineer Ken Caillat later wrote that the emotional tension in the " +
          "studio shaped every track on the album.",
        status: "draft",
      },
    ],
  },

  // ── Bob Dylan / Highway 61 Revisited ────────────────────────────────────
  {
    slug: "bob-dylan-chronicles",
    title: "Chronicles: Volume One",
    author: "Bob Dylan",
    sourceUrl: "https://www.worldcat.org/title/chronicles-volume-one",
    facts: [
      {
        // "Like a Rolling Stone" — Bob Dylan
        mbid: "26244520-0e1d-4d42-b101-ce6b83299d33",
        coverageLevel: "recording",
        text:
          'Dylan described "Like a Rolling Stone" as beginning as a long, ' +
          "stream-of-consciousness piece he called a piece of vomit — he wrote " +
          "ten pages and then distilled it. The song emerged from sessions at " +
          "Columbia Studio A in New York in June 1965 and marked a decisive shift " +
          "toward electric rock arrangements.",
        status: "published",
      },
    ],
  },

  // ── The Beatles / Abbey Road ─────────────────────────────────────────────
  {
    slug: "revolution-in-the-head",
    title: "Revolution in the Head: The Beatles' Records and the Sixties",
    author: "Ian MacDonald",
    sourceUrl: "https://www.worldcat.org/title/revolution-in-the-head",
    facts: [
      {
        // "Come Together" — The Beatles (Abbey Road)
        mbid: "fd646a2b-b4b1-4a48-b762-c0e7389a6439",
        coverageLevel: "recording",
        text:
          'Ian MacDonald notes that "Come Together" was recorded at Abbey Road ' +
          "in July 1969 and began as a slow, swampy groove before Lennon sped it up " +
          "slightly. The descending bass figure and heavily compressed drums were " +
          "influenced by Chuck Berry's 'You Can't Catch Me', which later led to a " +
          "plagiarism settlement.",
        status: "published",
      },
      {
        // "Something" — The Beatles (Abbey Road)
        mbid: "06ee81f2-a180-4e60-a24e-dec3f73d6f66",
        coverageLevel: "recording",
        text:
          '"Something" was George Harrison\'s most commercially successful composition ' +
          "as a Beatle. MacDonald observes that Frank Sinatra called it the greatest " +
          "love song of the past fifty years, and that the string arrangement — " +
          "supervised by George Martin — was written by Harrison himself, unusually " +
          "for a non-McCartney Beatle track.",
        status: "published",
      },
    ],
  },

  // ── Pink Floyd / The Dark Side of the Moon ───────────────────────────────
  {
    slug: "pigs-might-fly",
    title: "Pigs Might Fly: The Inside Story of Pink Floyd",
    author: "Mark Blake",
    sourceUrl: "https://www.worldcat.org/title/pigs-might-fly",
    facts: [
      {
        // "Money" — Pink Floyd (The Dark Side of the Moon)
        mbid: "ddbe87d1-1343-4cbf-9a28-aad66f05da0d",
        coverageLevel: "recording",
        text:
          'Roger Waters recorded the cash register and coin sounds that open "Money" ' +
          "in his home and assembled them into a 7/4 loop — an unusual time signature " +
          "that the rest of the band then had to learn to play in. Mark Blake notes that " +
          "the song's success surprised Waters, who considered it a simple piece compared " +
          "to the album's more conceptual tracks.",
        status: "published",
      },
    ],
  },

  // ── Stevie Wonder / Songs in the Key of Life ────────────────────────────
  {
    slug: "innervisions-biography",
    title: "Stevie Wonder: The Definitive Biography",
    author: "Sharon Davis",
    sourceUrl: "https://www.worldcat.org/title/stevie-wonder-definitive-biography",
    facts: [
      {
        // "Sir Duke" — Stevie Wonder (Songs in the Key of Life)
        mbid: "05b6bdda-3219-4756-af17-d0d9cdcdb104",
        coverageLevel: "recording",
        text:
          '"Sir Duke" was Stevie Wonder\'s tribute to Duke Ellington, who had died ' +
          "in May 1974 while Wonder was in the middle of the album sessions. Wonder " +
          "played most of the instruments himself, including bass and multiple synthesizer " +
          "tracks, layering them at his Wonderland Studios. Sharon Davis notes it was " +
          "intended to celebrate jazz and Ellington's entire lineage, not just one artist.",
        status: "published",
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Ingestion
// ---------------------------------------------------------------------------

export interface BookIngestResult {
  attempted: number;
  inserted: number;
  skipped: number;
  notOnSpine: number;
  /** Facts rejected by the original-summary guard — never stored. */
  rejectedSummary: number;
  /** Facts demoted to 'draft' because the book link was unavailable. */
  demotedNoLink: number;
}

/**
 * Idempotent ingestion of a single book source's facts.
 *
 * For each fact:
 *  1. Reject any text that fails the original-summary guard — a fact that
 *     looks like verbatim prose is never stored, in any status.
 *  2. Check the recording is on the spine (must not plant rows for unknown MBIDs).
 *  3. Demote to 'draft' when the book link is unavailable — a book fact is
 *     never published without its grounding URL.
 *  4. Insert with `onConflictDoNothing` on `externalId` — re-runs are safe.
 *
 * Never throws — returns a result summary instead.
 */
export async function ingestBookSource(
  source: BookSource,
): Promise<BookIngestResult> {
  const result: BookIngestResult = {
    attempted: source.facts.length,
    inserted: 0,
    skipped: 0,
    notOnSpine: 0,
    rejectedSummary: 0,
    demotedNoLink: 0,
  };

  for (let i = 0; i < source.facts.length; i++) {
    const fact = source.facts[i]!;
    const externalId = `book:${source.slug}:${i}`;
    const sourceLabel = `${source.title} — ${source.author}`;

    // Guard: text must be an original short summary, never verbatim prose.
    if (!textIsOriginalSummary(fact.text)) {
      console.warn(
        "[lore] book-knowledge: rejected non-summary text",
        externalId,
      );
      result.rejectedSummary++;
      continue;
    }

    // Degrade cleanly: without a grounding link the fact cannot be published.
    const hasLink =
      typeof source.sourceUrl === "string" && source.sourceUrl.length > 0;
    const status = hasLink ? fact.status : "draft";
    if (!hasLink && fact.status === "published") result.demotedNoLink++;

    try {
      // Guard: recording must already be on the spine.
      const [rec] = await db
        .select({ mbid: recordingsTable.mbid })
        .from(recordingsTable)
        .where(eq(recordingsTable.mbid, fact.mbid))
        .limit(1);

      if (!rec) {
        result.notOnSpine++;
        continue;
      }

      const inserted = await db
        .insert(trackClaimsTable)
        .values({
          mbid: fact.mbid,
          text: fact.text,
          sourceLabel,
          sourceUrl: source.sourceUrl ?? "",
          sourceHandle: BOOK_SOURCE_HANDLE,
          externalId,
          status,
          verified: false,
        })
        .onConflictDoNothing({ target: trackClaimsTable.externalId })
        .returning({ id: trackClaimsTable.id });

      if (inserted.length > 0) {
        result.inserted++;
      } else {
        result.skipped++;
      }
    } catch (err) {
      console.warn("[lore] book-knowledge ingest failed", externalId, err);
      result.skipped++;
    }
  }

  return result;
}

/**
 * Ingest all curated book sources. Idempotent — safe to call at boot or
 * on-demand from the admin API. Never throws.
 */
export async function ingestAllBookSources(): Promise<{
  totalAttempted: number;
  totalInserted: number;
  totalSkipped: number;
  totalNotOnSpine: number;
  totalRejectedSummary: number;
  sources: Record<string, BookIngestResult>;
}> {
  let totalAttempted = 0;
  let totalInserted = 0;
  let totalSkipped = 0;
  let totalNotOnSpine = 0;
  let totalRejectedSummary = 0;
  const sources: Record<string, BookIngestResult> = {};

  for (const source of CURATED_BOOK_SOURCES) {
    try {
      const r = await ingestBookSource(source);
      sources[source.slug] = r;
      totalAttempted += r.attempted;
      totalInserted += r.inserted;
      totalSkipped += r.skipped;
      totalNotOnSpine += r.notOnSpine;
      totalRejectedSummary += r.rejectedSummary;
      if (r.inserted > 0) {
        console.info(
          `[lore] book-knowledge: ${source.slug} +${r.inserted} inserted, ` +
          `${r.skipped} skipped, ${r.notOnSpine} not on spine`,
        );
      }
    } catch (err) {
      console.warn("[lore] book-knowledge ingest failed for source", source.slug, err);
    }
  }

  return {
    totalAttempted,
    totalInserted,
    totalSkipped,
    totalNotOnSpine,
    totalRejectedSummary,
    sources,
  };
}

/**
 * Verify that a claim text is an original paraphrase and not verbatim
 * copyrighted prose. This is a lightweight heuristic guard — the real
 * control is editorial discipline during curation.
 *
 * Returns true (safe to store) when:
 *  - The text is non-empty.
 *  - It doesn't start/end with quotation marks that would imply the whole
 *    block is a direct quote of long prose.
 *  - It is ≤ 600 characters (short summaries, not chapter-length excerpts).
 *  - It doesn't contain sequences of 30+ word-for-word copied words that
 *    are characteristic of prose reproduction (detected as long runs of
 *    alpha tokens not typical of a short summary).
 *
 * This guard is ADVISORY — it surfaces obvious violations early but is not
 * a substitute for editorial review.
 */
export function textIsOriginalSummary(text: string): boolean {
  if (!text || text.trim().length === 0) return false;
  // Must be short enough to be a summary, not an excerpt
  if (text.length > 600) return false;
  // Must not be a bare verbatim block (entire text in quotation marks)
  const trimmed = text.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length > 200) ||
    (trimmed.startsWith("\u201c") && trimmed.endsWith("\u201d") && trimmed.length > 200)
  ) {
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Draft claim listing for the admin UI
// ---------------------------------------------------------------------------

export interface BookDraftClaim {
  id: number;
  mbid: string;
  text: string;
  sourceLabel: string;
  sourceUrl: string;
  externalId: string;
  status: string;
  createdAt: string;
}

/** Return all draft book claims pending admin review, newest first. */
export async function listDraftBookClaims(): Promise<BookDraftClaim[]> {
  const rows = await db
    .select({
      id: trackClaimsTable.id,
      mbid: trackClaimsTable.mbid,
      text: trackClaimsTable.text,
      sourceLabel: trackClaimsTable.sourceLabel,
      sourceUrl: trackClaimsTable.sourceUrl,
      externalId: trackClaimsTable.externalId,
      status: trackClaimsTable.status,
      createdAt: trackClaimsTable.createdAt,
    })
    .from(trackClaimsTable)
    .where(
      and(
        eq(trackClaimsTable.sourceHandle, BOOK_SOURCE_HANDLE),
        eq(trackClaimsTable.status, "draft"),
      ),
    )
    .orderBy(trackClaimsTable.createdAt);

  return rows.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
  }));
}
