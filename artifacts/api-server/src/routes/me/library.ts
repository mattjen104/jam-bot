import { Router, type IRouter } from "express";
import {
  db,
  serviceConnectionsTable,
  libraryItemsTable,
  libraryImportJobsTable,
  librarySyncJobsTable,
  recordingsTable,
  recordingReleaseGroupsTable,
  listEntriesTable,
  listsTable,
  listSourcesTable,
  resolutionCacheTable,
  spotifyLibraryItemsTable,
  spinsTable,
  stationsTable,
  showsTable,
  listensTable,
  pickersTable,
  type LibraryItemProvenance,
  type ImportBufferEntry,
} from "@workspace/db";
import { eq, and, or, isNotNull, isNull, inArray, ne, desc, asc, sql, like, gte } from "drizzle-orm";
import { getConnector } from "../../lore/serviceConnector.js";
import { normalizeKey, isrcKey } from "../../lore/resolve.js";
import { createMbResolver } from "@workspace/song-enrichment";
import { h } from "../../middlewares/asyncHandler.js";
import {
  buildExport,
  isExportFormat,
  EXPORT_CONTENT_TYPES,
  type LibraryExportRow,
  type ListenExportRow,
} from "../../lore/library-export.js";
import { parseLibraryImport } from "../../lore/library-import.js";
import { runSyncWorker, SYNC_ZOMBIE_AGE_MS } from "../../lore/library-sync.js";
import { type AuthedRequest, getFreshToken, sleep } from "./auth.js";
import { checkSpotifyLibraryContains } from "./spotify-library-check.js";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max library page size. */
const LIBRARY_PAGE_SIZE = 50;
/** Delay between resolveToMbid calls in the import worker (1.1 s ≥ MB 1 req/sec). */
const IMPORT_RESOLVE_DELAY_MS = 1100;
/** Hard cap per MB resolve call — prevents a single hanging network call from
 *  stalling the entire import indefinitely. Track is counted as unresolved. */
const IMPORT_RESOLVE_TIMEOUT_MS = 12_000;
/** Shortened per-track timeout used when MB is clearly struggling (consecutive
 *  errors ≥ threshold). Prevents the budget from being burned on 12 s timeouts
 *  during a sustained rate-limit period. */
const PHASE3_HIGH_ERROR_TIMEOUT_MS = 4_000;
/** Number of consecutive MB errors (503s, network failures) before Phase 3
 *  pauses and backs off. */
const PHASE3_503_THRESHOLD = 3;
/** Base backoff duration on first threshold breach (doubles each time, capped). */
const PHASE3_503_BACKOFF_BASE_MS = 30_000; // 30 s
/** Max backoff so a sustained MB outage never stalls the worker longer than this. */
const PHASE3_503_MAX_BACKOFF_MS = 5 * 60_000; // 5 min
/** Stamp partial total to DB every N items during the buffer-drain (fetching) phase. */
const FETCH_STAMP_INTERVAL = 50;
/** How often the off-peak Phase 3 retry scheduler wakes up to check for work. */
const PHASE3_RETRY_POLL_MS = 15 * 60_000; // 15 min
/** UTC hour range [start, end) during which the off-peak retry scheduler runs. */
const PHASE3_RETRY_OFF_PEAK_HOURS: [number, number] = [2, 6]; // 2–6 AM UTC
/** Max age of a completed import job eligible for off-peak retry. */
const PHASE3_RETRY_MAX_JOB_AGE_MS = 7 * 24 * 60 * 60_000; // 7 days
/** Number of consecutive failed retry passes (zero tracks resolved) before a
 *  source job is marked retry_exhausted and skipped in all future passes.
 *  Prevents un-resolvable tracks from spawning a new retry job every night
 *  when MusicBrainz is persistently degraded. */
const PHASE3_MAX_RETRY_ATTEMPTS = 3;
/** If the remaining window at the start of a retry pass is below this
 *  threshold (ms), a warning is logged so clock drift is visible in logs
 *  without causing a crash. */
const PHASE3_RETRY_MIN_WINDOW_WARN_MS = 60_000; // 60 s

const SPOTIFY_TRACK_API = "https://api.spotify.com/v1/tracks";
const ARTWORK_BATCH_SIZE = 50;
const ARTWORK_FETCH_TIMEOUT_MS = 20_000;
const ARTWORK_BATCH_GAP_MS = 200;

/** Cursor field separator for name-sorted library pages (see library GET). */
const LIB_CURSOR_SEP = "\u001f";

/** Hard cap on rows in one export file. */
const EXPORT_MAX_ROWS = 50_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Escape LIKE wildcards so user search text is matched literally. */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// ---------------------------------------------------------------------------
// Library import
// ---------------------------------------------------------------------------

/**
 * POST /api/me/library/import?service=spotify — kick off a background import.
 * Creates a `library_import_jobs` row and starts the worker asynchronously.
 */
router.post("/me/library/import", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  const service = typeof req.query["service"] === "string" ? req.query["service"].trim() : "";
  if (!service) return res.status(400).json({ error: "service query param is required" });

  const connector = getConnector(service);
  if (!connector) return res.status(400).json({ error: `Unknown service: ${service}` });

  const [conn] = await db
    .select()
    .from(serviceConnectionsTable)
    .where(
      and(
        eq(serviceConnectionsTable.userId, user.id),
        eq(serviceConnectionsTable.service, service),
      ),
    )
    .limit(1);

  if (!conn) {
    return res.status(400).json({ error: `No ${service} connection found; connect first.` });
  }

  // ── Spotify rate-limit gate ────────────────────────────────────────────────
  // If the most recent import for this user/service failed with a Spotify 429,
  // extract the Retry-After and reject immediately rather than starting a new
  // job that would fail at the same point and waste the rate-limit allowance.
  {
    const [rateLimitedJob] = await db
      .select({
        error: libraryImportJobsTable.error,
        finishedAt: libraryImportJobsTable.finishedAt,
      })
      .from(libraryImportJobsTable)
      .where(and(
        eq(libraryImportJobsTable.userId, user.id),
        eq(libraryImportJobsTable.service, service),
        eq(libraryImportJobsTable.status, "error"),
        like(libraryImportJobsTable.error, "%Retry-After:%"),
        gte(libraryImportJobsTable.startedAt, new Date(Date.now() - 48 * 60 * 60_000)),
      ))
      .orderBy(desc(libraryImportJobsTable.id))
      .limit(1);

    if (rateLimitedJob?.error && rateLimitedJob.finishedAt) {
      const match = rateLimitedJob.error.match(/Retry-After:\s*(\d+)/i);
      if (match) {
        const retryAfterSec = parseInt(match[1]!, 10);
        const unlockMs = rateLimitedJob.finishedAt.getTime() + retryAfterSec * 1000;
        const remainingMs = unlockMs - Date.now();
        if (remainingMs > 0) {
          const remainingMin = Math.ceil(remainingMs / 60_000);
          return res.status(429).json({
            error: `Spotify is still rate-limiting this account. Try again in ${remainingMin} minute${remainingMin === 1 ? "" : "s"}.`,
            retryAfterSec: Math.ceil(remainingMs / 1000),
          });
        }
      }
    }
  }

  // Reject if a job is already actively running or pending — triggering another
  // would fire two concurrent Spotify API pagination loops, almost guaranteeing
  // a 429 rate-limit error on both.
  //
  // Exception: if the existing job is older than ZOMBIE_AGE_MS it was almost
  // certainly orphaned by a server restart (the setImmediate worker died with
  // the process). Mark it failed and let the user start fresh.
  const ZOMBIE_AGE_MS = 30 * 60_000; // 30 minutes
  const [existingJob] = await db
    .select({
      id: libraryImportJobsTable.id,
      status: libraryImportJobsTable.status,
      startedAt: libraryImportJobsTable.startedAt,
    })
    .from(libraryImportJobsTable)
    .where(
      and(
        eq(libraryImportJobsTable.userId, user.id),
        eq(libraryImportJobsTable.service, service),
        inArray(libraryImportJobsTable.status, ["running", "pending"]),
      ),
    )
    .limit(1);

  if (existingJob) {
    const ageMs = Date.now() - existingJob.startedAt.getTime();
    if (ageMs > ZOMBIE_AGE_MS) {
      // Orphaned job — clear it so the user gets a fresh import.
      console.warn(`[me/import] job=${existingJob.id} orphaned (${Math.round(ageMs / 60_000)}m old) — resetting`);
      // NOTE: `phase` and `bufferJson` are intentionally NOT included in this
      // set. They must survive so that runImportWorker can find the ex-zombie
      // as `prevInterrupted` and resume the fetch from buffer.length rather
      // than re-fetching tracks that were already downloaded before the server
      // restart. Resetting phase/bufferJson here would silently break resume.
      await db
        .update(libraryImportJobsTable)
        .set({ status: "error", error: "Import interrupted (server restarted) — please try again", finishedAt: new Date() })
        .where(eq(libraryImportJobsTable.id, existingJob.id));
    } else {
      return res.status(409).json({
        jobId: existingJob.id,
        status: existingJob.status,
        error: "An import is already in progress — check its status before starting another.",
      });
    }
  }

  const [job] = await db
    .insert(libraryImportJobsTable)
    .values({
      userId: user.id,
      service,
      status: "pending",
      total: 0,
      resolved: 0,
      startedAt: new Date(),
    })
    .returning();

  // Kick the worker off the hot path.
  setImmediate(() => runImportWorker(job!.id, user.id, service, conn));

  return res.status(202).json({ jobId: job!.id, status: "pending" });
}));

/**
 * POST /api/me/library/import/file — synchronous `lore.library.v1` JSON import.
 * Round-trip contract: importing a Lore export reproduces the library exactly
 * (mbids, added_at, provenance verbatim). Existing items are skipped
 * idempotently; per-item failures are reported, never partial-silent.
 * Unknown mbids: when the file carries title+artist we seed the spine row
 * from that real exported data (background jobs enrich later); otherwise the
 * item is rejected with a reason — mirroring the honesty rule everywhere else.
 */
router.post(
  "/me/library/import/file",
  h(async (req, res) => {
    const user = (req as AuthedRequest).loreUser;
    const parsed = parseLibraryImport(req.body);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });

    const { items, itemErrors } = parsed;
    const errors: Array<{ index: number; reason: string }> = [...itemErrors];
    let imported = 0;
    let skipped = 0;

    if (items.length > 0) {
      // One query: which of the file's mbids are already on the spine, and
      // which are already in this user's library.
      const mbids = [...new Set(items.map((i) => i.mbid))];
      const known = new Set(
        (
          await db
            .select({ mbid: recordingsTable.mbid })
            .from(recordingsTable)
            .where(inArray(recordingsTable.mbid, mbids))
        ).map((r) => r.mbid),
      );
      const owned = new Set(
        (
          await db
            .select({ mbid: libraryItemsTable.mbid })
            .from(libraryItemsTable)
            .where(
              and(
                eq(libraryItemsTable.userId, user.id),
                inArray(libraryItemsTable.mbid, mbids),
              ),
            )
        ).map((r) => r.mbid),
      );

      const seenInFile = new Set<string>();
      for (const item of items) {
        const origIndex = item.sourceIndex;
        if (seenInFile.has(item.mbid)) {
          skipped++;
          continue;
        }
        seenInFile.add(item.mbid);

        if (owned.has(item.mbid)) {
          skipped++;
          continue;
        }

        // FK guard: recordings row must exist before library_items insert.
        if (!known.has(item.mbid)) {
          if (!item.title || !item.artist) {
            errors.push({
              index: origIndex,
              reason: "unknown mbid and no title/artist in file to seed it",
            });
            continue;
          }
          // Seed the spine row from the file's own exported data — real
          // values the user exported, never fabricated. Enrichment
          // (links, genres, ISRC check) converges via background jobs.
          await db
            .insert(recordingsTable)
            .values({
              mbid: item.mbid,
              title: item.title,
              artist: item.artist,
              ...(item.isrc ? { isrc: item.isrc } : {}),
              ...(item.releaseYear != null ? { releaseYear: item.releaseYear } : {}),
            })
            .onConflictDoNothing();
          known.add(item.mbid);
        }

        const inserted = await db
          .insert(libraryItemsTable)
          .values({
            userId: user.id,
            mbid: item.mbid,
            provenance: item.provenance,
            addedAt: item.addedAt,
          })
          .onConflictDoNothing()
          .returning({ id: libraryItemsTable.id });
        if (inserted.length > 0) imported++;
        else skipped++;
      }
    }

    return res.json({
      imported,
      skipped,
      rejected: errors.length,
      // Cap the error detail so a fully-malformed 50k file doesn't return MBs.
      errors: errors.slice(0, 50),
    });
  }),
);

