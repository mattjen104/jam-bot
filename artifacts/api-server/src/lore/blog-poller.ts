import { db, pickersTable, type PickerHealth } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { ingestBlogFeed } from "./blog.js";
import { extractOutboundLinks, queueCrossRefDiscovery } from "./blog-crossref.js";

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
 *   - On success: writes health.last_ok_at and resets consecutive_failures to 0.
 *   - On failure: increments health.consecutive_failures; after MAX_FAILURES
 *     sets active=false and logs the demotion. Recoveries (success after prior
 *     failures) are explicitly logged.
 */

// Blogs move at human pace; poll each feed every 30 minutes.
const BLOG_POLL_MS = 30 * 60 * 1000;
// Stagger feeds so we never fetch (and resolve against MusicBrainz) all at once.
const STAGGER_MS = 15_000;
// Let boot (seed + station backfill) settle before the first blog fetch.
const WARMUP_MS = 60_000;
// Max consecutive failures before a picker is auto-demoted to active=false.
const MAX_FAILURES = 5;

let started = false;
const timers: NodeJS.Timeout[] = [];

/** A blog picker reduced to what the poller needs to ride its feed. */
interface BlogFeed {
  id: number;
  name: string;
  homeUrl: string | null;
  feedUrl: string;
  health: PickerHealth | null;
}

/** Active blog pickers that carry a feed URL in their sourceRef. */
async function loadBlogFeeds(): Promise<BlogFeed[]> {
  const rows = await db
    .select({
      id: pickersTable.id,
      name: pickersTable.name,
      homeUrl: pickersTable.homeUrl,
      sourceRef: pickersTable.sourceRef,
      health: pickersTable.health,
    })
    .from(pickersTable)
    .where(
      and(eq(pickersTable.pickerType, "blog"), eq(pickersTable.active, true)),
    );

  const feeds: BlogFeed[] = [];
  for (const r of rows) {
    const feedUrl = (r.sourceRef as Record<string, unknown> | null)?.["feedUrl"];
    if (typeof feedUrl === "string" && feedUrl.trim()) {
      feeds.push({
        id: r.id,
        name: r.name,
        homeUrl: r.homeUrl,
        feedUrl: feedUrl.trim(),
        health: r.health ?? null,
      });
    }
  }
  return feeds;
}

/** Write a success health snapshot to the picker row. */
async function writeHealthOk(pickerId: number, prevHealth: PickerHealth | null): Promise<void> {
  const wasFailingBefore = (prevHealth?.consecutive_failures ?? 0) > 0;
  const now = new Date().toISOString();
  const health: PickerHealth = {
    last_ok_at: now,
    last_error: null,
    consecutive_failures: 0,
  };
  await db
    .update(pickersTable)
    .set({ health, updatedAt: new Date() })
    .where(eq(pickersTable.id, pickerId));
  if (wasFailingBefore) {
    console.info(`[blog-poller] picker ${pickerId} recovered after prior failures`);
  }
}

/**
 * Write a failure health snapshot. Returns true if the picker was demoted to
 * active=false (reached MAX_FAILURES).
 */
async function writeHealthFail(
  pickerId: number,
  errMsg: string,
  prevHealth: PickerHealth | null,
): Promise<boolean> {
  const prev = prevHealth?.consecutive_failures ?? 0;
  const newFailures = prev + 1;
  const health: PickerHealth = {
    last_ok_at: prevHealth?.last_ok_at ?? null,
    last_error: errMsg,
    consecutive_failures: newFailures,
  };
  const shouldDemote = newFailures >= MAX_FAILURES;
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
    if (result.logged > 0) {
      console.info(`[lore] blog ${feed.name} ingested ${result.logged} pick(s)`);
    }
    await writeHealthOk(feed.id, feed.health).catch((err) =>
      console.error("[blog-poller] health write failed", feed.id, err),
    );

    // Queue any new outbound domains from ingested posts for cross-ref discovery.
    // We re-fetch the feed text here via result; since ingestBlogFeed doesn't
    // return the raw HTML of posts, we queue the feed URL's domain's outbound
    // links from the feed XML itself (links in items are outbound too).
    const sourceDomain = new URL(feed.feedUrl).hostname;
    queueCrossRefDiscovery(
      result.feedLinks ?? [],
      sourceDomain,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[lore] blog poll failed", feed.feedUrl, err);
    await writeHealthFail(feed.id, msg, feed.health).catch((e) =>
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
