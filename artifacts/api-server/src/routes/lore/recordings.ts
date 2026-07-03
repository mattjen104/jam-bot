import { Router, type IRouter } from "express";
import {
  GetRecordingParams,
  GetRecordingResponse,
  GetRecordingKnowledgeParams,
  GetRecordingKnowledgeResponse,
  GetRecordingLyricsParams,
  GetRecordingLyricsResponse,
  GetRecordingSpinsParams,
  GetRecordingSpinsResponse,
  GetRecordingPicksParams,
  GetRecordingPicksResponse,
  GetRecordingPreviewParams,
  GetRecordingPreviewResponse,
  GetRecordingSeguesParams,
  GetRecordingSeguesResponse,
  GetRecordingEntryParams,
  GetRecordingEntryResponse,
  GetRecordingSongExploderParams,
  GetRecordingSongExploderResponse,
  GetRecordingsAvailabilityResponse,
} from "@workspace/api-zod";
import {
  db,
  recordingsTable,
  pickersTable,
  picksTable,
  trackClaimsTable,
  songExploderEpisodesTable,
  lyricLinesTable,
} from "@workspace/db";
import { eq, and, asc, sql, inArray, gte, isNotNull } from "drizzle-orm";
import { nextRideable, spinsForRecording } from "../../lore/segue.js";
import { resolvePreview } from "../../lore/preview.js";
import { resolveEntry } from "../../lore/entry.js";
import { getLyrics } from "../../lore/lrclib.js";
import { enrichRecording, peekEnrichedKnowledge } from "@workspace/song-enrichment";
import { wireSongEnrichment } from "../../song/wire.js";
import { fetchWikipediaClaims } from "../../lore/wikipedia.js";
import { resolvePickRunAnchors } from "../../lore/runs.js";
import { h } from "../../middlewares/asyncHandler.js";

wireSongEnrichment();

/**
 * Stale-while-revalidate guard: prevents concurrent enrichment fan-out.
 * If we're already enriching a recording, skip the second fire-and-forget.
 */
const enrichingNow = new Set<string>();

/**
 * Wikipedia cooldown: don't re-fetch claims for the same MBID within 5 min.
 * Bounded: cleared wholesale when it grows past cap.
 */
const wikiRecentlyChecked = new Set<string>();
const WIKI_COOLDOWN_MS = 5 * 60_000;
const WIKI_COOLDOWN_MAX = 2_000;

const router: IRouter = Router();

// GET /api/recordings/availability?mbids=m1,m2,...
// Batch availability check: which MBIDs have synced lyrics and/or a SE episode.
// NOTE: must be registered before /recordings/:mbid so Express doesn't treat
// "availability" as a param value.
router.get("/recordings/availability", h(async (req, res) => {
  const raw = typeof req.query.mbids === "string" ? req.query.mbids.trim() : "";
  const mbids = raw.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 100);
  if (mbids.length === 0) {
    return res.json(GetRecordingsAvailabilityResponse.parse({ items: [] }));
  }

  const [lyricRows, seRows] = await Promise.all([
    db
      .selectDistinct({ mbid: lyricLinesTable.mbid })
      .from(lyricLinesTable)
      .where(and(inArray(lyricLinesTable.mbid, mbids), gte(lyricLinesTable.offsetMs, 0))),
    db
      .selectDistinct({ mbid: songExploderEpisodesTable.mbid })
      .from(songExploderEpisodesTable)
      .where(
        and(
          inArray(songExploderEpisodesTable.mbid, mbids),
          isNotNull(songExploderEpisodesTable.mbid),
        ),
      ),
  ]);

  const lyricSet = new Set(lyricRows.map((r) => r.mbid));
  const seSet = new Set(seRows.map((r) => r.mbid));

  const items = mbids.map((mbid) => ({
    mbid,
    hasLyrics: lyricSet.has(mbid),
    hasSe: seSet.has(mbid),
  }));

  return res.json(GetRecordingsAvailabilityResponse.parse({ items }));
}));

