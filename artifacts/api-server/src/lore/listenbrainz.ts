/**
 * ListenBrainz import adapter.
 *
 * Pages through the `user-feedback/recording-feedback?score=1` endpoint to
 * fetch a user's loved recordings.  Each result maps directly to an
 * `ImportItem` with a `recordingMbid` when the API provides one (Tier 1),
 * falling through to ISRC (Tier 2) or artist+title (Tier 3) otherwise.
 *
 * Rate: 1 request per second in line with MusicBrainz-family etiquette.
 * No API key required — ListenBrainz's feedback endpoint is public.
 */

import type { ImportItem } from "@workspace/db";

const LB_API_BASE = "https://api.listenbrainz.org";

/** Descriptive User-Agent per MusicBrainz / ListenBrainz etiquette. */
const LB_USER_AGENT = "Lore/1.0 (https://lore.fm; admin@lore.fm) node-fetch";

/** Items per page — ListenBrainz max is 100. */
const LB_PAGE_SIZE = 100;

/** Throttle between page fetches (1 req/sec). */
const LB_THROTTLE_MS = 1_000;

/** Raw shape of one feedback entry returned by the LB get-feedback endpoint. */
interface LbFeedbackEntry {
  created?: number;
  recording_mbid?: string | null;
  score?: number;
  track_metadata?: {
    artist_name?: string;
    track_name?: string;
    additional_info?: {
      isrc?: string | null;
      release_mbid?: string | null;
      release_name?: string | null;
    };
  };
}

/** Raw shape of the get-feedback API response. */
interface LbFeedbackResponse {
  count: number;
  offset: number;
  total_count: number;
  feedback: LbFeedbackEntry[];
}

// ---------------------------------------------------------------------------
// Username validation
// ---------------------------------------------------------------------------

/**
 * Check whether a ListenBrainz username exists.
 * Uses the lightweight listen-count endpoint (no auth needed).
 * Returns true if the user exists; false on 404; throws on unexpected errors.
 */
export async function validateListenBrainzUsername(username: string): Promise<boolean> {
  const url = `${LB_API_BASE}/1/user/${encodeURIComponent(username)}/listen-count`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { "User-Agent": LB_USER_AGENT } });
  } catch (err) {
    throw new Error(`ListenBrainz network error during username validation: ${(err as Error).message}`);
  }
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`ListenBrainz API returned ${res.status} during username validation`);
  return true;
}

// ---------------------------------------------------------------------------
// Loved-recordings fetcher
// ---------------------------------------------------------------------------

/**
 * Async iterable that pages through a user's loved (score=1) recordings on
 * ListenBrainz and yields one `ImportItem` per entry.
 *
 * Items whose `recording_mbid` is populated become Tier-1 hits (direct spine
 * write, zero MB queries).  Items without an MBID carry artist+title for
 * Tier-2/3 resolution by the import worker.
 */
export async function* fetchListenBrainzLoved(
  username: string,
  sleepFn: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): AsyncIterable<ImportItem> {
  let offset = 0;

  while (true) {
    const url =
      `${LB_API_BASE}/1/feedback/user/${encodeURIComponent(username)}/get-feedback` +
      `?score=1&count=${LB_PAGE_SIZE}&offset=${offset}&metadata=true`;

    let data: LbFeedbackResponse;
    try {
      const res = await fetch(url, { headers: { "User-Agent": LB_USER_AGENT } });
      if (res.status === 404) break; // user doesn't exist (or has no feedback)
      if (!res.ok) throw new Error(`ListenBrainz API returned ${res.status}`);
      data = (await res.json()) as LbFeedbackResponse;
    } catch (err) {
      throw new Error(`ListenBrainz fetch failed at offset=${offset}: ${(err as Error).message}`);
    }

    const feedbacks = data.feedback ?? [];
    for (const fb of feedbacks) {
      const meta = fb.track_metadata ?? {};
      const info = meta.additional_info ?? {};

      const artist = (meta.artist_name ?? "").trim();
      const title = (meta.track_name ?? "").trim();
      const recordingMbid = fb.recording_mbid?.trim() || undefined;
      const isrc = (info.isrc ?? "").trim() || undefined;
      const release = (info.release_name ?? "").trim() || undefined;

      // Skip entries with no useful identifiers at all.
      if (!recordingMbid && !artist && !title) continue;

      const addedAt =
        typeof fb.created === "number"
          ? new Date(fb.created * 1000).toISOString()
          : undefined;

      // sourceRef: prefer the stable recording MBID; fall back to composite key.
      const sourceRef = recordingMbid ?? (artist && title ? `${artist}\u001f${title}` : undefined);

      yield {
        recordingMbid,
        isrc,
        artist,
        title,
        release,
        sourceId: "listenbrainz",
        sourceRef,
        addedAt,
      };
    }

    if (feedbacks.length < LB_PAGE_SIZE) break; // last page
    offset += LB_PAGE_SIZE;

    // Throttle to 1 req/sec.
    await sleepFn(LB_THROTTLE_MS);
  }
}
