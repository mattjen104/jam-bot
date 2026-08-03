/**
 * Anonymous album-cover identity.
 *
 * The client submits only a canonical recording MBID. Candidate ownership,
 * artwork, and album metadata are always resolved from Lore's own catalogue
 * here so an arbitrary URL can never become a listener identity.
 */
import { Router, type IRouter } from "express";
import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import {
  db,
  libraryItemsTable,
  listenSessionsTable,
  loreUsersTable,
  recordingsTable,
} from "@workspace/db";
import { h } from "../../middlewares/asyncHandler.js";
import { type AuthedRequest } from "./auth.js";

const router: IRouter = Router();
const VISIT_ROTATION_GAP_MS = 30 * 60_000;

export interface AlbumAvatarCandidate {
  recordingMbid: string;
  releaseGroupMbid: string | null;
  albumTitle: string;
  artist: string;
  artworkUrl: string;
  source: "library" | "matt-starter" | "lore-catalogue";
}

export interface AlbumAvatarCurrent extends AlbumAvatarCandidate {
  selectedAt: string | null;
}

function candidateSelect(source: AlbumAvatarCandidate["source"]) {
  return {
    recordingMbid: recordingsTable.mbid,
    releaseGroupMbid: sql<string | null>`(
      SELECT release_group_mbid
      FROM recording_release_groups
      WHERE recording_mbid = ${recordingsTable.mbid} AND is_primary = true
      ORDER BY id ASC
      LIMIT 1
    )`,
    albumTitle: sql<string>`COALESCE((
      SELECT title
      FROM recording_release_groups
      WHERE recording_mbid = ${recordingsTable.mbid} AND is_primary = true
      ORDER BY id ASC
      LIMIT 1
    ), ${recordingsTable.title})`,
    artist: recordingsTable.artist,
    artworkUrl: recordingsTable.artworkUrl,
    source: sql<AlbumAvatarCandidate["source"]>`${source}`,
  };
}