// GET /api/recordings/:mbid — recording metadata (song-page header).
router.get("/recordings/:mbid", h(async (req, res) => {
  const parsed = GetRecordingParams.safeParse(req.params);
  if (!parsed.success) {
    return res.status(404).json({ error: "Recording not found" });
  }

  const [rec] = await db
    .select({
      mbid: recordingsTable.mbid,
      title: recordingsTable.title,
      artist: recordingsTable.artist,
      artistMbid: recordingsTable.artistMbid,
      durationMs: recordingsTable.durationMs,
      artworkUrl: recordingsTable.artworkUrl,
      links: recordingsTable.links,
    })
    .from(recordingsTable)
    .where(eq(recordingsTable.mbid, parsed.data.mbid))
    .limit(1);
  if (!rec) {
    return res.status(404).json({ error: "Recording not found" });
  }

  return res.json(
    GetRecordingResponse.parse({
      mbid: rec.mbid,
      title: rec.title,
      artist: rec.artist,
      artistMbid: rec.artistMbid,
      durationMs: rec.durationMs,
      artworkUrl: rec.artworkUrl ?? null,
      links: rec.links ?? [],
    }),
  );
}));

// GET /api/recordings/:mbid/knowledge — liner-notes credits for the live player.
// Enrichment runs off the hot path and caches by recording id.
router.get("/recordings/:mbid/knowledge", h(async (req, res) => {
  const parsed = GetRecordingKnowledgeParams.safeParse(req.params);
  if (!parsed.success) {
    return res.status(404).json({ error: "Recording not found" });
  }

  const [rec] = await db
    .select()
    .from(recordingsTable)
    .where(eq(recordingsTable.mbid, parsed.data.mbid))
    .limit(1);
  if (!rec) {
    return res.status(404).json({ error: "Recording not found" });
  }

  // Stale-while-revalidate: return cached knowledge immediately, enrich async.
  const knowledge = peekEnrichedKnowledge(rec.mbid);
  if (!enrichingNow.has(rec.mbid)) {
    enrichingNow.add(rec.mbid);
    setImmediate(() => {
      void enrichRecording({
        recordingId: rec.mbid,
        title: rec.title,
        artist: rec.artist,
        isrc: rec.isrc,
      }).finally(() => enrichingNow.delete(rec.mbid));
    });
  }

  const claimRows = await db
    .select()
    .from(trackClaimsTable)
    .where(
      and(
        eq(trackClaimsTable.mbid, rec.mbid),
        eq(trackClaimsTable.status, "published"),
      ),
    )
    .orderBy(trackClaimsTable.id);

  // Fire-and-forget Wikipedia check — off the hot path, with cooldown so a
  // popular song page doesn't hammer Wikipedia on every request.
  if (!wikiRecentlyChecked.has(rec.mbid)) {
    if (wikiRecentlyChecked.size > WIKI_COOLDOWN_MAX) wikiRecentlyChecked.clear();
    wikiRecentlyChecked.add(rec.mbid);
    setTimeout(() => wikiRecentlyChecked.delete(rec.mbid), WIKI_COOLDOWN_MS);
    fetchWikipediaClaims(rec.mbid).catch((err) =>
      console.warn("[lore] wikipedia fire-and-forget failed", rec.mbid, err),
    );
  }

  return res.json(
    GetRecordingKnowledgeResponse.parse({
      knowledge: knowledge ?? null,
      claims: claimRows.map((c) => ({
        id: c.id,
        text: c.text,
        sourceLabel: c.sourceLabel,
        sourceUrl: c.sourceUrl,
        sourceHandle: c.sourceHandle,
        positionMs: c.positionMs,
        anchorType: c.anchorType ?? null,
        anchorValue: c.anchorValue ?? null,
        status: c.status,
        verified: c.verified,
      })),
    }),
  );
}));