/**
 * POST /api/me/library/import/manual — kick off a background import from a
 * user-supplied track list (CSV/paste).  No service connection required.
 * Body: { tracks: [{ artist: string; title: string }] }
 */
router.post("/me/library/import/manual", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;

  const raw = req.body?.tracks;
  if (!Array.isArray(raw) || raw.length === 0) {
    return res.status(400).json({ error: "tracks must be a non-empty array" });
  }
  if (raw.length > 10_000) {
    return res.status(400).json({ error: `Too many tracks (max 10,000; got ${raw.length})` });
  }

  const tracks: ImportBufferEntry[] = [];
  for (let i = 0; i < raw.length; i++) {
    const t = raw[i];
    if (typeof t?.artist !== "string" || !t.artist.trim()) {
      return res.status(400).json({ error: `Track ${i}: artist is required` });
    }
    if (typeof t?.title !== "string" || !t.title.trim()) {
      return res.status(400).json({ error: `Track ${i}: title is required` });
    }
    const artist = t.artist.trim();
    const title = t.title.trim();
    tracks.push({ artist, title, isrc: null, durationMs: null, externalId: `${artist}\u001f${title}` });
  }

  // Zombie guard — same pattern as Spotify import.
  const ZOMBIE_AGE_MS = 30 * 60_000;
  const [existingJob] = await db
    .select({ id: libraryImportJobsTable.id, status: libraryImportJobsTable.status, startedAt: libraryImportJobsTable.startedAt })
    .from(libraryImportJobsTable)
    .where(and(
      eq(libraryImportJobsTable.userId, user.id),
      eq(libraryImportJobsTable.service, "manual"),
      inArray(libraryImportJobsTable.status, ["running", "pending"]),
    ))
    .limit(1);

  if (existingJob) {
    const ageMs = Date.now() - existingJob.startedAt.getTime();
    if (ageMs > ZOMBIE_AGE_MS) {
      await db.update(libraryImportJobsTable)
        .set({ status: "error", error: "Import interrupted — please try again", finishedAt: new Date() })
        .where(eq(libraryImportJobsTable.id, existingJob.id));
    } else {
      return res.status(409).json({ jobId: existingJob.id, status: existingJob.status, error: "An import is already in progress." });
    }
  }

  const [job] = await db
    .insert(libraryImportJobsTable)
    .values({ userId: user.id, service: "manual", status: "pending", total: tracks.length, resolved: 0, startedAt: new Date() })
    .returning();

  setImmediate(() => runManualImportWorker(job!.id, user.id, tracks));
  return res.status(202).json({ jobId: job!.id, status: "pending" });
}));

/**
 * GET /api/me/library/import — return the most recent import job for the user,
 * or 404 if no jobs exist yet.  Used by the frontend to detect in-progress or
 * recently finished imports without needing to track a jobId across tabs.
 */
router.get("/me/library/import", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  const [job] = await db
    .select()
    .from(libraryImportJobsTable)
    .where(eq(libraryImportJobsTable.userId, user.id))
    .orderBy(desc(libraryImportJobsTable.startedAt))
    .limit(1);

  if (!job) return res.status(404).json({ error: "No import jobs found" });

  return res.json({
    jobId: job.id,
    service: job.service,
    status: job.status,
    phase: job.phase ?? null,
    total: job.total,
    resolved: job.resolved,
    startedAt: job.startedAt.toISOString(),
    finishedAt: job.finishedAt ? job.finishedAt.toISOString() : null,
    error: job.error ?? null,
    resumedFrom: job.resumedFrom ?? null,
    retryExhausted: job.retryExhausted ?? false,
  });
}));

/**
 * GET /api/me/library/import/:jobId — poll import progress.
 */
router.get("/me/library/import/:jobId", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  const rawJobId = req.params.jobId;
  const jobId = parseInt(typeof rawJobId === "string" ? rawJobId : "", 10);
  if (isNaN(jobId)) return res.status(400).json({ error: "Invalid jobId" });

  const [job] = await db
    .select()
    .from(libraryImportJobsTable)
    .where(
      and(
        eq(libraryImportJobsTable.id, jobId),
        eq(libraryImportJobsTable.userId, user.id),
      ),
    )
    .limit(1);

  if (!job) return res.status(404).json({ error: "Job not found" });

  return res.json({
    jobId: job.id,
    service: job.service,
    status: job.status,
    phase: job.phase ?? null,
    total: job.total,
    resolved: job.resolved,
    startedAt: job.startedAt.toISOString(),
    finishedAt: job.finishedAt ? job.finishedAt.toISOString() : null,
    error: job.error ?? null,
    resumedFrom: job.resumedFrom ?? null,
    retryExhausted: job.retryExhausted ?? false,
  });
}));

// ---------------------------------------------------------------------------
// Soft-row helper: batch-fetch Spotify track metadata and seed spotify_library_items
// ---------------------------------------------------------------------------

/**
 * For unresolved import buffer entries, fetch artwork/album/ISRC from the
 * Spotify GET /v1/tracks API (up to 50 per call) and upsert rows into
 * `spotify_library_items`.  Failures in any batch are silently skipped —
 * the row is still inserted without artwork rather than being dropped.
 *
 * Only called for service="spotify" imports.
 */
