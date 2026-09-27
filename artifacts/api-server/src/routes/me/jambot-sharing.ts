import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  and,
  desc,
  eq,
  inArray,
  isNull,
  sql,
} from "drizzle-orm";
import {
  db,
  libraryItemsTable,
  loreSharingGrantsTable,
  loreSharingHandoffsTable,
  recordingReleaseGroupsTable,
  recordingsTable,
  spotifyLibraryItemsTable,
  type LoreSharingGrant,
} from "@workspace/db";
import { h } from "../../middlewares/asyncHandler.js";
import { getUserFromSession } from "../../lore/userSession.js";
import { classifyFreshness } from "../../lore/freshness.js";

/**
 * Lore shared-library pairing API.
 *
 * Bot contract (all endpoints require x-lore-internal-secret = SESSION_SECRET):
 * POST /api/me/jambot-sharing/internal/handoffs
 *   request: { workspaceId: string, channelId: string, slackUserId: string,
 *              ownerLabel: string } (all nonempty; if SLACK_CHANNEL_ID is
 *              configured, channelId must match it)
 *   response: 201 { handoffToken: string, expiresAt: string }. The token is
 *      returned only to this authenticated internal caller; the bot builds its
 *      link from configured LORE_PUBLIC_URL and puts the token in the fragment.
 *      Only its SHA-256 digest is persisted, TTL is 10 minutes.
 * GET /api/me/jambot-sharing/internal/crossings?workspaceId=...&channelId=...&slackUserId=...
 *   response: 200 { state: "computing"|"failed"|"settled", ownerLabel: string,
 *      items: Array<{ station: string, artist: string, title: string,
 *      matchKind: "recording"|"album"|"artist", reason: string,
 *      playedAt: ISO-8601, observedAt: ISO-8601 }> }.
 *      Items are the freshest confirmed playing spin per station only; a
 *      rolling 24-hour result is never treated as a current spin. No active
 *      matching grant returns 404.
 *
 * Browser contract (lore_sid cookie; never provisions a user here):
 * POST /api/me/jambot-sharing/preview { token: string }
 *   -> 200 { ownerLabel, workspaceId, channelId, expiresAt } (not consumed).
 * POST /api/me/jambot-sharing/claim { token: string }
 *   -> 201 { grant: { id, ownerLabel, workspaceId, channelId, createdAt } }.
 * GET /api/me/jambot-sharing -> 200 { grants: Grant[] }.
 * DELETE /api/me/jambot-sharing/:grantId -> 200 { revoked: true }.
 *
 * None of these responses include a Lore cookie, library rows, or journal data.
 */
const router: IRouter = Router();
const HANDOFF_TTL_MS = 10 * 60_000;
const COMPUTE_WAIT_MS = 1_200;

interface CurrentCrossing {
  station: string;
  artist: string;
  title: string;
  source: string | null;
  matchKind: "recording" | "album" | "artist";
  reason: string;
  playedAt: string;
  observedAt: string;
}
interface CrossingSnapshot {
  state: "computing" | "failed" | "settled";
  items: CurrentCrossing[];
  updatedAt: number;
}
const crossingSnapshots = new Map<number, CrossingSnapshot>();
const crossingComputes = new Map<number, Promise<CrossingSnapshot>>();

function internalAuthorized(supplied: string): boolean {
  const expected = process.env.SESSION_SECRET ?? "";
  if (!expected || expected.length !== supplied.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
}

function tokenDigest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function requireSameOriginMutation(req: Request, res: Response): boolean {
  const origin = req.get("origin");
  const host = req.get("host");
  if (!origin || !host || req.get("sec-fetch-site") === "cross-site") {
    res.status(403).json({ error: "Same-origin request required" });
    return false;
  }
  try {
    const parsed = new URL(origin);
    const expectedOrigin = `${req.protocol}://${host}`;
    if (
      (parsed.protocol !== "https:" && parsed.protocol !== "http:")
      || parsed.origin.toLowerCase() !== expectedOrigin.toLowerCase()
    ) {
      res.status(403).json({ error: "Same-origin request required" });
      return false;
    }
  } catch {
    res.status(403).json({ error: "Same-origin request required" });
    return false;
  }
  return true;
}

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned.length > 0 && cleaned.length <= maxLength ? cleaned : null;
}

