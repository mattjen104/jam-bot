import {
  db,
  scrapedShowsTable,
  showsTable,
  pickersTable,
  stationsTable,
  spinsTable,
} from "@workspace/db";
import { eq, and, isNull, isNotNull, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * True when a scraped dj_name looks like a real human name (contains a space
 * and no comma — the comma case is a multi-host listing like "Alice, Bob").
 * Excludes single-word usernames/handles like "wizzy", "rduffy", "TK".
 */
function looksLikeRealSingleName(name: string): boolean {
  const t = name.trim();
  return t.includes(" ") && !t.includes(",");
}

/**
 * Slugify a DJ name to a stable picker handle.
 * "Robert Drake" → "robert-drake"
 */
function slugifyDjName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// ---------------------------------------------------------------------------
// Phase 1 — shows rows
// ---------------------------------------------------------------------------

/**
 * For every unique (station_id, show_name) pair in scraped_shows that does not
 * yet have a corresponding row in shows, insert one. Stations that already have
 * curated shows (e.g. KEXP via the API harvester) are left alone — we only fill
 * gaps. Idempotent.
 */
async function syncShowRows(): Promise<number> {
  // Collect unique (stationId, showName, djName) — one representative dj_name
  // per (station, show) using DISTINCT ON.
  const rows = await db.execute<{
    station_id: number;
    show_name: string;
    dj_name: string | null;
  }>(sql`
    SELECT DISTINCT ON (station_id, show_name)
      station_id,
      show_name,
      dj_name
    FROM scraped_shows
    ORDER BY station_id, show_name, dj_name NULLS LAST
  `);

  let created = 0;
  for (const row of rows.rows) {
    const exists = await db
      .select({ id: showsTable.id })
      .from(showsTable)
      .where(
        and(
          eq(showsTable.stationId, row.station_id),
          eq(showsTable.name, row.show_name),
        ),
      )
      .limit(1);

    if (exists.length > 0) continue;

    await db
      .insert(showsTable)
      .values({
        stationId: row.station_id,
        name: row.show_name,
        djName: row.dj_name ?? null,
      })
      .onConflictDoNothing();
    created++;
  }

  return created;
}

// ---------------------------------------------------------------------------
// Phase 2 — DJ pickers
// ---------------------------------------------------------------------------

/**
 * For each unique (station_id, dj_name) pair where the name looks like a real
 * single human name, upsert a picker of type "dj" and link it to all matching
 * shows rows at that station. Picker handle is "show-dj-<station-slug>-<dj-slug>"
 * to avoid collisions with KEXP and other source-specific handles.
 */
async function syncDjPickers(): Promise<number> {
  const rows = await db.execute<{
    station_id: number;
    station_slug: string;
    dj_name: string;
  }>(sql`
    SELECT DISTINCT ON (ss.station_id, ss.dj_name)
      ss.station_id,
      st.slug AS station_slug,
      ss.dj_name
    FROM scraped_shows ss
    JOIN stations st ON st.id = ss.station_id
    WHERE ss.dj_name IS NOT NULL AND ss.dj_name <> ''
    ORDER BY ss.station_id, ss.dj_name
  `);

  let linked = 0;
  for (const row of rows.rows) {
    if (!looksLikeRealSingleName(row.dj_name)) continue;

    const djSlug = slugifyDjName(row.dj_name);
    const handle = `show-dj-${row.station_slug}-${djSlug}`;

    // Upsert picker
    const [existing] = await db
      .select({ id: pickersTable.id })
      .from(pickersTable)
      .where(eq(pickersTable.handle, handle))
      .limit(1);

    let pickerId: number;
    if (existing) {
      pickerId = existing.id;
    } else {
      const [inserted] = await db
        .insert(pickersTable)
        .values({
          pickerType: "dj",
          name: row.dj_name,
          handle,
          sourceRef: { stationSlug: row.station_slug, djName: row.dj_name },
          trustTier: 2,
          active: true,
        })
        .onConflictDoNothing()
        .returning({ id: pickersTable.id });
      if (!inserted) continue;
      pickerId = inserted.id;
    }

    // Link to all matching shows rows at this station
    const shows = await db
      .select({ id: showsTable.id })
      .from(showsTable)
      .where(
        and(
          eq(showsTable.stationId, row.station_id),
          eq(showsTable.djName, row.dj_name),
          isNull(showsTable.pickerId),
        ),
      );

    for (const show of shows) {
      await db
        .update(showsTable)
        .set({ pickerId })
        .where(eq(showsTable.id, show.id));
      linked++;
    }
  }

  return linked;
}

// ---------------------------------------------------------------------------
// Phase 3 — backfill spins.show_id
// ---------------------------------------------------------------------------

/**
 * For stations that have both a scraped schedule and an IANA timezone, stamp
 * show_id on historical spins whose show_id is currently null, by matching
 * played_at (converted to station-local time) against the (DOW, start_time,
 * end_time) window in scraped_shows.
 *
 * Only runs for stations with a known timezone — without one we can't safely
 * convert UTC to local time. Returns the number of spins updated.
 */
export async function stampSpinShowIds(): Promise<number> {
  const result = await db.execute<{ count: string }>(sql`
    WITH matches AS (
      SELECT DISTINCT ON (sp.id)
        sp.id  AS spin_id,
        sh.id  AS show_id
      FROM spins sp
      JOIN stations st ON st.id = sp.station_id
      JOIN scraped_shows ss ON ss.station_id = sp.station_id
      JOIN shows sh
        ON  sh.station_id = sp.station_id
        AND sh.name       = ss.show_name
      WHERE sp.show_id      IS NULL
        AND st.iana_timezone IS NOT NULL
        -- Overnight-aware slot matching (mirrors the crossing scorer's
        -- currently_airing CTE): a wrap slot (end <= start, e.g. 22:00-02:00)
        -- matches on its start day from start_time onward, and on the NEXT
        -- day before end_time (checked via yesterday's DOW carryover).
        AND (
          (
            ss.day_of_week = TO_CHAR(
              sp.played_at AT TIME ZONE st.iana_timezone, 'Dy')
            AND (
              (ss.end_time > ss.start_time
                AND TO_CHAR(sp.played_at AT TIME ZONE st.iana_timezone, 'HH24:MI') >= ss.start_time
                AND TO_CHAR(sp.played_at AT TIME ZONE st.iana_timezone, 'HH24:MI') <  ss.end_time)
              OR
              (ss.end_time < ss.start_time
                AND TO_CHAR(sp.played_at AT TIME ZONE st.iana_timezone, 'HH24:MI') >= ss.start_time)
            )
          )
          OR
          (
            ss.end_time < ss.start_time
            AND ss.day_of_week = TO_CHAR(
              (sp.played_at - interval '1 day') AT TIME ZONE st.iana_timezone, 'Dy')
            AND TO_CHAR(sp.played_at AT TIME ZONE st.iana_timezone, 'HH24:MI') < ss.end_time
          )
        )
      -- Deterministic tie-break when overlapping slots match one spin:
      -- prefer the latest-starting (most specific) slot, then stable ids.
      ORDER BY sp.id, ss.start_time DESC, ss.id
    ),
    updated AS (
      UPDATE spins sp
      SET show_id = m.show_id
      FROM matches m
      WHERE sp.id = m.spin_id
      RETURNING 1
    )
    SELECT COUNT(*)::text AS count FROM updated
  `);

  return parseInt(result.rows[0]?.count ?? "0", 10);
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Full sync: create shows rows from scraped_shows, link DJ pickers, then
 * backfill spins.show_id for stations with a known timezone. Idempotent and
 * safe to run at boot or after each schedule scrape cycle. Never throws —
 * errors are logged and swallowed so this never takes down the boot sequence.
 */
export async function syncScrapedShows(): Promise<void> {
  try {
    const showsCreated = await syncShowRows();
    const pickersLinked = await syncDjPickers();
    const spinsStamped = await stampSpinShowIds();
    console.info(
      `[scraped-shows-sync] shows created: ${showsCreated}, ` +
        `pickers linked: ${pickersLinked}, spins stamped: ${spinsStamped}`,
    );
  } catch (err) {
    console.error("[scraped-shows-sync] sync failed", err);
  }
}

// ---------------------------------------------------------------------------
// Forward-looking: show lookup for live ingest
// ---------------------------------------------------------------------------

/**
 * Resolve a `'mixed'` station's automation class at query time by checking
 * whether a scraped_shows slot is currently active.
 *
 * - Returns `'human'`    when a scraped show slot covers `now`.
 * - Returns `'automated'` when no slot covers `now` (overnight fill or
 *   missing schedule data).
 * - Returns the input value unchanged for any class other than `'mixed'`
 *   (including `null`).
 *
 * Designed for use in the station DTO serialisation path so callers receive
 * the per-slot truth rather than the static `'mixed'` flag.  Defaults to
 * `'automated'` on any error so the pessimistic behaviour is preserved.
 */
export async function resolveAutomationClass(
  stationId: number,
  ianaTimezone: string | null | undefined,
  automationClass: string | null,
  now: Date = new Date(),
): Promise<string | null> {
  if (automationClass !== "mixed") return automationClass;
  // Without a timezone we cannot map UTC→local DOW/time, so fall back to the
  // pessimistic value rather than incorrectly implying a human is on air.
  if (!ianaTimezone) return "automated";

  const showId = await lookupScrapedShowId(stationId, ianaTimezone, now);
  return showId != null ? "human" : "automated";
}

/**
 * Given a station with a known IANA timezone, look up which shows row (derived
 * from the scraped schedule) was airing at `playedAt`. Returns the show id or
 * null if none matches (overnight automation gap, or no schedule data).
 *
 * Called from logSpinIfChanged when np.show is absent, so ICY/radio-browser
 * spins land with the correct show attribution going forward.
 */
export async function lookupScrapedShowId(
  stationId: number,
  ianaTimezone: string,
  playedAt: Date,
): Promise<number | null> {
  try {
    const result = await db.execute<{ id: number }>(sql`
      SELECT sh.id
      FROM shows sh
      JOIN scraped_shows ss
        ON  ss.station_id = sh.station_id
        AND ss.show_name  = sh.name
      WHERE sh.station_id = ${stationId}
        AND (
          (
            ss.day_of_week = TO_CHAR(
              ${playedAt.toISOString()}::timestamptz AT TIME ZONE ${ianaTimezone}, 'Dy')
            AND (
              (ss.end_time > ss.start_time
                AND TO_CHAR(${playedAt.toISOString()}::timestamptz AT TIME ZONE ${ianaTimezone}, 'HH24:MI') >= ss.start_time
                AND TO_CHAR(${playedAt.toISOString()}::timestamptz AT TIME ZONE ${ianaTimezone}, 'HH24:MI') <  ss.end_time)
              OR
              (ss.end_time < ss.start_time
                AND TO_CHAR(${playedAt.toISOString()}::timestamptz AT TIME ZONE ${ianaTimezone}, 'HH24:MI') >= ss.start_time)
            )
          )
          OR
          (
            ss.end_time < ss.start_time
            AND ss.day_of_week = TO_CHAR(
              (${playedAt.toISOString()}::timestamptz - interval '1 day') AT TIME ZONE ${ianaTimezone}, 'Dy')
            AND TO_CHAR(${playedAt.toISOString()}::timestamptz AT TIME ZONE ${ianaTimezone}, 'HH24:MI') < ss.end_time
          )
        )
      ORDER BY ss.start_time DESC, ss.id
      LIMIT 1
    `);
    return (result.rows[0]?.id as number) ?? null;
  } catch {
    return null;
  }
}