export async function seedSpotifySoftRows(
  userId: number,
  accessToken: string,
  entries: ImportBufferEntry[],
): Promise<void> {
  if (entries.length === 0) return;

  // Map spotifyId → { albumName, artworkUrl, isrc } from the Spotify API.
  const metaMap = new Map<string, { albumName: string | null; artworkUrl: string | null; isrc: string | null }>();

  // Only call the API for entries whose externalId looks like a real Spotify
  // track ID (22 alphanumeric chars). Synthesised fallback keys are skipped.
  const spotifyIdPattern = /^[A-Za-z0-9]{22}$/;
  const batchableEntries = entries.filter((t) => spotifyIdPattern.test(t.externalId));

  for (let i = 0; i < batchableEntries.length; i += ARTWORK_BATCH_SIZE) {
    const batch = batchableEntries.slice(i, i + ARTWORK_BATCH_SIZE);
    const ids = batch.map((t) => t.externalId).join(",");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ARTWORK_FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(`${SPOTIFY_TRACK_API}?ids=${ids}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: controller.signal,
      });
      if (res.ok) {
        const data = await res.json() as {
          tracks: Array<{
            id: string;
            album: { name: string; images: Array<{ url: string; height: number | null }> };
            external_ids?: { isrc?: string };
          } | null>;
        };
        for (const track of data.tracks ?? []) {
          if (!track) continue;
          // Prefer the 300 px image; fall back to the first available.
          const img =
            track.album.images.find((im) => im.height === 300) ??
            track.album.images[0];
          metaMap.set(track.id, {
            albumName: track.album.name ?? null,
            artworkUrl: img?.url ?? null,
            isrc: track.external_ids?.isrc ?? null,
          });
        }
      }
    } catch {
      // Network error or timeout — continue without artwork for this batch.
    } finally {
      clearTimeout(timer);
    }
    if (i + ARTWORK_BATCH_SIZE < batchableEntries.length) await sleep(ARTWORK_BATCH_GAP_MS);
  }

  // Upsert every unresolved entry into spotify_library_items.
  for (const t of entries) {
    const meta = metaMap.get(t.externalId);
    const isRealSpotifyId = spotifyIdPattern.test(t.externalId);

    // Guard: when the entry uses a synthesised key (not a real 22-char Spotify
    // track ID), skip inserting if a real-Spotify-ID row already exists for
    // the same user+artist+title.  The duplicate soft row would prevent the
    // artist+title fallback delete in the promotion step from targeting the
    // correct (real-ID) row, leaving a dangling soft row behind.
    if (!isRealSpotifyId && t.artist && t.title) {
      const [existingRealRow] = await db
        .select({ spotifyId: spotifyLibraryItemsTable.spotifyId })
        .from(spotifyLibraryItemsTable)
        .where(
          and(
            eq(spotifyLibraryItemsTable.userId, userId),
            eq(spotifyLibraryItemsTable.artist, t.artist),
            eq(spotifyLibraryItemsTable.title, t.title),
            // Real Spotify IDs are exactly 22 alphanumeric characters.
            // Synthesised fallback keys always contain a separator character
            // and are never 22 chars, so length is a reliable discriminator.
            sql`LENGTH(${spotifyLibraryItemsTable.spotifyId}) = 22`,
          ),
        )
        .limit(1);
      if (existingRealRow) {
        console.log(`[me/import] skipping synthesised-key soft row for "${t.title}" by "${t.artist}" — real Spotify ID row already exists`);
        continue;
      }
    }

    await db
      .insert(spotifyLibraryItemsTable)
      .values({
        userId,
        spotifyId: t.externalId,
        title: t.title,
        artist: t.artist,
        albumName: meta?.albumName ?? null,
        artworkUrl: meta?.artworkUrl ?? null,
        isrc: meta?.isrc ?? t.isrc ?? null,
        addedAt: new Date(),
        mbid: null,
      })
      .onConflictDoUpdate({
        target: [spotifyLibraryItemsTable.userId, spotifyLibraryItemsTable.spotifyId],
        set: {
          title: t.title,
          artist: t.artist,
          albumName: meta?.albumName ?? null,
          artworkUrl: meta?.artworkUrl ?? null,
          isrc: meta?.isrc ?? t.isrc ?? null,
        },
      })
      .catch(() => {}); // Silently skip FK or other errors.
  }

  console.log(`[me/import] seeded ${entries.length} soft rows into spotify_library_items`);
}

// ---------------------------------------------------------------------------
// Import worker (runs off the hot path via setImmediate)
// ---------------------------------------------------------------------------

export async function runImportWorker(
  jobId: number,
  userId: number,
  service: string,
  conn: typeof serviceConnectionsTable.$inferSelect,
): Promise<void> {
  try {
    console.log(`[me/import] job=${jobId} starting (service=${service})`);
    await db
      .update(libraryImportJobsTable)
      .set({ status: "running" })
      .where(eq(libraryImportJobsTable.id, jobId));

    console.log(`[me/import] job=${jobId} fetching token…`);
    const accessToken = await getFreshToken(conn);
    if (!accessToken) {
      await db
        .update(libraryImportJobsTable)
        .set({ status: "error", error: "Token refresh failed", finishedAt: new Date() })
        .where(eq(libraryImportJobsTable.id, jobId));
      return;
    }

    const connector = getConnector(service);
    if (!connector) throw new Error(`connector '${service}' not found`);

    // ── Buffer drain (or resume) ───────────────────────────────────────────────
    const BUFFER_MAX_AGE_MS = 24 * 60 * 60_000; // 24 h

    // Path 1: look for a recent job that completed the fetch but crashed during
    // resolution.  Its bufferJson is the full library snapshot — no re-fetch needed.
    const [prevWithBuffer] = await db
      .select({
        id: libraryImportJobsTable.id,
        bufferJson: libraryImportJobsTable.bufferJson,
      })
      .from(libraryImportJobsTable)
      .where(and(
        eq(libraryImportJobsTable.userId, userId),
        eq(libraryImportJobsTable.service, service),
        ne(libraryImportJobsTable.id, jobId),
        eq(libraryImportJobsTable.status, "error"),
        inArray(libraryImportJobsTable.phase, ["spine", "cache", "resolve"]),
        isNotNull(libraryImportJobsTable.bufferJson),
        gte(libraryImportJobsTable.startedAt, new Date(Date.now() - BUFFER_MAX_AGE_MS)),
      ))
      .orderBy(desc(libraryImportJobsTable.id))
      .limit(1);

    // Path 2: look for a job interrupted mid-fetch (partial buffer).
    const [prevInterrupted] = prevWithBuffer
      ? [undefined] // skip the second query — Path 1 takes priority
      : await db
          .select({
            id: libraryImportJobsTable.id,
            bufferJson: libraryImportJobsTable.bufferJson,
          })
          .from(libraryImportJobsTable)
          .where(and(
            eq(libraryImportJobsTable.userId, userId),
            eq(libraryImportJobsTable.service, service),
            ne(libraryImportJobsTable.id, jobId),
            eq(libraryImportJobsTable.phase, "fetching"),
            isNotNull(libraryImportJobsTable.bufferJson),
            gte(libraryImportJobsTable.startedAt, new Date(Date.now() - BUFFER_MAX_AGE_MS)),
          ))
          .orderBy(desc(libraryImportJobsTable.id))
          .limit(1);

    let buffer: ImportBufferEntry[];

    if (prevWithBuffer?.bufferJson?.length) {
      // ── Path 1: skip Spotify fetch — drain the complete stored buffer ──────
      buffer = [...prevWithBuffer.bufferJson];
      console.log(
        `[me/import] job=${jobId} skipping Spotify fetch — using complete buffer` +
        ` from job=${prevWithBuffer.id} (${buffer.length} tracks)`,
      );
      await db
        .update(libraryImportJobsTable)
        .set({ phase: "spine", total: buffer.length, bufferJson: buffer, resumedFrom: prevWithBuffer.id })
        .where(eq(libraryImportJobsTable.id, jobId));
    } else {
      // ── Path 2 / fresh: fetch from Spotify (optionally resumed) ───────────
      const partialBuf = prevInterrupted?.bufferJson ?? [];
      buffer = [...partialBuf];
      const startOffset = buffer.length;
      if (startOffset > 0) {
        console.log(
          `[me/import] job=${jobId} resuming Spotify fetch from offset ${startOffset}` +
          ` (${buffer.length} tracks already buffered from interrupted job=${prevInterrupted!.id})`,
        );
      }

      await db
        .update(libraryImportJobsTable)
        .set({ phase: "fetching", total: startOffset })
        .where(eq(libraryImportJobsTable.id, jobId));

      let lastFetchStamp = startOffset;
      for await (const raw of connector.importLibrary(accessToken, startOffset)) {
        buffer.push({
          artist: raw.artist,
          title: raw.title,
          isrc: raw.isrc ?? null,
          durationMs: raw.durationMs ?? null,
          externalId: raw.externalId ?? `${raw.artist}\u001f${raw.title}`,
        });
        if (buffer.length - lastFetchStamp >= FETCH_STAMP_INTERVAL) {
          lastFetchStamp = buffer.length;
          await db
            .update(libraryImportJobsTable)
            .set({ total: buffer.length, bufferJson: buffer })
            .where(eq(libraryImportJobsTable.id, jobId));
        }
      }

      // Fetch complete — persist final buffer and advance phase.
      await db
        .update(libraryImportJobsTable)
        .set({ total: buffer.length, phase: "spine", bufferJson: buffer })
        .where(eq(libraryImportJobsTable.id, jobId));
    }

    const total = buffer.length;
    let resolved = 0;

    const provenance: LibraryItemProvenance = { kind: "import", service };

    const matchedIdx = new Set<number>();
    const resolvedMbidIdx = new Set<number>();

    // ── Phase 1: ISRC bulk pre-match against recordings ───────────────────────
    const isrcEntries = buffer
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => Boolean(t.isrc));

    if (isrcEntries.length > 0) {
      const uniqueIsrcs = [...new Set(isrcEntries.map(({ t }) => t.isrc!))];
      const isrcMatches = await db
        .select({ mbid: recordingsTable.mbid, isrc: recordingsTable.isrc })
        .from(recordingsTable)
        .where(inArray(recordingsTable.isrc, uniqueIsrcs));
      const isrcToMbid = new Map(isrcMatches.map((r) => [r.isrc!, r.mbid]));

      for (const { t, i } of isrcEntries) {
        const mbid = isrcToMbid.get(t.isrc!);
        if (mbid) {
          try {
            await db
              .insert(libraryItemsTable)
              .values({ userId, mbid, provenance, addedAt: new Date() })
              .onConflictDoNothing();
            resolved++;
          } catch (insertErr) {
            const pgCode = (insertErr as { code?: string }).code;
            if (pgCode !== "23503") throw insertErr;
            console.warn(
              `[me/import] Phase 1 FK violation for mbid=${mbid} isrc=${t.isrc} — ` +
              `recordings row gone between lookup and insert; excluding from soft rows`,
            );
          }
          matchedIdx.add(i);
          resolvedMbidIdx.add(i);
        }
      }

      await db
        .update(libraryImportJobsTable)
        .set({ total, resolved })
        .where(eq(libraryImportJobsTable.id, jobId));
    }

    // ── Phase 2: resolution-cache bulk pre-check ──────────────────────────────
    await db
      .update(libraryImportJobsTable)
      .set({ phase: "cache" })
      .where(eq(libraryImportJobsTable.id, jobId));

    const phase2Entries = buffer
      .map((t, i) => ({ t, i }))
      .filter(({ i }) => !matchedIdx.has(i));

    if (phase2Entries.length > 0) {
      const keySet = new Set<string>();
      const keyToIndices = new Map<string, number[]>();
      const addKey = (k: string, i: number) => {
        keySet.add(k);
        const arr = keyToIndices.get(k) ?? [];
        arr.push(i);
        keyToIndices.set(k, arr);
      };

      for (const { t, i } of phase2Entries) {
        if (t.isrc) addKey(isrcKey(t.isrc), i);
        addKey(normalizeKey(t.artist, t.title), i);
      }

      const allKeys = [...keySet];
      const cacheRows = await db
        .select({ key: resolutionCacheTable.key, mbid: resolutionCacheTable.mbid })
        .from(resolutionCacheTable)
        .where(inArray(resolutionCacheTable.key, allKeys));
      const cacheMap = new Map(cacheRows.map((r) => [r.key, r.mbid]));

      const indexToMbid = new Map<number, string>();
      for (const { t, i } of phase2Entries) {
        if (indexToMbid.has(i) || matchedIdx.has(i)) continue;
        if (t.isrc) {
          const hit = cacheMap.get(isrcKey(t.isrc));
          if (hit) { indexToMbid.set(i, hit); continue; }
          if (hit === null) { matchedIdx.add(i); continue; }
        }
        const hit = cacheMap.get(normalizeKey(t.artist, t.title));
        if (hit) { indexToMbid.set(i, hit); continue; }
        if (hit === null) matchedIdx.add(i);
      }

      if (indexToMbid.size > 0) {
        const idxToTrack = new Map(phase2Entries.map(({ t, i }) => [i, t]));

        for (const [idx, mbid] of indexToMbid) {
          const track = idxToTrack.get(idx);
          if (track) {
            await db
              .insert(recordingsTable)
              .values({
                mbid,
                title: track.title,
                artist: track.artist,
                ...(track.isrc ? { isrc: track.isrc } : {}),
              })
              .onConflictDoNothing();
          }
          try {
            await db
              .insert(libraryItemsTable)
              .values({ userId, mbid, provenance, addedAt: new Date() })
              .onConflictDoNothing();
            resolved++;
          } catch (insertErr) {
            const pgCode = (insertErr as { code?: string }).code;
            if (pgCode !== "23503") throw insertErr;
            console.warn(
              `[me/import] Phase 2 FK violation for mbid=${mbid} — ` +
              `recordings row gone between cache lookup and insert; excluding from soft rows`,
            );
          }
          matchedIdx.add(idx);
          resolvedMbidIdx.add(idx);
        }
      }

      await db
        .update(libraryImportJobsTable)
        .set({ total, resolved })
        .where(eq(libraryImportJobsTable.id, jobId));
    }

    // ── Phase 3: serial MB resolution for true misses ─────────────────────────
    const phase3Entries = buffer
      .map((t, i) => ({ t, i }))
      .filter(({ i }) => !matchedIdx.has(i));

    await db
      .update(libraryImportJobsTable)
      .set({ phase: "resolve", total, resolved })
      .where(eq(libraryImportJobsTable.id, jobId));

    const mbResolver = createMbResolver();
    const PHASE3_BUDGET_MS = 90 * 60_000; // 90 minutes
    const phase3StartMs = Date.now();

    let consecutiveErrors = 0;
    let currentBackoffMs = PHASE3_503_BACKOFF_BASE_MS;
    let mbDegraded = false;

    for (const { t, i } of phase3Entries) {
      if (Date.now() - phase3StartMs > PHASE3_BUDGET_MS) {
        console.warn(
          `[me/import] Phase 3 budget (${PHASE3_BUDGET_MS / 1000}s) exceeded — ` +
            `marking import done with ${resolved}/${total} resolved`,
        );
        break;
      }

      const resolveTimeoutMs = mbDegraded
        ? PHASE3_HIGH_ERROR_TIMEOUT_MS
        : IMPORT_RESOLVE_TIMEOUT_MS;

      const controller = new AbortController();
      const timer = setTimeout(() => {
        console.warn(`[me/import] resolve timeout for "${t.title}" by "${t.artist}" — skipping`);
        controller.abort();
      }, resolveTimeoutMs);

      let mbid: string | null = null;
      let resolveErrored = false;
      try {
        if (t.isrc) {
          mbid = await mbResolver.resolveByIsrc(t.isrc, controller.signal);
        }
        if (!mbid && !controller.signal.aborted) {
          mbid = await mbResolver.resolveByText(t.artist, t.title, controller.signal);
        }
        if (!controller.signal.aborted) {
          consecutiveErrors = 0;
          mbDegraded = false;
        }
      } catch {
        resolveErrored = true;
        consecutiveErrors++;
      } finally {
        clearTimeout(timer);
      }

      if (consecutiveErrors >= PHASE3_503_THRESHOLD) {
        mbDegraded = true;
        console.warn(
          `[me/import] job=${jobId} Phase 3 — ${consecutiveErrors} consecutive MB errors, ` +
          `pausing ${currentBackoffMs / 1000}s before continuing`,
        );
        await db
          .update(libraryImportJobsTable)
          .set({ total, resolved, error: "resolve:backoff" })
          .where(eq(libraryImportJobsTable.id, jobId));
        await sleep(currentBackoffMs);
        await db
          .update(libraryImportJobsTable)
          .set({ total, resolved, error: null })
          .where(eq(libraryImportJobsTable.id, jobId));
        currentBackoffMs = Math.min(currentBackoffMs * 2, PHASE3_503_MAX_BACKOFF_MS);
        consecutiveErrors = 0;
      }

      if (mbid) {
        await db
          .insert(recordingsTable)
          .values({
            mbid,
            title: t.title,
            artist: t.artist,
            ...(t.isrc ? { isrc: t.isrc } : {}),
          })
          .onConflictDoNothing();

        try {
          await db
            .insert(libraryItemsTable)
            .values({ userId, mbid, provenance, addedAt: new Date() })
            .onConflictDoNothing();
          resolved++;
        } catch (insertErr) {
          const pgCode = (insertErr as { code?: string }).code;
          if (pgCode !== "23503") throw insertErr;
          console.warn(
            `[me/import] Phase 3 FK violation for mbid=${mbid} — ` +
            `recordings row gone between MB resolve and insert; excluding from soft rows`,
          );
        }
        await db
          .insert(resolutionCacheTable)
          .values([
            ...(t.isrc ? [{ key: isrcKey(t.isrc), mbid }] : []),
            { key: normalizeKey(t.artist, t.title), mbid },
          ])
          .onConflictDoNothing()
          .catch(() => {});
        matchedIdx.add(i);
        resolvedMbidIdx.add(i);
      } else if (!controller.signal.aborted && !resolveErrored) {
        await db
          .insert(resolutionCacheTable)
          .values([
            ...(t.isrc ? [{ key: isrcKey(t.isrc), mbid: null }] : []),
            { key: normalizeKey(t.artist, t.title), mbid: null },
          ])
          .onConflictDoNothing()
          .catch(() => {});
      }

      if (!controller.signal.aborted) {
        await sleep(IMPORT_RESOLVE_DELAY_MS);
      }

      await db
        .update(libraryImportJobsTable)
        .set({ total, resolved })
        .where(eq(libraryImportJobsTable.id, jobId));
    }

    // ── Seed soft rows for unresolved tracks (Spotify only) ─────────────────
    if (service === "spotify") {
      const unresolvedEntries = buffer
        .map((t, i) => ({ t, i }))
        .filter(({ i }) => !resolvedMbidIdx.has(i))
        .map(({ t }) => t);
      if (unresolvedEntries.length > 0) {
        console.log(
          `[me/import] job=${jobId} seeding ${unresolvedEntries.length} unresolved tracks as soft rows`,
        );
        const softToken = await getFreshToken(conn);
        await seedSpotifySoftRows(userId, softToken ?? "", unresolvedEntries);
      }
    }

    // Update service_connections.lastImportAt.
    await db
      .update(serviceConnectionsTable)
      .set({ lastImportAt: new Date() })
      .where(eq(serviceConnectionsTable.id, conn.id));

    await db
      .update(libraryImportJobsTable)
      .set({ status: "done", total, resolved, finishedAt: new Date() })
      .where(eq(libraryImportJobsTable.id, jobId));

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[me] import worker job=${jobId} failed`, err);
    await db
      .update(libraryImportJobsTable)
      .set({ status: "error", error: message.slice(0, 500), finishedAt: new Date() })
      .where(eq(libraryImportJobsTable.id, jobId))
      .catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Manual import worker (no service connection, no soft rows)
// ---------------------------------------------------------------------------

/**
 * Resolves a user-supplied track list against the MusicBrainz spine.
 * Runs Phases 2 (cache) and 3 (MB text) only — no Spotify fetch, no soft rows.
 */
export async function runManualImportWorker(
  jobId: number,
  userId: number,
  buffer: ImportBufferEntry[],
): Promise<void> {
  try {
    console.log(`[me/import:manual] job=${jobId} starting (${buffer.length} tracks)`);
    await db.update(libraryImportJobsTable)
      .set({ status: "running", phase: "spine", total: buffer.length, bufferJson: buffer })
      .where(eq(libraryImportJobsTable.id, jobId));

    const total = buffer.length;
    let resolved = 0;
    const matchedIdx = new Set<number>();
    const provenance: LibraryItemProvenance = { kind: "import", service: "manual" };

    // ── Phase 2: resolution-cache bulk pre-check ──────────────────────────
    await db.update(libraryImportJobsTable)
      .set({ phase: "cache" })
      .where(eq(libraryImportJobsTable.id, jobId));

    const keySet = new Set<string>();
    const keyToIndices = new Map<string, number[]>();
    for (let i = 0; i < buffer.length; i++) {
      const t = buffer[i]!;
      const k = normalizeKey(t.artist, t.title);
      keySet.add(k);
      const arr = keyToIndices.get(k) ?? [];
      arr.push(i);
      keyToIndices.set(k, arr);
    }

    if (keySet.size > 0) {
      const cacheRows = await db
        .select({ key: resolutionCacheTable.key, mbid: resolutionCacheTable.mbid })
        .from(resolutionCacheTable)
        .where(inArray(resolutionCacheTable.key, [...keySet]));
      const cacheMap = new Map(cacheRows.map((r) => [r.key, r.mbid]));

      const indexToMbid = new Map<number, string>();
      for (let i = 0; i < buffer.length; i++) {
        if (matchedIdx.has(i)) continue;
        const t = buffer[i]!;
        const hit = cacheMap.get(normalizeKey(t.artist, t.title));
        if (hit) { indexToMbid.set(i, hit); continue; }
        if (hit === null) matchedIdx.add(i);
      }

      for (const [idx, mbid] of indexToMbid) {
        const t = buffer[idx]!;
        await db.insert(recordingsTable)
          .values({ mbid, title: t.title, artist: t.artist })
          .onConflictDoNothing();
        try {
          await db.insert(libraryItemsTable)
            .values({ userId, mbid, provenance, addedAt: new Date() })
            .onConflictDoNothing();
          resolved++;
        } catch (e) {
          const pgCode = (e as { code?: string }).code;
          if (pgCode !== "23503") throw e;
          console.warn(`[me/import:manual] Phase 2 FK violation mbid=${mbid}`);
        }
        matchedIdx.add(idx);
      }

      await db.update(libraryImportJobsTable)
        .set({ total, resolved })
        .where(eq(libraryImportJobsTable.id, jobId));
    }

    // ── Phase 3: serial MB text resolution ───────────────────────────────
    const phase3Entries = buffer
      .map((t, i) => ({ t, i }))
      .filter(({ i }) => !matchedIdx.has(i));

    await db.update(libraryImportJobsTable)
      .set({ phase: "resolve", total, resolved })
      .where(eq(libraryImportJobsTable.id, jobId));

    const mbResolver = createMbResolver();
    const PHASE3_BUDGET_MS = 90 * 60_000;
    const phase3StartMs = Date.now();
    let consecutiveErrors = 0;
    let currentBackoffMs = PHASE3_503_BACKOFF_BASE_MS;
    let mbDegraded = false;

    for (const { t, i } of phase3Entries) {
      if (Date.now() - phase3StartMs > PHASE3_BUDGET_MS) {
        console.warn(`[me/import:manual] job=${jobId} Phase 3 budget exceeded — ${resolved}/${total} resolved`);
        break;
      }

      const resolveTimeoutMs = mbDegraded ? PHASE3_HIGH_ERROR_TIMEOUT_MS : IMPORT_RESOLVE_TIMEOUT_MS;
      const controller = new AbortController();
      const timer = setTimeout(() => {
        console.warn(`[me/import:manual] resolve timeout for "${t.title}" by "${t.artist}"`);
        controller.abort();
      }, resolveTimeoutMs);

      let mbid: string | null = null;
      let resolveErrored = false;
      try {
        mbid = await mbResolver.resolveByText(t.artist, t.title, controller.signal);
        if (!controller.signal.aborted) { consecutiveErrors = 0; mbDegraded = false; }
      } catch {
        resolveErrored = true;
        consecutiveErrors++;
      } finally {
        clearTimeout(timer);
      }

      if (consecutiveErrors >= PHASE3_503_THRESHOLD) {
        mbDegraded = true;
        console.warn(`[me/import:manual] job=${jobId} ${consecutiveErrors} consecutive MB errors, pausing ${currentBackoffMs / 1000}s`);
        await db.update(libraryImportJobsTable)
          .set({ total, resolved, error: "resolve:backoff" })
          .where(eq(libraryImportJobsTable.id, jobId));
        await sleep(currentBackoffMs);
        await db.update(libraryImportJobsTable)
          .set({ total, resolved, error: null })
          .where(eq(libraryImportJobsTable.id, jobId));
        currentBackoffMs = Math.min(currentBackoffMs * 2, PHASE3_503_MAX_BACKOFF_MS);
        consecutiveErrors = 0;
      }

      if (mbid) {
        await db.insert(recordingsTable)
          .values({ mbid, title: t.title, artist: t.artist })
          .onConflictDoNothing();
        try {
          await db.insert(libraryItemsTable)
            .values({ userId, mbid, provenance, addedAt: new Date() })
            .onConflictDoNothing();
          resolved++;
        } catch (e) {
          const pgCode = (e as { code?: string }).code;
          if (pgCode !== "23503") throw e;
          console.warn(`[me/import:manual] Phase 3 FK violation mbid=${mbid}`);
        }
        await db.insert(resolutionCacheTable)
          .values([{ key: normalizeKey(t.artist, t.title), mbid }])
          .onConflictDoNothing()
          .catch(() => {});
      } else if (!controller.signal.aborted && !resolveErrored) {
        await db.insert(resolutionCacheTable)
          .values([{ key: normalizeKey(t.artist, t.title), mbid: null }])
          .onConflictDoNothing()
          .catch(() => {});
      }

      if (!controller.signal.aborted) await sleep(IMPORT_RESOLVE_DELAY_MS);

      await db.update(libraryImportJobsTable)
        .set({ total, resolved })
        .where(eq(libraryImportJobsTable.id, jobId));
    }

    await db.update(libraryImportJobsTable)
      .set({ status: "done", total, resolved, finishedAt: new Date() })
      .where(eq(libraryImportJobsTable.id, jobId));
    console.log(`[me/import:manual] job=${jobId} done — ${resolved}/${total} resolved`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[me/import:manual] worker job=${jobId} failed`, err);
    await db.update(libraryImportJobsTable)
      .set({ status: "error", error: message.slice(0, 500), finishedAt: new Date() })
      .where(eq(libraryImportJobsTable.id, jobId))
      .catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Off-peak Phase 3 retry scheduler
// ---------------------------------------------------------------------------

/**
 * Runs once: finds completed import jobs where MB resolved fewer tracks than
 * fetched (total > resolved) and there are still un-cached entries.
 * Called from `startPhase3RetryScheduler` during off-peak hours only.
 */
export async function runPhase3RetryPass(deadline?: Date, _testUserIds?: number[]): Promise<void> {
  const cutoff = new Date(Date.now() - PHASE3_RETRY_MAX_JOB_AGE_MS);

  const candidates = await db
    .select({
      id: libraryImportJobsTable.id,
      userId: libraryImportJobsTable.userId,
      service: libraryImportJobsTable.service,
      total: libraryImportJobsTable.total,
      resolved: libraryImportJobsTable.resolved,
      bufferJson: libraryImportJobsTable.bufferJson,
      retryAttempts: libraryImportJobsTable.retryAttempts,
    })
    .from(libraryImportJobsTable)
    .where(
      and(
        eq(libraryImportJobsTable.status, "done"),
        eq(libraryImportJobsTable.retryExhausted, false),
        isNotNull(libraryImportJobsTable.bufferJson),
        sql`COALESCE(${libraryImportJobsTable.finishedAt}, ${libraryImportJobsTable.startedAt}) >= ${cutoff}`,
        sql`${libraryImportJobsTable.total} > ${libraryImportJobsTable.resolved}`,
        ...(_testUserIds && _testUserIds.length > 0
          ? [inArray(libraryImportJobsTable.userId, _testUserIds)]
          : []),
      ),
    )
    .orderBy(desc(libraryImportJobsTable.id))
    .limit(100);

  const seen = new Set<string>();
  const dedupedCandidates = candidates.filter((c) => {
    const k = `${c.userId}:${c.service}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  if (dedupedCandidates.length === 0) return;

  // Warn early if clock drift has already eaten most of the window so ops
  // teams can see it in logs without needing to wait for a crash.
  if (deadline) {
    const windowRemainingMs = Math.max(0, deadline.getTime() - Date.now());
    if (windowRemainingMs < PHASE3_RETRY_MIN_WINDOW_WARN_MS) {
      console.warn(
        `[me/import/retry] clock drift warning: only ${windowRemainingMs}ms remaining ` +
        `at pass start (expected ≥ ${PHASE3_RETRY_MIN_WINDOW_WARN_MS}ms) — ` +
        `candidates may be skipped due to a narrowed window`,
      );
    }
  }

  console.log(
    `[me/import/retry] off-peak pass: ${dedupedCandidates.length} candidate job(s) to check`,
  );

  let processedCount = 0;
  for (const candidate of dedupedCandidates) {
    if (deadline && Date.now() >= deadline.getTime()) {
      console.warn(
        `[me/import/retry] window deadline reached — stopping pass early ` +
        `(${processedCount} of ${dedupedCandidates.length} candidate(s) processed)`,
      );
      break;
    }

    const buffer = candidate.bufferJson;
    if (!buffer || buffer.length === 0) continue;

    const keySet = new Set<string>();
    for (const t of buffer) {
      if (t.isrc) keySet.add(isrcKey(t.isrc));
      keySet.add(normalizeKey(t.artist, t.title));
    }
    const allKeys = [...keySet];
    const cachedRows = await db
      .select({ key: resolutionCacheTable.key })
      .from(resolutionCacheTable)
      .where(inArray(resolutionCacheTable.key, allKeys));
    const cachedKeySet = new Set(cachedRows.map((r) => r.key));

    const uncachedEntries = buffer.filter((t) => {
      const hasIsrcCached = t.isrc ? cachedKeySet.has(isrcKey(t.isrc)) : false;
      const hasTextCached = cachedKeySet.has(normalizeKey(t.artist, t.title));
      return !hasIsrcCached && !hasTextCached;
    });

    if (uncachedEntries.length === 0) {
      console.log(
        `[me/import/retry] job=${candidate.id} user=${candidate.userId} — no un-cached tracks, skipping`,
      );
      continue;
    }

    // Cross-check against the newest completed import snapshot for this
    // user+service.  If a newer import ran after the source job and its buffer
    // does not contain a track, the user removed that track from Spotify since
    // the original import — skip re-insertion to avoid ghost-restoring a
    // deliberate removal.
    let entriesToRetry = uncachedEntries;
    const [newerSnapshot] = await db
      .select({
        id: libraryImportJobsTable.id,
        bufferJson: libraryImportJobsTable.bufferJson,
      })
      .from(libraryImportJobsTable)
      .where(
        and(
          eq(libraryImportJobsTable.userId, candidate.userId),
          eq(libraryImportJobsTable.service, candidate.service),
          eq(libraryImportJobsTable.status, "done"),
          isNotNull(libraryImportJobsTable.bufferJson),
          sql`${libraryImportJobsTable.id} > ${candidate.id}`,
        ),
      )
      .orderBy(desc(libraryImportJobsTable.id))
      .limit(1);

    if (newerSnapshot) {
      // Apply unconditionally — an empty snapshot (user removed all tracks) is
      // as authoritative as a non-empty one; both should filter out tracks that
      // no longer appear in the user's Spotify library.
      const snapshotIds = new Set((newerSnapshot.bufferJson ?? []).map((t) => t.externalId));
      const before = entriesToRetry.length;
      entriesToRetry = entriesToRetry.filter((t) => snapshotIds.has(t.externalId));
      const skipped = before - entriesToRetry.length;
      if (skipped > 0) {
        console.log(
          `[me/import/retry] job=${candidate.id} user=${candidate.userId} — ` +
          `skipping ${skipped} track(s) absent from newer snapshot (job=${newerSnapshot.id})`,
        );
      }
    } else {
      // No newer completed import snapshot exists — live-check the Spotify API
      // to confirm each candidate with a real Spotify ID is still in the user's
      // library before re-inserting it.
      //
      // Entries with a synthetic externalId (not a 22-char alphanumeric Spotify
      // track ID) cannot be verified via the API and pass through unchanged.
      //
      // Fail safe: if the connection is missing, the token is stale, or the API
      // errors, skip this candidate entirely rather than risking ghost-restoring
      // a deliberate removal.
      if (candidate.service === "spotify") {
        const spotifyIdPattern = /^[A-Za-z0-9]{22}$/;
        const realIdEntries    = entriesToRetry.filter((t) =>  spotifyIdPattern.test(t.externalId));
        const syntheticEntries = entriesToRetry.filter((t) => !spotifyIdPattern.test(t.externalId));

        // Only hit the API when there are real Spotify IDs to verify.
        // Synthetic-key-only candidates pass through without a token lookup.
        if (realIdEntries.length > 0) {
          const [conn] = await db
            .select()
            .from(serviceConnectionsTable)
            .where(
              and(
                eq(serviceConnectionsTable.userId, candidate.userId),
                eq(serviceConnectionsTable.service, candidate.service),
              ),
            )
            .limit(1);

          if (!conn) {
            console.warn(
              `[me/import/retry] job=${candidate.id} user=${candidate.userId} — ` +
              `no Spotify connection found; skipping (no snapshot, cannot verify library)`,
            );
            continue;
          }

          const checkResult = await checkSpotifyLibraryContains(
            conn,
            realIdEntries.map((t) => t.externalId),
          );

          if (!checkResult.ok) {
            console.warn(
              `[me/import/retry] job=${candidate.id} user=${candidate.userId} — ` +
              `Spotify contains check failed (reason: ${checkResult.reason}); skipping candidate`,
            );
            continue;
          }

          const savedIds = checkResult.savedIds;
          // Confirmed entries: real IDs still saved in Spotify + synthetic-key
          // entries (no checkable Spotify ID — passed through unchanged).
          const before = entriesToRetry.length;
          entriesToRetry = [
            ...realIdEntries.filter((t) => savedIds.has(t.externalId)),
            ...syntheticEntries,
          ];
          const skipped = before - entriesToRetry.length;
          if (skipped > 0) {
            console.log(
              `[me/import/retry] job=${candidate.id} user=${candidate.userId} — ` +
              `skipping ${skipped} track(s) absent from Spotify library (live check, no snapshot)`,
            );
          }
        }
      }
    }

    if (entriesToRetry.length === 0) {
      console.log(
        `[me/import/retry] job=${candidate.id} user=${candidate.userId} — ` +
        `all un-cached tracks filtered by newer snapshot, skipping`,
      );
      continue;
    }

    // Window cap: applied AFTER snapshot/Spotify filtering so we always
    // select from the set of valid, still-present tracks.  Slicing before
    // filtering could stall the buffer indefinitely if the front slice is
    // entirely filtered out (e.g. those tracks were removed from Spotify)
    // while valid entries deeper in the buffer are never reached.
    //
    // Each nightly pass resolves as many valid tracks as the window allows;
    // the next pass picks up where the cache left off (resolved entries are
    // now cached and are excluded from uncachedEntries on the next run).
    if (deadline) {
      const remainingMs = Math.max(0, deadline.getTime() - Date.now());
      const estimatedMs = entriesToRetry.length * IMPORT_RESOLVE_DELAY_MS;
      if (estimatedMs > remainingMs) {
        const maxFit = Math.floor(remainingMs / IMPORT_RESOLVE_DELAY_MS);
        if (maxFit < 1) {
          // Window is too small for even one valid track.  Defer to next
          // night without counting this as a failed retry attempt.
          console.warn(
            `[me/import/retry] job=${candidate.id} user=${candidate.userId} — ` +
            `window too small for even one entry (${remainingMs}ms remaining); deferring`,
          );
          continue;
        }
        // Process only the first maxFit valid entries this pass.
        console.warn(
          `[me/import/retry] job=${candidate.id} user=${candidate.userId} — ` +
          `buffer too large for one pass (${entriesToRetry.length} valid entries, ` +
          `${remainingMs}ms remaining); slicing to ${maxFit} for this pass`,
        );
        entriesToRetry = entriesToRetry.slice(0, maxFit);
      }
    }

    console.log(
      `[me/import/retry] job=${candidate.id} user=${candidate.userId} — ` +
      `retrying ${entriesToRetry.length} un-cached track(s)`,
    );

    const [activeJob] = await db
      .select({ id: libraryImportJobsTable.id })
      .from(libraryImportJobsTable)
      .where(
        and(
          eq(libraryImportJobsTable.userId, candidate.userId),
          eq(libraryImportJobsTable.service, candidate.service),
          inArray(libraryImportJobsTable.status, ["running", "pending"]),
        ),
      )
      .limit(1);
    if (activeJob) {
      console.log(
        `[me/import/retry] skipping user=${candidate.userId} — job=${activeJob.id} already running`,
      );
      continue;
    }

    const [retryJob] = await db
      .insert(libraryImportJobsTable)
      .values({
        userId: candidate.userId,
        service: candidate.service,
        status: "running",
        phase: "resolve",
        total: entriesToRetry.length,
        resolved: 0,
        startedAt: new Date(),
      })
      .returning();

    if (!retryJob) continue;

    const retryJobId = retryJob.id;
    const provenance: LibraryItemProvenance = { kind: "import", service: candidate.service };
    let retryResolved = 0;
    let retryPassFailed = false;

    try {
      const mbResolver = createMbResolver();
      const RETRY_BUDGET_MS = 30 * 60_000; // 30-minute budget per retry pass
      const retryStartMs = Date.now();

      let consecutiveErrors = 0;
      let currentBackoffMs = PHASE3_503_BACKOFF_BASE_MS;
      let mbDegraded = false;

      for (const t of entriesToRetry) {
        if (Date.now() - retryStartMs > RETRY_BUDGET_MS) {
          console.warn(
            `[me/import/retry] job=${retryJobId} 30-minute budget exceeded — ` +
            `resolved ${retryResolved}/${entriesToRetry.length}`,
          );
          break;
        }
        if (deadline && Date.now() >= deadline.getTime()) {
          console.warn(
            `[me/import/retry] job=${retryJobId} window deadline reached — ` +
            `stopping track loop (resolved ${retryResolved}/${entriesToRetry.length})`,
          );
          break;
        }

        const resolveTimeoutMs = mbDegraded
          ? PHASE3_HIGH_ERROR_TIMEOUT_MS
          : IMPORT_RESOLVE_TIMEOUT_MS;

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), resolveTimeoutMs);

        let mbid: string | null = null;
        let resolveErrored = false;
        try {
          if (t.isrc) {
            mbid = await mbResolver.resolveByIsrc(t.isrc, controller.signal);
          }
          if (!mbid && !controller.signal.aborted) {
            mbid = await mbResolver.resolveByText(t.artist, t.title, controller.signal);
          }
          if (!controller.signal.aborted) {
            consecutiveErrors = 0;
            mbDegraded = false;
          }
        } catch {
          resolveErrored = true;
          consecutiveErrors++;
        } finally {
          clearTimeout(timer);
        }

        if (consecutiveErrors >= PHASE3_503_THRESHOLD) {
          mbDegraded = true;
          console.warn(
            `[me/import/retry] job=${retryJobId} ${consecutiveErrors} consecutive MB errors — ` +
            `pausing ${currentBackoffMs / 1000}s`,
          );
          await sleep(currentBackoffMs);
          currentBackoffMs = Math.min(currentBackoffMs * 2, PHASE3_503_MAX_BACKOFF_MS);
          consecutiveErrors = 0;
        }

        if (mbid) {
          await db
            .insert(recordingsTable)
            .values({
              mbid,
              title: t.title,
              artist: t.artist,
              ...(t.isrc ? { isrc: t.isrc } : {}),
            })
            .onConflictDoNothing();

          // FK guard: recordings row may disappear between the insert above and
          // the library_items insert (same race as the main Phase 3 worker).
          let libItemInserted = false;
          try {
            await db
              .insert(libraryItemsTable)
              .values({ userId: candidate.userId, mbid, provenance, addedAt: new Date() })
              .onConflictDoNothing();
            libItemInserted = true;
          } catch (insertErr) {
            const pgCode = (insertErr as { code?: string }).code;
            if (pgCode !== "23503") throw insertErr;
            console.warn(
              `[me/import/retry] FK violation for mbid=${mbid} — ` +
              `recordings row gone between resolve and insert; skipping`,
            );
          }

          await db
            .insert(resolutionCacheTable)
            .values([
              ...(t.isrc ? [{ key: isrcKey(t.isrc), mbid }] : []),
              { key: normalizeKey(t.artist, t.title), mbid },
            ])
            .onConflictDoNothing()
            .catch(() => {});

          if (libItemInserted) {
            // Promote: remove the soft row now that library_items has the track.
            if (candidate.service === "spotify") {
              const isRealSpotifyId = /^[A-Za-z0-9]{22}$/.test(t.externalId);
              if (isRealSpotifyId) {
                await db
                  .delete(spotifyLibraryItemsTable)
                  .where(
                    and(
                      eq(spotifyLibraryItemsTable.userId, candidate.userId),
                      eq(spotifyLibraryItemsTable.spotifyId, t.externalId),
                    ),
                  )
                  .catch(() => {});
              } else {
                const artistTitleCond = and(
                  eq(spotifyLibraryItemsTable.artist, t.artist),
                  eq(spotifyLibraryItemsTable.title, t.title),
                );
                const fallbackCond = t.isrc
                  ? or(
                      eq(spotifyLibraryItemsTable.isrc, t.isrc),
                      and(isNull(spotifyLibraryItemsTable.isrc), artistTitleCond),
                    )
                  : artistTitleCond;
                await db
                  .delete(spotifyLibraryItemsTable)
                  .where(and(eq(spotifyLibraryItemsTable.userId, candidate.userId), fallbackCond))
                  .catch(() => {});
              }
            }
            retryResolved++;
          }
        } else if (!controller.signal.aborted && !resolveErrored) {
          await db
            .insert(resolutionCacheTable)
            .values([
              ...(t.isrc ? [{ key: isrcKey(t.isrc), mbid: null }] : []),
              { key: normalizeKey(t.artist, t.title), mbid: null },
            ])
            .onConflictDoNothing()
            .catch(() => {});
        }

        if (!controller.signal.aborted) {
          await sleep(IMPORT_RESOLVE_DELAY_MS);
        }

        await db
          .update(libraryImportJobsTable)
          .set({ resolved: retryResolved })
          .where(eq(libraryImportJobsTable.id, retryJobId));
      }

      await db
        .update(libraryImportJobsTable)
        .set({ status: "done", resolved: retryResolved, finishedAt: new Date() })
        .where(eq(libraryImportJobsTable.id, retryJobId));

      console.log(
        `[me/import/retry] job=${retryJobId} complete — ` +
        `resolved ${retryResolved}/${entriesToRetry.length}`,
      );
    } catch (err) {
      retryPassFailed = true;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[me/import/retry] job=${retryJobId} failed`, err);
      await db
        .update(libraryImportJobsTable)
        .set({ status: "error", error: message.slice(0, 500), finishedAt: new Date() })
        .where(eq(libraryImportJobsTable.id, retryJobId))
        .catch(() => {});
    }

    if (retryResolved > 0) {
      await db
        .update(libraryImportJobsTable)
        .set({ retryAttempts: 0, retryExhausted: false })
        .where(eq(libraryImportJobsTable.id, candidate.id))
        .catch(() => {});
      console.log(
        `[me/import/retry] source job=${candidate.id} retry counter reset (resolved ${retryResolved})`,
      );
    } else if (!retryPassFailed) {
      const newAttempts = (candidate.retryAttempts ?? 0) + 1;
      const nowExhausted = newAttempts >= PHASE3_MAX_RETRY_ATTEMPTS;
      await db
        .update(libraryImportJobsTable)
        .set({
          retryAttempts: newAttempts,
          ...(nowExhausted ? { retryExhausted: true } : {}),
        })
        .where(eq(libraryImportJobsTable.id, candidate.id))
        .catch(() => {});
      if (nowExhausted) {
        console.warn(
          `[me/import/retry] source job=${candidate.id} marked retry_exhausted ` +
          `after ${newAttempts} consecutive failed passes`,
        );
      } else {
        console.log(
          `[me/import/retry] source job=${candidate.id} failed attempt ${newAttempts}/${PHASE3_MAX_RETRY_ATTEMPTS}`,
        );
      }
    }

    processedCount++;
  }
}

/**
 * Starts the recurring Phase 3 off-peak retry scheduler.
 * Called from the boot entrypoint (src/index.ts) so it never runs during tests.
 */
export function startPhase3RetryScheduler(): void {
  let passInFlight = false;

  setInterval(() => {
    const utcHour = new Date().getUTCHours();
    const [start, end] = PHASE3_RETRY_OFF_PEAK_HOURS;
    if (utcHour < start || utcHour >= end) return;
    if (passInFlight) {
      console.log("[me/import/retry] previous pass still running — skipping tick");
      return;
    }
    passInFlight = true;
    const [, windowEnd] = PHASE3_RETRY_OFF_PEAK_HOURS;
    const nowForDeadline = new Date();
    const windowEndDate = new Date(nowForDeadline);
    windowEndDate.setUTCHours(windowEnd, 0, 0, 0);
    const passDeadline = windowEndDate > nowForDeadline ? windowEndDate : undefined;
    runPhase3RetryPass(passDeadline)
      .catch((err) => console.error("[me/import/retry] scheduler pass failed", err))
      .finally(() => { passInFlight = false; });
  }, PHASE3_RETRY_POLL_MS);
  console.log("[me/import/retry] off-peak retry scheduler started (active 02–06 UTC)");
}

// ---------------------------------------------------------------------------
// Library endpoints
// ---------------------------------------------------------------------------

/**
 * GET /api/me/library — paginated list of kept + imported recordings.
 *
 * Unions `library_items` (MBID-resolved) and `spotify_library_items`
 * (unresolved soft rows) so the listener sees their whole Spotify library,
 * not just the ~55 % that resolved to MusicBrainz.
 */
router.get("/me/library", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  const cursor =
    typeof req.query["cursor"] === "string" ? req.query["cursor"].trim() : null;
  const limit = Math.min(
    parseInt(typeof req.query["limit"] === "string" ? req.query["limit"] : "", 10) || LIBRARY_PAGE_SIZE,
    100,
  );
  const q =
    typeof req.query["q"] === "string" ? req.query["q"].trim() : "";
  const sortRaw =
    typeof req.query["sort"] === "string" ? req.query["sort"] : "added";
  const sort: "added" | "artist" | "title" =
    sortRaw === "artist" || sortRaw === "title" ? sortRaw : "added";
  const sourceRaw =
    typeof req.query["source"] === "string" ? req.query["source"] : "";
  const source: "keep" | "import" | "soft" | "critic" | null =
    sourceRaw === "keep" || sourceRaw === "import" || sourceRaw === "soft" || sourceRaw === "critic" ? sourceRaw : null;

  const includeSoft = source !== "keep" && source !== "critic";
  const includeResolved = source !== "soft";

  // ── Resolved rows conditions ─────────────────────────────────────────────
  const conditions = [eq(libraryItemsTable.userId, user.id)];

  if (q.length > 0) {
    const pattern = `%${escapeLike(q)}%`;
    conditions.push(
      sql`(${recordingsTable.title} ILIKE ${pattern} OR ${recordingsTable.artist} ILIKE ${pattern})`,
    );
  }
  if (source && source !== "critic") {
    conditions.push(
      sql`${libraryItemsTable.provenance}->>'kind' = ${source}`,
    );
  }
  if (source === "critic") {
    conditions.push(
      sql`EXISTS (
        SELECT 1
        FROM recording_release_groups rrg
        JOIN list_entries le ON le.release_group_mbid = rrg.release_group_mbid
        WHERE rrg.recording_mbid = ${libraryItemsTable.mbid}
          AND (le.confidence = 'exact' OR le.confirmed = true)
      )`,
    );
  }

  // ── Total count (page 1 only) ────────────────────────────────────────────
  let total: number | undefined;
  let keepCount: number | undefined;
  let softCount: number | undefined;
  let criticCount: number | undefined;
  if (!cursor) {
    const [resolvedCount, rawSoftCount, rawKeepCount, rawCriticCount] = await Promise.all([
      includeResolved
        ? db
            .select({ count: sql<number>`count(*)::int` })
            .from(libraryItemsTable)
            .leftJoin(recordingsTable, eq(libraryItemsTable.mbid, recordingsTable.mbid))
            .where(and(...conditions))
            .then((r) => r[0]?.count ?? 0)
        : Promise.resolve(0),
      includeSoft
        ? (async () => {
            const softConds = [
              eq(spotifyLibraryItemsTable.userId, user.id),
              isNull(spotifyLibraryItemsTable.mbid),
            ];
            if (q.length > 0) {
              const pattern = `%${escapeLike(q)}%`;
              softConds.push(
                sql`(${spotifyLibraryItemsTable.title} ILIKE ${pattern} OR ${spotifyLibraryItemsTable.artist} ILIKE ${pattern})`,
              );
            }
            return db
              .select({ count: sql<number>`count(*)::int` })
              .from(spotifyLibraryItemsTable)
              .where(and(...softConds))
              .then((r) => r[0]?.count ?? 0);
          })()
        : Promise.resolve(0),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(libraryItemsTable)
        .where(
          and(
            eq(libraryItemsTable.userId, user.id),
            sql`${libraryItemsTable.provenance}->>'kind' = 'keep'`,
          ),
        )
        .then((r) => r[0]?.count ?? 0),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(libraryItemsTable)
        .where(
          and(
            eq(libraryItemsTable.userId, user.id),
            sql`EXISTS (
              SELECT 1
              FROM recording_release_groups rrg
              JOIN list_entries le ON le.release_group_mbid = rrg.release_group_mbid
              WHERE rrg.recording_mbid = ${libraryItemsTable.mbid}
                AND (le.confidence = 'exact' OR le.confirmed = true)
            )`,
          ),
        )
        .then((r) => r[0]?.count ?? 0),
    ]);
    softCount = rawSoftCount;
    total = resolvedCount + softCount;
    keepCount = rawKeepCount;
    criticCount = rawCriticCount;
  }

  const sortKeyExpr =
    sort === "artist"
      ? sql<string>`lower(coalesce(${recordingsTable.artist}, '') || ' ' || coalesce(${recordingsTable.title}, ''))`
      : sql<string>`lower(coalesce(${recordingsTable.title}, '') || ' ' || coalesce(${recordingsTable.artist}, ''))`;

  const softConds = [
    eq(spotifyLibraryItemsTable.userId, user.id),
    isNull(spotifyLibraryItemsTable.mbid),
  ];
  if (q.length > 0) {
    const pattern = `%${escapeLike(q)}%`;
    softConds.push(
      sql`(${spotifyLibraryItemsTable.title} ILIKE ${pattern} OR ${spotifyLibraryItemsTable.artist} ILIKE ${pattern})`,
    );
  }

  const softSortKeyExpr =
    sort === "artist"
      ? sql<string>`lower(coalesce(${spotifyLibraryItemsTable.artist}, '') || ' ' || coalesce(${spotifyLibraryItemsTable.title}, ''))`
      : sql<string>`lower(coalesce(${spotifyLibraryItemsTable.title}, '') || ' ' || coalesce(${spotifyLibraryItemsTable.artist}, ''))`;

  let legacyNameCursor = false;
  if (cursor) {
    if (sort === "added") {
      conditions.push(sql`${libraryItemsTable.addedAt} < ${cursor}::timestamptz`);
      softConds.push(sql`${spotifyLibraryItemsTable.addedAt} < ${cursor}::timestamptz`);
    } else {
      const sep = cursor.lastIndexOf(LIB_CURSOR_SEP);
      if (sep < 0) {
        return res.status(400).json({ error: "Malformed cursor for this sort" });
      }
      const keyPart = cursor.slice(0, sep);
      const suffixPart = cursor.slice(sep + 1);
      const isAddedAtSuffix = /^\d{4}-\d{2}-\d{2}T/.test(suffixPart);
      if (isAddedAtSuffix) {
        conditions.push(
          sql`(${sortKeyExpr}, ${libraryItemsTable.addedAt}) > (${keyPart}, ${suffixPart}::timestamptz)`,
        );
        softConds.push(
          sql`(${softSortKeyExpr}, ${spotifyLibraryItemsTable.addedAt}) > (${keyPart}, ${suffixPart}::timestamptz)`,
        );
      } else {
        conditions.push(
          sql`(${sortKeyExpr}, ${libraryItemsTable.mbid}) > (${keyPart}, ${suffixPart})`,
        );
        legacyNameCursor = true;
      }
    }
  }

  type ResolvedRow = {
    mbid: string; provenance: LibraryItemProvenance; addedAt: Date;
    title: string | null; artist: string | null; artworkUrl: string | null;
    links: Array<{ url: string }> | null; sortKey: string; albumTitle: string | null;
  };
  let resolvedRows: ResolvedRow[] = [];
  if (includeResolved) resolvedRows = await db
    .select({
      mbid: libraryItemsTable.mbid,
      provenance: libraryItemsTable.provenance,
      addedAt: libraryItemsTable.addedAt,
      title: recordingsTable.title,
      artist: recordingsTable.artist,
      artworkUrl: recordingsTable.artworkUrl,
      links: recordingsTable.links,
      sortKey: sortKeyExpr.as("sort_key"),
      albumTitle: sql<string | null>`(
        SELECT title FROM recording_release_groups
        WHERE recording_mbid = ${libraryItemsTable.mbid} AND is_primary = true
        LIMIT 1
      )`,
    })
    .from(libraryItemsTable)
    .leftJoin(recordingsTable, eq(libraryItemsTable.mbid, recordingsTable.mbid))
    .where(and(...conditions))
    .orderBy(
      ...(sort === "added"
        ? [desc(libraryItemsTable.addedAt)]
        : [asc(sortKeyExpr), asc(libraryItemsTable.addedAt)]),
    )
    .limit(limit + 1);

  void legacyNameCursor;

  type SoftRow = { spotifyId: string; addedAt: Date; title: string; artist: string; artworkUrl: string | null; albumName: string | null; sortKey: string };
  let softRows: SoftRow[] = [];
  if (includeSoft) {
    softRows = await db
      .select({
        spotifyId: spotifyLibraryItemsTable.spotifyId,
        addedAt: spotifyLibraryItemsTable.addedAt,
        title: spotifyLibraryItemsTable.title,
        artist: spotifyLibraryItemsTable.artist,
        artworkUrl: spotifyLibraryItemsTable.artworkUrl,
        albumName: spotifyLibraryItemsTable.albumName,
        sortKey: softSortKeyExpr.as("soft_sort_key"),
      })
      .from(spotifyLibraryItemsTable)
      .where(and(...softConds))
      .orderBy(
        ...(sort === "added"
          ? [desc(spotifyLibraryItemsTable.addedAt)]
          : [asc(softSortKeyExpr), asc(spotifyLibraryItemsTable.addedAt)]),
      )
      .limit(limit + 1);
  }

  const softProvenance: LibraryItemProvenance = { kind: "import", service: "spotify" };

  const unified = [
    ...resolvedRows.map((r) => ({
      soft: false as const,
      mbid: r.mbid as string | null,
      spotifyId: null as string | null,
      provenance: r.provenance,
      addedAt: r.addedAt,
      title: r.title,
      artist: r.artist,
      artworkUrl: r.artworkUrl,
      links: r.links as Array<{ url: string }> | null,
      albumTitle: r.albumTitle,
      sortKey: r.sortKey,
    })),
    ...softRows.map((s) => ({
      soft: true as const,
      mbid: null as string | null,
      spotifyId: s.spotifyId,
      provenance: softProvenance,
      addedAt: s.addedAt,
      title: s.title,
      artist: s.artist,
      artworkUrl: s.artworkUrl,
      links: null as Array<{ url: string }> | null,
      albumTitle: s.albumName,
      sortKey: s.sortKey,
    })),
  ];

  if (sort === "added") {
    unified.sort((a, b) => b.addedAt.getTime() - a.addedAt.getTime());
  } else {
    unified.sort(
      (a, b) =>
        a.sortKey.localeCompare(b.sortKey) ||
        a.addedAt.getTime() - b.addedAt.getTime(),
    );
  }

  const hasMore = unified.length > limit;
  const items = unified.slice(0, limit);
  const last = items[items.length - 1];

  const nextCursor = !hasMore || !last
    ? null
    : sort === "added"
      ? last.addedAt.toISOString()
      : `${last.sortKey}${LIB_CURSOR_SEP}${last.addedAt.toISOString()}`;

  return res.json({
    items: items.map((r) => ({
      mbid: r.mbid,
      provenance: r.provenance,
      addedAt: r.addedAt.toISOString(),
      recording: r.title
        ? {
            title: r.title,
            artist: r.artist,
            artworkUrl: r.artworkUrl ?? null,
            albumTitle: r.albumTitle ?? null,
            spotifyUrl:
              r.links?.find((l) => l.url.includes("open.spotify.com"))?.url ?? null,
          }
        : null,
      ...(r.soft ? { soft: true, spotifyId: r.spotifyId } : {}),
    })),
    nextCursor,
    ...(total !== undefined ? { total } : {}),
    ...(keepCount !== undefined ? { keepCount } : {}),
    ...(softCount !== undefined ? { softCount } : {}),
    ...(criticCount !== undefined ? { criticCount } : {}),
  });
}));

/**
 * GET /api/me/library/mbids — all resolved MBIDs in the user's library,
 * returned as a flat string array, plus the set of release-group MBIDs.
 */
router.get("/me/library/mbids", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  if (!user) { res.json({ mbids: [], releaseGroupMbids: [], artistMbids: [] }); return; }

  const rows = await db
    .select({ mbid: libraryItemsTable.mbid })
    .from(libraryItemsTable)
    .where(and(eq(libraryItemsTable.userId, user.id), isNotNull(libraryItemsTable.mbid)));

  const mbids = rows.map((r) => r.mbid).filter((m): m is string => !!m);

  let releaseGroupMbids: string[] = [];
  let artistMbids: string[] = [];
  if (mbids.length > 0) {
    const [rgRows, artistRows] = await Promise.all([
      db.selectDistinct({ releaseGroupMbid: recordingReleaseGroupsTable.releaseGroupMbid })
        .from(recordingReleaseGroupsTable)
        .where(inArray(recordingReleaseGroupsTable.recordingMbid, mbids)),
      db.selectDistinct({ artistMbid: recordingsTable.artistMbid })
        .from(recordingsTable)
        .where(and(inArray(recordingsTable.mbid, mbids), isNotNull(recordingsTable.artistMbid))),
    ]);
    releaseGroupMbids = rgRows.map((r) => r.releaseGroupMbid);
    artistMbids = artistRows.map((r) => r.artistMbid).filter((m): m is string => !!m);
  }

  let softArtists: string[] = [];
  {
    const softRows = await db
      .selectDistinct({ artist: spotifyLibraryItemsTable.artist })
      .from(spotifyLibraryItemsTable)
      .where(
        and(
          eq(spotifyLibraryItemsTable.userId, user.id),
          isNull(spotifyLibraryItemsTable.mbid),
        ),
      );
    softArtists = softRows.map((r) => r.artist).filter(Boolean);
  }

  res.json({ mbids, releaseGroupMbids, artistMbids, softArtists });
}));

/**
 * GET /api/me/library/export?format=csv|json|m3u8|txt — download the whole library as a file.
 */
router.get("/me/library/export", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  const format = req.query["format"];
  if (!isExportFormat(format)) {
    return res.status(400).json({ error: "format must be one of csv, json, m3u8, txt" });
  }

  const rows = await db
    .select({
      mbid: libraryItemsTable.mbid,
      provenance: libraryItemsTable.provenance,
      addedAt: libraryItemsTable.addedAt,
      title: recordingsTable.title,
      artist: recordingsTable.artist,
      isrc: recordingsTable.isrc,
      releaseYear: recordingsTable.releaseYear,
      album: sql<string | null>`(
        SELECT title FROM recording_release_groups
        WHERE recording_mbid = ${libraryItemsTable.mbid} AND is_primary = true
        LIMIT 1
      )`,
      releaseGroupMbid: sql<string | null>`(
        SELECT release_group_mbid FROM recording_release_groups
        WHERE recording_mbid = ${libraryItemsTable.mbid} AND is_primary = true
        LIMIT 1
      )`,
      spinPlayedAt: spinsTable.playedAt,
      spinStationSlug: stationsTable.slug,
      spinStationName: stationsTable.name,
      spinShowName: showsTable.name,
    })
    .from(libraryItemsTable)
    .leftJoin(recordingsTable, eq(libraryItemsTable.mbid, recordingsTable.mbid))
    .leftJoin(spinsTable, eq(libraryItemsTable.spinId, spinsTable.id))
    .leftJoin(stationsTable, eq(spinsTable.stationId, stationsTable.id))
    .leftJoin(showsTable, eq(spinsTable.showId, showsTable.id))
    .where(eq(libraryItemsTable.userId, user.id))
    .orderBy(desc(libraryItemsTable.addedAt))
    .limit(EXPORT_MAX_ROWS);

  const exportRows: LibraryExportRow[] = rows.map((r) => ({
    mbid: r.mbid,
    title: r.title,
    artist: r.artist,
    album: r.album,
    releaseGroupMbid: r.releaseGroupMbid,
    releaseYear: r.releaseYear,
    isrc: r.isrc,
    addedAt: r.addedAt,
    provenance: r.provenance,
    spin: r.spinPlayedAt || r.spinStationSlug
      ? {
          stationSlug: r.spinStationSlug,
          stationName: r.spinStationName,
          showName: r.spinShowName,
          playedAt: r.spinPlayedAt,
        }
      : null,
  }));

  let listenExportRows: ListenExportRow[] | undefined;
  if (format === "json" && user.ledgerEnabled) {
    const listenRows = await db
      .select({
        id: listensTable.id,
        mbid: listensTable.mbid,
        title: recordingsTable.title,
        artist: recordingsTable.artist,
        stationName: stationsTable.name,
        pickerName: pickersTable.name,
        showName: showsTable.name,
        context: listensTable.context,
        outputService: listensTable.outputService,
        startedAt: listensTable.startedAt,
        msPlayed: listensTable.msPlayed,
        completed: listensTable.completed,
      })
      .from(listensTable)
      .leftJoin(recordingsTable, eq(listensTable.mbid, recordingsTable.mbid))
      .leftJoin(stationsTable, eq(listensTable.stationId, stationsTable.id))
      .leftJoin(pickersTable, eq(listensTable.pickerId, pickersTable.id))
      .leftJoin(showsTable, eq(listensTable.showId, showsTable.id))
      .where(eq(listensTable.userId, user.id))
      .orderBy(desc(listensTable.startedAt))
      .limit(EXPORT_MAX_ROWS);

    listenExportRows = listenRows.map((l) => ({
      id: l.id,
      mbid: l.mbid,
      title: l.title ?? null,
      artist: l.artist ?? null,
      stationName: l.stationName ?? null,
      pickerName: l.pickerName ?? null,
      showName: l.showName ?? null,
      context: l.context,
      outputService: l.outputService,
      startedAt: l.startedAt,
      msPlayed: l.msPlayed,
      completed: l.completed,
    }));
  }

  const now = new Date();
  const body = buildExport(format, exportRows, now, listenExportRows);
  const stamp = now.toISOString().slice(0, 10);
  res.setHeader("Content-Type", EXPORT_CONTENT_TYPES[format]);
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="lore-library-${stamp}.${format}"`,
  );
  return res.send(body);
}));

/**
 * GET /api/me/library/list-coverage — publication lists that feature albums
 * from the user's library.
 */
router.get("/me/library/list-coverage", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;

  const rows = await db
    .select({
      listId: listsTable.id,
      listTitle: listsTable.title,
      listUrl: listsTable.url,
      listYear: listsTable.year,
      listKind: listsTable.kind,
      isRanked: listsTable.isRanked,
      sourceName: listSourcesTable.name,
      rank: listEntriesTable.rank,
      releaseGroupMbid: listEntriesTable.releaseGroupMbid,
      albumTitle: recordingReleaseGroupsTable.title,
      releaseYear: recordingReleaseGroupsTable.releaseYear,
    })
    .from(libraryItemsTable)
    .innerJoin(
      recordingReleaseGroupsTable,
      eq(recordingReleaseGroupsTable.recordingMbid, libraryItemsTable.mbid),
    )
    .innerJoin(
      listEntriesTable,
      eq(listEntriesTable.releaseGroupMbid, recordingReleaseGroupsTable.releaseGroupMbid),
    )
    .innerJoin(listsTable, eq(listsTable.id, listEntriesTable.listId))
    .innerJoin(listSourcesTable, eq(listSourcesTable.id, listsTable.sourceId))
    .where(
      and(
        eq(libraryItemsTable.userId, user.id),
        isNotNull(libraryItemsTable.mbid),
        sql`(${listEntriesTable.confidence} = 'exact' OR ${listEntriesTable.confirmed} = true)`,
      ),
    )
    .orderBy(
      asc(listSourcesTable.name),
      sql`${listsTable.year} desc nulls last`,
      sql`${listEntriesTable.rank} asc nulls last`,
    );

  const listMap = new Map<
    number,
    {
      listId: number;
      listTitle: string;
      listUrl: string;
      listYear: number | null;
      listKind: string;
      isRanked: boolean;
      sourceName: string;
      albums: Array<{
        releaseGroupMbid: string;
        albumTitle: string | null;
        releaseYear: number | null;
        rank: number | null;
      }>;
    }
  >();
  const seenAlbums = new Set<string>();

  for (const r of rows) {
    const albumKey = `${r.listId}:${r.releaseGroupMbid}`;
    if (seenAlbums.has(albumKey)) continue;
    seenAlbums.add(albumKey);

    let entry = listMap.get(r.listId);
    if (!entry) {
      entry = {
        listId: r.listId,
        listTitle: r.listTitle,
        listUrl: r.listUrl,
        listYear: r.listYear ?? null,
        listKind: r.listKind,
        isRanked: r.isRanked,
        sourceName: r.sourceName,
        albums: [],
      };
      listMap.set(r.listId, entry);
    }
    entry.albums.push({
      releaseGroupMbid: r.releaseGroupMbid,
      albumTitle: r.albumTitle ?? null,
      releaseYear: r.releaseYear ?? null,
      rank: r.rank ?? null,
    });
  }

  return res.json({ items: Array.from(listMap.values()) });
}));

