import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { h } from "../../middlewares/asyncHandler.js";
import { type AuthedRequest } from "./auth.js";

const router: IRouter = Router();

/**
 * Release attendance is a listener read model, not a property of the
 * library keep itself. Missing rows stay missing so the client can say
 * "Attendance unknown" instead of displaying a fabricated zero.
 */
router.get("/me/library/release-stats", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  const ids = String(req.query.rg ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .slice(0, 100);
  if (ids.length === 0) return res.json({ stats: {} });
  let rawSince: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(String(req.query.since ?? "{}"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      rawSince = parsed as Record<string, unknown>;
    }
  } catch {
    rawSince = {};
  }
  const requested = ids.map((id) => {
    const value = rawSince[id];
    if (typeof value !== "string") return { id, since: null };
    const parsed = new Date(value);
    return { id, since: Number.isNaN(parsed.getTime()) ? null : parsed.toISOString() };
  });

  const rows = await db.execute(sql`
    WITH requested("releaseGroupMbid", "sinceAt") AS (
      VALUES ${sql.join(
        requested.map(({ id, since }) => sql`(${id}, ${since}::timestamptz)`),
        sql`, `,
      )}
    )
    SELECT
      rrg.release_group_mbid AS "releaseGroupMbid",
      COUNT(DISTINCT rrg.recording_mbid)::int AS total,
      COUNT(DISTINCT CASE
        WHEN ar.spin_count > 0
          AND (requested."sinceAt" IS NULL OR ar.last_heard >= requested."sinceAt")
        THEN rrg.recording_mbid
      END)::int AS heard,
      (requested."sinceAt" IS NOT NULL) AS "sinceAdding"
    FROM requested
    JOIN recording_release_groups rrg
      ON rrg.release_group_mbid = requested."releaseGroupMbid"
    LEFT JOIN attendance_rollups ar
      ON ar.recording_mbid = rrg.recording_mbid
     AND ar.user_id = ${user.id}
    GROUP BY rrg.release_group_mbid, requested."sinceAt"
  `);

  const stats: Record<string, { heard: number; total: number; sinceAdding?: true }> = {};
  const resultRows = rows.rows as unknown as Array<{
    releaseGroupMbid: string;
    heard: number;
    total: number;
    sinceAdding: boolean;
  }>;
  for (const row of resultRows) {
    if (row.heard > 0 && row.total > 0) {
      stats[row.releaseGroupMbid] = {
        heard: row.heard,
        total: row.total,
        ...(row.sinceAdding ? { sinceAdding: true as const } : {}),
      };
    }
  }
  return res.json({ stats });
}));

export default router;