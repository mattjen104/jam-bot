import { db, pickersTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { ingestBlogFeed } from "./blog.js";

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
 */

// Blogs move at human pace; poll each feed every 30 minutes.
const BLOG_POLL_MS = 30 * 60 * 1000;
// Stagger feeds so we never fetch (and resolve against MusicBrainz) all at once.
const STAGGER_MS = 15_000;
// Let boot (seed + station backfill) settle before the first blog fetch.
const WARMUP_MS = 60_000;

let started = false;
const timers: NodeJS.Timeout[] = [];

/** A blog picker reduced to what the poller needs to ride its feed. */
interface BlogFeed {
  name: string;
  homeUrl: string | null;
  feedUrl: string;
}

/** Active blog pickers that carry a feed URL in their sourceRef. */
async function loadBlogFeeds(): Promise<BlogFeed[]> {
  const rows = await db
    .select({
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
    const feedUrl = (r.sourceRef as Record<string, unknown> | null)?.["feedUrl"];
    if (typeof feedUrl === "string" && feedUrl.trim()) {
      feeds.push({ name: r.name, homeUrl: r.homeUrl, feedUrl: feedUrl.trim() });
    }
  }
  return feeds;
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
  } catch (err) {
    console.error("[lore] blog poll failed", feed.feedUrl, err);
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
