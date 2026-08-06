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

    const body = req.body as { songs?: unknown };
    if (!Array.isArray(body.songs)) {
      return res.status(400).json({ error: "songs array required" });
    }

    const songs = body.songs as AppleSong[];
    if (songs.length > 500) {
      return res.status(400).json({ error: "Too many songs in one batch (max 500)" });
    }

    // ── Upsert into apple_library_items ─────────────────────────────────────
    let inserted = 0;
    for (const song of songs) {
      if (!song.appleId || typeof song.appleId !== "string") continue;
      if (!song.title || typeof song.title !== "string") continue;
      if (!song.artist || typeof song.artist !== "string") continue;

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
            isrc       = COALESCE(EXCLUDED.isrc, apple_library_items.isrc)
        `);
        inserted++;
      } catch {
        // Per-row failures are swallowed — the batch continues.
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
              '{"kind":"keep"}'::jsonb,
              NOW()
            )
            ON CONFLICT (user_id, mbid) DO NOTHING
          `);
          resolved++;
        } catch { /* ignore */ }
      }
    }

    return res.json({ received: songs.length, inserted, resolved });
  }));

  // GET /me/apple-library-import/status
  router.get("/me/apple-library-import/status", h(async (req, res) => {
    const user = (req as AuthedRequest).loreUser;

    const result = await db.execute<{ total: string; resolved: string }>(sql`
      SELECT
        COUNT(*)::text                                   AS total,
        COUNT(*) FILTER (WHERE mbid IS NOT NULL)::text  AS resolved
        FROM apple_library_items
       WHERE user_id = ${user.id}
    `);

    const row = result.rows[0];
    return res.json({
      total: parseInt(row?.total ?? "0", 10),
      resolved: parseInt(row?.resolved ?? "0", 10),
    });
  }));
}
