import { ingestBlogFeed } from "./blog.js";
import { upsertPicker } from "./picks.js";

/**
 * Bandcamp Daily is an RSS publication.  We retain the publisher's feed
 * metadata and link readers back to it; article HTML and embedded players are
 * intentionally never fetched.
 */
export const BANDCAMP_DAILY_HANDLE = "bandcamp-daily";
const FEED_URL = "https://daily.bandcamp.com/index.rss";
const HOME_URL = "https://daily.bandcamp.com";
const POLL_MS = 12 * 60 * 60 * 1000;
const WARMUP_MS = 150_000;
let pollTimer: ReturnType<typeof setTimeout> | null = null;

export async function seedBandcampDailyPicker(): Promise<void> {
  await upsertPicker({
    pickerType: "blog",
    name: "Bandcamp Daily",
    handle: BANDCAMP_DAILY_HANDLE,
    homeUrl: HOME_URL,
    sourceRef: { feedUrl: FEED_URL },
    trustTier: 2,
    description: "Bandcamp Daily's RSS publication feed.",
  });
}

async function sync(): Promise<void> {
  await ingestBlogFeed({
    feedUrl: FEED_URL,
    name: "Bandcamp Daily",
    homeUrl: HOME_URL,
  });
}

export function startBandcampDailyPoller(): void {
  const run = async () => {
    try {
      await sync();
    } catch (err) {
      console.error("[bandcamp-daily] RSS ingest failed", err);
    } finally {
      pollTimer = setTimeout(run, POLL_MS);
    }
  };
  pollTimer = setTimeout(run, WARMUP_MS);
}

export function stopBandcampDailyPoller(): void {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
}