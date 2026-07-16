import { db, pickersTable, type PickerHealth } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { ingestBlogFeed } from "./blog.js";
import { queueCrossRefDiscovery } from "./blog-crossref.js";

/**
 * Blog-feed poller — the blog analogue of the station poller. Blogs publish a
 * handful of posts a day, so this is a single, slow, in-process interval that
 * re-reads every active blog picker's RSS feed and ingests any new "Artist –
 * Track" posts as picks. Like the station poller it is deliberately the smallest
 * thing that works: staggered per feed on boot, every tick wrapped so one dead
 * feed never throws, never blocks requests, and never kills the loop. Ingest is
 * idempotent (picks dedup by (pickerId, externalId) on the post's guid) and
 * conservative (only confidently-parsed posts become picks; feed body text is
 * never stored), so re-polling only ever fills gaps.
 *
 * Health tracking:
 *   - `ingestBlogFeed` returns `success: false` when the feed fetch/HTTP fails
 *     (the error is swallowed internally). The poller treats that as a failure.
 *   - On failure: reads the CURRENT health from DB (atomic read-before-write),
 *     increments consecutive_failures; after MAX_FAILURES sets active=false and
 *     logs the demotion.
 *   - On success: reads current health from DB, resets consecutive_failures to
 *     0. Logs recoveries (first success after prior failures).
 */

// Blogs move at human pace; poll each feed every 30 minutes.
const BLOG_POLL_MS = 30 * 60 * 1000;
// Stagger feeds so we never fetch (and resolve against MusicBrainz) all at once.
const STAGGER_MS = 15_000;
// Let boot (seed + station backfill) settle before the first blog fetch.
const WARMUP_MS = 60_000;
// Max consecutive failures before a picker is auto-demoted to active=false.
export const MAX_FAILURES = 5;

let started = false;
const timers: NodeJS.Timeout[] = [];

/** A blog picker reduced to what the poller needs to ride its feed. */
interface BlogFeed {
  id: number;
  name: string;
  homeUrl: string | null;
  feedUrl: string;
  /**
   * Known-flaky/thin feed (sourceRef.tolerant) — failures are logged and
   * health is recorded, but the picker is never auto-demoted to inactive.
   */
  tolerant: boolean;
}

/** Active blog pickers that carry a feed URL in their sourceRef. */
async function loadBlogFeeds(): Promise<BlogFeed[]> {
  const rows = await db
    .select({
      id: pickersTable.id,
      name: pickersTable.name,
      homeUrl: pickersTable.homeUrl,
      sourceRef: pickersTable.sourceRef,
    })
    .from(pickersTable)
    .where(
      and(eq(pickersTable.pickerType, "blog"), eq(pickersTable.active, true)),
    );

  const feeds: BlogFeed[] = [];
  for (const r of rows) {
    const ref = r.sourceRef as Record<string, unknown> | null;
    const feedUrl = ref?.["feedUrl"];
    if (typeof feedUrl === "string" && feedUrl.trim()) {
      feeds.push({
        id: r.id,
        name: r.name,
        homeUrl: r.homeUrl,
        feedUrl: feedUrl.trim(),
        tolerant: ref?.["tolerant"] === true,
      });
    }
  }
  return feeds;
}

/**
 * Read the current health snapshot for a picker from the DB. Returned value is
 * the single source of truth — never use a boot-time snapshot to accumulate
 * consecutive_failures, or counts will reset to 0 on every restart.
 */
async function readCurrentHealth(pickerId: number): Promise<PickerHealth | null> {
  const rows = await db
    .select({ health: pickersTable.health })
    .from(pickersTable)
    .where(eq(pickersTable.id, pickerId))
    .limit(1);
  return rows[0]?.health ?? null;
}

/**
 * Write a success health snapshot to the picker row.
 * Reads current health from DB first to detect recovery from prior failures.
 */
export async function writeHealthOk(pickerId: number): Promise<void> {
  const current = await readCurrentHealth(pickerId);
  const wasFailingBefore = (current?.consecutive_failures ?? 0) > 0;
  const health: PickerHealth = {
    last_ok_at: new Date().toISOString(),
    last_error: null,
    consecutive_failures: 0,
  };
  await db
    .update(pickersTable)
    .set({ health, updatedAt: new Date() })
    .where(eq(pickersTable.id, pickerId));
  if (wasFailingBefore) {
    console.info(`[blog-poller] picker ${pickerId} recovered after ${current?.consecutive_failures} consecutive failures`);
  }
}

