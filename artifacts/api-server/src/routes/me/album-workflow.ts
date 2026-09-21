import { Router, type IRouter } from "express";
import {
  albumWorkflowTable,
  albumWorkflowTransitionsTable,
  appleLibraryItemsTable,
  db,
  importItemsTable,
  libraryImportJobsTable,
  libraryItemsTable,
  recordingReleaseGroupsTable,
  recordingsTable,
  spotifyLibraryItemsTable,
} from "@workspace/db";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { h } from "../../middlewares/asyncHandler.js";
import { type AuthedRequest } from "./auth.js";

const router: IRouter = Router();
const STATES = ["inbox", "rotation", "shelf", "passed"] as const;
type AlbumWorkflowState = (typeof STATES)[number];

function isState(value: unknown): value is AlbumWorkflowState {
  return typeof value === "string" && (STATES as readonly string[]).includes(value);
}

export function cleanPicks(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string =>
    typeof item === "string" && item.trim().length > 0,
  ).map((item) => item.trim()))].slice(0, 100);
}

export function resolveTransitionMetadata(
  current: { note: string | null; picks: string[] } | null | undefined,
  note: string | null | undefined,
  picks: string[] | undefined,
  allowedPicks: ReadonlySet<string>,
) {
  const nextNote = note === undefined ? current?.note ?? null : note;
  const requestedPicks = picks === undefined ? current?.picks ?? [] : picks;
  return {
    note: nextNote,
    picks: cleanPicks(requestedPicks).filter((pick) => allowedPicks.has(pick)),
  };
}

type AlbumItem = {
  releaseGroupMbid: string;
  title: string;
  artist: string;
  artistMbid: string | null;
  artworkUrl: string | null;
  releaseYear: number | null;
  state: AlbumWorkflowState;
  note: string | null;
  picks: string[];
  trackCount: number;
  activeTrackMbids: string[];
  sourceCount: number;
  unresolved: false;
};

async function activeAlbumRows(userId: number, releaseGroupMbid?: string) {
  return db
    .select({
      releaseGroupMbid: recordingReleaseGroupsTable.releaseGroupMbid,
      title: recordingReleaseGroupsTable.title,
      releaseYear: recordingReleaseGroupsTable.releaseYear,
      recordingMbid: recordingsTable.mbid,
      artist: recordingsTable.artist,
      artistMbid: recordingsTable.artistMbid,
      artworkUrl: recordingsTable.artworkUrl,
    })
    .from(libraryItemsTable)
    .innerJoin(recordingsTable, eq(libraryItemsTable.mbid, recordingsTable.mbid))
    .innerJoin(
      recordingReleaseGroupsTable,
      and(
        eq(recordingReleaseGroupsTable.recordingMbid, recordingsTable.mbid),
        eq(recordingReleaseGroupsTable.isPrimary, true),
        ...(releaseGroupMbid
          ? [eq(recordingReleaseGroupsTable.releaseGroupMbid, releaseGroupMbid)]
          : []),
      ),
    )
    .where(and(
      eq(libraryItemsTable.userId, userId),
      isNull(libraryItemsTable.removedAt),
    ))
    .orderBy(asc(recordingReleaseGroupsTable.releaseGroupMbid), asc(recordingsTable.mbid));
}

async function unresolvedItems(userId: number) {
  const [spotify, apple, imports] = await Promise.all([
    db.select({
      id: spotifyLibraryItemsTable.id,
      title: spotifyLibraryItemsTable.albumName,
      trackTitle: spotifyLibraryItemsTable.title,
      artist: spotifyLibraryItemsTable.artist,
      artworkUrl: spotifyLibraryItemsTable.artworkUrl,
      addedAt: spotifyLibraryItemsTable.addedAt,
      source: sql<string>`'spotify'`,
    }).from(spotifyLibraryItemsTable).where(and(
      eq(spotifyLibraryItemsTable.userId, userId),
      isNull(spotifyLibraryItemsTable.mbid),
      isNull(spotifyLibraryItemsTable.removedAt),
    )),
    db.select({
      id: appleLibraryItemsTable.id,
      title: appleLibraryItemsTable.albumName,
      trackTitle: appleLibraryItemsTable.title,
      artist: appleLibraryItemsTable.artist,
      artworkUrl: appleLibraryItemsTable.artworkUrl,
      addedAt: appleLibraryItemsTable.addedAt,
      source: sql<string>`'apple_music'`,
    }).from(appleLibraryItemsTable).where(and(
      eq(appleLibraryItemsTable.userId, userId),
      isNull(appleLibraryItemsTable.mbid),
      isNull(appleLibraryItemsTable.removedAt),
    )),
    db.select({
      id: importItemsTable.id,
      title: importItemsTable.rawRelease,
      trackTitle: importItemsTable.rawTitle,
      artist: importItemsTable.rawArtist,
      artworkUrl: sql<string | null>`NULL`,
      addedAt: importItemsTable.addedAt,
      source: libraryImportJobsTable.service,
    }).from(importItemsTable).innerJoin(
      libraryImportJobsTable,
      eq(importItemsTable.jobId, libraryImportJobsTable.id),
    ).where(and(
      eq(importItemsTable.userId, userId),
      isNull(importItemsTable.recordingMbid),
    )),
  ]);
  const deduped = new Map<string, (typeof spotify)[number]>();
  for (const item of [...spotify, ...apple, ...imports].sort(
    (a, b) => b.addedAt.getTime() - a.addedAt.getTime(),
  )) {
    const key = [item.artist, item.trackTitle, item.title]
      .map((value) => value?.trim().toLocaleLowerCase() ?? "")
      .join("\u001f");
    const current = deduped.get(key);
    if (!current) {
      deduped.set(key, item);
    } else if (!current.source.split(",").includes(item.source)) {
      current.source = `${current.source},${item.source}`;
    }
  }
  return [...deduped.values()].map((item) => ({
      unresolved: true as const,
      unresolvedId: `${item.source}:${item.id}`,
      title: item.title ?? item.trackTitle ?? "Unknown album",
      artist: item.artist,
      artworkUrl: item.artworkUrl,
      source: item.source,
      addedAt: item.addedAt.toISOString(),
    }));
}

