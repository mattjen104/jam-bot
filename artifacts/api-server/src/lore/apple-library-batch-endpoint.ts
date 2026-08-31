/**
 * Apple Music library import — batch ingestion endpoint helpers.
 *
 * The client-side MusicKit JS API fetches the user's Apple Music library
 * songs and POSTs each page here.  The server resolves ISRC → MBID and
 * stores rows in the `apple_library_items` staging table, then promotes
 * matched rows to `library_items` (service-agnostic keeps).
 *
 * This module exports the mount helper so it can be called from library.ts.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { h } from "../middlewares/asyncHandler.js";
import type { AuthedRequest } from "../routes/me/auth.js";
import type { Router } from "express";

/** One song entry sent by the MusicKit client. */
interface AppleSong {
  appleId: string;
  title: string;
  artist: string;
  albumName?: string | null;
  artworkUrl?: string | null;
  isrc?: string | null;
}

/**
 * Mount the Apple Music library import endpoints onto the given router.
 * Exposed at:
 *   POST /me/apple-library-import          — ingest a batch of songs
 *   GET  /me/apple-library-import/status   — count total/resolved rows
 */
export function mountAppleLibraryImport(router: Router): void {
  // POST /me/apple-library-import
  router.post("/me/apple-library-import", h(async (req, res) => {
    const user = (req as AuthedRequest).loreUser;

    const body = req.body as { songs?: unknown; complete?: unknown };
    if (!Array.isArray(body.songs)) {
      return res.status(400).json({ error: "songs array required" });
    }

    const songs = body.songs as AppleSong[];
    const complete = body.complete === true;
    if (songs.length > 500) {
      return res.status(400).json({ error: "Too many songs in one batch (max 500)" });
    }

    // ── Upsert into apple_library_items ─────────────────────────────────────
    let inserted = 0;
    const failures: Array<{ index: number; reason: string }> = [];
    for (const [index, song] of songs.entries()) {
      if (!song || typeof song !== "object") {
        failures.push({ index, reason: "song must be an object" });
        continue;
      }
      if (!song.appleId || typeof song.appleId !== "string") {
        failures.push({ index, reason: "appleId is required" });
        continue;
      }
      if (!song.title || typeof song.title !== "string") {
        failures.push({ index, reason: "title is required" });
        continue;
      }
      if (!song.artist || typeof song.artist !== "string") {
        failures.push({ index, reason: "artist is required" });
        continue;
      }

      try {
        await db.execute(sql`
          INSERT INTO apple_library_items (user_id, apple_id, title, artist, album_name, artwork_url, isrc)
          VALUES (
            ${user.id},
            ${song.appleId.trim()},
            ${song.title.trim()},
            ${song.artist.trim()},
            ${song.albumName?.trim() ?? null},
            ${song.artworkUrl?.trim() ?? null},
            ${song.isrc?.trim().toUpperCase() ?? null}
          )
          ON CONFLICT (user_id, apple_id) DO UPDATE SET
            title      = EXCLUDED.title,
            artist     = EXCLUDED.artist,
            album_name = EXCLUDED.album_name,
             artwork_url = COALESCE(EXCLUDED.artwork_url, apple_library_items.artwork_url),
            isrc       = COALESCE(EXCLUDED.isrc, apple_library_items.isrc)
        `);
        inserted++;
      } catch (error) {
        failures.push({
          index,
          reason: error instanceof Error ? error.message : "database write failed",
        });
      }
    }

    // ── Resolve ISRCs → MBIDs for newly inserted rows ────────────────────────
    // Find rows for this user that have an ISRC but no MBID yet (up to 500).
    const toResolve = await db.execute<{
      id: number;
      isrc: string;
    }>(sql`
      SELECT id, isrc
        FROM apple_library_items
       WHERE user_id = ${user.id}
         AND isrc IS NOT NULL
         AND mbid IS NULL
       LIMIT 500
    `);

    const rows = toResolve.rows;
    let resolved = 0;

    if (rows.length > 0) {
      const isrcs = [...new Set(rows.map((r) => r.isrc))];

      // Bulk ISRC lookup against recordings table.
      const matches = await db.execute<{ mbid: string; isrc: string }>(sql`
        SELECT mbid, isrc
          FROM recordings
         WHERE isrc = ANY(${isrcs}::text[])
      `);

      const isrcToMbid = new Map(matches.rows.map((r) => [r.isrc, r.mbid]));

      for (const row of rows) {
        const mbid = isrcToMbid.get(row.isrc);
        if (!mbid) continue;

        // Stamp MBID on the staging row.
        try {
          await db.execute(sql`
            UPDATE apple_library_items SET mbid = ${mbid}
             WHERE id = ${row.id}
          `);
        } catch { /* ignore */ }

        // Promote to library_items (service-agnostic keep).
        try {
          await db.execute(sql`
            INSERT INTO library_items (user_id, mbid, provenance, added_at)
            VALUES (
              ${user.id},
              ${mbid},
              '{"kind":"import","service":"apple_music","sourceKeepDate":false}'::jsonb,
              NOW()
            )
            ON CONFLICT (user_id, mbid) DO NOTHING
          `);
          resolved++;
        } catch { /* ignore */ }
      }
    }

    const counts = await db.execute<{ total: string; resolved: string }>(sql`
      SELECT
        COUNT(*)::text AS total,
        COUNT(*) FILTER (WHERE mbid IS NOT NULL)::text AS resolved
      FROM apple_library_items
      WHERE user_id = ${user.id}
    `);
    const total = parseInt(counts.rows[0]?.total ?? "0", 10);
    const totalResolved = parseInt(counts.rows[0]?.resolved ?? "0", 10);

    await db.execute(sql`
      INSERT INTO apple_library_import_state
        (user_id, pages, complete, last_error, updated_at, completed_at)
      VALUES (
        ${user.id},
        ${songs.length > 0 ? 1 : 0},
        ${complete && failures.length === 0},
        ${failures.length > 0 ? `${failures.length} rows failed` : null},
        NOW(),
        ${complete && failures.length === 0 ? new Date() : null}
      )
      ON CONFLICT (user_id) DO UPDATE SET
        pages = apple_library_import_state.pages + ${songs.length > 0 ? 1 : 0},
        complete = ${complete && failures.length === 0},
        last_error = ${failures.length > 0 ? `${failures.length} rows failed` : null},
        updated_at = NOW(),
        completed_at = CASE
          WHEN ${complete && failures.length === 0} THEN NOW()
          ELSE apple_library_import_state.completed_at
        END
    `);

    return res.status(failures.length > 0 ? 207 : 200).json({
      received: songs.length,
      inserted,
      resolved,
      total,
      totalResolved,
      failures,
      complete: complete && failures.length === 0,
    });
  }));

  // GET /me/apple-library-import/status
  router.get("/me/apple-library-import/status", h(async (req, res) => {
    const user = (req as AuthedRequest).loreUser;

    const result = await db.execute<{
      total: string;
      resolved: string;
      pages: number | null;
      complete: boolean | null;
      last_error: string | null;
    }>(sql`
      SELECT
        COUNT(items.id)::text AS total,
        COUNT(items.id) FILTER (WHERE items.mbid IS NOT NULL)::text AS resolved,
        state.pages,
        state.complete,
        state.last_error
      FROM apple_library_items items
      FULL JOIN apple_library_import_state state
        ON state.user_id = items.user_id
      WHERE COALESCE(items.user_id, state.user_id) = ${user.id}
      GROUP BY state.pages, state.complete, state.last_error
    `);

    const row = result.rows[0];
    return res.json({
      total: parseInt(row?.total ?? "0", 10),
      resolved: parseInt(row?.resolved ?? "0", 10),
      unresolved: Math.max(
        0,
        parseInt(row?.total ?? "0", 10) - parseInt(row?.resolved ?? "0", 10),
      ),
      pages: row?.pages ?? 0,
      received: parseInt(row?.total ?? "0", 10),
      complete: row?.complete ?? false,
      error: row?.last_error ?? null,
    });
  }));
}
