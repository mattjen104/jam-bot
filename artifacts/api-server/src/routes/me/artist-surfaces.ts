import { Router, type IRouter } from "express";
import {
  db,
  libraryItemsTable,
  recordingsTable,
  recordingReleaseGroupsTable,
  recordingSupportFactsTable,
  spinsTable,
  tasteSeedsTable,
} from "@workspace/db";
import { and, asc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { GetMyAlbumsResponse, GetMyMerchResponse } from "@workspace/api-zod";
import { h } from "../../middlewares/asyncHandler.js";
import { type AuthedRequest } from "./auth.js";

const router: IRouter = Router();

/**
 * This is intentionally narrower than a general search normalization. It is
 * used only to resolve a listener-entered taste seed against an unresolved
 * recording, never to turn a library keep into a name-based match.
 */
export function normalizeArtistName(value: string): string {
  return value
    .toLowerCase()
    .replace(/^the\s+/, "")
    .replace(/[\s\p{P}]+/gu, "");
}

const normalizedRecordingArtist = sql`
  nullif(
    regexp_replace(
      regexp_replace(lower(${recordingsTable.artist}), '^the[[:space:]]+', ''),
      '[[:space:][:punct:]]+',
      '',
      'g'
    ),
    ''
  )
`;

type TasteRecording = {
  mbid: string;
  title: string;
  artist: string;
  artistMbid: string | null;
  artworkUrl: string | null;
};

/**
 * Resolve the artist-centered set without ever writing a keep. Exact artist
 * MBIDs come from active library recordings. Seeds may resolve to an exact
 * MBID when a same-name recording has one; only unresolved recordings use the
 * normalized seed fallback.
 */
export async function tasteRecordings(userId: number): Promise<{
  recordings: TasteRecording[];
  activeLibraryMbids: Set<string>;
}> {
  const [library, seeds] = await Promise.all([
    db
      .select({
        mbid: recordingsTable.mbid,
        title: recordingsTable.title,
        artist: recordingsTable.artist,
        artistMbid: recordingsTable.artistMbid,
        artworkUrl: recordingsTable.artworkUrl,
      })
      .from(libraryItemsTable)
      .innerJoin(recordingsTable, eq(libraryItemsTable.mbid, recordingsTable.mbid))
      .where(and(eq(libraryItemsTable.userId, userId), isNull(libraryItemsTable.removedAt))),
    db
      .select({ artistName: tasteSeedsTable.artistName })
      .from(tasteSeedsTable)
      .where(eq(tasteSeedsTable.userId, userId)),
  ]);

  const activeLibraryMbids = new Set(library.map((row) => row.mbid));
  const libraryArtistMbids = new Set(
    library.map((row) => row.artistMbid).filter((value): value is string => Boolean(value)),
  );
  const seedNames = [...new Set(seeds.map((row) => normalizeArtistName(row.artistName)).filter(Boolean))];

  const matchers = [];
  if (libraryArtistMbids.size > 0) {
    matchers.push(inArray(recordingsTable.artistMbid, [...libraryArtistMbids]));
  }
  if (seedNames.length > 0) {
    const seedNameMatch = or(
      ...seedNames.map((name) => sql`${normalizedRecordingArtist} = ${name}`),
    );
    if (seedNameMatch) matchers.push(seedNameMatch);
  }
  if (matchers.length === 0) return { recordings: [], activeLibraryMbids };

  const matched = await db
    .select({
      mbid: recordingsTable.mbid,
      title: recordingsTable.title,
      artist: recordingsTable.artist,
      artistMbid: recordingsTable.artistMbid,
      artworkUrl: recordingsTable.artworkUrl,
    })
    .from(recordingsTable)
    .where(or(...matchers));

  // A seed name can resolve an exact MBID. Once resolved, include the rest of
  // that canonical artist's recordings, rather than falling back to names.
  const seededArtistMbids = new Set(
    matched
      .filter((row) => row.artistMbid && seedNames.includes(normalizeArtistName(row.artist)))
      .map((row) => row.artistMbid as string),
  );
  let canonical = matched;
  if (seededArtistMbids.size > 0) {
    canonical = await db
      .select({
        mbid: recordingsTable.mbid,
        title: recordingsTable.title,
        artist: recordingsTable.artist,
        artistMbid: recordingsTable.artistMbid,
        artworkUrl: recordingsTable.artworkUrl,
      })
      .from(recordingsTable)
      .where(inArray(recordingsTable.artistMbid, [...seededArtistMbids]));
  }
  const recordings = selectTasteRecordings(
    [...new Map([...matched, ...canonical].map((row) => [row.mbid, row])).values()],
    libraryArtistMbids,
    seedNames,
  );
  return { recordings, activeLibraryMbids };
}

export function selectTasteRecordings(
  matched: TasteRecording[],
  libraryArtistMbids: Set<string>,
  seedNames: string[],
): TasteRecording[] {
  const seededArtistMbids = new Set(
    matched
      .filter((row) => row.artistMbid && seedNames.includes(normalizeArtistName(row.artist)))
      .map((row) => row.artistMbid as string),
  );
  const exactArtistMbids = new Set([...libraryArtistMbids, ...seededArtistMbids]);
  return matched.filter((row) =>
    (row.artistMbid && exactArtistMbids.has(row.artistMbid)) ||
    (!row.artistMbid && seedNames.includes(normalizeArtistName(row.artist))),
  );
}

type AlbumRow = {
  releaseGroupMbid: string;
  title: string | null;
  primaryType: string | null;
  releaseYear: number | null;
  recordingMbid: string;
  artist: string;
  artistMbid: string | null;
  artworkUrl: string | null;
};

export function buildAlbumReadModel(
  rows: AlbumRow[],
  activeLibraryMbids: Set<string>,
  spinCounts: Map<string, number>,
) {
  const albums = new Map<string, {
    releaseGroupMbid: string;
    title: string;
    artist: string;
    artistMbid: string | null;
    artworkUrl: string | null;
    releaseYear: number | null;
    primaryType: string | null;
    firstRecordingMbid: string;
    trackCount: number;
    libraryTrackCount: number;
    spinCount: number;
  }>();

  for (const row of rows) {
    if (!row.title || !["Album", "EP"].includes(row.primaryType ?? "")) continue;
    const current = albums.get(row.releaseGroupMbid);
    if (!current) {
      albums.set(row.releaseGroupMbid, {
        releaseGroupMbid: row.releaseGroupMbid,
        title: row.title,
        artist: row.artist,
        artistMbid: row.artistMbid,
        artworkUrl: row.artworkUrl,
        releaseYear: row.releaseYear,
        primaryType: row.primaryType,
        firstRecordingMbid: row.recordingMbid,
        trackCount: 1,
        libraryTrackCount: activeLibraryMbids.has(row.recordingMbid) ? 1 : 0,
        spinCount: spinCounts.get(row.recordingMbid) ?? 0,
      });
      continue;
    }
    current.trackCount++;
    if (activeLibraryMbids.has(row.recordingMbid)) current.libraryTrackCount++;
    current.spinCount += spinCounts.get(row.recordingMbid) ?? 0;
    if (row.recordingMbid < current.firstRecordingMbid) {
      current.firstRecordingMbid = row.recordingMbid;
      current.artist = row.artist;
      current.artistMbid = row.artistMbid;
    }
    if (!current.artworkUrl && row.artworkUrl) current.artworkUrl = row.artworkUrl;
  }

  return [...albums.values()].sort((a, b) =>
    (b.releaseYear ?? -1) - (a.releaseYear ?? -1) || a.title.localeCompare(b.title) ||
    a.releaseGroupMbid.localeCompare(b.releaseGroupMbid),
  );
}

function safeHttpUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

type MerchCandidate = {
  title: string;
  artist: string;
  imageUrl: string | null;
  destinationUrl: string;
  source: string;
  provider: string | null;
  kind: string;
};

export function dedupeMerchProducts(rows: MerchCandidate[]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const destinationUrl = safeHttpUrl(row.destinationUrl);
    const imageUrl = safeHttpUrl(row.imageUrl);
    if (!destinationUrl || !imageUrl) return false;
    const key = destinationUrl.replace(/\/+$/, "");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((row) => ({
    title: row.title,
    artist: row.artist,
    imageUrl: safeHttpUrl(row.imageUrl)!,
    destinationUrl: safeHttpUrl(row.destinationUrl)!,
    source: row.source,
    provider: row.provider,
    kind: row.kind as "artist_direct" | "label" | "discogs",
  }));
}

router.get("/me/albums", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  const taste = await tasteRecordings(user.id);
  if (taste.recordings.length === 0) {
    return res.json(GetMyAlbumsResponse.parse({ items: [], total: 0 }));
  }
  const mbids = taste.recordings.map((row) => row.mbid);
  const rows = await db
    .select({
      releaseGroupMbid: recordingReleaseGroupsTable.releaseGroupMbid,
      title: recordingReleaseGroupsTable.title,
      primaryType: recordingReleaseGroupsTable.primaryType,
      releaseYear: recordingReleaseGroupsTable.releaseYear,
      recordingMbid: recordingsTable.mbid,
      artist: recordingsTable.artist,
      artistMbid: recordingsTable.artistMbid,
      artworkUrl: recordingsTable.artworkUrl,
    })
    .from(recordingReleaseGroupsTable)
    .innerJoin(recordingsTable, eq(recordingReleaseGroupsTable.recordingMbid, recordingsTable.mbid))
    .where(and(eq(recordingReleaseGroupsTable.isPrimary, true), inArray(recordingReleaseGroupsTable.recordingMbid, mbids)))
    .orderBy(asc(recordingReleaseGroupsTable.releaseGroupMbid), asc(recordingsTable.mbid));
  const spinRows = await db
    .select({ mbid: spinsTable.mbid, count: sql<number>`count(*)::int` })
    .from(spinsTable)
    .where(inArray(spinsTable.mbid, mbids))
    .groupBy(spinsTable.mbid);
  const items = buildAlbumReadModel(
    rows,
    taste.activeLibraryMbids,
    new Map(spinRows.filter((row) => row.mbid).map((row) => [row.mbid!, row.count])),
  );
  return res.json(GetMyAlbumsResponse.parse({ items, total: items.length }));
}));

