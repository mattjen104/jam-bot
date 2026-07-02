import { Router, type IRouter, type Request, type Response } from "express";
import {
  ListStationsResponse,
  GetStationNowPlayingParams,
  GetStationNowPlayingResponse,
  GetRecordingParams,
  GetRecordingResponse,
  GetRecordingSpinsParams,
  GetRecordingSpinsResponse,
  GetRecordingPreviewParams,
  GetRecordingPreviewResponse,
  GetRecordingSeguesParams,
  GetRecordingSeguesResponse,
  CreateManualSpinBody,
  ListPickersResponse,
  GetRecordingEntryParams,
  GetRecordingEntryResponse,
  UpsertPickerBody,
  LogTracklistParams,
  LogTracklistBody,
  SeedLabelBody,
  IngestBlogBody,
  IngestDiscogsListBody,
  AddRymListBody,
} from "@workspace/api-zod";
import {
  db,
  stationsTable,
  spinsTable,
  recordingsTable,
  pickersTable,
  type Station,
  type Picker,
} from "@workspace/db";
import { eq, asc, desc } from "drizzle-orm";
import { nextRideable, spinsForRecording } from "../../lore/segue.js";
import { resolvePreview } from "../../lore/preview.js";
import { ingestManualSpin } from "../../lore/resolve.js";
import {
  upsertPicker,
  getPickerByHandle,
  logTracklist,
  type PickerType,
  type PickSource,
} from "../../lore/picks.js";
import { seedLabelPicker } from "../../lore/label.js";
import { ingestBlogFeed } from "../../lore/blog.js";
import { ingestDiscogsList, addRymPicker } from "../../lore/collector.js";
import { resolveEntry } from "../../lore/entry.js";

const router: IRouter = Router();

/**
 * Shared admin-token gate, matching the /admin/spins pattern: absent env =>
 * disabled (503), never silently open; mismatch => 401. Returns true when the
 * request may proceed (and has already been rejected otherwise). Never logs the
 * token.
 */
function requireAdmin(req: Request, res: Response): boolean {
  const adminToken = process.env["LORE_ADMIN_TOKEN"];
  if (!adminToken) {
    res.status(503).json({ error: "Admin entry is not configured" });
    return false;
  }
  const provided = req.header("x-admin-token");
  if (!provided || provided !== adminToken) {
    res.status(401).json({ error: "Invalid admin token" });
    return false;
  }
  return true;
}

/** Shape a DB picker row into the public Picker payload. */
function toPicker(p: Picker) {
  return {
    id: p.id,
    pickerType: p.pickerType,
    name: p.name,
    handle: p.handle,
    homeUrl: p.homeUrl,
    trustTier: p.trustTier,
    description: p.description,
    active: p.active,
  };
}

/** Shape a DB station row into the public Station payload. */
function toStation(s: Station) {
  return {
    slug: s.slug,
    name: s.name,
    org: s.org,
    country: s.country,
    streamUrl: s.streamUrl,
    streamQuality: s.streamQuality,
    streamFormat: s.streamFormat,
    mode: s.mode,
    homepageUrl: s.homepageUrl,
    donateUrl: s.donateUrl,
    logoUrl: s.logoUrl,
    attribution: s.attribution,
  };
}

// GET /api/stations
router.get("/stations", async (_req, res) => {
  try {
    const rows = await db
      .select()
      .from(stationsTable)
      .orderBy(asc(stationsTable.sortOrder), asc(stationsTable.name));
    const data = ListStationsResponse.parse({ stations: rows.map(toStation) });
    return res.json(data);
  } catch (err) {
    console.error("[lore] list stations failed", err);
    return res.status(503).json({ error: "Could not load stations" });
  }
});