async function activeLibraryExists(userId: number): Promise<boolean> {
  const [libraryRows, resolvedSpotifyRows] = await Promise.all([
    db.select({ id: libraryItemsTable.id })
      .from(libraryItemsTable)
      .where(and(eq(libraryItemsTable.userId, userId), isNull(libraryItemsTable.removedAt)))
      .limit(1),
    db.select({ id: spotifyLibraryItemsTable.id })
      .from(spotifyLibraryItemsTable)
      .where(and(
        eq(spotifyLibraryItemsTable.userId, userId),
        isNull(spotifyLibraryItemsTable.removedAt),
        sql`${spotifyLibraryItemsTable.mbid} IS NOT NULL`,
      ))
      .limit(1),
  ]);
  return libraryRows.length > 0 || resolvedSpotifyRows.length > 0;
}

function grantResponse(grant: LoreSharingGrant) {
  return {
    id: grant.id,
    ownerLabel: grant.ownerLabel,
    workspaceId: grant.workspaceId,
    channelId: grant.channelId,
    createdAt: grant.createdAt.toISOString(),
  };
}

async function computeFreshCurrentCrossings(userId: number): Promise<CurrentCrossing[]> {
  // Latest actual spin per visible station, not a rolling 24-hour crossing.
  // A station-leading index makes the LATERAL lookup one bounded seek per
  // station rather than sorting the whole spins archive on every chat turn.
  const current = await db.execute<{
    station: string;
    mbid: string | null;
    artist_mbid: string | null;
    artist: string;
    title: string;
    source: string | null;
    played_at: Date | string;
    observed_at: Date | string;
  }>(sql`
    SELECT
      st.slug AS station,
      s.mbid,
      r.artist_mbid,
      COALESCE(r.artist, s.raw_artist, '') AS artist,
      COALESCE(r.title, s.raw_title, '') AS title,
      s.source,
      s.played_at,
      COALESCE(s.observed_at, s.created_at) AS observed_at
    FROM stations st
    INNER JOIN LATERAL (
      SELECT sp.mbid, sp.raw_artist, sp.raw_title, sp.source,
        sp.played_at, sp.observed_at, sp.created_at
      FROM spins sp
      WHERE sp.station_id = st.id
      ORDER BY sp.played_at DESC, sp.id DESC
      LIMIT 1
    ) s ON true
    LEFT JOIN recordings r ON r.mbid = s.mbid
    WHERE st.active = true
      AND st.hidden = false
    ORDER BY st.slug
  `);
  if (current.rows.length === 0) return [];

  const [library, resolvedSpotify] = await Promise.all([
    db.select({ mbid: libraryItemsTable.mbid })
      .from(libraryItemsTable)
      .where(and(eq(libraryItemsTable.userId, userId), isNull(libraryItemsTable.removedAt))),
    db.select({ mbid: spotifyLibraryItemsTable.mbid })
      .from(spotifyLibraryItemsTable)
      .where(and(
        eq(spotifyLibraryItemsTable.userId, userId),
        isNull(spotifyLibraryItemsTable.removedAt),
        sql`${spotifyLibraryItemsTable.mbid} IS NOT NULL`,
      )),
  ]);
  const activeLibraryMbids = new Set([
    ...library.map((row) => row.mbid),
    ...resolvedSpotify.flatMap((row) => row.mbid ? [row.mbid] : []),
  ]);
  const albumGroups = activeLibraryMbids.size
    ? await db
      .selectDistinct({ releaseGroupMbid: recordingReleaseGroupsTable.releaseGroupMbid })
      .from(recordingReleaseGroupsTable)
      .where(inArray(recordingReleaseGroupsTable.recordingMbid, [...activeLibraryMbids]))
    : [];
  const groupIds = new Set(albumGroups.map((row) => row.releaseGroupMbid));
  const albumMbids = groupIds.size
    ? await db
      .selectDistinct({ mbid: recordingReleaseGroupsTable.recordingMbid })
      .from(recordingReleaseGroupsTable)
      .where(inArray(recordingReleaseGroupsTable.releaseGroupMbid, [...groupIds]))
    : [];
  const albumRecordingMbids = new Set(albumMbids.map((row) => row.mbid));

  const softArtists = await db
    .selectDistinct({ artist: spotifyLibraryItemsTable.artist })
    .from(spotifyLibraryItemsTable)
    .where(and(
      eq(spotifyLibraryItemsTable.userId, userId),
      isNull(spotifyLibraryItemsTable.mbid),
      isNull(spotifyLibraryItemsTable.removedAt),
      sql`${spotifyLibraryItemsTable.artist} <> ''`,
    ));
  const normalizeArtist = (value: string) => value.toLowerCase()
    .replace(/^the\s+/, "")
    .replace(/[\s\p{P}]+/gu, "");
  // Taste seeds are preferences, not saved library items. A seed-only artist
  // must never be presented to the channel as a match with Matt's library.
  const softNames = new Set(softArtists.map((row) => normalizeArtist(row.artist)));
  const artistRows = activeLibraryMbids.size
    ? await db
      .selectDistinct({ artistMbid: recordingsTable.artistMbid })
      .from(recordingsTable)
      .where(and(
        inArray(recordingsTable.mbid, [...activeLibraryMbids]),
        sql`${recordingsTable.artistMbid} IS NOT NULL`,
      ))
    : [];
  const artistMbids = new Set(artistRows.flatMap((row) => row.artistMbid ? [row.artistMbid] : []));

  const matches: CurrentCrossing[] = [];
  for (const row of current.rows) {
    const observedAt = new Date(row.observed_at);
    if (classifyFreshness(row.source, observedAt) !== "fresh") continue;
    let matchKind: CurrentCrossing["matchKind"] | null = null;
    let reason = "";
    if (row.mbid && activeLibraryMbids.has(row.mbid)) {
      matchKind = "recording";
      reason = "Recording is in the active Lore library.";
    } else if (row.mbid) {
      if (albumRecordingMbids.has(row.mbid)) {
        matchKind = "album";
        reason = "Recording belongs to an album represented in the active Lore library.";
      }
    }
    if (!matchKind && row.artist_mbid && artistMbids.has(row.artist_mbid)) {
      matchKind = "artist";
      reason = "Artist is represented in the active Lore library.";
    }
    if (!matchKind && softNames.has(normalizeArtist(row.artist))) {
      matchKind = "artist";
      reason = "Artist name matches an active imported library item.";
    }
    if (!matchKind) continue;
    matches.push({
      station: row.station,
      artist: row.artist,
      title: row.title,
      source: row.source,
      matchKind,
      reason,
      playedAt: new Date(row.played_at).toISOString(),
      observedAt: observedAt.toISOString(),
    });
  }
  return matches;
}