router.get("/me/merch", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  const taste = await tasteRecordings(user.id);
  if (taste.recordings.length === 0) {
    return res.json(GetMyMerchResponse.parse({ items: [], total: 0 }));
  }
  const rows = await db
    .select({
      url: recordingSupportFactsTable.url,
      kind: recordingSupportFactsTable.kind,
      providerId: recordingSupportFactsTable.providerId,
      detail: recordingSupportFactsTable.detail,
      recordingTitle: recordingsTable.title,
      artist: recordingsTable.artist,
      artworkUrl: recordingsTable.artworkUrl,
      releaseGroupMbid: recordingSupportFactsTable.releaseGroupMbid,
      releaseTitle: recordingReleaseGroupsTable.title,
    })
    .from(recordingSupportFactsTable)
    .innerJoin(recordingsTable, eq(recordingSupportFactsTable.recordingMbid, recordingsTable.mbid))
    .leftJoin(
      recordingReleaseGroupsTable,
      and(
        eq(recordingReleaseGroupsTable.recordingMbid, recordingsTable.mbid),
        eq(recordingReleaseGroupsTable.isPrimary, true),
        eq(recordingReleaseGroupsTable.releaseGroupMbid, recordingSupportFactsTable.releaseGroupMbid),
      ),
    )
    .where(and(
      eq(recordingSupportFactsTable.scope, "release"),
      inArray(recordingSupportFactsTable.verification, ["exact", "trusted"]),
      or(isNull(recordingSupportFactsTable.expiresAt), gt(recordingSupportFactsTable.expiresAt, new Date())),
      inArray(recordingSupportFactsTable.recordingMbid, taste.recordings.map((row) => row.mbid)),
    ))
    .orderBy(asc(recordingSupportFactsTable.id));
  const candidates = rows.map((row) => ({
    title: row.releaseTitle ?? row.detail ?? row.recordingTitle,
    artist: row.artist,
    imageUrl: row.artworkUrl,
    destinationUrl: row.url,
    source: row.providerId ?? row.kind,
    provider: row.providerId,
    kind: row.kind,
  }));
  const items = dedupeMerchProducts(candidates);
  return res.json(GetMyMerchResponse.parse({ items, total: items.length }));
}));

export default router;