export function aggregateAlbums(
  rows: Awaited<ReturnType<typeof activeAlbumRows>>,
  workflow: Map<string, typeof albumWorkflowTable.$inferSelect>,
): AlbumItem[] {
  const grouped = new Map<string, AlbumItem>();
  for (const row of rows) {
    if (!row.title) continue;
    const current = grouped.get(row.releaseGroupMbid);
    if (current) {
      if (!current.activeTrackMbids.includes(row.recordingMbid)) current.activeTrackMbids.push(row.recordingMbid);
      current.trackCount = current.activeTrackMbids.length;
      current.sourceCount++;
      if (!current.artworkUrl && row.artworkUrl) current.artworkUrl = row.artworkUrl;
      continue;
    }
    const state = workflow.get(row.releaseGroupMbid);
    grouped.set(row.releaseGroupMbid, {
      releaseGroupMbid: row.releaseGroupMbid,
      title: row.title,
      artist: row.artist,
      artistMbid: row.artistMbid,
      artworkUrl: row.artworkUrl,
      releaseYear: row.releaseYear,
      state: (state?.state && isState(state.state) ? state.state : "inbox"),
      note: state?.note ?? null,
      picks: state?.picks ?? [],
      trackCount: 1,
      activeTrackMbids: [row.recordingMbid],
      sourceCount: 1,
      unresolved: false,
    });
  }
  return [...grouped.values()];
}

async function ensureWorkflow(userId: number, releaseGroupMbid: string) {
  const [existing] = await db.select().from(albumWorkflowTable).where(and(
    eq(albumWorkflowTable.userId, userId),
    eq(albumWorkflowTable.releaseGroupMbid, releaseGroupMbid),
  )).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(albumWorkflowTable).values({
    userId,
    releaseGroupMbid,
    state: "inbox",
    picks: [],
  }).onConflictDoNothing().returning();
  if (created) return created;
  const [retried] = await db.select().from(albumWorkflowTable).where(and(
    eq(albumWorkflowTable.userId, userId),
    eq(albumWorkflowTable.releaseGroupMbid, releaseGroupMbid),
  )).limit(1);
  return retried ?? null;
}

/**
 * GET /api/me/library/albums?state=inbox|rotation|shelf|passed&includeUnresolved=true
 */
router.get("/me/library/albums", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  const requestedState = typeof req.query.state === "string" ? req.query.state : null;
  if (requestedState && requestedState !== "unresolved" && !isState(requestedState)) {
    return res.status(400).json({ error: "state must be inbox, rotation, shelf, passed, or unresolved" });
  }
  const query = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";
  const [rows, workflow, unresolved] = await Promise.all([
    activeAlbumRows(user.id),
    db.select().from(albumWorkflowTable).where(eq(albumWorkflowTable.userId, user.id)),
    unresolvedItems(user.id),
  ]);
  const albums = aggregateAlbums(rows, new Map(workflow.map((item) => [item.releaseGroupMbid, item])));
  const filteredAlbums = albums.filter((item) =>
    (!requestedState || requestedState === "unresolved" || item.state === requestedState) &&
    (!query || item.title.toLowerCase().includes(query) || item.artist.toLowerCase().includes(query)),
  );
  const filteredUnresolved = requestedState === "unresolved" || (requestedState == null && req.query.includeUnresolved === "true")
    ? unresolved.filter((item) => !query || item.title.toLowerCase().includes(query) || item.artist.toLowerCase().includes(query))
    : [];
  return res.json({
    items: [...filteredAlbums, ...filteredUnresolved],
    counts: {
      inbox: albums.filter((item) => item.state === "inbox").length,
      rotation: albums.filter((item) => item.state === "rotation").length,
      shelf: albums.filter((item) => item.state === "shelf").length,
      passed: albums.filter((item) => item.state === "passed").length,
      unresolved: unresolved.length,
    },
    total: filteredAlbums.length + filteredUnresolved.length,
  });
}));