async function getCrossingSnapshot(userId: number): Promise<CrossingSnapshot> {
  const existing = crossingSnapshots.get(userId);
  if (existing && Date.now() - existing.updatedAt < 30_000 && existing.state !== "computing") {
    return existing;
  }
  let work = crossingComputes.get(userId);
  if (!work) {
    work = computeFreshCurrentCrossings(userId)
      .then((items): CrossingSnapshot => ({
        state: "settled",
        items,
        updatedAt: Date.now(),
      }))
      .catch((): CrossingSnapshot => ({
        state: "failed",
        items: [],
        updatedAt: Date.now(),
      }));
    crossingComputes.set(userId, work);
    void work.then((snapshot) => crossingSnapshots.set(userId, snapshot))
      .finally(() => crossingComputes.delete(userId));
  }
  const winner = await Promise.race([
    work.then(() => "done" as const),
    new Promise<"timeout">((resolve) => {
      const timer = setTimeout(() => resolve("timeout"), COMPUTE_WAIT_MS);
      timer.unref?.();
    }),
  ]);
  if (winner === "timeout") {
    return { state: "computing", items: [], updatedAt: Date.now() };
  }
  if (winner === "done") return await work;
  return { state: "computing", items: [], updatedAt: Date.now() };
}

// Bot-only create-handoff. An API-configured SLACK_CHANNEL_ID further pins the
// bot's configured channel when present; workspace/user/label are from the
// verified Slack event and the authenticated bot request.
router.post("/me/jambot-sharing/internal/handoffs", h(async (req, res) => {
  if (!internalAuthorized(req.get("x-lore-internal-secret") ?? "")) {
    res.status(process.env.SESSION_SECRET ? 401 : 503).json({ error: "Unauthorized" });
    return;
  }
  const workspaceId = cleanText(req.body?.workspaceId, 100);
  const channelId = cleanText(req.body?.channelId, 100);
  const slackUserId = cleanText(req.body?.slackUserId, 100);
  const ownerLabel = cleanText(req.body?.ownerLabel, 120);
  if (!workspaceId || !channelId || !slackUserId || !ownerLabel) {
    res.status(400).json({ error: "workspaceId, channelId, slackUserId and ownerLabel are required" });
    return;
  }
  if (process.env.SLACK_CHANNEL_ID && channelId !== process.env.SLACK_CHANNEL_ID) {
    res.status(403).json({ error: "Sharing is not configured for this channel" });
    return;
  }
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + HANDOFF_TTL_MS);
  await db.insert(loreSharingHandoffsTable).values({
    tokenHash: tokenDigest(token),
    workspaceId,
    channelId,
    slackUserId,
    ownerLabel,
    expiresAt,
  });
  res.status(201).json({ handoffToken: token, expiresAt: expiresAt.toISOString() });
}));

