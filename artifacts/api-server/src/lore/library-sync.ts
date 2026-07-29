/**
 * Spotify library sync worker — push the user's Lore library to Spotify
 * saved tracks, with an honest completion receipt.
 *
 * Receipt buckets:
 *   synced         — ISRC or Odesli-link match, successfully saved
 *   searchMatched  — artist+title search match, successfully saved (lower confidence)
 *   alreadySaved   — was already in Spotify before the sync (idempotent skip)
 *   unavailable    — no Spotify match found; listed with Bandcamp search links
 *
 * API usage:
 *   All calls use the USER's service_connections token (not the app client).
 *   Search: 150ms gap between calls (generous for user-OAuth quota).
 *   Contains check: 50 IDs per call.
 *   Save: 50 IDs per PUT /me/tracks (Spotify hard limit).
 */

import { db, librarySyncJobsTable, libraryItemsTable, recordingsTable, serviceConnectionsTable } from "@workspace/db";
import type { SyncReceipt, SyncReceiptUnavailableItem, SyncReceiptSearchItem } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { decryptToken, encryptToken } from "./tokenCrypto.js";
import { refreshServiceToken } from "./serviceConnector.js";
import { extractSpotifyTrackId } from "./spotifyConnect.js";

const API_BASE = "https://api.spotify.com/v1";
/** Gap between per-track Spotify search calls. */
const SEARCH_GAP_MS = 150;
/** Max IDs per contains-check or save call (Spotify hard limit). */
const BATCH_SIZE = 50;
/** Max items in the receipt lists (avoids huge jsonb). */
const RECEIPT_LIST_CAP = 200;
/** Zombie-reset threshold: a job older than this is considered orphaned. */
export const SYNC_ZOMBIE_AGE_MS = 30 * 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Bandcamp search URL for a given artist + title. */
function bandcampUrl(artist: string, title: string): string {
  return `https://bandcamp.com/search?q=${encodeURIComponent(`${artist} ${title}`)}`;
}

// ---------------------------------------------------------------------------
// Spotify user-token API helpers (no app-client pacing applies here)
// ---------------------------------------------------------------------------

interface SpotifySearchHit {
  id: string;
  uri: string;
  spotifyUrl: string;
}

async function spotifySearchUser(
  token: string,
  q: string,
): Promise<SpotifySearchHit | null> {
  const res = await fetch(
    `${API_BASE}/search?type=track&limit=1&q=${encodeURIComponent(q)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (res.status === 429) {
    const wait = Number(res.headers.get("retry-after") ?? 5);
    console.warn(`[sync] Spotify search 429 — waiting ${wait}s`);
    await sleep((wait + 1) * 1000);
    // Retry once.
    const r2 = await fetch(
      `${API_BASE}/search?type=track&limit=1&q=${encodeURIComponent(q)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!r2.ok) return null;
    return parseSearchHit(await r2.json());
  }
  if (!res.ok) return null;
  return parseSearchHit(await res.json());
}

function parseSearchHit(body: unknown): SpotifySearchHit | null {
  const b = body as { tracks?: { items?: Array<{ id?: string; uri?: string; external_urls?: { spotify?: string } }> } };
  const item = b?.tracks?.items?.[0];
  if (!item?.id || !item.uri) return null;
  return {
    id: item.id,
    uri: item.uri,
    spotifyUrl: item.external_urls?.spotify ?? `https://open.spotify.com/track/${item.id}`,
  };
}

/**
 * Check which of the given track IDs are already saved.
 * Returns a Set of confirmed-saved IDs.
 * 429s are retried once with Retry-After backoff rather than silently skipped,
 * so alreadySaved accounting stays honest.
 */
async function containsCheck(token: string, ids: string[]): Promise<Set<string>> {
  const saved = new Set<string>();
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);
    let res = await fetch(
      `${API_BASE}/me/tracks/contains?ids=${batch.join(",")}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (res.status === 429) {
      const wait = Number(res.headers.get("retry-after") ?? 5);
      console.warn(`[sync] contains-check 429 — waiting ${wait}s`);
      await sleep((wait + 1) * 1000);
      res = await fetch(
        `${API_BASE}/me/tracks/contains?ids=${batch.join(",")}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
    }
    if (!res.ok) {
      // Still failed after retry: treat as unknown (will attempt to save;
      // Spotify PUT /me/tracks is idempotent so re-adding is safe).
      console.warn(`[sync] contains-check batch failed (${res.status}) — treating as unsaved`);
      continue;
    }
    const flags = (await res.json()) as boolean[];
    flags.forEach((f, j) => { if (f) saved.add(batch[j]!); });
    if (i + BATCH_SIZE < ids.length) await sleep(100);
  }
  return saved;
}