// ---------------------------------------------------------------------------
// Library sync — push Lore library → Spotify saved tracks
// ---------------------------------------------------------------------------

/**
 * POST /api/me/library/sync — start a background sync job.
 */
router.post("/me/library/sync", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  const service = typeof req.query["service"] === "string" ? req.query["service"].trim() : "spotify";

  const [conn] = await db
    .select()
    .from(serviceConnectionsTable)
    .where(and(eq(serviceConnectionsTable.userId, user.id), eq(serviceConnectionsTable.service, service)))
    .limit(1);

  if (!conn) {
    return res.status(400).json({ error: `No ${service} connection found; connect first.` });
  }

  if (!conn.canWrite) {
    return res.status(403).json({
      error: "canWrite:false",
      message: "Your Spotify connection doesn't have write access. Reconnect Spotify to grant it.",
      reAuthUrl: null,
    });
  }

  const ZOMBIE_AGE_MS = SYNC_ZOMBIE_AGE_MS;
  const [existingJob] = await db
    .select({
      id: librarySyncJobsTable.id,
      status: librarySyncJobsTable.status,
      startedAt: librarySyncJobsTable.startedAt,
      committedOffset: librarySyncJobsTable.committedOffset,
    })
    .from(librarySyncJobsTable)
    .where(and(
      eq(librarySyncJobsTable.userId, user.id),
      eq(librarySyncJobsTable.service, service),
      inArray(librarySyncJobsTable.status, ["running", "pending"]),
    ))
    .limit(1);

  if (existingJob) {
    const ageMs = Date.now() - existingJob.startedAt.getTime();
    if (ageMs > ZOMBIE_AGE_MS) {
      if (existingJob.committedOffset > 0) {
        const freshToken = await getFreshToken(conn);
        if (!freshToken) {
          await db
            .update(librarySyncJobsTable)
            .set({ status: "error", error: "Spotify token expired or revoked — please reconnect Spotify and sync again", finishedAt: new Date() })
            .where(eq(librarySyncJobsTable.id, existingJob.id));
          console.warn(`[me/sync] job=${existingJob.id} token refresh failed during zombie-resume — marked error`);
        } else {
          console.log(
            `[me/sync] job=${existingJob.id} orphaned (${Math.round(ageMs / 60_000)}m old) ` +
            `but has committedOffset=${existingJob.committedOffset} — resuming`,
          );
          setImmediate(() => runSyncWorker(existingJob.id, user.id, conn, existingJob.committedOffset));
          return res.status(202).json({ jobId: existingJob.id, status: "running" });
        }
      } else {
        console.warn(`[me/sync] job=${existingJob.id} orphaned (${Math.round(ageMs / 60_000)}m old) — resetting`);
        await db
          .update(librarySyncJobsTable)
          .set({ status: "error", error: "Sync interrupted (server restarted) — please try again", finishedAt: new Date() })
          .where(eq(librarySyncJobsTable.id, existingJob.id));
      }
    } else {
      return res.status(409).json({
        jobId: existingJob.id,
        status: existingJob.status,
        error: "A sync is already in progress.",
      });
    }
  }

  const [job] = await db
    .insert(librarySyncJobsTable)
    .values({ userId: user.id, service, status: "pending", total: 0, processed: 0, startedAt: new Date() })
    .returning();

  setImmediate(() => runSyncWorker(job!.id, user.id, conn));

  return res.status(202).json({ jobId: job!.id, status: "pending" });
}));

