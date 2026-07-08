import { Router, type IRouter } from "express";
import {
  ListSelectorsResponse,
  GetSelectorRunsParams,
  GetSelectorRunsResponse,
} from "@workspace/api-zod";
import {
  db,
  pickersTable,
  showsTable,
  spinsTable,
} from "@workspace/db";
import { eq, and, asc, isNotNull, inArray, sql } from "drizzle-orm";
import { getPickerByHandle } from "../../lore/picks.js";
import { h } from "../../middlewares/asyncHandler.js";

const router: IRouter = Router();

// GET /api/selectors — public list of KEXP DJ selectors with recent spin counts.
router.get("/selectors", h(async (_req, res) => {
  const pickers = await db
    .select({
      id: pickersTable.id,
      name: pickersTable.name,
      handle: pickersTable.handle,
      homeUrl: pickersTable.homeUrl,
    })
    .from(pickersTable)
    .where(
      and(
        eq(pickersTable.active, true),
        eq(pickersTable.pickerType, "dj"),
        sql`${pickersTable.sourceRef}->>'stationSlug' = 'kexp'`,
      ),
    )
    .orderBy(asc(pickersTable.name));

  if (pickers.length === 0) {
    return res.json(ListSelectorsResponse.parse({ selectors: [] }));
  }

  const pickerIds = pickers.map((p) => p.id);

  // Find shows linked to these pickers.
  const shows = await db
    .select({
      id: showsTable.id,
      pickerId: showsTable.pickerId,
    })
    .from(showsTable)
    .where(
      and(
        isNotNull(showsTable.pickerId),
        inArray(showsTable.pickerId, pickerIds),
      ),
    );

  const showIds = shows.map((s) => s.id);
  const pickerIdByShowId = new Map(shows.map((s) => [s.id, s.pickerId as number]));

  const statsByPickerId = new Map<
    number,
    { recentSpinCount: number; lastPlayedAt: string | null }
  >();

  if (showIds.length > 0) {
    type StatRow = { showId: number; recentSpinCount: number; lastPlayedAt: Date | null };
    const rows = await db.execute<StatRow>(sql`
      SELECT
        show_id AS "showId",
        COUNT(*)::int AS "recentSpinCount",
        MAX(played_at) AS "lastPlayedAt"
      FROM spins
      WHERE show_id = ANY(ARRAY[${sql.join(showIds, sql`, `)}]::integer[])
        AND played_at >= NOW() - INTERVAL '30 days'
      GROUP BY show_id
    `);

    for (const r of rows.rows) {
      const pickerId = pickerIdByShowId.get(r.showId);
      if (pickerId == null) continue;
      const existing = statsByPickerId.get(pickerId);
      const count = r.recentSpinCount ?? 0;
      const at = r.lastPlayedAt ? new Date(r.lastPlayedAt).toISOString() : null;
      if (!existing) {
        statsByPickerId.set(pickerId, { recentSpinCount: count, lastPlayedAt: at });
      } else {
        statsByPickerId.set(pickerId, {
          recentSpinCount: existing.recentSpinCount + count,
          lastPlayedAt:
            at && (!existing.lastPlayedAt || at > existing.lastPlayedAt)
              ? at
              : existing.lastPlayedAt,
        });
      }
    }
  }

  return res.json(
    ListSelectorsResponse.parse({
      selectors: pickers.map((p) => {
        const stats = statsByPickerId.get(p.id);
        return {
          id: p.id,
          name: p.name,
          handle: p.handle,
          homeUrl: p.homeUrl ?? null,
          recentSpinCount: stats?.recentSpinCount ?? 0,
          lastPlayedAt: stats?.lastPlayedAt ?? null,
        };
      }),
    }),
  );
}));

// GET /api/selectors/:handle/runs — station runs for a KEXP DJ selector, newest first.
// A "run" here is one show+UTC-day combination from the spins table.
router.get("/selectors/:handle/runs", h(async (req, res) => {
  const parsed = GetSelectorRunsParams.safeParse(req.params);
  if (!parsed.success) {
    return res.status(404).json({ error: "Selector not found" });
  }

  const picker = await getPickerByHandle(parsed.data.handle);
  const isKexpDj =
    picker?.pickerType === "dj" &&
    (picker.sourceRef as Record<string, unknown> | null | undefined)?.[
      "stationSlug"
    ] === "kexp";
  if (!picker || !isKexpDj) {
    return res.status(404).json({ error: "Selector not found" });
  }

  const shows = await db
    .select({
      id: showsTable.id,
      name: showsTable.name,
      djName: showsTable.djName,
    })
    .from(showsTable)
    .where(eq(showsTable.pickerId, picker.id));

  if (shows.length === 0) {
    return res.json(
      GetSelectorRunsResponse.parse({
        selector: {
          id: picker.id,
          name: picker.name,
          handle: picker.handle,
          homeUrl: picker.homeUrl ?? null,
        },
        runs: [],
      }),
    );
  }

  const showIds = shows.map((s) => s.id);
  const showMap = new Map(shows.map((s) => [s.id, s]));

  type RunRow = {
    runId: number;
    showId: number | null;
    day: string;
    spinCount: number;
    startedAt: string;
  };

  const runRows = await db.execute<RunRow>(sql`
    SELECT
      MIN(id)::int                              AS "runId",
      show_id                                   AS "showId",
      (DATE(played_at AT TIME ZONE 'UTC'))::text AS day,
      COUNT(*)::int                             AS "spinCount",
      MIN(played_at)                            AS "startedAt"
    FROM spins
    WHERE show_id = ANY(ARRAY[${sql.join(showIds, sql`, `)}]::integer[])
    GROUP BY show_id, DATE(played_at AT TIME ZONE 'UTC')
    ORDER BY MIN(played_at) DESC
    LIMIT 100
  `);

  return res.json(
    GetSelectorRunsResponse.parse({
      selector: {
        id: picker.id,
        name: picker.name,
        handle: picker.handle,
        homeUrl: picker.homeUrl ?? null,
      },
      runs: runRows.rows.map((r) => {
        const show = r.showId != null ? showMap.get(r.showId) : null;
        return {
          runId: r.runId,
          date: r.day ?? null,
          show: show ? { name: show.name, djName: show.djName ?? null } : null,
          spinCount: r.spinCount,
          startedAt: r.startedAt ? new Date(r.startedAt).toISOString() : null,
        };
      }),
    }),
  );
}));

export default router;