/**
 * Save track IDs in batches of 50.
 * Returns the Set of IDs that were *confirmed* saved (batch PUT succeeded).
 * Failed batches are logged but do not throw — they are excluded from the
 * confirmed set so receipt counts stay honest.
 */
async function saveBatched(token: string, ids: string[]): Promise<Set<string>> {
  const confirmed = new Set<string>();
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);
    let res = await fetch(`${API_BASE}/me/tracks`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ids: batch }),
    });
    if (res.status === 429) {
      const wait = Number(res.headers.get("retry-after") ?? 10);
      console.warn(`[sync] Spotify save 429 — waiting ${wait}s`);
      await sleep((wait + 1) * 1000);
      res = await fetch(`${API_BASE}/me/tracks`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ids: batch }),
      });
    }
    if (res.ok) {
      batch.forEach((id) => confirmed.add(id));
    } else {
      console.error(`[sync] save batch failed (${res.status}) — ${batch.length} tracks not saved`);
    }
    if (i + BATCH_SIZE < ids.length) await sleep(100);
  }
  return confirmed;
}

// ---------------------------------------------------------------------------
// Token refresh helper (mirrors getFreshToken in me/index.ts)
// ---------------------------------------------------------------------------

async function getFreshUserToken(
  conn: typeof serviceConnectionsTable.$inferSelect,
): Promise<{ token: string; conn: typeof serviceConnectionsTable.$inferSelect } | null> {
  const plainAccess = decryptToken(conn.accessToken);
  if (conn.expiresAt.getTime() > Date.now()) {
    return { token: plainAccess, conn };
  }
  try {
    const plainRefresh = decryptToken(conn.refreshToken);
    const refreshed = await refreshServiceToken(plainRefresh);
    const [updated] = await db
      .update(serviceConnectionsTable)
      .set({
        accessToken: encryptToken(refreshed.accessToken),
        expiresAt: refreshed.expiresAt,
      })
      .where(eq(serviceConnectionsTable.id, conn.id))
      .returning();
    return { token: refreshed.accessToken, conn: updated ?? conn };
  } catch (err) {
    console.error("[sync] token refresh failed", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main worker
// ---------------------------------------------------------------------------

export async function runSyncWorker(
  jobId: number,
  userId: number,
  conn: typeof serviceConnectionsTable.$inferSelect,
): Promise<void> {
  const stamp = (patch: object) =>
    db.update(librarySyncJobsTable).set(patch).where(eq(librarySyncJobsTable.id, jobId));

  try {
    console.log(`[me/sync] job=${jobId} starting`);
    await stamp({ status: "running", phase: "matching" });

    // Refresh token before the first call.
    // `currentConn` is mutable so mid-job refreshes carry forward the updated expiry.
    const tokenResult = await getFreshUserToken(conn);
    if (!tokenResult) {
      await stamp({ status: "error", error: "Token refresh failed", finishedAt: new Date() });
      return;
    }
    let token = tokenResult.token;
    let currentConn = tokenResult.conn;

    // ── Load the full library ────────────────────────────────────────────────
    const items = await db
      .select({
        mbid: libraryItemsTable.mbid,
        title: recordingsTable.title,
        artist: recordingsTable.artist,
        isrc: recordingsTable.isrc,
        links: recordingsTable.links,
      })
      .from(libraryItemsTable)
      .innerJoin(recordingsTable, eq(libraryItemsTable.mbid, recordingsTable.mbid))
      .where(eq(libraryItemsTable.userId, userId));

    const total = items.length;
    await stamp({ total, phase: "matching" });
    console.log(`[me/sync] job=${jobId} library: ${total} items`);

    // ── Phase 1: Match each item to a Spotify track ID ───────────────────────
    // Priority: Odesli-link (exact, no API call) → ISRC search → text search.

    interface MatchedItem {
      mbid: string;
      title: string;
      artist: string;
      spotifyId: string;
      confidence: "link" | "isrc" | "search";
    }
    interface UnmatchedItem {
      mbid: string;
      title: string;
      artist: string;
    }

    const matched: MatchedItem[] = [];
    const unmatched: UnmatchedItem[] = [];

    let processed = 0;
    const STAMP_EVERY = 20;

    for (const item of items) {
      // Refresh token mid-job if it's within 30s of expiry.
      // Update currentConn so subsequent iterations see the new expiry.
      if (currentConn.expiresAt.getTime() < Date.now() + 30_000) {
        const r = await getFreshUserToken(currentConn);
        if (r) { token = r.token; currentConn = r.conn; }
      }

      let spotifyId: string | null = null;
      let confidence: "link" | "isrc" | "search" = "link";

      // 1a. Odesli link (no API call)
      const linkedId = item.links ? extractSpotifyTrackId(item.links) : null;
      if (linkedId) {
        spotifyId = linkedId;
        confidence = "link";
      }

      // 1b. ISRC search
      if (!spotifyId && item.isrc) {
        await sleep(SEARCH_GAP_MS);
        const hit = await spotifySearchUser(token, `isrc:${item.isrc}`);
        if (hit) {
          spotifyId = hit.id;
          confidence = "isrc";
        }
      }

      // 1c. Text search
      if (!spotifyId && item.title && item.artist) {
        await sleep(SEARCH_GAP_MS);
        const hit = await spotifySearchUser(
          token,
          `track:"${item.title}" artist:"${item.artist}"`,
        );
        if (hit) {
          spotifyId = hit.id;
          confidence = "search";
        }
      }

      if (spotifyId) {
        matched.push({ mbid: item.mbid, title: item.title, artist: item.artist, spotifyId, confidence });
      } else {
        unmatched.push({ mbid: item.mbid, title: item.title, artist: item.artist });
      }

      processed++;
      if (processed % STAMP_EVERY === 0) {
        await stamp({ processed });
      }
    }

    await stamp({ processed, phase: "checking" });

    // ── Phase 2: Contains check — idempotency pre-filter ────────────────────
    const matchedIds = matched.map((m) => m.spotifyId);
    const alreadySavedSet = await containsCheck(token, matchedIds);

    const toSave = matched.filter((m) => !alreadySavedSet.has(m.spotifyId));
    const alreadySavedCount = matched.length - toSave.length;

    // ── Phase 3: Save in batches ─────────────────────────────────────────────
    await stamp({ phase: "saving" });

    const toSaveIds = toSave.map((m) => m.spotifyId);
    const confirmedSavedIds = await saveBatched(token, toSaveIds);

    // ── Build receipt from *confirmed* saves only ────────────────────────────
    // toSave items whose spotifyId is NOT in confirmedSavedIds were attempted
    // but the PUT batch failed — they are not counted as synced.
    const exactSynced = toSave.filter(
      (m) => confirmedSavedIds.has(m.spotifyId) && (m.confidence === "link" || m.confidence === "isrc"),
    );
    const searchSynced = toSave.filter(
      (m) => confirmedSavedIds.has(m.spotifyId) && m.confidence === "search",
    );

    const unavailableItems: SyncReceiptUnavailableItem[] = unmatched
      .slice(0, RECEIPT_LIST_CAP)
      .map((u) => ({
        mbid: u.mbid,
        title: u.title,
        artist: u.artist,
        bandcampUrl: bandcampUrl(u.artist, u.title),
      }));

    // Full MBID list (no cap) — used by the /unavailable download endpoint.
    const unavailableMbids = unmatched.map((u) => u.mbid);

    const searchMatchedItems: SyncReceiptSearchItem[] = searchSynced
      .slice(0, RECEIPT_LIST_CAP)
      .map((m) => ({
        mbid: m.mbid,
        title: m.title,
        artist: m.artist,
        spotifyUrl: `https://open.spotify.com/track/${m.spotifyId}`,
      }));

    const receipt: SyncReceipt = {
      synced: exactSynced.length,
      searchMatched: searchSynced.length,
      alreadySaved: alreadySavedCount,
      unavailable: unmatched.length,
      unavailableItems,
      unavailableMbids,
      searchMatchedItems,
    };

    await stamp({
      status: "done",
      phase: null,
      processed: total,
      results: receipt,
      finishedAt: new Date(),
    });

    console.log(
      `[me/sync] job=${jobId} done — synced=${receipt.synced} search=${receipt.searchMatched} ` +
      `already=${receipt.alreadySaved} unavailable=${receipt.unavailable}`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[me/sync] job=${jobId} failed`, err);
    await db
      .update(librarySyncJobsTable)
      .set({ status: "error", error: msg, finishedAt: new Date(), phase: null })
      .where(eq(librarySyncJobsTable.id, jobId));
  }
}