// GET /api/stations/:slug/now-playing
router.get("/stations/:slug/now-playing", async (req, res) => {
  const parsed = GetStationNowPlayingParams.safeParse(req.params);
  if (!parsed.success) {
    return res.status(404).json({ error: "Station not found" });
  }
  try {
    const [station] = await db
      .select()
      .from(stationsTable)
      .where(eq(stationsTable.slug, parsed.data.slug))
      .limit(1);
    if (!station) {
      return res.status(404).json({ error: "Station not found" });
    }

    // Most recent spin for this station, joined with its resolved recording.
    const [row] = await db
      .select({
        rawArtist: spinsTable.rawArtist,
        rawTitle: spinsTable.rawTitle,
        source: spinsTable.source,
        confidence: spinsTable.confidence,
        playedAt: spinsTable.playedAt,
        mbid: recordingsTable.mbid,
        title: recordingsTable.title,
        artist: recordingsTable.artist,
        artworkUrl: recordingsTable.artworkUrl,
        links: recordingsTable.links,
      })
      .from(spinsTable)
      .leftJoin(recordingsTable, eq(spinsTable.mbid, recordingsTable.mbid))
      .where(eq(spinsTable.stationId, station.id))
      .orderBy(desc(spinsTable.playedAt))
      .limit(1);

    const nowPlaying = row
      ? {
          rawArtist: row.rawArtist ?? "",
          rawTitle: row.rawTitle ?? "",
          source: row.source,
          confidence: row.confidence,
          playedAt: row.playedAt.toISOString(),
          artworkUrl: row.artworkUrl ?? null,
          recording: row.mbid
            ? {
                mbid: row.mbid,
                title: row.title ?? row.rawTitle ?? "",
                artist: row.artist ?? row.rawArtist ?? "",
                artworkUrl: row.artworkUrl ?? null,
                links: row.links ?? [],
              }
            : null,
        }
      : null;

    const data = GetStationNowPlayingResponse.parse({
      station: toStation(station),
      nowPlaying,
    });
    return res.json(data);
  } catch (err) {
    console.error("[lore] now-playing failed", err);
    return res.status(503).json({ error: "Could not load now-playing" });
  }
});

// GET /api/recordings/:mbid — the recording's own metadata (song-page header).
router.get("/recordings/:mbid", async (req, res) => {
  const parsed = GetRecordingParams.safeParse(req.params);
  if (!parsed.success) {
    return res.status(404).json({ error: "Recording not found" });
  }
  try {
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
    const data = GetRecordingResponse.parse({
      mbid: rec.mbid,
      title: rec.title,
      artist: rec.artist,
      artistMbid: rec.artistMbid,
      durationMs: rec.durationMs,
      artworkUrl: rec.artworkUrl ?? null,
      links: rec.links ?? [],
    });
    return res.json(data);
  } catch (err) {
    console.error("[lore] get recording failed", err);
    return res.status(503).json({ error: "Could not load recording" });
  }
});

// GET /api/recordings/:mbid/spins
router.get("/recordings/:mbid/spins", async (req, res) => {
  const parsed = GetRecordingSpinsParams.safeParse(req.params);
  if (!parsed.success) {
    return res.status(404).json({ error: "Recording not found" });
  }
  try {
    const spins = await spinsForRecording(parsed.data.mbid);
    const data = GetRecordingSpinsResponse.parse({
      mbid: parsed.data.mbid,
      spins: spins.map((s) => ({
        playedAt: s.playedAt.toISOString(),
        source: s.source,
        confidence: s.confidence,
        station: s.station,
        show: s.show,
      })),
    });
    return res.json(data);
  } catch (err) {
    console.error("[lore] recording spins failed", err);
    return res.status(503).json({ error: "Could not load spins" });
  }
});

// GET /api/recordings/:mbid/preview — best-effort 30s clip (for riding).
router.get("/recordings/:mbid/preview", async (req, res) => {
  const parsed = GetRecordingPreviewParams.safeParse(req.params);
  if (!parsed.success) {
    return res.status(404).json({ error: "Recording not found" });
  }
  try {
    const [rec] = await db
      .select({
        title: recordingsTable.title,
        artist: recordingsTable.artist,
      })
      .from(recordingsTable)
      .where(eq(recordingsTable.mbid, parsed.data.mbid))
      .limit(1);
    if (!rec) {
      return res.status(404).json({ error: "Recording not found" });
    }
    const preview = await resolvePreview(parsed.data.mbid, rec.artist, rec.title);
    const data = GetRecordingPreviewResponse.parse({
      mbid: parsed.data.mbid,
      previewUrl: preview.previewUrl,
      artworkUrl: preview.artworkUrl,
      source: preview.source,
    });
    return res.json(data);
  } catch (err) {
    console.error("[lore] recording preview failed", err);
    return res.status(503).json({ error: "Could not load preview" });
  }
});

