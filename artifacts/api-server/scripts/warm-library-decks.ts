/**
 * Warm the set-contexts cache for real listeners' libraries so the crate
 * renders decks instantly on next load. For each active device with a
 * meaningful library, mirrors the client's anchor list (mbid anchors for
 * resolved keeps, artist anchors for unresolved ones) and POSTs them in
 * chunks of 100 against the local API.
 *
 * The endpoint caches per (user, anchor) for 10 minutes, so this is worth
 * re-running after a restart or when a listener reports a slow crate.
 *
 * Run: pnpm --filter @workspace/api-server exec tsx scripts/warm-library-decks.ts
 */
import { db, libraryItemsTable, loreUsersTable, recordingsTable } from "@workspace/db";
import { and, eq, isNull, sql } from "drizzle-orm";

const API = process.env.WARM_API_BASE ?? "http://127.0.0.1:80";
const MIN_KEEPS = 50;
const MAX_USERS = 20;
const CHUNK = 100;

// The API server 503s while it is still booting after a restart.
async function waitForApi(): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const probe = await fetch(`${API}/api/me/library/set-contexts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ anchors: [] }),
      });
      if (probe.status !== 503) return; // 400/401 = route alive
    } catch { /* connection refused while booting */ }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error("API server never came up");
}
await waitForApi();

const users = await db.execute(sql`
  SELECT u.id, u.device_key, COUNT(li.id) AS keeps
  FROM library_items li
  JOIN lore_users u ON u.id = li.user_id
  WHERE li.removed_at IS NULL
  GROUP BY u.id
  HAVING COUNT(li.id) >= ${MIN_KEEPS}
  ORDER BY keeps DESC
  LIMIT ${MAX_USERS}
`);

let totalAnchors = 0;
let totalMs = 0;
for (const row of users.rows as Array<{ id: number; device_key: string; keeps: string }>) {
  const items = await db
    .select({ mbid: libraryItemsTable.mbid, artist: recordingsTable.artist })
    .from(libraryItemsTable)
    .leftJoin(recordingsTable, eq(recordingsTable.mbid, libraryItemsTable.mbid))
    .where(and(eq(libraryItemsTable.userId, row.id), isNull(libraryItemsTable.removedAt)));

  const anchors: Array<{ mbid: string } | { artist: string }> = [];
  const seen = new Set<string>();
  for (const item of items) {
    const anchor = item.mbid
      ? { key: `mbid:${item.mbid}`, body: { mbid: item.mbid } as { mbid: string } }
      : item.artist?.trim()
        ? { key: `artist:${item.artist.trim().toLowerCase()}`, body: { artist: item.artist.trim() } as { artist: string } }
        : null;
    if (anchor && !seen.has(anchor.key)) {
      seen.add(anchor.key);
      anchors.push(anchor.body);
    }
  }

  const t0 = Date.now();
  let firstChunkMs = 0;
  for (let i = 0; i < anchors.length; i += CHUNK) {
    const t = Date.now();
    let res: Response | null = null;
    for (let retry = 0; retry < 4; retry++) {
      res = await fetch(`${API}/api/me/library/set-contexts`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: `lore_sid=${row.device_key}` },
        body: JSON.stringify({ anchors: anchors.slice(i, i + CHUNK) }),
      });
      if (res.status !== 503) break; // server briefly 503s under boot/recompute load
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
    if (!res!.ok) throw new Error(`warm failed for ${row.device_key}: HTTP ${res!.status}`);
    await res.json();
    if (i === 0) firstChunkMs = Date.now() - t;
  }
  const elapsed = Date.now() - t0;
  totalAnchors += anchors.length;
  totalMs += elapsed;
  console.log(`${row.device_key.slice(0, 8)}… keeps=${row.keeps} anchors=${anchors.length} coldChunk=${firstChunkMs}ms total=${elapsed}ms`);
}
console.log(`warmed ${users.rows.length} devices, ${totalAnchors} anchors in ${totalMs}ms`);
process.exit(0);
