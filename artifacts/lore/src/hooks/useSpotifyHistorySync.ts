import { useEffect, useRef } from "react";
import { appendJournal, patchJournalEntry, journalHasRecentEntry } from "../lib/local";

/**
 * Polls GET /api/spotify/recently-played every 5 minutes (and once on mount)
 * and writes new Spotify plays into the local journal with kind: "spotify".
 *
 * Cursor strategy: the last-seen played_at timestamp is stored in localStorage
 * under `lore:spotify-sync:cursor` (as a Unix ms integer). Each successful
 * fetch advances the cursor to the newest track's timestamp + 1 ms so the
 * next poll only fetches genuinely new plays.
 *
 * Dedup: appendJournal already has a 30-minute identity window, so tracks
 * heard around the same time via Lore radio won't create duplicates.
 *
 * MBID resolution: after writing the raw entry (mbid: null), we fire a
 * best-effort ISRC lookup via the existing /api/lore/resolve endpoint and
 * patch the entry in-place if it resolves — same pattern as Icecast fallback.
 *
 * Runs only when Spotify is connected; silently no-ops when the scope is
 * absent (server responds 204) so pre-reconnect tokens are handled gracefully.
 */

const CURSOR_KEY = "lore:spotify-sync:cursor";
const POLL_INTERVAL_MS = 5 * 60 * 1000;

function readCursor(): number | undefined {
  try {
    const raw = localStorage.getItem(CURSOR_KEY);
    if (!raw) return undefined;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  } catch {
    return undefined;
  }
}

function writeCursor(ms: number) {
  try {
    localStorage.setItem(CURSOR_KEY, String(ms));
  } catch {
    // Storage full/blocked — skip; we'll re-fetch next time.
  }
}

interface RecentTrack {
  playedAt: string;
  title: string;
  artist: string;
  isrc: string | null;
  artworkUrl: string | null;
  uri: string;
}

async function fetchRecent(after?: number): Promise<RecentTrack[] | null> {
  const url = after
    ? `/api/spotify/recently-played?after=${after}`
    : "/api/spotify/recently-played";
  const res = await fetch(url, { credentials: "include" });
  if (res.status === 204) return null;
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`recently-played ${res.status}`);
  const body = (await res.json()) as { tracks: RecentTrack[] };
  return body.tracks;
}

/** Best-effort: resolve an ISRC to an MBID via the API server. */
async function resolveIsrc(isrc: string): Promise<{ mbid: string; artistMbid: string | null } | null> {
  try {
    const res = await fetch(
      `/api/recordings/by-isrc/${encodeURIComponent(isrc)}`,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { mbid?: string; artistMbid?: string | null };
    return data.mbid ? { mbid: data.mbid, artistMbid: data.artistMbid ?? null } : null;
  } catch {
    return null;
  }
}

async function syncHistory(signal: AbortSignal) {
  const cursor = readCursor();
  const tracks = await fetchRecent(cursor);
  if (signal.aborted) return;
  if (tracks === null) return;
  if (tracks.length === 0) return;

  for (const t of [...tracks].reverse()) {
    if (signal.aborted) return;
    const at = t.playedAt;

    // Full-journal dedup check: skip if any entry matches within the 30-minute
    // window, regardless of its position in the journal. This handles the case
    // where the same track already exists from Lore radio listening around the
    // same time, and also prevents double-writes during oldest-first backfill
    // (where appendJournal's newest-only check would miss existing entries).
    if (journalHasRecentEntry(t.title, t.artist, null, at)) {
      continue;
    }

    appendJournal({
      at,
      kind: "spotify",
      mbid: null,
      artistMbid: null,
      title: t.title,
      artist: t.artist,
      artworkUrl: t.artworkUrl,
    });

    if (t.isrc) {
      void resolveIsrc(t.isrc).then((resolved) => {
        if (!resolved || signal.aborted) return;
        patchJournalEntry(
          at,
          t.title,
          t.artist,
          resolved.mbid,
          resolved.artistMbid,
          t.artworkUrl,
        );
      });
    }
  }

  const newestMs = new Date(tracks[0].playedAt).getTime();
  if (Number.isFinite(newestMs)) {
    writeCursor(newestMs + 1);
  }
}

export function useSpotifyHistorySync(connected: boolean) {
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!connected) return;

    const controller = new AbortController();
    abortRef.current = controller;

    void syncHistory(controller.signal).catch(() => {});

    timerRef.current = setInterval(() => {
      if (abortRef.current?.signal.aborted) return;
      void syncHistory(controller.signal).catch(() => {});
    }, POLL_INTERVAL_MS);

    return () => {
      controller.abort();
      abortRef.current = null;
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [connected]);
}
