import { Router, type IRouter } from "express";
import { rateLimit } from "express-rate-limit";
import {
  db, libraryItemsTable, recordingsTable, recordingReleaseGroupsTable,
  albumWorkflowTable, spotifyLibraryItemsTable, appleLibraryItemsTable, importItemsTable,
} from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { h } from "../../middlewares/asyncHandler.js";
import { type AuthedRequest } from "./auth.js";
import { buildOverlap, gatherTaste, type OverlapReport } from "../../lore/lma-overlap.js";
import { logger } from "@workspace/song-enrichment";

const router: IRouter = Router();
type Scan = {
  state: "running" | "done" | "error";
  report: OverlapReport | null;
  expiresAt: number;
};
const scans = new Map<number, Scan>();
const SCAN_TTL_MS = 60 * 60_000;

router.get("/me/library/lma-overlap", (req, res) => {
  const userId = (req as AuthedRequest).loreUser.id;
  const scan = scans.get(userId);
  if (scan && scan.expiresAt < Date.now() && scan.state !== "running") scans.delete(userId);
  res.setHeader("Cache-Control", "private, no-store");
  res.json(scan && (scan.state === "running" || scan.expiresAt >= Date.now())
    ? { state: scan.state, report: scan.report }
    : { state: "idle", report: null });
});

router.post("/me/library/lma-overlap", rateLimit({
  windowMs: 10 * 60_000, limit: 4, standardHeaders: true, legacyHeaders: false,
  message: { error: "Archive report requested too often. Try again later." },
}), h(async (req, res) => {
  const userId = (req as AuthedRequest).loreUser.id;
  const existing = scans.get(userId);
  if (existing?.state === "running") {
    res.setHeader("Cache-Control", "private, no-store");
    return res.json({ state: existing.state, report: existing.report });
  }
  // Bound concurrent archive traffic across listeners. A running scan is never
  // evicted; finished reports are only retained in memory for an hour.
  if ([...scans.values()].filter((scan) => scan.state === "running").length >= 2) {
    return res.status(503).json({ error: "Archive checks are busy. Try again shortly." });
  }
  const [tracks, albums, spotify, apple, imports] = await Promise.all([
    db.select({
      mbid: libraryItemsTable.mbid,
      name: recordingsTable.artist,
      artistMbid: recordingsTable.artistMbid,
      provenance: libraryItemsTable.provenance,
    })
      .from(libraryItemsTable).innerJoin(recordingsTable, eq(libraryItemsTable.mbid, recordingsTable.mbid))
      .where(and(eq(libraryItemsTable.userId, userId), isNull(libraryItemsTable.removedAt))),
    db.select({
      mbid: libraryItemsTable.mbid,
      name: recordingsTable.artist, artistMbid: recordingsTable.artistMbid,
      state: albumWorkflowTable.state,
    })
      .from(recordingReleaseGroupsTable)
      .innerJoin(libraryItemsTable, and(
        eq(libraryItemsTable.mbid, recordingReleaseGroupsTable.recordingMbid),
        eq(libraryItemsTable.userId, userId), isNull(libraryItemsTable.removedAt),
      ))
      .innerJoin(recordingsTable, eq(recordingsTable.mbid, libraryItemsTable.mbid))
      .leftJoin(albumWorkflowTable, and(
        eq(albumWorkflowTable.userId, userId),
        eq(albumWorkflowTable.releaseGroupMbid, recordingReleaseGroupsTable.releaseGroupMbid),
      ))
      .where(eq(recordingReleaseGroupsTable.isPrimary, true)),
    db.select({ name: spotifyLibraryItemsTable.artist }).from(spotifyLibraryItemsTable)
      .where(and(eq(spotifyLibraryItemsTable.userId, userId), isNull(spotifyLibraryItemsTable.mbid), isNull(spotifyLibraryItemsTable.removedAt))),
    db.select({ name: appleLibraryItemsTable.artist }).from(appleLibraryItemsTable)
      .where(and(eq(appleLibraryItemsTable.userId, userId), isNull(appleLibraryItemsTable.mbid), isNull(appleLibraryItemsTable.removedAt))),
    db.select({ name: importItemsTable.rawArtist }).from(importItemsTable)
      .where(and(eq(importItemsTable.userId, userId), isNull(importItemsTable.recordingMbid))),
  ]);
  const states = new Map(albums.map((row) => [row.mbid, row.state ?? "inbox"]));
  const candidates = gatherTaste([
    ...tracks.map(({ mbid, name, artistMbid, provenance }) => ({
      name, artistMbid,
      source: (provenance.kind === "keep" ? "track" : states.get(mbid) ?? "track") as "track" | "shelf" | "inbox" | "rotation" | "passed",
    })),
    ...albums.map((row) => ({
      ...row, source: (["shelf", "rotation", "passed"].includes(row.state ?? "") ? row.state : "inbox") as "shelf" | "rotation" | "passed" | "inbox",
    })),
    ...spotify.map(({ name }) => ({ name, source: "unresolved" as const })),
    ...apple.map(({ name }) => ({ name, source: "unresolved" as const })),
    ...imports.map(({ name }) => ({ name, source: "unresolved" as const })),
  ]);
  const scan: Scan = { state: "running", report: null, expiresAt: Date.now() + SCAN_TTL_MS };
  scans.set(userId, scan);
  void buildOverlap(candidates, undefined, (report) => {
    scan.report = report;
  }).then((report) => {
    scan.report = report;
    scan.state = "done";
    scan.expiresAt = Date.now() + SCAN_TTL_MS;
  }).catch((error: unknown) => {
    logger.error(`Live Music Archive overlap scan failed: ${String(error)}`);
    scan.state = "error";
    scan.expiresAt = Date.now() + SCAN_TTL_MS;
  });
  res.setHeader("Cache-Control", "private, no-store");
  return res.json({ state: "running", report: null });
}));

export default router;