/**
 * Write a failure health snapshot. Reads current health from DB first so that
 * consecutive_failures accumulates correctly across restarts (not reset to 0
 * every time the server boots).
 *
 * Returns true if the picker was demoted to active=false (reached MAX_FAILURES).
 */
export async function writeHealthFail(
  pickerId: number,
  errMsg: string,
  opts: { tolerant?: boolean } = {},
): Promise<boolean> {
  const current = await readCurrentHealth(pickerId);
  const prev = current?.consecutive_failures ?? 0;
  const newFailures = prev + 1;
  const health: PickerHealth = {
    last_ok_at: current?.last_ok_at ?? null,
    last_error: errMsg,
    consecutive_failures: newFailures,
  };
  // Tolerant (known-flaky/thin) feeds record health but are never auto-demoted
  // — a Louder-style feed that 500s for a day should quietly recover, not
  // vanish from the roster. Genuinely dead tolerant feeds still surface via
  // the health snapshot (consecutive_failures keeps climbing).
  const shouldDemote = !opts.tolerant && newFailures >= MAX_FAILURES;
  if (opts.tolerant && newFailures >= MAX_FAILURES && newFailures % MAX_FAILURES === 0) {
    console.warn(
      `[blog-poller] tolerant picker ${pickerId} at ${newFailures} consecutive failures (not demoted): ${errMsg}`,
    );
  }
  await db
    .update(pickersTable)
    .set({
      health,
      ...(shouldDemote ? { active: false } : {}),
      updatedAt: new Date(),
    })
    .where(eq(pickersTable.id, pickerId));
  if (shouldDemote) {
    console.warn(
      `[blog-poller] demoted picker ${pickerId} to inactive after ${newFailures} consecutive failures`,
    );
  }
  return shouldDemote;
}

/** Poll one blog feed once. Never throws. */
async function pollFeed(feed: BlogFeed): Promise<void> {
  try {
    const result = await ingestBlogFeed({
      feedUrl: feed.feedUrl,
      name: feed.name,
      homeUrl: feed.homeUrl ?? undefined,
    });

    if (!result.success) {
      // ingestBlogFeed swallows the HTTP/network error and returns success:false.
      // Treat this as a failure so health tracking demotes the picker correctly.
      await writeHealthFail(feed.id, "feed fetch failed (no HTTP response)", {
        tolerant: feed.tolerant,
      }).catch((e) =>
        console.error("[blog-poller] health write failed", feed.id, e),
      );
      return;
    }

    if (result.logged > 0) {
      console.info(`[lore] blog ${feed.name} ingested ${result.logged} pick(s)`);
    }
    await writeHealthOk(feed.id).catch((err) =>
      console.error("[blog-poller] health write failed", feed.id, err),
    );

    // Queue any blog post page links for cross-ref discovery. The cross-ref
    // module will fetch each post page, extract outbound links, and auto-discover
    // new blog candidates from those links' domains.
    const sourceDomain = new URL(feed.feedUrl).hostname;
    queueCrossRefDiscovery(result.feedLinks ?? [], sourceDomain);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[lore] blog poll failed", feed.feedUrl, err);
    await writeHealthFail(feed.id, msg, { tolerant: feed.tolerant }).catch((e) =>
      console.error("[blog-poller] health write failed", feed.id, e),
    );
  }
}

/**
 * Start the blog poller. Idempotent — safe to call once at boot. Loads the blog
 * pickers once, then schedules a staggered, slow interval per feed. If the DB is
 * unreachable at boot it logs and returns without crashing the API.
 */
export async function startBlogPoller(): Promise<void> {
  if (started) return;
  started = true;

  let feeds: BlogFeed[];
  try {
    feeds = await loadBlogFeeds();
  } catch (err) {
    console.error("[lore] blog poller could not load feeds; not started", err);
    started = false;
    return;
  }

  console.info(`[lore] starting blog poller for ${feeds.length} feed(s)`);

  feeds.forEach((feed, i) => {
    const kickoff = setTimeout(
      () => {
        void pollFeed(feed);
        const interval = setInterval(() => void pollFeed(feed), BLOG_POLL_MS);
        timers.push(interval);
      },
      WARMUP_MS + i * STAGGER_MS,
    );
    timers.push(kickoff);
  });
}

/** Stop the blog poller (tests / graceful shutdown). */
export function stopBlogPoller(): void {
  for (const t of timers) clearTimeout(t);
  timers.length = 0;
  started = false;
}