// GET /api/recordings/:mbid/segues
router.get("/recordings/:mbid/segues", async (req, res) => {
  const parsed = GetRecordingSeguesParams.safeParse(req.params);
  if (!parsed.success) {
    return res.status(404).json({ error: "Recording not found" });
  }
  try {
    const next = await nextRideable(parsed.data.mbid);
    const data = GetRecordingSeguesResponse.parse({
      mbid: parsed.data.mbid,
      next,
    });
    return res.json(data);
  } catch (err) {
    console.error("[lore] recording segues failed", err);
    return res.status(503).json({ error: "Could not load segues" });
  }
});

// POST /api/admin/spins — admin-only manual/historical spin entry.
router.post("/admin/spins", async (req, res) => {
  // Gate on a server-side token. Absent env => the endpoint is disabled (503),
  // never silently open. Never log the token.
  const adminToken = process.env["LORE_ADMIN_TOKEN"];
  if (!adminToken) {
    return res.status(503).json({ error: "Manual entry is not configured" });
  }
  const provided = req.header("x-admin-token");
  if (!provided || provided !== adminToken) {
    return res.status(401).json({ error: "Invalid admin token" });
  }

  const parsed = CreateManualSpinBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid manual spin" });
  }
  const body = parsed.data;

  try {
    const [station] = await db
      .select()
      .from(stationsTable)
      .where(eq(stationsTable.slug, body.stationSlug))
      .limit(1);
    if (!station) {
      return res.status(404).json({ error: "Station not found" });
    }

    const playedAt = body.playedAt ? new Date(body.playedAt) : new Date();
    if (Number.isNaN(playedAt.getTime())) {
      return res.status(400).json({ error: "Invalid playedAt timestamp" });
    }

    const { logged, resolution } = await ingestManualSpin({
      station,
      artist: body.artist,
      title: body.title,
      citation: body.citation,
      playedAt,
      ...(body.showName
        ? {
            show: {
              name: body.showName,
              ...(body.djName ? { djName: body.djName } : {}),
            },
          }
        : {}),
      ...(body.durationMs != null ? { durationMs: body.durationMs } : {}),
    });

    return res.status(201).json({
      logged,
      mbid: resolution.mbid,
      confidence: resolution.confidence,
    });
  } catch (err) {
    console.error("[lore] manual spin failed", err);
    const message =
      err instanceof Error ? err.message : "Could not log manual spin";
    return res.status(400).json({ error: message });
  }
});

// GET /api/pickers — public list of taste sources beyond radio DJs.
router.get("/pickers", async (_req, res) => {
  try {
    const rows = await db
      .select()
      .from(pickersTable)
      .where(eq(pickersTable.active, true))
      .orderBy(asc(pickersTable.trustTier), asc(pickersTable.name));
    const data = ListPickersResponse.parse({ pickers: rows.map(toPicker) });
    return res.json(data);
  } catch (err) {
    console.error("[lore] list pickers failed", err);
    return res.status(503).json({ error: "Could not load pickers" });
  }
});

// GET /api/recordings/:mbid/entry — the source-agnostic fallback ladder.
router.get("/recordings/:mbid/entry", async (req, res) => {
  const parsed = GetRecordingEntryParams.safeParse(req.params);
  if (!parsed.success) {
    return res.status(404).json({ error: "Recording not found" });
  }
  try {
    // The artist-level rung needs the recording's artist MBID; resolve it from
    // the spine so the ladder needs no client-supplied hint.
    const [rec] = await db
      .select({ artistMbid: recordingsTable.artistMbid })
      .from(recordingsTable)
      .where(eq(recordingsTable.mbid, parsed.data.mbid))
      .limit(1);
    const result = await resolveEntry(
      parsed.data.mbid,
      rec?.artistMbid ?? undefined,
    );
    const data = GetRecordingEntryResponse.parse(result);
    return res.json(data);
  } catch (err) {
    console.error("[lore] recording entry failed", err);
    return res.status(503).json({ error: "Could not load entry" });
  }
});

// POST /api/admin/pickers — admin-only create/update of a picker.
router.post("/admin/pickers", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const parsed = UpsertPickerBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid picker" });
  }
  const b = parsed.data;
  try {
    const picker = await upsertPicker({
      pickerType: b.pickerType as PickerType,
      name: b.name,
      ...(b.handle ? { handle: b.handle } : {}),
      ...(b.homeUrl ? { homeUrl: b.homeUrl } : {}),
      ...(b.trustTier != null ? { trustTier: b.trustTier } : {}),
      ...(b.description ? { description: b.description } : {}),
    });
    return res.status(201).json(toPicker(picker));
  } catch (err) {
    console.error("[lore] upsert picker failed", err);
    const message = err instanceof Error ? err.message : "Could not save picker";
    return res.status(400).json({ error: message });
  }
});