// GET /api/recordings/:mbid/lyrics — synced lyric lines from LRCLIB.
router.get("/recordings/:mbid/lyrics", h(async (req, res) => {
  const parsed = GetRecordingLyricsParams.safeParse(req.params);
  if (!parsed.success) {
    return res.status(404).json({ error: "Recording not found" });
  }

  const [rec] = await db
    .select({ mbid: recordingsTable.mbid })
    .from(recordingsTable)
    .where(eq(recordingsTable.mbid, parsed.data.mbid))
    .limit(1);
  if (!rec) return res.status(404).json({ error: "Recording not found" });

  const { lines, synced } = await getLyrics(rec.mbid);
  return res.json(GetRecordingLyricsResponse.parse({ lines, synced }));
}));

// GET /api/recordings/:mbid/spins
router.get("/recordings/:mbid/spins", h(async (req, res) => {
  const parsed = GetRecordingSpinsParams.safeParse(req.params);
  if (!parsed.success) {
    return res.status(404).json({ error: "Recording not found" });
  }

  const spins = await spinsForRecording(parsed.data.mbid);
  return res.json(
    GetRecordingSpinsResponse.parse({
      mbid: parsed.data.mbid,
      spins: spins.map((s) => ({
        playedAt: s.playedAt.toISOString(),
        source: s.source,
        confidence: s.confidence,
        station: s.station,
        show: s.show,
        runId: s.runId,
      })),
    }),
  );
}));

// GET /api/recordings/:mbid/picks — every curated list containing this recording.
// Each pick names its picker and (when sourceUrl present) its archived run.
router.get("/recordings/:mbid/picks", h(async (req, res) => {
  const parsed = GetRecordingPicksParams.safeParse(req.params);
  if (!parsed.success) {
    return res.status(404).json({ error: "Recording not found" });
  }

  const rows = await db
    .select({
      pickerId: picksTable.pickerId,
      sourceUrl: picksTable.sourceUrl,
      context: picksTable.context,
      pickedAt: picksTable.pickedAt,
      ordinal: picksTable.ordinal,
      confidence: picksTable.confidence,
      pickerName: pickersTable.name,
      pickerHandle: pickersTable.handle,
      pickerType: pickersTable.pickerType,
      trustTier: pickersTable.trustTier,
    })
    .from(picksTable)
    .innerJoin(pickersTable, eq(picksTable.pickerId, pickersTable.id))
    .where(
      and(eq(picksTable.mbid, parsed.data.mbid), eq(pickersTable.active, true)),
    )
    .orderBy(
      asc(pickersTable.trustTier),
      sql`${picksTable.pickedAt} desc nulls last`,
      asc(picksTable.id),
    )
    .limit(50);

  // Resolve run anchors for picks that have a sourceUrl.
  const withUrl = rows
    .filter((r) => r.sourceUrl != null)
    .map((r) => ({ pickerId: r.pickerId, sourceUrl: r.sourceUrl! }));
  const runByKey = await resolvePickRunAnchors(withUrl);

  return res.json(
    GetRecordingPicksResponse.parse({
      mbid: parsed.data.mbid,
      picks: rows.map((r) => {
        const runKey =
          r.sourceUrl != null ? `${r.pickerId}|${r.sourceUrl}` : null;
        const run = runKey ? runByKey.get(runKey) ?? null : null;
        return {
          picker: {
            name: r.pickerName,
            handle: r.pickerHandle,
            pickerType: r.pickerType,
            trustTier: r.trustTier,
          },
          runId: run?.runId ?? null,
          listTitle: r.context ?? null,
          sourceUrl: r.sourceUrl ?? null,
          pickedAt: r.pickedAt ? r.pickedAt.toISOString() : null,
          ordinal: r.ordinal ?? null,
          trackCount: run?.trackCount ?? 0,
          confidence: r.confidence,
        };
      }),
    }),
  );
}));

