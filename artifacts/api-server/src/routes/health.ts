import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { getMigrationFailures, getMigrationCompletions } from "../lore/boot-migrations.js";

const router: IRouter = Router();

const startedAt = Date.now();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/health", async (_req, res) => {
  const uptimeSeconds = Math.floor((Date.now() - startedAt) / 1000);
  try {
    await db.execute(sql`SELECT 1`);
    res.json({ ok: true, db: "ok", uptimeSeconds });
  } catch {
    res.status(503).json({ ok: false, db: "error", uptimeSeconds });
  }
});

router.get("/health/migrations", async (_req, res) => {
  const failures = getMigrationFailures();
  const completions = await getMigrationCompletions();
  const ok = failures.length === 0;
  res
    .status(ok ? 200 : 503)
    .json({ ok, failures, completions });
});

/**
 * GET /health/station-silence
 *
 * DB-backed seven-day zero-spin audit. Returns every active, non-hidden,
 * crossing-eligible station that has a now-playing source configured but
 * logged zero spins in the past seven days. Does NOT use in-memory state —
 * the query runs against the spins table so the result is accurate even on
 * a fresh boot.
 *
 * Results are split into two categories:
 *
 *   neverSeen — stations that have NEVER logged a spin (last_spin_at IS
 *               NULL). Typically: new enrollments that haven't had a chance
 *               to produce data yet, or adapters that have always been broken.
 *
 *   previouslyActive — stations that had at least one spin historically
 *               but have logged nothing in the last seven days. These are
 *               the operationally interesting entries: a working feed has
 *               gone silent and needs investigation.
 *
 * Admin-only route; no auth here — keep it on the internal admin surface.
 */
router.get("/health/station-silence", async (_req, res) => {
  try {
    type SilenceRow = {
      id: number;
      slug: string;
      name: string;
      now_playing_source: string;
      created_at: string;
      last_spin_at: string | null;
    };
    const rows = await db.execute<SilenceRow>(sql`
      SELECT
        s.id,
        s.slug,
        s.name,
        s.now_playing_source,
        s.created_at,
        (SELECT MAX(sp.played_at)
         FROM spins sp
         WHERE sp.station_id = s.id) AS last_spin_at
      FROM stations s
      WHERE s.active = true
        AND s.hidden = false
        AND s.now_playing_source IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM spins sp
          WHERE sp.station_id = s.id
            AND sp.played_at >= NOW() - INTERVAL '7 days'
        )
      ORDER BY s.name
    `);

    const neverSeen: Array<{ id: number; slug: string; name: string; nowPlayingSource: string; createdAt: string }> = [];
    const previouslyActive: Array<{ id: number; slug: string; name: string; nowPlayingSource: string; lastSpinAt: string }> = [];

    for (const r of rows.rows) {
      if (r.last_spin_at === null) {
        neverSeen.push({
          id: r.id,
          slug: r.slug,
          name: r.name,
          nowPlayingSource: r.now_playing_source,
          createdAt: new Date(r.created_at).toISOString(),
        });
      } else {
        previouslyActive.push({
          id: r.id,
          slug: r.slug,
          name: r.name,
          nowPlayingSource: r.now_playing_source,
          lastSpinAt: new Date(r.last_spin_at).toISOString(),
        });
      }
    }

    res.json({
      monitoringNote: "active stations with a now-playing source and zero spins in the last 7 days",
      neverSeen,
      previouslyActive,
      totalSilent: neverSeen.length + previouslyActive.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(503).json({ ok: false, error: message });
  }
});

export default router;