// POST /api/admin/pickers/:handle/picks — admin-only tracklist ingest.
router.post("/admin/pickers/:handle/picks", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const params = LogTracklistParams.safeParse(req.params);
  if (!params.success) {
    return res.status(404).json({ error: "Picker not found" });
  }
  const parsed = LogTracklistBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid tracklist" });
  }
  try {
    const picker = await getPickerByHandle(params.data.handle);
    if (!picker) {
      return res.status(404).json({ error: "Picker not found" });
    }
    const b = parsed.data;
    const summary = await logTracklist({
      pickerId: picker.id,
      source: b.source as PickSource,
      entries: b.entries,
      ...(b.ordered != null ? { ordered: b.ordered } : {}),
      ...(b.sourceUrl ? { sourceUrl: b.sourceUrl } : {}),
      ...(b.context ? { context: b.context } : {}),
    });
    return res.status(201).json(summary);
  } catch (err) {
    console.error("[lore] log tracklist failed", err);
    return res.status(400).json({ error: "Could not log tracklist" });
  }
});

// POST /api/admin/labels — admin-only label seed by MusicBrainz MBID.
router.post("/admin/labels", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const parsed = SeedLabelBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid label seed" });
  }
  const b = parsed.data;
  try {
    const summary = await seedLabelPicker({
      labelMbid: b.labelMbid,
      ...(b.name ? { name: b.name } : {}),
      ...(b.homeUrl ? { homeUrl: b.homeUrl } : {}),
    });
    return res.status(201).json({ ...summary, matched: null });
  } catch (err) {
    console.error("[lore] seed label failed", err);
    const message = err instanceof Error ? err.message : "Could not seed label";
    return res.status(400).json({ error: message });
  }
});

// POST /api/admin/blogs — admin-only blog/critic RSS ingest.
router.post("/admin/blogs", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const parsed = IngestBlogBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid blog ingest" });
  }
  const b = parsed.data;
  try {
    const r = await ingestBlogFeed({
      feedUrl: b.feedUrl,
      name: b.name,
      ...(b.homeUrl ? { homeUrl: b.homeUrl } : {}),
    });
    return res.status(201).json({
      pickerId: r.pickerId,
      handle: r.handle,
      name: r.name,
      found: r.items,
      matched: r.matched,
      logged: r.logged,
    });
  } catch (err) {
    console.error("[lore] ingest blog failed", err);
    const message = err instanceof Error ? err.message : "Could not ingest blog";
    return res.status(400).json({ error: message });
  }
});

// POST /api/admin/discogs-lists — admin-only Discogs list ingest (collector).
router.post("/admin/discogs-lists", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const parsed = IngestDiscogsListBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid Discogs list ingest" });
  }
  const b = parsed.data;
  try {
    const r = await ingestDiscogsList({
      listId: b.listId,
      ...(b.name ? { name: b.name } : {}),
    });
    return res.status(201).json({
      pickerId: r.pickerId,
      handle: r.handle,
      name: r.name,
      found: r.items,
      matched: null,
      logged: r.logged,
    });
  } catch (err) {
    console.error("[lore] ingest discogs list failed", err);
    const message =
      err instanceof Error ? err.message : "Could not ingest Discogs list";
    return res.status(400).json({ error: message });
  }
});

// POST /api/admin/rym-lists — admin-only RateYourMusic link-out picker.
router.post("/admin/rym-lists", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const parsed = AddRymListBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid RYM list" });
  }
  const b = parsed.data;
  try {
    const r = await addRymPicker({ name: b.name, url: b.url });
    const picker = await getPickerByHandle(r.handle);
    if (!picker) {
      return res.status(400).json({ error: "Could not create RYM picker" });
    }
    return res.status(201).json(toPicker(picker));
  } catch (err) {
    console.error("[lore] add rym list failed", err);
    const message = err instanceof Error ? err.message : "Could not add RYM list";
    return res.status(400).json({ error: message });
  }
});

export default router;
