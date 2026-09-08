import {
  db,
  showsTable,
  pickersTable,
} from "@workspace/db";
import { eq, and, isNull, sql } from "drizzle-orm";
import { normalizeAttributionName } from "@workspace/lore-attribution";
import { parseScheduleDjNames } from "./schedule-name-sanitizer.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function scrapedDjFields(
  values: ReadonlyArray<string>,
  showName: string,
): { djName: string | null; djNames: string[] | null } {
  const names = values.flatMap((value) => parseScheduleDjNames(value, showName));
  const unique = [
    ...new Map(
      names.map((name) => [normalizeAttributionName(name), name]),
    ).values(),
  ];
  return unique.length > 1
    ? { djName: null, djNames: unique }
    : { djName: unique[0] ?? null, djNames: null };
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
  // Collect every distinct host credit for a show. A weekly schedule can list
  // different co-host strings on different days, so one representative value
  // would silently discard identities.
  const rows = await db.execute<{
    station_id: number;
    station_slug: string;
    show_name: string;
    dj_names: string[];
  }>(sql`
    SELECT
      ss.station_id,
      st.slug AS station_slug,
      ss.show_name,
      ARRAY_AGG(DISTINCT ss.dj_name) FILTER (
        WHERE ss.dj_name IS NOT NULL AND ss.dj_name <> ''
      ) AS dj_names
    FROM scraped_shows ss
    JOIN stations st ON st.id = ss.station_id
    WHERE ss.voided_at IS NULL
    GROUP BY ss.station_id, st.slug, ss.show_name
  `);

  let created = 0;
  for (const row of rows.rows) {
    const exists = await db
      .select({
        id: showsTable.id,
        djName: showsTable.djName,
        djNames: showsTable.djNames,
        pickerId: showsTable.pickerId,
      })
      .from(showsTable)
      .where(
        and(
          eq(showsTable.stationId, row.station_id),
          eq(showsTable.name, row.show_name),
        ),
      )
      .limit(1);

    const fields = scrapedDjFields(row.dj_names ?? [], row.show_name);
    const existing = exists[0];
    if (existing) {
      const oldNames = parseScheduleDjNames(existing.djName, row.show_name);
      let generatedPickerId: number | null = null;
      if (existing.pickerId != null && existing.djName) {
        const expectedHandle =
          `show-dj-${row.station_slug}-${slugifyDjName(existing.djName)}`;
        const [picker] = await db
          .select({ id: pickersTable.id, handle: pickersTable.handle })
          .from(pickersTable)
          .where(eq(pickersTable.id, existing.pickerId))
          .limit(1);
        if (picker?.handle === expectedHandle) generatedPickerId = picker.id;
      }

      const isEmptyLegacyRow =
        existing.djName == null &&
        existing.djNames == null &&
        existing.pickerId == null;
      const isUnlinkedComposite =
        existing.pickerId == null && oldNames.length > 1;
      const isGeneratedComposite =
        generatedPickerId != null &&
        (fields.djNames != null ||
          normalizeAttributionName(existing.djName) !==
            normalizeAttributionName(fields.djName));
      if (
        !isEmptyLegacyRow &&
        !isUnlinkedComposite &&
        !isGeneratedComposite
      ) {
        continue;
      }

      await db
        .update(showsTable)
        .set({ ...fields, pickerId: null })
        .where(eq(showsTable.id, existing.id));

      if (generatedPickerId != null) {
        const [stillLinked] = await db
          .select({ id: showsTable.id })
          .from(showsTable)
          .where(eq(showsTable.pickerId, generatedPickerId))
          .limit(1);
        if (!stillLinked) {
          await db
            .update(pickersTable)
            .set({ active: false })
            .where(eq(pickersTable.id, generatedPickerId));
        }
      }
      continue;
    }

    await db
      .insert(showsTable)
      .values({
        stationId: row.station_id,
        name: row.show_name,
        ...fields,
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
    show_name: string;
    dj_name: string;
  }>(sql`
    SELECT DISTINCT ON (ss.station_id, ss.show_name, ss.dj_name)
      ss.station_id,
      st.slug AS station_slug,
      ss.show_name,
      ss.dj_name
    FROM scraped_shows ss
    JOIN stations st ON st.id = ss.station_id
    WHERE ss.dj_name IS NOT NULL AND ss.dj_name <> ''
      AND ss.voided_at IS NULL
    ORDER BY ss.station_id, ss.show_name, ss.dj_name
  `);

  let linked = 0;
  for (const row of rows.rows) {
    const djNames = parseScheduleDjNames(row.dj_name, row.show_name);
    for (const djName of djNames) {

      const djSlug = slugifyDjName(djName);
      if (!djSlug) continue;
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
            name: djName,
            handle,
            sourceRef: { stationSlug: row.station_slug, djName },
            trustTier: 2,
            active: true,
          })
          .onConflictDoNothing()
          .returning({ id: pickersTable.id });
        if (!inserted) continue;
        pickerId = inserted.id;
      }

      // Only single-host shows carry djName, so multi-host shows intentionally
      // remain unlinked rather than attributing the whole show to one picker.
      const shows = await db
        .select({ id: showsTable.id })
        .from(showsTable)
        .where(
          and(
            eq(showsTable.stationId, row.station_id),
            eq(showsTable.djName, djName),
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
  }

  return linked;
}

export async function syncScrapedShowRowsAndPickers(): Promise<{
  showsCreated: number;
  pickersLinked: number;
}> {
  const showsCreated = await syncShowRows();
  const pickersLinked = await syncDjPickers();
  return { showsCreated, pickersLinked };
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
        AND ss.voided_at IS NULL
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
      SET show_id = m.show_id,
          show_attribution_source = 'schedule_match'
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
 * Clear cached automation-class entries for the given station IDs, or clear
 * the entire cache when no IDs are supplied. Call after any operation that
 * rewrites a station's scraped_shows schedule so the dial reflects the new
 * data on the very next request rather than serving a stale TTL value.
 */
export function clearAutomationClassCache(stationIds?: number[]): void {
  if (!stationIds || stationIds.length === 0) {
    automationClassCache.clear();
    return;
  }
  for (const id of stationIds) {
    automationClassCache.delete(id);
  }
}

/**
 * Full sync: create shows rows from scraped_shows, link DJ pickers, then
 * backfill spins.show_id for stations with a known timezone. Idempotent and
 * safe to run at boot or after each schedule scrape cycle. Never throws —
 * errors are logged and swallowed so this never takes down the boot sequence.
 */
export async function syncScrapedShows(): Promise<void> {
  try {
    const { showsCreated, pickersLinked } =
      await syncScrapedShowRowsAndPickers();
    const spinsStamped = await stampSpinShowIds();
    console.info(
      `[scraped-shows-sync] shows created: ${showsCreated}, ` +
        `pickers linked: ${pickersLinked}, spins stamped: ${spinsStamped}`,
    );

    // Evict stale automation-class cache entries for every station whose
    // schedule was just (re)written so the next dial refresh reads live data.
    const affected = await db.execute<{ station_id: number }>(
      sql`SELECT DISTINCT station_id FROM scraped_shows`,
    );
    clearAutomationClassCache(affected.rows.map((r) => r.station_id));
  } catch (err) {
    console.error("[scraped-shows-sync] sync failed", err);
  }
}

// ---------------------------------------------------------------------------
// Forward-looking: show lookup for live ingest
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Per-station automation-class cache
// ---------------------------------------------------------------------------

/**
 * One cached entry: the resolved value plus the wall-clock expiry timestamp.
 */
interface AutomationClassEntry {
  value: string | null;
  expiresAt: number; // Date.now() ms
}

/**
 * In-memory cache keyed by stationId.
 * Entries are evicted lazily on the next read once their TTL has elapsed.
 *
 * Show slots are ~1 hour long, so 5-minute staleness is acceptable and
 * prevents redundant DB round-trips during high-frequency dial refreshes.
 */
const automationClassCache = new Map<number, AutomationClassEntry>();

/**
 * Default TTL for resolved automation-class values (5 minutes in ms).
 * Exported so tests can override it without touching production constants.
 */
export const AUTOMATION_CLASS_CACHE_TTL_MS = 5 * 60 * 1000;

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
 * Results for `'mixed'` stations are cached per stationId for
 * `AUTOMATION_CLASS_CACHE_TTL_MS` (default 5 min) to avoid a DB round-trip
 * on every dial refresh. Pass `ttlMs` to override in tests.
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
  ttlMs: number = AUTOMATION_CLASS_CACHE_TTL_MS,
): Promise<string | null> {
  if (automationClass !== "mixed") return automationClass;
  // Without a timezone we cannot map UTC→local DOW/time, so fall back to the
  // pessimistic value rather than incorrectly implying a human is on air.
  if (!ianaTimezone) return "automated";

  const nowMs = now.getTime();
  const cached = automationClassCache.get(stationId);
  if (cached !== undefined && nowMs < cached.expiresAt) {
    return cached.value;
  }

  const showId = await lookupScrapedShowId(stationId, ianaTimezone, now);
  const resolved = showId != null ? "human" : "automated";

  automationClassCache.set(stationId, {
    value: resolved,
    expiresAt: nowMs + ttlMs,
  });

  return resolved;
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
        AND ss.voided_at IS NULL
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