// GET /api/recordings/:mbid/preview — best-effort 30s clip (for riding).
router.get("/recordings/:mbid/preview", h(async (req, res) => {
  const parsed = GetRecordingPreviewParams.safeParse(req.params);
  if (!parsed.success) {
    return res.status(404).json({ error: "Recording not found" });
  }

  const [rec] = await db
    .select({ title: recordingsTable.title, artist: recordingsTable.artist })
    .from(recordingsTable)
    .where(eq(recordingsTable.mbid, parsed.data.mbid))
    .limit(1);
  if (!rec) {
    return res.status(404).json({ error: "Recording not found" });
  }

  const preview = await resolvePreview(parsed.data.mbid, rec.artist, rec.title);
  return res.json(
    GetRecordingPreviewResponse.parse({
      mbid: parsed.data.mbid,
      previewUrl: preview.previewUrl,
      artworkUrl: preview.artworkUrl,
      source: preview.source,
    }),
  );
}));

// GET /api/recordings/:mbid/segues
router.get("/recordings/:mbid/segues", h(async (req, res) => {
  const parsed = GetRecordingSeguesParams.safeParse(req.params);
  if (!parsed.success) {
    return res.status(404).json({ error: "Recording not found" });
  }

  const next = await nextRideable(parsed.data.mbid);
  return res.json(
    GetRecordingSeguesResponse.parse({ mbid: parsed.data.mbid, next }),
  );
}));

// GET /api/recordings/:mbid/entry — source-agnostic fallback ladder.
router.get("/recordings/:mbid/entry", h(async (req, res) => {
  const parsed = GetRecordingEntryParams.safeParse(req.params);
  if (!parsed.success) {
    return res.status(404).json({ error: "Recording not found" });
  }

  const [rec] = await db
    .select({ artistMbid: recordingsTable.artistMbid })
    .from(recordingsTable)
    .where(eq(recordingsTable.mbid, parsed.data.mbid))
    .limit(1);
  const result = await resolveEntry(
    parsed.data.mbid,
    rec?.artistMbid ?? undefined,
  );
  return res.json(GetRecordingEntryResponse.parse(result));
}));

// GET /api/recordings/:mbid/song-exploder — Song Exploder episode + timeline anchors.
router.get("/recordings/:mbid/song-exploder", h(async (req, res) => {
  const parsed = GetRecordingSongExploderParams.safeParse(req.params);
  if (!parsed.success) {
    return res.status(404).json({ error: "Recording not found" });
  }
  const { mbid } = parsed.data;

  const [episode] = await db
    .select()
    .from(songExploderEpisodesTable)
    .where(eq(songExploderEpisodesTable.mbid, mbid))
    .limit(1);

  if (!episode) {
    return res.json(GetRecordingSongExploderResponse.parse({ episode: null, anchors: [] }));
  }

  // Fetch published claims for this MBID from the song-exploder source.
  const claimRows = await db
    .select({
      id: trackClaimsTable.id,
      positionMs: trackClaimsTable.positionMs,
      text: trackClaimsTable.text,
      sourceUrl: trackClaimsTable.sourceUrl,
      sourceLabel: trackClaimsTable.sourceLabel,
    })
    .from(trackClaimsTable)
    .where(
      and(
        eq(trackClaimsTable.mbid, mbid),
        eq(trackClaimsTable.sourceHandle, "song-exploder"),
        eq(trackClaimsTable.status, "published"),
      ),
    )
    .orderBy(asc(trackClaimsTable.positionMs));

  const anchors = claimRows
    .filter((c) => c.positionMs != null)
    .map((c) => ({
      id: c.id,
      positionMs: c.positionMs!,
      text: c.text,
      sourceUrl: c.sourceUrl,
      sourceLabel: c.sourceLabel,
    }));

  return res.json(
    GetRecordingSongExploderResponse.parse({
      episode: {
        id: episode.id,
        title: episode.title,
        episodeUrl: episode.episodeUrl,
        youtubeUrl: episode.youtubeUrl ?? null,
        publishedAt: episode.publishedAt?.toISOString() ?? null,
        resolvedAt: episode.resolvedAt?.toISOString() ?? null,
      },
      anchors,
    }),
  );
}));

export default router;