function normalizeRows(
  rows: Array<{
    recordingMbid: string;
    releaseGroupMbid: string | null;
    albumTitle: string;
    artist: string;
    artworkUrl: string | null;
    source: AlbumAvatarCandidate["source"];
  }>,
): AlbumAvatarCandidate[] {
  const seen = new Set<string>();
  return rows
    .filter((row) => {
      // Artwork is already in Lore, but only return absolute web URLs. This
      // protects the presence surface from malformed/stale catalogue values.
      if (!row.artworkUrl || !/^https?:\/\//i.test(row.artworkUrl)) return false;
      if (seen.has(row.recordingMbid)) return false;
      seen.add(row.recordingMbid);
      return true;
    })
    .map((row) => ({
      recordingMbid: row.recordingMbid,
      releaseGroupMbid: row.releaseGroupMbid,
      albumTitle: row.albumTitle || "Unknown album",
      artist: row.artist,
      artworkUrl: row.artworkUrl!,
      source: row.source,
    }));
}

async function getCandidates(userId: number): Promise<AlbumAvatarCandidate[]> {
  const libraryRows = await db
    .select(candidateSelect("library"))
    .from(libraryItemsTable)
    .innerJoin(recordingsTable, eq(libraryItemsTable.mbid, recordingsTable.mbid))
    .where(and(
      eq(libraryItemsTable.userId, userId),
      isNotNull(recordingsTable.artworkUrl),
      sql`COALESCE(${libraryItemsTable.provenance}->>'service', '') <> 'matt-starter'`,
    ))
    .orderBy(asc(libraryItemsTable.addedAt))
    .limit(80);
  const libraryCandidates = normalizeRows(libraryRows);
  if (libraryCandidates.length > 0) return libraryCandidates;

  // Matt's starter library is a deliberately labelled fallback, not an
  // arbitrary assignment. It is only considered when the user's own library
  // has no usable artwork.
  const starterRows = await db
    .select(candidateSelect("matt-starter"))
    .from(libraryItemsTable)
    .innerJoin(recordingsTable, eq(libraryItemsTable.mbid, recordingsTable.mbid))
    .where(and(
      eq(libraryItemsTable.userId, userId),
      isNotNull(recordingsTable.artworkUrl),
      sql`${libraryItemsTable.provenance}->>'service' = 'matt-starter'`,
    ))
    .orderBy(asc(libraryItemsTable.addedAt))
    .limit(80);
  const starterCandidates = normalizeRows(starterRows);
  if (starterCandidates.length > 0) return starterCandidates;

  // A clearly-labelled Lore catalogue fallback is available only when the
  // listener has no usable personal or starter-library artwork.
  // Never manufacture an identity for an empty anonymous account. The
  // catalogue is an explicit fallback after a real seed/library action has
  // produced a usable path, not a decorative avatar catalogue.
  const [seededOrLibrary] = await db
    .select({ n: sql<number>`count(*)` })
    .from(libraryItemsTable)
    .where(eq(libraryItemsTable.userId, userId));
  if (Number(seededOrLibrary?.n ?? 0) === 0) return [];

  const catalogueRows = await db
    .select(candidateSelect("lore-catalogue"))
    .from(recordingsTable)
    .where(and(
      isNotNull(recordingsTable.artworkUrl),
    ))
    .orderBy(asc(recordingsTable.artist), asc(recordingsTable.title))
    .limit(80);
  return normalizeRows(catalogueRows);
}

async function hasActiveListeningSession(userId: number): Promise<boolean> {
  const threshold = new Date(Date.now() - 4 * 60 * 60_000);
  const [row] = await db
    .select({ id: listenSessionsTable.id })
    .from(listenSessionsTable)
    .where(and(
      eq(listenSessionsTable.userId, userId),
      sql`${listenSessionsTable.endedAt} IS NULL`,
      sql`${listenSessionsTable.lastHeartbeatAt} >= ${threshold}`,
    ))
    .limit(1);
  return row != null;
}

function currentFromUser(user: typeof loreUsersTable.$inferSelect): AlbumAvatarCurrent | null {
  if (
    !user.avatarRecordingMbid ||
    !user.avatarArtworkUrl ||
    !user.avatarAlbumTitle ||
    !user.avatarArtist ||
    !/^https?:\/\//i.test(user.avatarArtworkUrl)
  ) {
    return null;
  }
  return {
    recordingMbid: user.avatarRecordingMbid,
    releaseGroupMbid: user.avatarReleaseGroupMbid,
    albumTitle: user.avatarAlbumTitle,
    artist: user.avatarArtist,
    artworkUrl: user.avatarArtworkUrl,
    source: (user.avatarSource as AlbumAvatarCandidate["source"] | null) ?? "library",
    selectedAt: user.avatarVisitStartedAt?.toISOString() ?? null,
  };
}

async function maybeRotate(
  user: typeof loreUsersTable.$inferSelect,
  candidates: AlbumAvatarCandidate[],
): Promise<typeof loreUsersTable.$inferSelect> {
  if (!user.avatarRecordingMbid || candidates.length < 2) return user;
  const now = Date.now();
  const visitStarted = user.avatarVisitStartedAt?.getTime() ?? 0;
  if (visitStarted > 0 && now - visitStarted < VISIT_ROTATION_GAP_MS) return user;
  if (await hasActiveListeningSession(user.id)) return user;

  const currentIndex = candidates.findIndex(
    (candidate) => candidate.recordingMbid === user.avatarRecordingMbid,
  );
  const next = candidates[(currentIndex + 1 + candidates.length) % candidates.length];
  if (!next) return user;
  const [updated] = await db
    .update(loreUsersTable)
    .set({
      avatarRecordingMbid: next.recordingMbid,
      avatarReleaseGroupMbid: next.releaseGroupMbid,
      avatarAlbumTitle: next.albumTitle,
      avatarArtist: next.artist,
      avatarArtworkUrl: next.artworkUrl,
      avatarSource: next.source,
      avatarVisitStartedAt: new Date(),
      avatarVisitRecordingMbid: next.recordingMbid,
    })
    .where(eq(loreUsersTable.id, user.id))
    .returning();
  return updated ?? user;
}

router.get("/me/avatar", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  const candidates = await getCandidates(user.id);
  const rotatedUser = await maybeRotate(user, candidates);
  return res.json({
    current: currentFromUser(rotatedUser),
    candidates,
    eligible: candidates.length > 0,
    needsChoice: rotatedUser.avatarRecordingMbid == null && candidates.length > 0,
    rotation: {
      visitStartedAt: rotatedUser.avatarVisitStartedAt?.toISOString() ?? null,
      stableForVisit: rotatedUser.avatarRecordingMbid != null,
    },
  });
}));

router.put("/me/avatar", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  const recordingMbid = typeof req.body?.recordingMbid === "string"
    ? req.body.recordingMbid.trim()
    : "";
  if (!recordingMbid) return res.status(400).json({ error: "recordingMbid is required" });

  const candidates = await getCandidates(user.id);
  const selected = candidates.find((candidate) => candidate.recordingMbid === recordingMbid);
  if (!selected) {
    return res.status(400).json({ error: "That album is not eligible for this listener" });
  }

  const selectedAt = new Date();
  const [updated] = await db
    .update(loreUsersTable)
    .set({
      avatarRecordingMbid: selected.recordingMbid,
      avatarReleaseGroupMbid: selected.releaseGroupMbid,
      avatarAlbumTitle: selected.albumTitle,
      avatarArtist: selected.artist,
      avatarArtworkUrl: selected.artworkUrl,
      avatarSource: selected.source,
      avatarVisitStartedAt: selectedAt,
      avatarVisitRecordingMbid: selected.recordingMbid,
    })
    .where(eq(loreUsersTable.id, user.id))
    .returning();
  if (!updated) {
    return res.status(500).json({ error: "Could not save listener identity" });
  }

  return res.json({
    current: {
      ...selected,
      selectedAt: selectedAt.toISOString(),
    },
    candidates,
    eligible: candidates.length > 0,
    needsChoice: false,
    rotation: {
      visitStartedAt: selectedAt.toISOString(),
      stableForVisit: true,
    },
  });
}));

export default router;