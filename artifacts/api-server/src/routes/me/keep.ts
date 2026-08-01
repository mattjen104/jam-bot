import { Router, type IRouter } from "express";
import {
  db,
  serviceConnectionsTable,
  libraryItemsTable,
  keepTargetsTable,
  pendingKeepsTable,
  recordingsTable,
  spinsTable,
  type LibraryItemProvenance,
} from "@workspace/db";
import { eq, and, isNull, inArray, sql } from "drizzle-orm";
import { getConnector } from "../../lore/serviceConnector.js";
import { h } from "../../middlewares/asyncHandler.js";
import { type AuthedRequest, getFreshToken } from "./auth.js";

const router: IRouter = Router();

/** Max MBIDs per batch keep-status check. */
const KEEP_BATCH_MAX = 50;

// ---------------------------------------------------------------------------
// Keep endpoints
// ---------------------------------------------------------------------------

/**
 * POST /api/me/keep — upsert a recording into library_items and optionally
 * mirror to enabled streaming services.
 * Body: { mbid: string, provenance?: object }
 *    OR { spinId: number, provenance?: object }  ← unresolved-track path
 */
router.post("/me/keep", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  const { mbid, spinId, provenance: provenanceOverride } = req.body as {
    mbid?: string;
    spinId?: number;
    provenance?: Partial<LibraryItemProvenance>;
  };

  // ── Spin-based save (unresolved or not-yet-resolved track) ────────────────
  if (!mbid && spinId != null) {
    const [spin] = await db
      .select({ id: spinsTable.id, mbid: spinsTable.mbid })
      .from(spinsTable)
      .where(eq(spinsTable.id, spinId))
      .limit(1);

    if (!spin) return res.status(404).json({ error: "Spin not found" });

    // If the spin already resolved, also write to library_items.
    let promotedAt: Date | null = null;
    if (spin.mbid) {
      // Spread first, then force kind — clients may pass display kinds like
      // "station" in the override, but the stored kind is always "keep".
      const provenance: LibraryItemProvenance = { ...provenanceOverride, kind: "keep" };
      await db
        .insert(libraryItemsTable)
        .values({ userId: user.id, mbid: spin.mbid, provenance, spinId: spin.id, addedAt: new Date() })
        .onConflictDoUpdate({
          target: [libraryItemsTable.userId, libraryItemsTable.mbid],
          set: { provenance, spinId: spin.id, addedAt: new Date() },
        });
      promotedAt = new Date();
    }

    await db
      .insert(pendingKeepsTable)
      .values({ userId: user.id, spinId: spin.id, promotedAt })
      .onConflictDoUpdate({
        target: [pendingKeepsTable.userId, pendingKeepsTable.spinId],
        set: { promotedAt },
      });

    // Show the recovery hint once — when this keep brings the total to exactly 3.
    const [spinLibCount] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(libraryItemsTable)
      .where(eq(libraryItemsTable.userId, user.id));
    const [spinPendingCount] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(pendingKeepsTable)
      .where(and(eq(pendingKeepsTable.userId, user.id), isNull(pendingKeepsTable.promotedAt)));
    const showRecoveryHint = ((spinLibCount?.n ?? 0) + (spinPendingCount?.n ?? 0)) === 3;

    return res.json({ keptToLore: promotedAt != null, pendingKept: true, mirrors: [], showRecoveryHint });
  }

  // ── MBID-based (resolved) keep ────────────────────────────────────────────
  if (!mbid || typeof mbid !== "string") {
    return res.status(400).json({ error: "mbid or spinId is required" });
  }

  // The recording must already be on the spine.
  const [recording] = await db
    .select()
    .from(recordingsTable)
    .where(eq(recordingsTable.mbid, mbid))
    .limit(1);

  if (!recording) {
    return res.status(404).json({ error: "Recording not on the spine" });
  }

  const provenance: LibraryItemProvenance = {
    ...provenanceOverride,
    kind: "keep",
  };

  // When the client keeps a resolved track off a live play it can pass the
  // spin id alongside the mbid. Only store the link when the spin actually
  // resolved to this mbid — never persist mismatched provenance.
  let keepSpinId: number | null = null;
  if (spinId != null) {
    const [s] = await db
      .select({ id: spinsTable.id })
      .from(spinsTable)
      .where(and(eq(spinsTable.id, spinId), eq(spinsTable.mbid, mbid)))
      .limit(1);
    keepSpinId = s?.id ?? null;
  }

  await db
    .insert(libraryItemsTable)
    .values({ userId: user.id, mbid, provenance, spinId: keepSpinId, addedAt: new Date() })
    .onConflictDoUpdate({
      target: [libraryItemsTable.userId, libraryItemsTable.mbid],
      set: {
        provenance,
        addedAt: new Date(),
        ...(keepSpinId != null ? { spinId: keepSpinId } : {}),
      },
    });

  // Mirror to enabled service connectors.
  const enabledTargets = await db
    .select()
    .from(keepTargetsTable)
    .where(and(eq(keepTargetsTable.userId, user.id), eq(keepTargetsTable.enabled, true)));

  const mirrors: Array<{ service: string; ok: boolean; linkOut?: string }> = [];

  for (const target of enabledTargets) {
    const [conn] = await db
      .select()
      .from(serviceConnectionsTable)
      .where(
        and(
          eq(serviceConnectionsTable.userId, user.id),
          eq(serviceConnectionsTable.service, target.service),
        ),
      )
      .limit(1);

    if (!conn) {
      mirrors.push({ service: target.service, ok: false });
      continue;
    }

    if (!conn.canWrite) {
      const q = encodeURIComponent(`${recording.artist} ${recording.title}`);
      mirrors.push({
        service: target.service,
        ok: false,
        linkOut: `https://open.spotify.com/search/${q}`,
      });
      continue;
    }

    const accessToken = await getFreshToken(conn);
    if (!accessToken) {
      mirrors.push({ service: target.service, ok: false });
      continue;
    }

    const connector = getConnector(target.service);
    if (!connector) {
      mirrors.push({ service: target.service, ok: false });
      continue;
    }

    const result = await connector.addToLibrary(accessToken, recording);
    mirrors.push({ service: target.service, ...result });
  }

  // Show the recovery hint once — when this keep brings the total to exactly 3.
  const [libCount] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(libraryItemsTable)
    .where(eq(libraryItemsTable.userId, user.id));
  const [pendingCount] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(pendingKeepsTable)
    .where(and(eq(pendingKeepsTable.userId, user.id), isNull(pendingKeepsTable.promotedAt)));
  const showRecoveryHint = ((libCount?.n ?? 0) + (pendingCount?.n ?? 0)) === 3;

  return res.json({ keptToLore: true, mirrors, showRecoveryHint });
}));