// Browser-only owner claim. getUserFromSession deliberately does not create a
// user, so a visitor without an existing lore_sid cannot claim a shared library.
router.post("/me/jambot-sharing/claim", h(async (req, res) => {
  if (!requireSameOriginMutation(req, res)) return;
  const user = await getUserFromSession(req);
  if (!user) {
    res.status(401).json({ error: "An existing Lore session is required" });
    return;
  }
  const token = cleanText(req.body?.token, 200);
  if (!token) {
    res.status(400).json({ error: "A handoff token is required" });
    return;
  }
  if (!(await activeLibraryExists(user.id))) {
    res.status(409).json({ error: "Add at least one item to your Lore library before sharing it" });
    return;
  }
  try {
    const created = await db.transaction(async (tx) => {
      const [handoff] = await tx
        .select()
        .from(loreSharingHandoffsTable)
        .where(eq(loreSharingHandoffsTable.tokenHash, tokenDigest(token)))
        .for("update");
      if (!handoff || handoff.consumedAt || handoff.expiresAt.getTime() <= Date.now()) {
        return null;
      }
      const [priorGrant] = await tx
        .select({ id: loreSharingGrantsTable.id })
        .from(loreSharingGrantsTable)
        .where(and(
          eq(loreSharingGrantsTable.workspaceId, handoff.workspaceId),
          eq(loreSharingGrantsTable.channelId, handoff.channelId),
          isNull(loreSharingGrantsTable.revokedAt),
        ))
        .limit(1);
      if (priorGrant) return "active" as const;
      const [grant] = await tx
        .insert(loreSharingGrantsTable)
        .values({
          workspaceId: handoff.workspaceId,
          channelId: handoff.channelId,
          slackUserId: handoff.slackUserId,
          ownerLabel: handoff.ownerLabel,
          userId: user.id,
        })
        .returning();
      await tx.update(loreSharingHandoffsTable)
        .set({ consumedAt: new Date() })
        .where(eq(loreSharingHandoffsTable.tokenHash, handoff.tokenHash));
      return grant;
    });
    if (created === null) {
      res.status(410).json({ error: "This handoff is expired or has already been used" });
      return;
    }
    if (created === "active") {
      res.status(409).json({ error: "The previous Lore owner must revoke this channel grant before relinking" });
      return;
    }
    res.status(201).json({ grant: grantResponse(created) });
  } catch (err) {
    if ((err as { code?: string } | null)?.code !== "23505") throw err;
    res.status(409).json({ error: "This Slack channel already has an active Lore owner; revoke before relinking" });
  }
}));

router.post("/me/jambot-sharing/preview", h(async (req, res) => {
  if (!requireSameOriginMutation(req, res)) return;
  const user = await getUserFromSession(req);
  if (!user) {
    res.status(401).json({ error: "An existing Lore session is required" });
    return;
  }
  const token = cleanText(req.body?.token, 200);
  if (!token) {
    res.status(400).json({ error: "A handoff token is required" });
    return;
  }
  const [handoff] = await db.select({
    workspaceId: loreSharingHandoffsTable.workspaceId,
    channelId: loreSharingHandoffsTable.channelId,
    ownerLabel: loreSharingHandoffsTable.ownerLabel,
    expiresAt: loreSharingHandoffsTable.expiresAt,
    consumedAt: loreSharingHandoffsTable.consumedAt,
  }).from(loreSharingHandoffsTable)
    .where(eq(loreSharingHandoffsTable.tokenHash, tokenDigest(token)))
    .limit(1);
  if (!handoff || handoff.consumedAt || handoff.expiresAt.getTime() <= Date.now()) {
    res.status(410).json({ error: "This handoff is expired or has already been used" });
    return;
  }
  res.json({
    ownerLabel: handoff.ownerLabel,
    workspaceId: handoff.workspaceId,
    channelId: handoff.channelId,
    expiresAt: handoff.expiresAt.toISOString(),
  });
}));

