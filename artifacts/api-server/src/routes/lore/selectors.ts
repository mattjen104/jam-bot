import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import {
  ListSelectorsResponse,
  GetSelectorRunsParams,
  GetSelectorRunsResponse,
  GetSelectorInsightsParams,
  GetSelectorInsightsResponse,
} from "@workspace/api-zod";
import {
  db,
  pickersTable,
  showsTable,
  spinsTable,
  recordingsTable,
  selectorClaimsTable,
  serviceConnectionsTable,
  type LoreUser,
} from "@workspace/db";
import { eq, and, asc, isNotNull, inArray, sql } from "drizzle-orm";
import { getPickerByHandle } from "../../lore/picks.js";
import { h } from "../../middlewares/asyncHandler.js";
import { computeGenreBreakdown, computeDiscoveryScore } from "../../lore/genre-insights.js";
import { getUserFromSession } from "../../lore/userSession.js";
import { pickerNotOptedOut, isPickerOptedOut } from "./shared.js";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

/** Extend Request with the resolved user attached by requireUser. */
interface AuthedRequest extends Request {
  loreUser: LoreUser;
}

/**
 * Middleware: reads `lore_sid`, resolves the `lore_users` row, attaches it as
 * `req.loreUser`. Returns 401 when no session or no user row exists.
 */
async function requireUserMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = await getUserFromSession(req);
    if (!user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    (req as AuthedRequest).loreUser = user;
    next();
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// GET /api/selectors — public list of KEXP DJ selectors with recent spin counts.
// ---------------------------------------------------------------------------
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
        pickerNotOptedOut(pickersTable.id),
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

// ---------------------------------------------------------------------------
// GET /api/selectors/:handle/runs
// ---------------------------------------------------------------------------
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

  if (await isPickerOptedOut(picker.id)) {
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

// ---------------------------------------------------------------------------
// GET /api/selectors/:handle/insights
// ---------------------------------------------------------------------------
router.get("/selectors/:handle/insights", h(async (req, res) => {
  const parsed = GetSelectorInsightsParams.safeParse(req.params);
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

  if (await isPickerOptedOut(picker.id)) {
    return res.status(404).json({ error: "Selector not found" });
  }

  const selector = {
    id: picker.id,
    name: picker.name,
    handle: picker.handle,
    homeUrl: picker.homeUrl ?? null,
  };

  const shows = await db
    .select({ id: showsTable.id })
    .from(showsTable)
    .where(eq(showsTable.pickerId, picker.id));

  if (shows.length === 0) {
    return res.json(
      GetSelectorInsightsResponse.parse({
        selector,
        insights: {
          genreBreakdown: computeGenreBreakdown([]),
          discoveryScore: computeDiscoveryScore([]),
        },
      }),
    );
  }

  const showIds = shows.map((s) => s.id);
  const rows = await db
    .select({
      genres: recordingsTable.genres,
      releaseYear: recordingsTable.releaseYear,
      playedAt: spinsTable.playedAt,
    })
    .from(spinsTable)
    .innerJoin(recordingsTable, eq(spinsTable.mbid, recordingsTable.mbid))
    .where(inArray(spinsTable.showId, showIds));

  return res.json(
    GetSelectorInsightsResponse.parse({
      selector,
      insights: {
        genreBreakdown: computeGenreBreakdown(rows),
        discoveryScore: computeDiscoveryScore(
          rows.map((r) => ({ releaseYear: r.releaseYear, airedAt: r.playedAt })),
        ),
      },
    }),
  );
}));

// ---------------------------------------------------------------------------
// POST /api/selectors/:pickerId/opt-out
//
// Requires a valid lore_sid cookie (no Spotify login required). Sets
// optedOut = true on the selector_claims row (creating it if absent), which
// immediately suppresses the selector from all public surfaces. Returns 204.
// ---------------------------------------------------------------------------
router.post(
  "/selectors/:pickerId/opt-out",
  requireUserMiddleware,
  h(async (req, res) => {
    const user = (req as AuthedRequest).loreUser;

    const rawId = typeof req.params["pickerId"] === "string" ? req.params["pickerId"] : "";
    const pickerId = parseInt(rawId, 10);
    if (!Number.isFinite(pickerId)) {
      return res.status(400).json({ error: "Invalid pickerId" });
    }

    // Require a verified service connection — prevents auto-provisioned
    // anonymous sessions from silently claiming any picker.
    // A real selector will always have connected at least one service.
    const [conn] = await db
      .select({ id: serviceConnectionsTable.id })
      .from(serviceConnectionsTable)
      .where(eq(serviceConnectionsTable.userId, user.id))
      .limit(1);
    if (!conn) {
      return res.status(403).json({
        error: "A verified service connection is required to manage selector preferences",
      });
    }

    // Verify the picker exists.
    const [picker] = await db
      .select({ id: pickersTable.id })
      .from(pickersTable)
      .where(eq(pickersTable.id, pickerId))
      .limit(1);
    if (!picker) {
      return res.status(404).json({ error: "Selector not found" });
    }

    // Ownership model: the first authenticated user to claim a picker owns it.
    // If a claim already exists and belongs to a different user, reject.
    const [existingClaim] = await db
      .select({ userId: selectorClaimsTable.userId })
      .from(selectorClaimsTable)
      .where(eq(selectorClaimsTable.pickerId, pickerId))
      .limit(1);

    if (existingClaim && existingClaim.userId !== null && existingClaim.userId !== user.id) {
      return res.status(403).json({ error: "Not authorized to opt this selector out" });
    }

    await db
      .insert(selectorClaimsTable)
      .values({ pickerId, userId: user.id, optedOut: true })
      .onConflictDoUpdate({
        target: selectorClaimsTable.pickerId,
        set: { optedOut: true, userId: user.id },
      });

    return res.status(204).send();
  }),
);

// ---------------------------------------------------------------------------
// POST /api/selectors/:pickerId/opt-in
//
// Reverses an opt-out. Requires a full authenticated lore session and
// ownership: the claim's userId must match req.loreUser.id. Returns 204.
// ---------------------------------------------------------------------------
router.post(
  "/selectors/:pickerId/opt-in",
  requireUserMiddleware,
  h(async (req, res) => {
    const user = (req as AuthedRequest).loreUser;

    const rawId = typeof req.params["pickerId"] === "string" ? req.params["pickerId"] : "";
    const pickerId = parseInt(rawId, 10);
    if (!Number.isFinite(pickerId)) {
      return res.status(400).json({ error: "Invalid pickerId" });
    }

    // Verify the picker exists.
    const [picker] = await db
      .select({ id: pickersTable.id })
      .from(pickersTable)
      .where(eq(pickersTable.id, pickerId))
      .limit(1);
    if (!picker) {
      return res.status(404).json({ error: "Selector not found" });
    }

    // Ownership check: the claim must belong to this user.
    const [claim] = await db
      .select({ userId: selectorClaimsTable.userId })
      .from(selectorClaimsTable)
      .where(eq(selectorClaimsTable.pickerId, pickerId))
      .limit(1);

    if (!claim) {
      // No claim row at all — nothing to opt back in from.
      return res.status(409).json({ error: "No opt-out found for this selector" });
    }
    if (claim.userId !== user.id) {
      return res.status(403).json({ error: "Not authorized to opt this selector back in" });
    }

    await db
      .update(selectorClaimsTable)
      .set({ optedOut: false })
      .where(eq(selectorClaimsTable.pickerId, pickerId));

    return res.status(204).send();
  }),
);

export default router;
