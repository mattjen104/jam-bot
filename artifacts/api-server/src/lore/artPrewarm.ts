/**
 * Art pre-warm job — runs every 5 minutes on a low-priority background
 * interval. Walks recordings aired in the last 48 hours and stores any
 * artworkUrl not yet in Object Storage so common covers are cache-warm
 * before a user requests them.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { isSafeArtworkUrl } from "./share.js";
import { artExists, artPut } from "../lib/artStorage.js";

const PREWARM_INTERVAL_MS = 5 * 60 * 1_000; // 5 minutes
const BATCH_SIZE = 30;
const CONCURRENCY = 3;

async function fetchAndStore(url: string): Promise<void> {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    if (!(await isSafeArtworkUrl(current))) return;
    let res: globalThis.Response;
    try {
      res = await fetch(current, {
        signal: AbortSignal.timeout(8_000),
        redirect: "manual",
        headers: { Accept: "image/*,*/*;q=0.8" },
      });
    } catch {
      return;
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return;
      current = new URL(loc, current).toString();
      continue;
    }
    if (!res.ok) return;
    const ct = res.headers.get("content-type") ?? "image/jpeg";
    if (!ct.startsWith("image/")) return;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > 8_000_000) return;
    await artPut(url, buf, ct);
    return;
  }
}

async function runPrewarm(): Promise<void> {
  try {
    const rows = await db.execute<{ artwork_url: string }>(sql`
      SELECT DISTINCT r.artwork_url
      FROM spins sp
      JOIN recordings r ON r.mbid = sp.mbid
      WHERE r.artwork_url IS NOT NULL
        AND sp.played_at > NOW() - INTERVAL '48 hours'
      ORDER BY r.artwork_url
      LIMIT ${BATCH_SIZE}
    `);

    const urls = rows.rows
      .map((r) => r.artwork_url)
      .filter((u): u is string => typeof u === "string" && u.length > 0);

    let warmed = 0;
    for (let i = 0; i < urls.length; i += CONCURRENCY) {
      const batch = urls.slice(i, i + CONCURRENCY);
      await Promise.all(
        batch.map(async (url) => {
          try {
            if (await artExists(url)) return;
            await fetchAndStore(url);
            warmed++;
          } catch {
            // Best-effort
          }
        }),
      );
      // Small pause between batches to avoid hammering origins/storage
      await new Promise((r) => setTimeout(r, 500));
    }

    if (warmed > 0) {
      console.log(`[art-prewarm] warmed ${warmed}/${urls.length} artwork URLs`);
    }
  } catch (err) {
    console.error("[art-prewarm] tick error", err);
  }
}

let _started = false;

export function startArtPrewarm(): void {
  if (_started) return;
  _started = true;

  // First run 60 s after boot — let the server settle first.
  const t = setTimeout(() => {
    void runPrewarm();
    const interval = setInterval(() => void runPrewarm(), PREWARM_INTERVAL_MS);
    // Don't block process exit
    interval.unref();
  }, 60_000);
  t.unref();
}