router.get("/me/jambot-sharing", h(async (req, res) => {
  const user = await getUserFromSession(req);
  if (!user) {
    res.status(401).json({ error: "An existing Lore session is required" });
    return;
  }
  const grants = await db.select()
    .from(loreSharingGrantsTable)
    .where(and(eq(loreSharingGrantsTable.userId, user.id), isNull(loreSharingGrantsTable.revokedAt)))
    .orderBy(desc(loreSharingGrantsTable.createdAt));
  res.json({ grants: grants.map(grantResponse) });
}));

router.delete("/me/jambot-sharing/:grantId", h(async (req, res) => {
  if (!requireSameOriginMutation(req, res)) return;
  const user = await getUserFromSession(req);
  if (!user) {
    res.status(401).json({ error: "An existing Lore session is required" });
    return;
  }
  const grantId = Number(req.params.grantId);
  if (!Number.isSafeInteger(grantId) || grantId <= 0) {
    res.status(400).json({ error: "Invalid grant id" });
    return;
  }
  const revoked = await db.update(loreSharingGrantsTable)
    .set({ revokedAt: new Date() })
    .where(and(
      eq(loreSharingGrantsTable.id, grantId),
      eq(loreSharingGrantsTable.userId, user.id),
      isNull(loreSharingGrantsTable.revokedAt),
    ))
    .returning({ id: loreSharingGrantsTable.id });
  if (!revoked.length) {
    res.status(404).json({ error: "Active Lore sharing grant not found" });
    return;
  }
  res.json({ revoked: true });
}));

// Narrow bot-only read. Revalidates the active grant on every request so revoke
// takes effect immediately; callers cannot select a user or widen channel scope.
router.get("/me/jambot-sharing/internal/crossings", h(async (req, res) => {
  if (!internalAuthorized(req.get("x-lore-internal-secret") ?? "")) {
    res.status(process.env.SESSION_SECRET ? 401 : 503).json({ error: "Unauthorized" });
    return;
  }
  const workspaceId = cleanText(req.query.workspaceId, 100);
  const channelId = cleanText(req.query.channelId, 100);
  const slackUserId = cleanText(req.query.slackUserId, 100);
  if (!workspaceId || !channelId || !slackUserId) {
    res.status(400).json({ error: "workspaceId, channelId and slackUserId are required" });
    return;
  }
  if (process.env.SLACK_CHANNEL_ID && channelId !== process.env.SLACK_CHANNEL_ID) {
    res.status(403).json({ error: "Sharing is not configured for this channel" });
    return;
  }
  const [grant] = await db.select()
    .from(loreSharingGrantsTable)
    .where(and(
      eq(loreSharingGrantsTable.workspaceId, workspaceId),
      eq(loreSharingGrantsTable.channelId, channelId),
      eq(loreSharingGrantsTable.slackUserId, slackUserId),
      isNull(loreSharingGrantsTable.revokedAt),
    ))
    .limit(1);
  if (!grant) {
    res.status(404).json({ error: "No active Lore library grant for this channel" });
    return;
  }
  const snapshot = await getCrossingSnapshot(grant.userId);
  res.json({
    state: snapshot.state,
    ownerLabel: grant.ownerLabel,
    // A cached "current" result must still pass the source-specific clock
    // check at response time; the cache never grants freshness for 30s.
    items: snapshot.items.filter((item) =>
      snapshot.state === "settled" &&
      classifyFreshness(item.source, new Date(item.observedAt)) === "fresh",
    ).map((item) => ({
      station: item.station,
      artist: item.artist,
      title: item.title,
      matchKind: item.matchKind,
      reason: item.reason,
      playedAt: item.playedAt,
      observedAt: item.observedAt,
    })),
  });
}));

export default router;