function formatSyncJob(job: typeof librarySyncJobsTable.$inferSelect) {
  return {
    jobId: job.id,
    service: job.service,
    status: job.status,
    phase: job.phase ?? null,
    total: job.total,
    processed: job.processed,
    startedAt: job.startedAt.toISOString(),
    finishedAt: job.finishedAt ? job.finishedAt.toISOString() : null,
    error: job.error ?? null,
    results: job.results ?? null,
    resumedFrom: job.resumedFrom ?? null,
  };
}

/**
 * GET /api/me/library/sync — most recent sync job for the user (404 if none).
 */
router.get("/me/library/sync", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  const [job] = await db
    .select()
    .from(librarySyncJobsTable)
    .where(eq(librarySyncJobsTable.userId, user.id))
    .orderBy(desc(librarySyncJobsTable.startedAt))
    .limit(1);
  if (!job) return res.status(404).json({ error: "No sync jobs found" });
  return res.json(formatSyncJob(job));
}));

/**
 * GET /api/me/library/sync/:jobId/unavailable — full paginated list of tracks
 * that could not be found on Spotify for a completed sync job.
 */
router.get("/me/library/sync/:jobId/unavailable", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  const rawJobId = req.params.jobId;
  const jobId = parseInt(typeof rawJobId === "string" ? rawJobId : "", 10);
  if (isNaN(jobId)) return res.status(400).json({ error: "Invalid jobId" });

  const [job] = await db
    .select()
    .from(librarySyncJobsTable)
    .where(and(eq(librarySyncJobsTable.id, jobId), eq(librarySyncJobsTable.userId, user.id)))
    .limit(1);
  if (!job) return res.status(404).json({ error: "Job not found" });
  if (job.status !== "done" || !job.results) {
    return res.status(400).json({ error: "Job is not complete" });
  }

  const receipt = job.results;
  const total = receipt.unavailable;

  const formatRaw = req.query["format"];
  const format = formatRaw === "csv" ? "csv" : "json";
  const limitRaw = parseInt(typeof req.query["limit"] === "string" ? req.query["limit"] : "", 10);
  const limit = isNaN(limitRaw) ? 200 : Math.max(1, Math.min(limitRaw, 1000));
  const pageRaw = parseInt(typeof req.query["page"] === "string" ? req.query["page"] : "", 10);
  const page = isNaN(pageRaw) ? 1 : Math.max(1, pageRaw);

  const bcUrl = (artist: string, title: string) =>
    `https://bandcamp.com/search?q=${encodeURIComponent(`${artist} ${title}`)}`;

  interface UnavailableRow { mbid: string; artist: string; title: string; bandcampUrl: string }

  let allItems: UnavailableRow[];

  if (receipt.unavailableMbids && receipt.unavailableMbids.length > 0) {
    const mbids = receipt.unavailableMbids;
    const recs = await db
      .select({ mbid: recordingsTable.mbid, artist: recordingsTable.artist, title: recordingsTable.title })
      .from(recordingsTable)
      .where(inArray(recordingsTable.mbid, mbids));
    const recMap = new Map(recs.map((r) => [r.mbid, r]));

    allItems = mbids.map((mbid) => {
      const rec = recMap.get(mbid);
      const artist = rec?.artist ?? "";
      const title = rec?.title ?? "";
      return { mbid, artist, title, bandcampUrl: bcUrl(artist, title) };
    });
  } else {
    allItems = receipt.unavailableItems.map((item) => ({
      mbid: item.mbid,
      artist: item.artist,
      title: item.title,
      bandcampUrl: item.bandcampUrl,
    }));
  }

  if (format === "csv") {
    const lines = [
      "mbid,artist,title,bandcamp_url",
      ...allItems.map((r) => [r.mbid, r.artist, r.title, r.bandcampUrl]
        .map((v) => `"${v.replace(/"/g, '""')}"`)
        .join(",")),
    ];
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="sync-${jobId}-unavailable.csv"`,
    );
    return res.send(lines.join("\n"));
  }

  const offset = (page - 1) * limit;
  const pageItems = allItems.slice(offset, offset + limit);
  const pages = Math.ceil(allItems.length / limit) || 1;

  return res.json({ items: pageItems, total, page, limit, pages });
}));

/**
 * GET /api/me/library/sync/:jobId/search-matched — full paginated list of tracks
 * matched by artist+title search for a completed sync job.
 */
router.get("/me/library/sync/:jobId/search-matched", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  const rawJobId = req.params.jobId;
  const jobId = parseInt(typeof rawJobId === "string" ? rawJobId : "", 10);
  if (isNaN(jobId)) return res.status(400).json({ error: "Invalid jobId" });

  const [job] = await db
    .select()
    .from(librarySyncJobsTable)
    .where(and(eq(librarySyncJobsTable.id, jobId), eq(librarySyncJobsTable.userId, user.id)))
    .limit(1);
  if (!job) return res.status(404).json({ error: "Job not found" });
  if (job.status !== "done" || !job.results) {
    return res.status(400).json({ error: "Job is not complete" });
  }

  const receipt = job.results;
  const total = receipt.searchMatched;

  const formatRaw = req.query["format"];
  const format = formatRaw === "csv" ? "csv" : "json";
  const limitRaw = parseInt(typeof req.query["limit"] === "string" ? req.query["limit"] : "", 10);
  const limit = isNaN(limitRaw) ? 200 : Math.max(1, Math.min(limitRaw, 1000));
  const pageRaw = parseInt(typeof req.query["page"] === "string" ? req.query["page"] : "", 10);
  const page = isNaN(pageRaw) ? 1 : Math.max(1, pageRaw);

  interface SearchMatchedRow { mbid: string; artist: string; title: string; spotifyUrl: string }

  let allItems: SearchMatchedRow[];

  if (receipt.searchMatchedMbids && receipt.searchMatchedMbids.length > 0) {
    const mbids = receipt.searchMatchedMbids;
    const recs = await db
      .select({ mbid: recordingsTable.mbid, artist: recordingsTable.artist, title: recordingsTable.title })
      .from(recordingsTable)
      .where(inArray(recordingsTable.mbid, mbids));
    const recMap = new Map(recs.map((r) => [r.mbid, r]));

    const spotifyUrlMap = new Map(receipt.searchMatchedItems.map((i) => [i.mbid, i.spotifyUrl]));

    allItems = mbids.map((mbid) => {
      const rec = recMap.get(mbid);
      const artist = rec?.artist ?? "";
      const title = rec?.title ?? "";
      const spotifyUrl = spotifyUrlMap.get(mbid) ?? `https://open.spotify.com/search/${encodeURIComponent(`${artist} ${title}`)}`;
      return { mbid, artist, title, spotifyUrl };
    });
  } else {
    allItems = receipt.searchMatchedItems.map((item) => ({
      mbid: item.mbid,
      artist: item.artist,
      title: item.title,
      spotifyUrl: item.spotifyUrl,
    }));
  }

  if (format === "csv") {
    const lines = [
      "mbid,artist,title,spotify_url",
      ...allItems.map((r) => [r.mbid, r.artist, r.title, r.spotifyUrl]
        .map((v) => `"${v.replace(/"/g, '""')}"`)
        .join(",")),
    ];
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="sync-${jobId}-search-matched.csv"`,
    );
    return res.send(lines.join("\n"));
  }

  const offset = (page - 1) * limit;
  const pageItems = allItems.slice(offset, offset + limit);
  const pages = Math.ceil(allItems.length / limit) || 1;

  return res.json({ items: pageItems, total, page, limit, pages });
}));

/**
 * GET /api/me/library/sync/:jobId — poll sync job progress.
 */
router.get("/me/library/sync/:jobId", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  const jobId = parseInt(typeof req.params.jobId === "string" ? req.params.jobId : "", 10);
  if (isNaN(jobId)) return res.status(400).json({ error: "Invalid jobId" });
  const [job] = await db
    .select()
    .from(librarySyncJobsTable)
    .where(and(eq(librarySyncJobsTable.id, jobId), eq(librarySyncJobsTable.userId, user.id)))
    .limit(1);
  if (!job) return res.status(404).json({ error: "Job not found" });
  return res.json(formatSyncJob(job));
}));

/**
 * On boot: find sync jobs that were interrupted mid-run and either resume or
 * mark them as error.
 */
export async function markOrphanedSyncJobsAsError(): Promise<void> {
  try {
    const stuck = await db
      .select()
      .from(librarySyncJobsTable)
      .where(inArray(librarySyncJobsTable.status, ["running", "pending"]));

    if (stuck.length === 0) return;

    const resumable: typeof stuck = [];
    const dead: typeof stuck = [];

    for (const job of stuck) {
      if (job.committedOffset > 0) {
        resumable.push(job);
      } else {
        dead.push(job);
      }
    }

    if (dead.length > 0) {
      await db
        .update(librarySyncJobsTable)
        .set({ status: "error", error: "Server restarted — please start a new sync", finishedAt: new Date() })
        .where(inArray(librarySyncJobsTable.id, dead.map((j) => j.id)));
      console.log(`[me] marked ${dead.length} orphaned sync job(s) as error (no committed progress)`);
    }

    for (const job of resumable) {
      const [conn] = await db
        .select()
        .from(serviceConnectionsTable)
        .where(
          and(
            eq(serviceConnectionsTable.userId, job.userId),
            eq(serviceConnectionsTable.service, job.service),
          ),
        )
        .limit(1);

      if (!conn) {
        await db
          .update(librarySyncJobsTable)
          .set({ status: "error", error: "Server restarted — Spotify connection not found, please sync again", finishedAt: new Date() })
          .where(eq(librarySyncJobsTable.id, job.id));
        console.warn(`[me] sync job=${job.id} has progress but no service connection — marked error`);
        continue;
      }

      const freshToken = await getFreshToken(conn);
      if (!freshToken) {
        await db
          .update(librarySyncJobsTable)
          .set({ status: "error", error: "Spotify token expired or revoked — please reconnect Spotify and sync again", finishedAt: new Date() })
          .where(eq(librarySyncJobsTable.id, job.id));
        console.warn(`[me] sync job=${job.id} token refresh failed on boot — marked error`);
        continue;
      }

      console.log(`[me] resuming sync job=${job.id} from committedOffset=${job.committedOffset}`);
      setImmediate(() => runSyncWorker(job.id, job.userId, conn, job.committedOffset));
    }
  } catch (err) {
    console.error("[me] failed to handle orphaned sync jobs on boot", err);
  }
}

export async function markOrphanedImportJobsAsError(_testUserIds?: number[]): Promise<void> {
  try {
    const stuck = await db
      .select({
        id: libraryImportJobsTable.id,
        userId: libraryImportJobsTable.userId,
        service: libraryImportJobsTable.service,
        bufferJson: libraryImportJobsTable.bufferJson,
      })
      .from(libraryImportJobsTable)
      .where(
        and(
          inArray(libraryImportJobsTable.status, ["running", "pending"]),
          ...(_testUserIds && _testUserIds.length > 0
            ? [inArray(libraryImportJobsTable.userId, _testUserIds)]
            : []),
        ),
      );

    if (stuck.length === 0) return;

    // Manual import jobs that stored their buffer can be resumed transparently —
    // Phase 2 re-checks the resolution cache (fast), so already-resolved tracks
    // cost nothing; Phase 3 only re-runs on tracks not yet in the cache.
    const resumable = stuck.filter(
      (j) => j.service === "manual" && Array.isArray(j.bufferJson) && j.bufferJson.length > 0,
    );
    const dead = stuck.filter((j) => !resumable.includes(j));

    if (dead.length > 0) {
      await db
        .update(libraryImportJobsTable)
        .set({
          status: "error",
          error: "Server restarted while job was running — please start a new import",
          finishedAt: new Date(),
        })
        .where(inArray(libraryImportJobsTable.id, dead.map((j) => j.id)));
      console.log(`[me] marked ${dead.length} orphaned import job(s) as error:`, dead.map((j) => j.id));
    }

    for (const job of resumable) {
      console.log(
        `[me] resuming manual import job=${job.id} from stored buffer (${job.bufferJson!.length} tracks)`,
      );
      // Reset to running so the worker's own status updates are coherent.
      // Also reset startedAt so the POST zombie guard (30-min threshold) doesn't
      // kill this job if the user opens the import modal shortly after reboot.
      await db
        .update(libraryImportJobsTable)
        .set({ status: "running", error: null, startedAt: new Date() })
        .where(eq(libraryImportJobsTable.id, job.id));
      setImmediate(() => runManualImportWorker(job.id, job.userId, job.bufferJson!));
    }
  } catch (err) {
    console.error("[me] failed to clear orphaned import jobs", err);
  }
}

export default router;