/**
 * DELETE /api/me/keep/spin/:spinId — remove a spin-based save.
 * Deletes from pending_keeps; if the spin resolved, also removes library_items.
 * Must be registered before DELETE /me/keep/:mbid or "spin" matches :mbid.
 */
router.delete("/me/keep/spin/:spinId", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  const spinId = parseInt(typeof req.params.spinId === "string" ? req.params.spinId : "", 10);
  if (isNaN(spinId)) return res.status(400).json({ error: "invalid spinId" });

  await db
    .delete(pendingKeepsTable)
    .where(and(eq(pendingKeepsTable.userId, user.id), eq(pendingKeepsTable.spinId, spinId)));

  // If the spin has an MBID, clean up library_items too.
  const [spin] = await db
    .select({ mbid: spinsTable.mbid })
    .from(spinsTable)
    .where(eq(spinsTable.id, spinId))
    .limit(1);

  if (spin?.mbid) {
    await db
      .delete(libraryItemsTable)
      .where(and(eq(libraryItemsTable.userId, user.id), eq(libraryItemsTable.mbid, spin.mbid)));
  }

  return res.status(204).end();
}));

/**
 * GET /api/me/keep/pending-status?spinIds=1,2,3 — batch spin save-state check.
 * Returns two sets:
 *   savedSpinIds  — spin was saved AND promoted to library_items (resolved)
 *   pendingSpinIds — spin was saved but not yet resolved to an MBID
 */
router.get("/me/keep/pending-status", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  const rawIds = typeof req.query.spinIds === "string" ? req.query.spinIds : "";
  const spinIds = rawIds
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n) && n > 0)
    .slice(0, 50);

  if (spinIds.length === 0) return res.json({ savedSpinIds: [], pendingSpinIds: [] });

  const rows = await db
    .select({ spinId: pendingKeepsTable.spinId, promotedAt: pendingKeepsTable.promotedAt })
    .from(pendingKeepsTable)
    .where(
      and(
        eq(pendingKeepsTable.userId, user.id),
        inArray(pendingKeepsTable.spinId, spinIds),
      ),
    );

  const savedSpinIds = rows.filter((r) => r.promotedAt != null).map((r) => r.spinId);
  const pendingSpinIds = rows.filter((r) => r.promotedAt == null).map((r) => r.spinId);

  return res.json({ savedSpinIds, pendingSpinIds });
}));

/**
 * DELETE /api/me/keep/:mbid — remove a recording from library_items only.
 * Never touches the streaming service library.
 */
router.delete("/me/keep/:mbid", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  const mbid = typeof req.params.mbid === "string" ? req.params.mbid : "";
  if (!mbid) return res.status(400).json({ error: "mbid is required" });

  await db
    .delete(libraryItemsTable)
    .where(
      and(
        eq(libraryItemsTable.userId, user.id),
        eq(libraryItemsTable.mbid, mbid),
      ),
    );

  return res.status(204).end();
}));

/**
 * GET /api/me/keep/status?mbids=a,b,c — batch presence check.
 * Returns the subset of the given MBIDs that the user has kept.
 * Pattern mirrors GET /picks/contains.
 */
router.get("/me/keep/status", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  const raw = typeof req.query["mbids"] === "string" ? req.query["mbids"] : "";
  if (!raw) return res.status(400).json({ error: "mbids is required" });

  const mbids = [
    ...new Set(
      raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ].slice(0, KEEP_BATCH_MAX);

  if (mbids.length === 0) return res.json({ kept: [] });

  const rows = await db
    .select({ mbid: libraryItemsTable.mbid })
    .from(libraryItemsTable)
    .where(
      and(
        eq(libraryItemsTable.userId, user.id),
        inArray(libraryItemsTable.mbid, mbids),
      ),
    );

  return res.json({ kept: rows.map((r) => r.mbid) });
}));

export default router;