/** GET /api/me/library/albums/:releaseGroupMbid */
router.get("/me/library/albums/:releaseGroupMbid", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  const releaseGroupMbid = typeof req.params.releaseGroupMbid === "string"
    ? req.params.releaseGroupMbid.trim()
    : "";
  if (!releaseGroupMbid) return res.status(400).json({ error: "releaseGroupMbid is required" });
  const rows = await activeAlbumRows(user.id, releaseGroupMbid);
  if (rows.length === 0) return res.status(404).json({ error: "Album is not in the active Library" });
  const workflow = await ensureWorkflow(user.id, releaseGroupMbid);
  const history = await db.select().from(albumWorkflowTransitionsTable)
    .where(and(
      eq(albumWorkflowTransitionsTable.userId, user.id),
      eq(albumWorkflowTransitionsTable.releaseGroupMbid, releaseGroupMbid),
    )).orderBy(desc(albumWorkflowTransitionsTable.createdAt));
  const [album] = aggregateAlbums(rows, new Map(workflow ? [[releaseGroupMbid, workflow]] : []));
  return res.json({ album, history });
}));

async function transitionAlbum(
  userId: number,
  releaseGroupMbid: string,
  state: AlbumWorkflowState,
  note: string | null | undefined,
  picks: string[] | undefined,
) {
  const rows = await activeAlbumRows(userId, releaseGroupMbid);
  if (rows.length === 0) return null;
  const allowedPicks = new Set(rows.map((row) => row.recordingMbid));
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(albumWorkflowTable).where(and(
      eq(albumWorkflowTable.userId, userId),
      eq(albumWorkflowTable.releaseGroupMbid, releaseGroupMbid),
    )).limit(1);
    const fromState = current?.state ?? "inbox";
    const metadata = resolveTransitionMetadata(current, note, picks, allowedPicks);
    const [next] = await tx.insert(albumWorkflowTable).values({
      userId,
      releaseGroupMbid,
      state,
      note: metadata.note,
      picks: metadata.picks,
    }).onConflictDoUpdate({
      target: [albumWorkflowTable.userId, albumWorkflowTable.releaseGroupMbid],
      set: { state, note: metadata.note, picks: metadata.picks, updatedAt: new Date() },
    }).returning();
    await tx.insert(albumWorkflowTransitionsTable).values({
      userId,
      releaseGroupMbid,
      fromState,
      toState: state,
      note: metadata.note,
      picks: metadata.picks,
    });
    return next;
  });
}

/** POST /api/me/library/albums/:releaseGroupMbid/state { state, note?, picks? } */
router.post("/me/library/albums/:releaseGroupMbid/state", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  const releaseGroupMbid = typeof req.params.releaseGroupMbid === "string"
    ? req.params.releaseGroupMbid.trim()
    : "";
  const state = req.body?.state;
  if (!releaseGroupMbid || !isState(state)) return res.status(400).json({ error: "a valid state is required" });
  const hasNote = Object.prototype.hasOwnProperty.call(req.body ?? {}, "note");
  const hasPicks = Object.prototype.hasOwnProperty.call(req.body ?? {}, "picks");
  const workflow = await transitionAlbum(
    user.id,
    releaseGroupMbid,
    state,
    hasNote
      ? typeof req.body?.note === "string" && req.body.note.trim()
        ? req.body.note.trim().slice(0, 2000)
        : null
      : undefined,
    hasPicks ? cleanPicks(req.body?.picks) : undefined,
  );
  if (!workflow) return res.status(404).json({ error: "Album is not in the active Library" });
  return res.json({ workflow });
}));

/** POST /api/me/library/albums/:releaseGroupMbid/file — shorthand for Shelf. */
router.post("/me/library/albums/:releaseGroupMbid/file", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  const releaseGroupMbid = typeof req.params.releaseGroupMbid === "string"
    ? req.params.releaseGroupMbid.trim()
    : "";
  if (!releaseGroupMbid) return res.status(400).json({ error: "releaseGroupMbid is required" });
  const hasNote = Object.prototype.hasOwnProperty.call(req.body ?? {}, "note");
  const hasPicks = Object.prototype.hasOwnProperty.call(req.body ?? {}, "picks");
  const workflow = await transitionAlbum(
    user.id,
    releaseGroupMbid,
    "shelf",
    hasNote
      ? typeof req.body?.note === "string" && req.body.note.trim()
        ? req.body.note.trim().slice(0, 2000)
        : null
      : undefined,
    hasPicks ? cleanPicks(req.body?.picks) : undefined,
  );
  if (!workflow) return res.status(404).json({ error: "Album is not in the active Library" });
  return res.json({ workflow });
}));

export default router;