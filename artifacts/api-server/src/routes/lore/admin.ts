import { Router, type IRouter } from "express";
import { rateLimit } from "express-rate-limit";
import { timingSafeEqual, createHash } from "node:crypto";
import {
  CreateManualSpinBody,
  CreateManualSpinResponse,
  UpsertPickerBody,
  LogTracklistParams,
  LogTracklistBody,
  SeedLabelBody,
  IngestBlogBody,
  SeedBlogPickersBody,
  SeedBlogPickersResponse,
  IngestDiscogsListBody,
  AddSongExploderClaimParams,
  AddSongExploderClaimBody,
  AddRymListBody,
  EnrollNtsShowBody,
  EnrollNtsShowResponse,
  ListAllDraftClaimsResponse,
  GetWikipediaDraftsResponse,
  PatchClaimParams,
  PatchClaimBody,
  PatchClaimResponse,
  ListGeniusDraftsQueryParams,
  ReviewGeniusDraftParams,
  ReviewGeniusDraftBody,
  ListGeniusDraftsResponse,
  ReviewGeniusDraftResponse,
  ListSongExploderEpisodesResponse,
  PatchSongExploderEpisodeParams,
  PatchSongExploderEpisodeBody,
  PatchSongExploderEpisodeResponse,
  GetSongExploderChaptersParams,
  GetSongExploderChaptersResponse,
  EnrollRadioBrowserBody,
  EnrollRadioBrowserResponse,
  ListRadioBrowserStationsResponse,
  DeleteRadioBrowserParams,
  ReenrollRadioBrowserParams,
  ReenrollRadioBrowserResponse,
  CreateListSourceBody,
  ScrapeListBody,
  ConfirmListEntryBody,
  RecomputeStationQualityResponse,
  ListAdminStationsResponse,
  VoidScrapedShowParams,
  VoidScrapedShowBody,
  VoidScrapedShowResponse,
} from "@workspace/api-zod";
import {
  db,
  stationsTable,
  recordingsTable,
  pickersTable,
  picksTable,
  trackClaimsTable,
  geniusAnnotationDraftsTable,
  songExploderEpisodesTable,
  radioBrowserStationsTable,
  listSourcesTable,
  listsTable,
  listEntriesTable,
  recordingReleaseGroupsTable,
  stationQualityTable,
  blogListCandidatesTable,
  criCandidatesTable,
  scrapedShowsTable,
} from "@workspace/db";
import { eq, and, asc, desc, sql, count, isNull, gt } from "drizzle-orm";
import { runAnonCleanup } from "../../lore/anonCleanup.js";
import { wireListExtractor } from "../../lore/list-wire.js";
import { processListCandidate, writeCandidateOutcome, runListCandidateBatch } from "../../lore/list-candidates.js";
import { scrapeAndPopulateList, enrichRecordingReleaseGroups } from "../../lore/list-scraper.js";
import { recomputeAllQualityScores } from "../../lore/quality.js";
import { ingestManualSpin } from "../../lore/resolve.js";
import { fetchRadioBrowserStation, slugify as rbSlugify } from "../../lore/radio-browser.js";
import { enrollStationPoller, unenrollStationPoller, getSpinitronWebStaleStations, getFeedFreshnessStaleStations, coverageClassFor } from "../../lore/poller.js";
import { monitoringSince } from "../../lore/feed-freshness-health.js";
import { clearIcyErrorBackoff, isPollable } from "../../lore/adapters.js";
import { getLeaseAllocation } from "../../lore/socket-leases.js";
import {
  upsertPicker,
  getPickerByHandle,
  logTracklist,
  slugify,
  type PickerType,
  type PickSource,
} from "../../lore/picks.js";
import { validateNtsShowAlias } from "../../lore/nts.js";
import { seedLabelPicker } from "../../lore/label.js";
import { ingestBlogFeed, discoverFeedUrl, extractFeedLinksFromHtml } from "../../lore/blog.js";
import { ingestDiscogsList, addRymPicker } from "../../lore/collector.js";
import { addSongExploderClaim } from "../../lore/song-exploder.js";
import { publishGeniusDraft, rejectGeniusDraft } from "../../lore/genius-annotations.js";
import { h, HttpError } from "../../middlewares/asyncHandler.js";
import { stampSpinShowIds } from "../../lore/scraped-shows-sync.js";
import { clearAutomationClassCache } from "../../lore/scraped-shows-sync.js";
import { clearPlayerScheduleCache } from "../player.js";
import { toPicker } from "./shared.js";

const router: IRouter = Router();

// Rate limit: 10 requests per 15 minutes per IP — brute-force protection.
// Applied before auth so lockout happens before any token comparison.
//
// Scoped to STATE-MUTATING methods only (POST/PATCH/PUT/DELETE). Read-only
// GET endpoints are deliberately exempt: the admin dashboard polls several of
// them (e.g. /admin/feed-freshness-health, /admin/spinitron-web-health,
// /admin/radio-browser/stations) every 30s, which would otherwise trip the
// 10-per-15-minutes budget within a couple of minutes and lock a legitimate
// admin out of their own monitoring UI. GETs cannot mutate admin state, remain
// behind the auth gate below, and carry no brute-force risk (a valid token is
// required to learn anything), so exempting them closes the false-positive
// throttling without weakening security. The mutating routes — where a
// brute-force / abuse concern actually exists — keep the strict limit.
const adminMutationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});
router.use((req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    return next();
  }
  return adminMutationLimiter(req, res, next);
});

// Structural auth gate — all routes on this router are automatically protected.
// Absent env var → 503 (not silently open); token mismatch → 401.
// Uses timingSafeEqual on SHA-256 digests to prevent timing side-channels.
router.use((req, res, next) => {
  const adminToken = process.env["LORE_ADMIN_TOKEN"];
  if (!adminToken) {
    res.status(503).json({ error: "Admin entry is not configured" });
    return;
  }
  const provided = req.header("x-admin-token") ?? "";
  const expected = adminToken;
  const aDigest = createHash("sha256").update(provided).digest();
  const bDigest = createHash("sha256").update(expected).digest();
  if (!timingSafeEqual(aDigest, bDigest)) {
    res.status(401).json({ error: "Invalid admin token" });
    return;
  }
  next();
});

// POST /api/admin/spins — admin-only manual/historical spin entry.
router.post("/admin/spins", h(async (req, res) => {
  const parsed = CreateManualSpinBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid manual spin" });
  }
  const body = parsed.data;

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
      ? { show: { name: body.showName, ...(body.djName ? { djName: body.djName } : {}) } }
      : {}),
    ...(body.durationMs != null ? { durationMs: body.durationMs } : {}),
  }).catch((err) => {
    throw new HttpError(400, err instanceof Error ? err.message : "Could not log manual spin");
  });

  return res.status(201).json(
    CreateManualSpinResponse.parse({
      logged,
      mbid: resolution.mbid ?? null,
      confidence: resolution.confidence,
    }),
  );
}));

// POST /api/admin/pickers — admin-only create/update of a picker.
router.post("/admin/pickers", h(async (req, res) => {
  const parsed = UpsertPickerBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid picker" });
  }
  const b = parsed.data;

  const picker = await upsertPicker({
    pickerType: b.pickerType as PickerType,
    name: b.name,
    ...(b.handle ? { handle: b.handle } : {}),
    ...(b.homeUrl ? { homeUrl: b.homeUrl } : {}),
    ...(b.trustTier != null ? { trustTier: b.trustTier } : {}),
    ...(b.description ? { description: b.description } : {}),
  }).catch((err) => {
    throw new HttpError(400, err instanceof Error ? err.message : "Could not save picker");
  });

  return res.status(201).json(toPicker(picker));
}));

// POST /api/admin/pickers/:handle/picks — admin-only tracklist ingest.
router.post("/admin/pickers/:handle/picks", h(async (req, res) => {
  const params = LogTracklistParams.safeParse(req.params);
  if (!params.success) {
    return res.status(404).json({ error: "Picker not found" });
  }
  const parsed = LogTracklistBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid tracklist" });
  }

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
  }).catch(() => {
    throw new HttpError(400, "Could not log tracklist");
  });

  return res.status(201).json(summary);
}));

// POST /api/admin/labels — admin-only label seed by MusicBrainz MBID.
router.post("/admin/labels", h(async (req, res) => {
  const parsed = SeedLabelBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid label seed" });
  }
  const b = parsed.data;

  const summary = await seedLabelPicker({
    labelMbid: b.labelMbid,
    ...(b.name ? { name: b.name } : {}),
    ...(b.homeUrl ? { homeUrl: b.homeUrl } : {}),
  }).catch((err) => {
    throw new HttpError(400, err instanceof Error ? err.message : "Could not seed label");
  });

  return res.status(201).json(summary);
}));

// POST /api/admin/blogs — admin-only blog/critic RSS ingest.
router.post("/admin/blogs", h(async (req, res) => {
  const parsed = IngestBlogBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid blog ingest" });
  }
  const b = parsed.data;

  const r = await ingestBlogFeed({
    feedUrl: b.feedUrl,
    name: b.name,
    ...(b.homeUrl ? { homeUrl: b.homeUrl } : {}),
  }).catch((err) => {
    throw new HttpError(400, err instanceof Error ? err.message : "Could not ingest blog");
  });

  return res.status(201).json({
    pickerId: r.pickerId,
    handle: r.handle,
    name: r.name,
    found: r.items,
    matched: r.matched,
    logged: r.logged,
  });
}));

/**
 * Curated list of well-known music blogs for bulk seeding.
 * These are inserted as inactive (active=false) longtail pickers awaiting
 * human review — feed discovery confirms the feed URL before upsert.
 */
const CURATED_BLOG_URLS = [
  "https://theobelisk.net",
  "https://www.invisibleoranges.com",
  "https://thequietus.com",
  "https://daily.bandcamp.com",
  "https://aquariumdrunkard.com",
  "https://pitchfork.com",
  "https://www.stereogum.com",
  "https://exclaim.ca",
  "https://www.tinymixtapes.com",
  "https://www.clashmusic.com",
  "https://www.sputnikmusic.com",
  "https://www.allmusic.com",
  "https://treblezine.com",
  "https://www.thefader.com",
  "https://www.residentadvisor.net",
] as const;

// POST /api/admin/lore/pickers/seed-blog — bulk-seed blog pickers via auto-discovery.
router.post("/admin/lore/pickers/seed-blog", h(async (req, res) => {
  const parsed = SeedBlogPickersBody.safeParse(req.body);
  const urls = parsed.success ? parsed.data.urls : [...CURATED_BLOG_URLS];

  type SeedResult = {
    url: string;
    feedUrl: string | null;
    handle: string | null;
    status: "discovered" | "already_exists" | "no_feed" | "error";
    error?: string;
  };
  const results: SeedResult[] = [];

  for (const url of urls) {
    let feedUrl: string | null = null;
    try {
      feedUrl = await discoverFeedUrl(url);

      if (!feedUrl) {
        results.push({ url, feedUrl: null, handle: null, status: "no_feed" });
        continue;
      }

      let domain: string;
      try {
        domain = new URL(url).hostname;
      } catch {
        results.push({ url, feedUrl: null, handle: null, status: "error", error: "Invalid URL" });
        continue;
      }

      const handle = slugify(domain);
      if (!handle) {
        results.push({ url, feedUrl, handle: null, status: "error", error: "Could not slugify domain" });
        continue;
      }

      const existing = await db
        .select({ id: pickersTable.id })
        .from(pickersTable)
        .where(eq(pickersTable.handle, handle))
        .limit(1);

      if (existing.length > 0) {
        results.push({ url, feedUrl, handle, status: "already_exists" });
        continue;
      }

      await db.insert(pickersTable).values({
        pickerType: "blog",
        name: domain,
        handle,
        homeUrl: url,
        sourceRef: { feedUrl },
        trustTier: 2,
        active: false,
        description: `Seeded longtail blog candidate — feed discovered via auto-discovery.`,
      }).onConflictDoNothing({ target: pickersTable.handle });

      results.push({ url, feedUrl, handle, status: "discovered" });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      results.push({ url, feedUrl, handle: null, status: "error", error: errMsg });
    }
  }

  const discovered = results.filter((r) => r.status === "discovered").length;
  console.info(`[lore] seed-blog: ${discovered}/${urls.length} new pickers inserted`);

  return res.status(200).json({ results });
}));

// POST /api/admin/discogs-lists — admin-only Discogs list ingest.
router.post("/admin/discogs-lists", h(async (req, res) => {
  const parsed = IngestDiscogsListBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid Discogs list ingest" });
  }
  const b = parsed.data;

  const r = await ingestDiscogsList({
    listId: b.listId,
    ...(b.name ? { name: b.name } : {}),
  }).catch((err) => {
    throw new HttpError(400, err instanceof Error ? err.message : "Could not ingest Discogs list");
  });

  return res.status(201).json({
    pickerId: r.pickerId,
    handle: r.handle,
    name: r.name,
    found: r.items,
    matched: null,
    logged: r.logged,
  });
}));

// POST /api/admin/song-exploder/:episodeId/claims — attach a timestamp-anchored
// claim to the recording resolved from a Song Exploder episode.
router.post("/admin/song-exploder/:episodeId/claims", h(async (req, res) => {
  const params = AddSongExploderClaimParams.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: "Invalid episode id" });
  }
  const parsed = AddSongExploderClaimBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid claim body" });
  }
  const b = parsed.data;

  const result = await addSongExploderClaim({
    episodeId: params.data.episodeId,
    offsetMs: b.offsetMs ?? null,
    text: b.text,
    sourceUrl: b.sourceUrl,
  }).catch((err) => {
    const status = (err as { status?: number }).status;
    if (status === 404) throw new HttpError(404, "Episode not found");
    if (status === 409)
      throw new HttpError(
        409,
        "Episode not yet resolved to a recording — resolve it first",
      );
    throw new HttpError(400, "Could not store claim");
  });

  return res.status(201).json(result);
}));

// GET /api/admin/claims?status=draft — all pending Wikipedia draft claims across all tracks.
router.get("/admin/claims", h(async (req, res) => {
  const rows = await db
    .select({
      id: trackClaimsTable.id,
      mbid: trackClaimsTable.mbid,
      anchorValue: trackClaimsTable.anchorValue,
      sourceLabel: trackClaimsTable.sourceLabel,
      sourceUrl: trackClaimsTable.sourceUrl,
      status: trackClaimsTable.status,
      createdAt: trackClaimsTable.createdAt,
      trackTitle: recordingsTable.title,
      trackArtist: recordingsTable.artist,
    })
    .from(trackClaimsTable)
    .leftJoin(recordingsTable, eq(trackClaimsTable.mbid, recordingsTable.mbid))
    .where(
      and(
        eq(trackClaimsTable.status, "draft"),
        sql`${trackClaimsTable.sourceHandle} in ('wikipedia', 'wikipedia-album')`,
      ),
    )
    .orderBy(desc(trackClaimsTable.createdAt));

  const data = ListAllDraftClaimsResponse.parse({
    claims: rows.map((r) => ({
      id: r.id,
      mbid: r.mbid,
      anchorValue: r.anchorValue ?? "",
      sourceLabel: r.sourceLabel,
      sourceUrl: r.sourceUrl,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      trackTitle: r.trackTitle ?? null,
      trackArtist: r.trackArtist ?? null,
    })),
  });
  return res.json(data);
}));

// GET /api/admin/wikipedia-drafts?mbid= — draft Wikipedia claims pending review.
router.get("/admin/wikipedia-drafts", h(async (req, res) => {
  const rawMbid = req.query["mbid"];
  const mbid = typeof rawMbid === "string" ? rawMbid.trim() : "";
  if (!mbid) {
    return res.status(400).json({ error: "mbid query parameter is required" });
  }

  const rows = await db
    .select()
    .from(trackClaimsTable)
    .where(
      and(
        eq(trackClaimsTable.mbid, mbid),
        eq(trackClaimsTable.sourceHandle, "wikipedia"),
        eq(trackClaimsTable.status, "draft"),
      ),
    )
    .orderBy(trackClaimsTable.id);

  return res.json(
    GetWikipediaDraftsResponse.parse({
      claims: rows.map((c) => ({
        id: c.id,
        mbid: c.mbid,
        anchorValue: c.anchorValue ?? "",
        sourceLabel: c.sourceLabel,
        sourceUrl: c.sourceUrl,
        status: c.status,
        createdAt: c.createdAt.toISOString(),
      })),
    }),
  );
}));

// PATCH /api/admin/claims/:id — admin review: paraphrase + publish or reject.
router.patch("/admin/claims/:id", h(async (req, res) => {
  const params = PatchClaimParams.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: "Invalid claim id" });
  }
  const body = PatchClaimBody.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ error: "Invalid request body" });
  }
  const b = body.data;

  if (b.status === "published" && (!b.text || !b.text.trim())) {
    return res.status(400).json({ error: "text is required when publishing a claim" });
  }

  const [existing] = await db
    .select()
    .from(trackClaimsTable)
    .where(eq(trackClaimsTable.id, params.data.id))
    .limit(1);
  if (!existing) {
    return res.status(404).json({ error: "Claim not found" });
  }

  const [updated] = await db
    .update(trackClaimsTable)
    .set({ status: b.status, ...(b.text ? { text: b.text.trim() } : {}) })
    .where(eq(trackClaimsTable.id, params.data.id))
    .returning();
  if (!updated) {
    return res.status(404).json({ error: "Claim not found" });
  }

  return res.json(
    PatchClaimResponse.parse({
      id: updated.id,
      mbid: updated.mbid,
      anchorValue: updated.anchorValue ?? "",
      sourceLabel: updated.sourceLabel,
      sourceUrl: updated.sourceUrl,
      status: updated.status,
      createdAt: updated.createdAt.toISOString(),
    }),
  );
}));

// GET /api/admin/genius-drafts?mbid=:mbid — list pending annotation drafts.
router.get("/admin/genius-drafts", h(async (req, res) => {
  const parsed = ListGeniusDraftsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "mbid query parameter is required" });
  }

  const rows = await db
    .select()
    .from(geniusAnnotationDraftsTable)
    .where(
      and(
        eq(geniusAnnotationDraftsTable.mbid, parsed.data.mbid),
        eq(geniusAnnotationDraftsTable.status, "draft"),
      ),
    )
    .orderBy(
      desc(geniusAnnotationDraftsTable.verified),
      desc(geniusAnnotationDraftsTable.voteCount),
      asc(geniusAnnotationDraftsTable.id),
    );

  return res.json(
    ListGeniusDraftsResponse.parse({
      mbid: parsed.data.mbid,
      drafts: rows.map((r) => ({
        id: r.id,
        mbid: r.mbid,
        geniusSongId: r.geniusSongId,
        geniusAnnotationId: r.geniusAnnotationId,
        fragmentHash: r.fragmentHash,
        fragmentLen: r.fragmentLen,
        anchorType: r.anchorType,
        offsetMs: r.offsetMs ?? null,
        geniusUrl: r.geniusUrl,
        verified: r.verified,
        voteCount: r.voteCount,
        status: r.status,
      })),
    }),
  );
}));

// POST /api/admin/genius-drafts/:id/review — publish or reject a draft.
router.post("/admin/genius-drafts/:id/review", h(async (req, res) => {
  const params = ReviewGeniusDraftParams.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: "Invalid draft id" });
  }
  const parsed = ReviewGeniusDraftBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid review request" });
  }
  const { action, text } = parsed.data;

  if (action === "publish" && !text) {
    return res.status(400).json({ error: "text (paraphrase) is required when publishing" });
  }

  if (action === "reject") {
    const ok = await rejectGeniusDraft(params.data.id);
    if (!ok) return res.status(404).json({ error: "Draft not found" });
    return res.json(
      ReviewGeniusDraftResponse.parse({ id: params.data.id, action: "rejected", claimId: null }),
    );
  }

  // action === "publish"
  const claimId = await publishGeniusDraft(params.data.id, text!);
  if (claimId === null) {
    return res.status(400).json({ error: "Draft not found or not in reviewable state" });
  }
  return res.json(
    ReviewGeniusDraftResponse.parse({ id: params.data.id, action: "published", claimId }),
  );
}));

// GET /api/admin/song-exploder/episodes — list all Song Exploder episodes
// (resolved + unresolved) with anchor counts. Resolved episodes have an MBID.
router.get("/admin/song-exploder/episodes", h(async (req, res) => {
  const rows = await db
    .select({
      id: songExploderEpisodesTable.id,
      title: songExploderEpisodesTable.title,
      episodeUrl: songExploderEpisodesTable.episodeUrl,
      youtubeUrl: songExploderEpisodesTable.youtubeUrl,
      mbid: songExploderEpisodesTable.mbid,
      resolvedAt: songExploderEpisodesTable.resolvedAt,
      publishedAt: songExploderEpisodesTable.publishedAt,
      anchorCount: sql<number>`
        cast(count(${trackClaimsTable.id}) filter (
          where ${trackClaimsTable.sourceHandle} = 'song-exploder'
            and ${trackClaimsTable.status} = 'published'
        ) as int)
      `,
    })
    .from(songExploderEpisodesTable)
    .leftJoin(
      trackClaimsTable,
      eq(trackClaimsTable.mbid, songExploderEpisodesTable.mbid),
    )
    .groupBy(songExploderEpisodesTable.id)
    .orderBy(desc(songExploderEpisodesTable.publishedAt));

  return res.json(
    ListSongExploderEpisodesResponse.parse({
      episodes: rows.map((r) => ({
        id: r.id,
        title: r.title,
        episodeUrl: r.episodeUrl,
        youtubeUrl: r.youtubeUrl ?? null,
        mbid: r.mbid ?? null,
        resolvedAt: r.resolvedAt?.toISOString() ?? null,
        publishedAt: r.publishedAt?.toISOString() ?? null,
        anchorCount: r.anchorCount,
      })),
    }),
  );
}));

// PATCH /api/admin/song-exploder/:episodeId — update the YouTube URL for an episode.
router.patch("/admin/song-exploder/:episodeId", h(async (req, res) => {
  const params = PatchSongExploderEpisodeParams.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: "Invalid episode id" });
  }
  const body = PatchSongExploderEpisodeBody.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ error: "Invalid request body — youtubeUrl must be a URL or null" });
  }

  const [updated] = await db
    .update(songExploderEpisodesTable)
    .set({ youtubeUrl: body.data.youtubeUrl })
    .where(eq(songExploderEpisodesTable.id, params.data.episodeId))
    .returning({ id: songExploderEpisodesTable.id, youtubeUrl: songExploderEpisodesTable.youtubeUrl });

  if (!updated) {
    return res.status(404).json({ error: "Episode not found" });
  }

  return res.json(
    PatchSongExploderEpisodeResponse.parse({
      id: updated.id,
      youtubeUrl: updated.youtubeUrl ?? null,
    }),
  );
}));

// GET /api/admin/song-exploder/:episodeId/chapters — fetch and parse YouTube
// chapter markers from the episode's stored YouTube URL. Uses YouTube's
// public innertube player endpoint so no API key is required.
router.get("/admin/song-exploder/:episodeId/chapters", h(async (req, res) => {
  const params = GetSongExploderChaptersParams.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: "Invalid episode id" });
  }

  const [episode] = await db
    .select({ youtubeUrl: songExploderEpisodesTable.youtubeUrl })
    .from(songExploderEpisodesTable)
    .where(eq(songExploderEpisodesTable.id, params.data.episodeId));

  if (!episode) {
    return res.status(404).json({ error: "Episode not found" });
  }
  if (!episode.youtubeUrl) {
    return res.status(422).json({ error: "Episode has no YouTube URL — save one first" });
  }

  const videoId = extractYouTubeVideoId(episode.youtubeUrl);
  if (!videoId) {
    return res.status(422).json({ error: "Cannot parse video ID from the stored YouTube URL" });
  }

  const result = await fetchYouTubeVideoDescription(videoId);
  if ("error" in result) {
    const status = result.error === "YOUTUBE_API_KEY is not configured" ? 503 : 502;
    return res.status(status).json({ error: result.error });
  }

  const chapters = parseYouTubeChapters(result.description);
  return res.json(GetSongExploderChaptersResponse.parse({ chapters }));
}));

/** Pull the video ID out of common YouTube URL forms. */
function extractYouTubeVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") return u.pathname.slice(1) || null;
    return u.searchParams.get("v");
  } catch {
    return null;
  }
}

/**
 * Fetch the video's description text via YouTube Data API v3.
 * Requires YOUTUBE_API_KEY to be set in the environment.
 * Returns { description: string } on success, { error: string } on failure.
 */
async function fetchYouTubeVideoDescription(
  videoId: string,
): Promise<{ description: string } | { error: string }> {
  const apiKey = process.env["YOUTUBE_API_KEY"];
  if (!apiKey) {
    return { error: "YOUTUBE_API_KEY is not configured" };
  }
  try {
    const url = new URL("https://www.googleapis.com/youtube/v3/videos");
    url.searchParams.set("id", videoId);
    url.searchParams.set("part", "snippet");
    url.searchParams.set("key", apiKey);
    const r = await fetch(url.toString(), {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) {
      const body = (await r.json().catch(() => ({}))) as { error?: { message?: string } };
      return { error: body.error?.message ?? `YouTube API returned HTTP ${r.status}` };
    }
    const j = (await r.json()) as {
      items?: Array<{ snippet?: { description?: string } }>;
    };
    const description = j.items?.[0]?.snippet?.description;
    if (description == null) {
      return { error: "Video not found or description unavailable" };
    }
    return { description };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Network error fetching YouTube data" };
  }
}

/**
 * Parse YouTube chapter markers from a video description.
 * Accepts both M:SS and H:MM:SS formats. Returns chapters sorted by
 * position; returns [] when fewer than two timestamps are found (YouTube's
 * own threshold for treating them as chapters).
 */
function parseYouTubeChapters(description: string): { positionMs: number; text: string }[] {
  const lines = description.split("\n");
  const chapters: { positionMs: number; text: string }[] = [];

  for (const line of lines) {
    const m = line.match(/^(\d+:\d{2}(?::\d{2})?)\s+(.+)/);
    if (!m) continue;
    const [, ts, rawLabel] = m;
    const parts = ts!.split(":").map((p) => parseInt(p, 10));
    let posMs: number;
    if (parts.length === 2) {
      posMs = (parts[0]! * 60 + parts[1]!) * 1000;
    } else {
      posMs = (parts[0]! * 3600 + parts[1]! * 60 + parts[2]!) * 1000;
    }
    const text = rawLabel!.trim();
    if (text) chapters.push({ positionMs: posMs, text });
  }

  chapters.sort((a, b) => a.positionMs - b.positionMs);
  return chapters.length >= 2 ? chapters : [];
}

// POST /api/admin/pickers/nts — admin-only NTS resident show enrolment.
// Validates the alias against the NTS public API, upserts a curator picker,
// and returns it. The existing NTS poller picks it up on its next cycle.
router.post("/admin/pickers/nts", h(async (req, res) => {
  const parsed = EnrollNtsShowBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request — alias is required" });
  }
  const { alias, name: nameOverride } = parsed.data;

  const validated = await validateNtsShowAlias(alias).catch((err) => {
    throw new HttpError(400, err instanceof Error ? err.message : "NTS alias validation failed");
  });

  const displayName = nameOverride?.trim() || validated.name;
  const handle = `nts-${slugify(alias)}`;
  const homeUrl = `https://www.nts.live/shows/${alias}`;

  const picker = await upsertPicker({
    pickerType: "curator",
    name: displayName,
    handle,
    homeUrl,
    trustTier: 2,
    sourceRef: { ntsShowAlias: alias },
    description: `NTS resident show — archived tracklists ingested by the NTS poller.`,
  }).catch((err) => {
    throw new HttpError(400, err instanceof Error ? err.message : "Could not save NTS picker");
  });

  return res.status(201).json(
    EnrollNtsShowResponse.parse({
      pickerId: picker.id,
      handle: picker.handle,
      name: picker.name,
      alias,
      homeUrl,
    }),
  );
}));

// ---- Radio Browser ICY enrollment --------------------------------------

// POST /api/admin/radio-browser/enroll — enroll a Radio Browser station for
// ICY metadata polling. Accepts a station UUID, fetches metadata from the
// Radio Browser API, upserts a stations row and a radio_browser_stations row,
// and immediately starts polling. Idempotent by UUID.
router.post("/admin/radio-browser/enroll", h(async (req, res) => {
  const parsed = EnrollRadioBrowserBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "uuid is required" });
  }
  const { uuid } = parsed.data;
  const trimmedUuid = uuid.trim();

  // Resolve UUID → station metadata via the Radio Browser API.
  const rbStation = await fetchRadioBrowserStation(trimmedUuid);
  if (!rbStation) {
    return res.status(404).json({
      error: `Station UUID "${trimmedUuid}" not found in Radio Browser directory`,
    });
  }

  const streamUrl = (rbStation.url_resolved || rbStation.url || "").trim();
  if (!streamUrl) {
    return res.status(422).json({ error: "Station has no usable stream URL" });
  }

  const stationName = rbStation.name?.trim() || "Unknown Station";
  // Use the full UUID as the slug (stable across name changes, collision-free).
  // Format: rb-{uuid} e.g. rb-960a8447-6600-11e8-ae2d-52543be04c81
  const slug = `rb-${trimmedUuid}`;
  void rbSlugify; // imported for potential future use; slug is UUID-based

  // Upsert the canonical stations row (change-detection now-playing source).
  const [stationRow] = await db
    .insert(stationsTable)
    .values({
      slug,
      name: stationName,
      streamUrl,
      streamFormat: "mp3",
      source: "radio_browser",
      tier: "longtail",
      active: true,
      nowPlayingSource: "radio_browser_icy",
      ...(rbStation.favicon?.trim() ? { logoUrl: rbStation.favicon.trim() } : {}),
      ...(rbStation.country?.trim() ? { country: rbStation.country.trim() } : {}),
      nowPlayingConfig: {},
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: stationsTable.slug,
      set: {
        nowPlayingSource: "radio_browser_icy",
        active: true,
        updatedAt: new Date(),
      },
    })
    .returning();

  if (!stationRow) {
    return res.status(500).json({ error: "Failed to upsert station row" });
  }

  // Upsert the radio_browser_stations enrollment row.
  const [rbRow] = await db
    .insert(radioBrowserStationsTable)
    .values({
      radioBrowserUuid: trimmedUuid,
      streamUrl,
      name: stationName,
      faviconUrl: rbStation.favicon?.trim() || null,
      stationId: stationRow.id,
      icyStatus: "active",
      consecutiveErrors: 0,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: radioBrowserStationsTable.radioBrowserUuid,
      set: {
        streamUrl,
        name: stationName,
        faviconUrl: rbStation.favicon?.trim() || null,
        stationId: stationRow.id,
        icyStatus: "active",
        consecutiveErrors: 0,
        updatedAt: new Date(),
      },
    })
    .returning();

  if (!rbRow) {
    return res.status(500).json({ error: "Failed to upsert radio_browser_stations row" });
  }

  // Wire the station's nowPlayingConfig with the rbRow id so the adapter can
  // update ICY status on every tick.
  await db
    .update(stationsTable)
    .set({
      nowPlayingConfig: { streamUrl, radioBrowserId: rbRow.id },
    })
    .where(eq(stationsTable.id, stationRow.id));

  // Reload the fully-configured station row and kick off immediate polling.
  const [freshStation] = await db
    .select()
    .from(stationsTable)
    .where(eq(stationsTable.id, stationRow.id))
    .limit(1);

  if (freshStation) {
    enrollStationPoller(freshStation);
  }

  console.info(
    `[lore] radio-browser enrolled: uuid=${trimmedUuid} name="${stationName}" slug=${slug}`,
  );

  return res.status(201).json(
    EnrollRadioBrowserResponse.parse({
      id: rbRow.id,
      radioBrowserUuid: rbRow.radioBrowserUuid,
      name: rbRow.name,
      streamUrl: rbRow.streamUrl,
      faviconUrl: rbRow.faviconUrl ?? null,
      icyStatus: rbRow.icyStatus,
      enrolledAt: rbRow.enrolledAt.toISOString(),
    }),
  );
}));

// GET /api/admin/radio-browser/stations — list enrolled Radio Browser stations.
router.get("/admin/radio-browser/stations", h(async (_req, res) => {
  const rows = await db
    .select()
    .from(radioBrowserStationsTable)
    .orderBy(asc(radioBrowserStationsTable.enrolledAt));

  return res.json(
    ListRadioBrowserStationsResponse.parse({
      stations: rows.map((r) => ({
        id: r.id,
        radioBrowserUuid: r.radioBrowserUuid,
        name: r.name,
        streamUrl: r.streamUrl,
        faviconUrl: r.faviconUrl ?? null,
        icyStatus: r.icyStatus,
        lastStreamTitle: r.lastStreamTitle ?? null,
        lastSuccessAt: r.lastSuccessAt?.toISOString() ?? null,
        consecutiveErrors: r.consecutiveErrors,
        enrolledAt: r.enrolledAt.toISOString(),
      })),
    }),
  );
}));

// GET /api/admin/stations/coverage — coverage class per pollable station
// (plain JSON, admin-only). Blind spots = no history endpoint and no
// persistent/multiplexed connection; the admin UI surfaces them so they can
// be pinned as favorites or handled specially.
router.get("/admin/stations/coverage", h(async (_req, res) => {
  const rows = await db
    .select()
    .from(stationsTable)
    .orderBy(asc(stationsTable.name));
  const pollable = rows.filter(
    (s) => isPollable(s.nowPlayingSource) && !s.hidden,
  );
  const stations = pollable.map((s) => ({
    id: s.id,
    slug: s.slug,
    name: s.name,
    source: s.nowPlayingSource,
    favorite: s.favorite,
    coverage: coverageClassFor(s),
  }));
  const counts: Record<string, number> = {};
  for (const s of stations) counts[s.coverage] = (counts[s.coverage] ?? 0) + 1;
  return res.json({ stations, counts });
}));

// PATCH /api/admin/scraped-shows/:id/void — withdraw one schedule evidence row
// without deleting it. The receipt remains queryable for audit, while all
// schedule-derived attribution paths ignore it.
router.patch("/admin/scraped-shows/:id/void", h(async (req, res) => {
  const params = VoidScrapedShowParams.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: "Invalid schedule block id" });
  }
  const parsed = VoidScrapedShowBody.safeParse(
    typeof req.body?.reason === "string"
      ? { ...req.body, reason: req.body.reason.trim() }
      : req.body,
  );
  if (!parsed.success) {
    return res.status(400).json({
      error: "A non-empty void reason is required",
      details: parsed.error.flatten(),
    });
  }

  const now = new Date();
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(scrapedShowsTable)
      .set({ voidedAt: now, voidReason: parsed.data.reason })
      .where(eq(scrapedShowsTable.id, params.data.id))
      .returning();
    if (!row) return null;

    // Keep the station's denormalized schedule count honest after withdrawal.
    await tx.execute(sql`
      UPDATE stations
      SET upcoming_show_count = (
        SELECT count(*)::int
        FROM scraped_shows
        WHERE station_id = ${row.stationId}
          AND voided_at IS NULL
      )
      WHERE id = ${row.stationId}
    `);
    return row;
  });

  if (!updated) {
    return res.status(404).json({ error: "Schedule block not found" });
  }

  clearAutomationClassCache([updated.stationId]);
  clearPlayerScheduleCache();
  return res.json(
    VoidScrapedShowResponse.parse({
      id: updated.id,
      stationId: updated.stationId,
      showName: updated.showName,
      dayOfWeek: updated.dayOfWeek,
      startTime: updated.startTime,
      endTime: updated.endTime,
      djName: updated.djName,
      sourceUrl: updated.sourceUrl,
      scrapedAt: updated.scrapedAt,
      extraction: updated.extraction,
      voidedAt: updated.voidedAt,
      voidReason: updated.voidReason,
    }),
  );
}));

// POST /api/admin/radio-browser/stations/:id/reenroll — reset a suspended ICY
// station back to active without restarting the server.  Clears icyStatus →
// "active" and consecutiveErrors → 0 in the DB, and clears the in-memory
// 30-minute backoff so the very next poll tick makes a live probe attempt.
// Safe to call on a station that is already active (idempotent).
router.post("/admin/radio-browser/stations/:id/reenroll", h(async (req, res) => {
  const params = ReenrollRadioBrowserParams.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: "Invalid station id" });
  }

  const [rbRow] = await db
    .select()
    .from(radioBrowserStationsTable)
    .where(eq(radioBrowserStationsTable.id, params.data.id))
    .limit(1);

  if (!rbRow) {
    return res.status(404).json({ error: "Station not found" });
  }

  const now = new Date();
  await db
    .update(radioBrowserStationsTable)
    .set({ icyStatus: "active", consecutiveErrors: 0, updatedAt: now })
    .where(eq(radioBrowserStationsTable.id, rbRow.id));

  // Clear the in-memory backoff so the next poll tick probes immediately.
  clearIcyErrorBackoff(rbRow.id);

  console.info(
    `[lore] radio-browser reenrolled: id=${rbRow.id} uuid=${rbRow.radioBrowserUuid} name="${rbRow.name}"`,
  );

  return res.status(200).json(
    ReenrollRadioBrowserResponse.parse({
      id: rbRow.id,
      icyStatus: "active",
      consecutiveErrors: 0,
      updatedAt: now.toISOString(),
    }),
  );
}));

// DELETE /api/admin/radio-browser/stations/:id — remove an enrolled station.
// Marks the linked station inactive and removes the enrollment row.
router.delete("/admin/radio-browser/stations/:id", h(async (req, res) => {
  const params = DeleteRadioBrowserParams.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: "Invalid station id" });
  }

  const [rbRow] = await db
    .select()
    .from(radioBrowserStationsTable)
    .where(eq(radioBrowserStationsTable.id, params.data.id))
    .limit(1);

  if (!rbRow) {
    return res.status(404).json({ error: "Station not found" });
  }

  // Cancel the live poll interval immediately so the station stops being polled
  // without waiting for a process restart.
  if (rbRow.stationId !== null) {
    unenrollStationPoller(rbRow.stationId);
    await db
      .update(stationsTable)
      .set({ active: false, nowPlayingSource: null, nowPlayingConfig: null, updatedAt: new Date() })
      .where(eq(stationsTable.id, rbRow.stationId));
  }

  await db
    .delete(radioBrowserStationsTable)
    .where(eq(radioBrowserStationsTable.id, params.data.id));

  return res.status(204).send();
}));

// ---------------------------------------------------------------------------
// List provenance admin endpoints
// ---------------------------------------------------------------------------

// POST /api/admin/list-sources — create a list source (publication, selector, station).
router.post("/admin/list-sources", h(async (req, res) => {
  const parsed = CreateListSourceBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid list source", details: parsed.error.flatten() });
  }
  const b = parsed.data;
  const [row] = await db
    .insert(listSourcesTable)
    .values({
      kind: b.kind,
      name: b.name,
      homepageUrl: b.homepageUrl ?? null,
      pickerId: b.pickerId ?? null,
      stationId: b.stationId ?? null,
    })
    .returning();
  if (!row) return res.status(500).json({ error: "Insert failed" });
  return res.status(201).json({ id: row.id, kind: row.kind, name: row.name });
}));

// GET /api/admin/list-sources — list all sources.
router.get("/admin/list-sources", h(async (_req, res) => {
  const rows = await db
    .select()
    .from(listSourcesTable)
    .orderBy(asc(listSourcesTable.name));
  return res.json({ sources: rows });
}));

// POST /api/admin/lists/scrape — scrape a URL and create list + entries.
router.post("/admin/lists/scrape", h(async (req, res) => {
  const parsed = ScrapeListBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid list body", details: parsed.error.flatten() });
  }
  const b = parsed.data;

  const contact = process.env["MUSICBRAINZ_CONTACT"]?.trim();
  if (!contact) {
    return res.status(503).json({ error: "MUSICBRAINZ_CONTACT not configured" });
  }

  const ready = await wireListExtractor();
  if (!ready) {
    return res.status(503).json({ error: "Anthropic AI integration unavailable for list extraction" });
  }

  // Upsert list row (idempotent on re-scrape of same list).
  const [listRow] = await db
    .insert(listsTable)
    .values({
      sourceId: b.sourceId,
      title: b.title,
      year: b.year ?? null,
      kind: b.kind,
      isRanked: b.isRanked,
      listLength: b.listLength ?? null,
      url: b.url,
      retrievedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [listsTable.sourceId, listsTable.title, listsTable.year],
      set: { url: b.url, retrievedAt: new Date() },
    })
    .returning();
  if (!listRow) return res.status(500).json({ error: "Failed to upsert list" });

  // Run async scrape — returns result summary, entries already inserted.
  const result = await scrapeAndPopulateList(listRow.id, b.url, contact);

  return res.status(200).json({
    listId: listRow.id,
    ...result,
  });
}));

// GET /api/admin/lists/:listId/entries — list entries for a given list.
// Optional query: ?filter=pending (only fuzzy/unresolved + unconfirmed)
router.get("/admin/lists/:listId/entries", h(async (req, res) => {
  const listId = parseInt(String(req.params["listId"] ?? ""), 10);
  if (!listId) return res.status(400).json({ error: "Invalid listId" });
  const filter = String(req.query["filter"] ?? "");

  let query = db
    .select()
    .from(listEntriesTable)
    .where(eq(listEntriesTable.listId, listId));

  if (filter === "pending") {
    const rows = await db
      .select()
      .from(listEntriesTable)
      .where(
        and(
          eq(listEntriesTable.listId, listId),
          sql`(${listEntriesTable.confidence} != 'exact' OR ${listEntriesTable.confirmed} = false)`,
        ),
      )
      .orderBy(asc(listEntriesTable.rank));
    return res.json({ entries: rows });
  }

  const rows = await (query as typeof query).orderBy(asc(listEntriesTable.rank));
  return res.json({ entries: rows });
}));

// PATCH /api/admin/lists/:listId/entries/:entryId — confirm or correct an entry.
router.patch("/admin/lists/:listId/entries/:entryId", h(async (req, res) => {
  const listId = parseInt(String(req.params["listId"] ?? ""), 10);
  const entryId = parseInt(String(req.params["entryId"] ?? ""), 10);
  if (!listId || !entryId) return res.status(400).json({ error: "Invalid id" });

  const parsed = ConfirmListEntryBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body" });
  }

  const updates: Partial<typeof listEntriesTable.$inferInsert> = {
    confirmed: parsed.data.confirmed,
  };
  if (parsed.data.releaseGroupMbid) {
    updates.releaseGroupMbid = parsed.data.releaseGroupMbid;
    updates.confidence = "exact";
  }

  const [updated] = await db
    .update(listEntriesTable)
    .set(updates)
    .where(
      and(eq(listEntriesTable.id, entryId), eq(listEntriesTable.listId, listId)),
    )
    .returning();

  if (!updated) return res.status(404).json({ error: "Entry not found" });
  return res.json(updated);
}));

// POST /api/admin/recordings/enrich-release-groups — fetch and cache release
// groups for a batch of recording MBIDs. Populates the recording_release_groups
// bridge table so the provenance endpoint can join through it.
// Rate-limited: 1.1s MB sleep per recording. Not for large batches.
router.post("/admin/recordings/enrich-release-groups", h(async (req, res) => {
  const contact = process.env["MUSICBRAINZ_CONTACT"]?.trim();
  if (!contact) {
    return res.status(503).json({ error: "MUSICBRAINZ_CONTACT not configured" });
  }

  const body = req.body as { mbids?: unknown };
  if (!Array.isArray(body.mbids) || body.mbids.length === 0) {
    return res.status(400).json({ error: "mbids must be a non-empty array" });
  }
  const mbids: string[] = body.mbids
    .map((m: unknown) => (typeof m === "string" ? m.trim() : ""))
    .filter(Boolean)
    .slice(0, 50);

  const results: Array<{ mbid: string; inserted: number; primaryMbid: string | null }> = [];
  for (const mbid of mbids) {
    const r = await enrichRecordingReleaseGroups(mbid, contact);
    results.push({ mbid: r.recordingMbid, inserted: r.inserted, primaryMbid: r.primaryMbid });
  }

  return res.json({ enriched: results.length, results });
}));

// GET /api/admin/recordings/:mbid/release-groups — list cached release groups
// for a specific recording (diagnostic — not needed for UI).
router.get("/admin/recordings/:mbid/release-groups", h(async (req, res) => {
  const mbid = String(req.params["mbid"] ?? "");
  if (!mbid) return res.status(400).json({ error: "Invalid MBID" });

  const rows = await db
    .select()
    .from(recordingReleaseGroupsTable)
    .where(eq(recordingReleaseGroupsTable.recordingMbid, mbid));

  return res.json({ mbid, releaseGroups: rows });
}));

// GET /api/admin/spinitron-web-health — stations whose spinitron_web scraper
// has been returning null for longer than the configurable threshold (default
// 10 minutes). An empty array means all spinitron_web stations are healthy.
router.get("/admin/spinitron-web-health", h(async (_req, res) => {
  const stale = getSpinitronWebStaleStations();
  return res.json({
    staleCount: stale.length,
    stations: stale.map((s) => ({
      stationId: s.stationId,
      slug: s.slug,
      lastSuccessAt: s.lastSuccessAt?.toISOString() ?? null,
      lastNullAt: s.lastNullAt.toISOString(),
      consecutiveNulls: s.consecutiveNulls,
      staleSinceMs: s.staleSinceMs,
    })),
  });
}));

// GET /api/admin/feed-freshness-health — stations whose fixed-size feed
// (bbc_api, somafm) has been silent for longer than 2× its poll interval.
// An empty array means all tracked stations have ingested spins recently.
// `monitoringSince` reflects when this server process started tracking state;
// all counters were zero before that instant (state does not survive restarts).
router.get("/admin/feed-freshness-health", h(async (_req, res) => {
  const stale = getFeedFreshnessStaleStations();
  return res.json({
    monitoringSince: monitoringSince.toISOString(),
    staleCount: stale.length,
    stations: stale.map((s) => ({
      stationId: s.stationId,
      slug: s.slug,
      source: s.source,
      pollIntervalMs: s.pollIntervalMs,
      lastSpinAt: s.lastSpinAt?.toISOString() ?? null,
      lastEmptyAt: s.lastEmptyAt.toISOString(),
      consecutiveEmpties: s.consecutiveEmpties,
      staleSinceMs: s.staleSinceMs,
      thresholdMs: s.thresholdMs,
    })),
  });
}));

// GET /api/admin/lore/blog-health — per-picker feed health for all blog
// pickers (active AND inactive, so demotions are visible), plus pending
// list-candidate counts for stage-2 visibility.
router.get("/admin/lore/blog-health", h(async (_req, res) => {
  const rows = await db
    .select({
      id: pickersTable.id,
      handle: pickersTable.handle,
      name: pickersTable.name,
      active: pickersTable.active,
      sourceRef: pickersTable.sourceRef,
      health: pickersTable.health,
    })
    .from(pickersTable)
    .where(eq(pickersTable.pickerType, "blog"))
    .orderBy(asc(pickersTable.handle));

  const candidateCounts = await db.execute(sql`
    SELECT picker_id, status, COUNT(*)::int AS n
    FROM blog_list_candidates
    GROUP BY picker_id, status
  `);
  const countsByPicker = new Map<number, Record<string, number>>();
  for (const r of candidateCounts.rows as Array<{
    picker_id: number;
    status: string;
    n: number;
  }>) {
    const entry = countsByPicker.get(r.picker_id) ?? {};
    entry[r.status] = r.n;
    countsByPicker.set(r.picker_id, entry);
  }

  return res.json({
    pickers: rows.map((p) => {
      const ref = (p.sourceRef ?? {}) as Record<string, unknown>;
      const health = (p.health ?? {}) as Record<string, unknown>;
      return {
        id: p.id,
        handle: p.handle,
        name: p.name,
        active: p.active,
        feedUrl: typeof ref["feedUrl"] === "string" ? ref["feedUrl"] : null,
        tolerant: ref["tolerant"] === true,
        lastOkAt: health["last_ok_at"] ?? null,
        lastError: health["last_error"] ?? null,
        consecutiveFailures: health["consecutive_failures"] ?? 0,
        listCandidates: countsByPicker.get(p.id) ?? {},
      };
    }),
  });
}));

// GET /api/admin/lore/list-candidates — the stage-2 extraction queue.
// Optional ?status=pending|extracted|failed|skipped filter. Shows per-post
// outcome notes so extraction failures are loud and diagnosable.
// Includes listId (left-joined from lists on URL match) so the admin UI can
// link directly to the entry review flow for extracted candidates.
router.get("/admin/lore/list-candidates", h(async (req, res) => {
  const status = String(req.query["status"] ?? "").trim();
  const where = status
    ? and(
        eq(blogListCandidatesTable.status, status),
      )
    : undefined;
  const rows = await db
    .select({
      id: blogListCandidatesTable.id,
      pickerId: blogListCandidatesTable.pickerId,
      pickerHandle: pickersTable.handle,
      pickerName: pickersTable.name,
      title: blogListCandidatesTable.title,
      url: blogListCandidatesTable.url,
      publishedAt: blogListCandidatesTable.publishedAt,
      status: blogListCandidatesTable.status,
      processedAt: blogListCandidatesTable.processedAt,
      note: blogListCandidatesTable.note,
      createdAt: blogListCandidatesTable.createdAt,
      listId: listsTable.id,
    })
    .from(blogListCandidatesTable)
    .innerJoin(pickersTable, eq(pickersTable.id, blogListCandidatesTable.pickerId))
    .leftJoin(listsTable, eq(listsTable.url, blogListCandidatesTable.url))
    .where(where)
    .orderBy(desc(blogListCandidatesTable.id))
    .limit(200);
  return res.json({ candidates: rows });
}));

// POST /api/admin/lore/list-candidates/:id/retry — re-run extraction for one
// candidate immediately (any status). Returns the outcome so the admin gets
// direct feedback instead of waiting for the next worker cycle.
router.post("/admin/lore/list-candidates/:id/retry", h(async (req, res) => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (!id) return res.status(400).json({ error: "Invalid candidate id" });

  const [candidate] = await db
    .select()
    .from(blogListCandidatesTable)
    .where(eq(blogListCandidatesTable.id, id))
    .limit(1);
  if (!candidate) return res.status(404).json({ error: "Candidate not found" });

  const contact = process.env["MUSICBRAINZ_CONTACT"]?.trim();
  if (!contact) {
    return res.status(503).json({ error: "MUSICBRAINZ_CONTACT not configured" });
  }
  const ready = await wireListExtractor();
  if (!ready) {
    return res.status(503).json({ error: "Anthropic AI integration unavailable for list extraction" });
  }

  const outcome = await processListCandidate(candidate, contact);
  await writeCandidateOutcome(candidate.id, outcome);
  return res.json({ id: candidate.id, ...outcome });
}));

// ---------------------------------------------------------------------------
// Station quality scoring endpoints
// ---------------------------------------------------------------------------

// GET /api/admin/stations — list all stations with ingest-quality scores.
// Joins station_quality (LEFT JOIN) so stations with no computed scores still
// appear (qualityTier null). Includes inactive stations so the admin can see
// the full picture, including longtail candidates.
router.get("/admin/stations", h(async (_req, res) => {
  const rows = await db
    .select({
      id: stationsTable.id,
      slug: stationsTable.slug,
      name: stationsTable.name,
      org: stationsTable.org,
      country: stationsTable.country,
      active: stationsTable.active,
      nowPlayingSource: stationsTable.nowPlayingSource,
      tier: stationsTable.tier,
      source: stationsTable.source,
      qualityTier: stationQualityTable.qualityTier,
      metadataYield: stationQualityTable.metadataYield,
      trackShaped: stationQualityTable.trackShaped,
      mbidResolutionRate: stationQualityTable.mbidResolutionRate,
      musicShare: stationQualityTable.musicShare,
      sampleCount: stationQualityTable.sampleCount,
      qualityComputedAt: stationQualityTable.computedAt,
    })
    .from(stationsTable)
    .leftJoin(
      stationQualityTable,
      eq(stationQualityTable.stationId, stationsTable.id),
    )
    .orderBy(asc(stationsTable.sortOrder), asc(stationsTable.name));

  return res.json(
    ListAdminStationsResponse.parse({
      stations: rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        name: r.name,
        org: r.org ?? null,
        country: r.country ?? null,
        active: r.active,
        nowPlayingSource: r.nowPlayingSource ?? null,
        tier: r.tier ?? null,
        source: r.source ?? null,
        qualityTier: r.qualityTier ?? null,
        metadataYield: r.metadataYield ?? null,
        trackShaped: r.trackShaped ?? null,
        mbidResolutionRate: r.mbidResolutionRate ?? null,
        musicShare: r.musicShare ?? null,
        sampleCount: r.sampleCount ?? null,
        qualityComputedAt: r.qualityComputedAt?.toISOString() ?? null,
      })),
    }),
  );
}));

// GET /api/admin/stations/flags — every station (incl. inactive/hidden) with
// the curation flags. Plain JSON (deliberately outside the OpenAPI surface —
// consumed only by the admin UI via plain fetch).
router.get("/admin/stations/flags", h(async (_req, res) => {
  const rows = await db
    .select({
      id: stationsTable.id,
      slug: stationsTable.slug,
      name: stationsTable.name,
      org: stationsTable.org,
      country: stationsTable.country,
      active: stationsTable.active,
      source: stationsTable.source,
      nowPlayingSource: stationsTable.nowPlayingSource,
      logoUrl: stationsTable.logoUrl,
      favorite: stationsTable.favorite,
      hidden: stationsTable.hidden,
    })
    .from(stationsTable)
    .orderBy(asc(stationsTable.sortOrder), asc(stationsTable.name));
  return res.json({ stations: rows });
}));

// GET /api/admin/stations/allocation — current persistent-connection
// allocation: pinned favorites, active crossing-score leases (with scores and
// expiry) and the next lease re-evaluation time. Plain JSON (outside the
// OpenAPI surface — consumed only by the admin UI via plain fetch).
//
// Also includes `timezoneGaps`: stations that have scraped schedule data but
// no iana_timezone — these silently fall back to the station-wide crossing
// score in scoreCrossingCandidates() and never benefit from per-show affinity
// scoring.  Surfacing them here lets an admin spot and fix the gap (e.g. by
// adding city/country) without having to query the DB directly.
router.get("/admin/stations/allocation", h(async (_req, res) => {
  const { budget, leases, nextEvaluationAt } = getLeaseAllocation();
  const [pinned, timezoneGaps] = await Promise.all([
    db
      .select({
        id: stationsTable.id,
        slug: stationsTable.slug,
        name: stationsTable.name,
      })
      .from(stationsTable)
      .where(
        and(
          eq(stationsTable.favorite, true),
          eq(stationsTable.hidden, false),
          eq(stationsTable.nowPlayingSource, "radio_browser_icy"),
        ),
      )
      .orderBy(asc(stationsTable.name)),
    // Stations with at least one scraped show but no stored IANA timezone.
    // These are the "silent fallback" bucket: scoreCrossingCandidates() skips
    // the show-scoped path for them because the currently_airing CTE requires
    // iana_timezone IS NOT NULL to convert wall-clock time to local station time.
    db
      .select({
        id: stationsTable.id,
        slug: stationsTable.slug,
        name: stationsTable.name,
        city: stationsTable.city,
        country: stationsTable.country,
        upcomingShowCount: stationsTable.upcomingShowCount,
      })
      .from(stationsTable)
      .where(
        and(
          isNull(stationsTable.ianaTimezone),
          gt(stationsTable.upcomingShowCount, 0),
          eq(stationsTable.active, true),
          eq(stationsTable.hidden, false),
        ),
      )
      .orderBy(asc(stationsTable.name)),
  ]);
  return res.json({
    budget,
    pinnedCount: pinned.length,
    leasedCount: leases.length,
    freeSlots: Math.max(0, budget - pinned.length - leases.length),
    pinned,
    leases,
    nextEvaluationAt,
    /** Stations with scraped schedule data but no iana_timezone — they cannot
     *  enter the show-scoped scoring path and silently fall back to the
     *  station-wide crossing average. */
    timezoneGaps: timezoneGaps.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      city: r.city ?? null,
      country: r.country ?? null,
      upcomingShowCount: r.upcomingShowCount,
    })),
  });
}));

// PATCH /api/admin/stations/:id/timezone — manually assign an IANA timezone
// when city/country inference can't resolve one (e.g. US stations with no
// city). Validates against the runtime tz database via Intl. On success,
// kicks the spin show-stamper so historical spins gain show attribution
// immediately instead of waiting for the next boot.
router.patch("/admin/stations/:id/timezone", h(async (req, res) => {
  const id = Number(req.params["id"]);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: "Invalid station id" });
  }
  const tzRaw = (req.body ?? {})["ianaTimezone"];
  if (tzRaw !== null && typeof tzRaw !== "string") {
    return res
      .status(400)
      .json({ error: "Body must set ianaTimezone (IANA string, or null to clear)" });
  }
  const tz = typeof tzRaw === "string" ? tzRaw.trim() : null;
  if (tz !== null) {
    try {
      // Throws RangeError for unknown zone names.
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
    } catch {
      return res.status(400).json({ error: `Unknown IANA timezone: ${tz}` });
    }
  }

  const [updated] = await db
    .update(stationsTable)
    .set({ ianaTimezone: tz, updatedAt: new Date() })
    .where(eq(stationsTable.id, id))
    .returning({
      id: stationsTable.id,
      slug: stationsTable.slug,
      ianaTimezone: stationsTable.ianaTimezone,
    });
  if (!updated) {
    return res.status(404).json({ error: "Station not found" });
  }

  // Fire-and-forget: idempotent, scoped to show_id-null spins.
  if (tz) {
    void stampSpinShowIds().then((n) => {
      if (n > 0) console.info(`[admin] timezone set for ${updated.slug} — stamped ${n} spin(s)`);
    });
  }

  return res.json(updated);
}));

// PATCH /api/admin/stations/:id/flags — toggle favorite/hidden and apply the
// change to the live poller immediately (no restart):
//   hidden=true  → all polling/watching stops (soft-hide; row + history kept)
//   hidden=false → re-enrolled (watcher iff favorite ICY, else interval poll)
//   favorite toggles re-enroll so the watcher/interval choice is re-evaluated.
router.patch("/admin/stations/:id/flags", h(async (req, res) => {
  const id = Number(req.params["id"]);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: "Invalid station id" });
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const patch: Partial<{ favorite: boolean; hidden: boolean }> = {};
  if (typeof body["favorite"] === "boolean") patch.favorite = body["favorite"];
  if (typeof body["hidden"] === "boolean") patch.hidden = body["hidden"];
  if (Object.keys(patch).length === 0) {
    return res
      .status(400)
      .json({ error: "Body must set favorite and/or hidden (booleans)" });
  }

  const [updated] = await db
    .update(stationsTable)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(stationsTable.id, id))
    .returning();
  if (!updated) {
    return res.status(404).json({ error: "Station not found" });
  }

  // Live-apply: enrollStationPoller unenrolls first, then no-ops when hidden,
  // starts a watcher for favorite ICY stations, or falls back to interval.
  if (updated.hidden) {
    unenrollStationPoller(updated.id);
  } else {
    enrollStationPoller(updated);
  }

  return res.json({
    id: updated.id,
    slug: updated.slug,
    favorite: updated.favorite,
    hidden: updated.hidden,
  });
}));

// POST /api/admin/stations/recompute-quality — trigger an immediate full
// quality recompute across all active stations. Returns the tier count summary.
// Long-running but safe to call while the server is live — each station is
// processed atomically, so a failure on one station never aborts the batch.
router.post("/admin/stations/recompute-quality", h(async (_req, res) => {
  console.info("[lore:quality] admin triggered quality recompute");
  const summary = await recomputeAllQualityScores();
  console.info("[lore:quality] admin recompute complete", summary);
  return res.json(RecomputeStationQualityResponse.parse(summary));
}));

// ---------------------------------------------------------------------------
// CRI candidate promotion endpoints
// ---------------------------------------------------------------------------

/**
 * Normalise a country name as scraped from CRI to an ISO 3166-1 alpha-2 code.
 * Falls back to the original string when no mapping is found, so the UI can
 * still display something sensible.
 */
const COUNTRY_ISO2: Record<string, string> = {
  "uk": "GB",
  "united kingdom": "GB",
  "england": "GB",
  "scotland": "GB",
  "wales": "GB",
  "northern ireland": "GB",
  "germany": "DE",
  "deutschland": "DE",
  "france": "FR",
  "usa": "US",
  "united states": "US",
  "united states of america": "US",
  "australia": "AU",
  "canada": "CA",
  "netherlands": "NL",
  "the netherlands": "NL",
  "holland": "NL",
  "belgium": "BE",
  "japan": "JP",
  "ireland": "IE",
  "italy": "IT",
  "spain": "ES",
  "sweden": "SE",
  "denmark": "DK",
  "norway": "NO",
  "finland": "FI",
  "switzerland": "CH",
  "austria": "AT",
  "portugal": "PT",
  "poland": "PL",
  "czech republic": "CZ",
  "czechia": "CZ",
  "hungary": "HU",
  "romania": "RO",
  "greece": "GR",
  "turkey": "TR",
  "south korea": "KR",
  "korea": "KR",
  "china": "CN",
  "brazil": "BR",
  "argentina": "AR",
  "mexico": "MX",
  "colombia": "CO",
  "chile": "CL",
  "south africa": "ZA",
  "new zealand": "NZ",
  "israel": "IL",
  "lebanon": "LB",
  "india": "IN",
  "russia": "RU",
};

function normalizeCountryToIso2(name: string | null | undefined): string | null {
  if (!name) return null;
  const lower = name.toLowerCase().trim();
  return COUNTRY_ISO2[lower] ?? name;
}

// GET /api/admin/cri/candidates — list all CRI candidates, optionally filtered
// by icyStatus and/or alreadyInLore. Ordered newest-checked first.
// Query params:
//   icyStatus=yes|no|unknown   — filter by ICY status
//   alreadyInLore=true|false   — filter by whether already promoted
//   promotable=true            — shorthand for icyStatus=yes + alreadyInLore=false
router.get("/admin/cri/candidates", h(async (req, res) => {
  const icyFilter = typeof req.query["icyStatus"] === "string" ? req.query["icyStatus"] : null;
  const alreadyInLoreFilter = typeof req.query["alreadyInLore"] === "string"
    ? req.query["alreadyInLore"] === "true"
    : null;
  const onlyPromotable = req.query["promotable"] === "true";

  const rows = await db
    .select()
    .from(criCandidatesTable)
    .orderBy(desc(criCandidatesTable.checkedAt));

  const filtered = rows.filter((r) => {
    if (icyFilter && r.icyStatus !== icyFilter) return false;
    if (alreadyInLoreFilter !== null && r.alreadyInLore !== alreadyInLoreFilter) return false;
    if (onlyPromotable && (r.icyStatus !== "yes" || r.alreadyInLore)) return false;
    return true;
  });

  return res.json({
    candidates: filtered.map((r) => ({
      id: r.id,
      criSlug: r.criSlug,
      name: r.name,
      city: r.city ?? null,
      country: r.country ?? null,
      genres: r.genres ?? [],
      websiteUrl: r.websiteUrl ?? null,
      streamUrl: r.streamUrl ?? null,
      icyStatus: r.icyStatus,
      alreadyInLore: r.alreadyInLore,
      notes: r.notes ?? null,
      checkedAt: r.checkedAt.toISOString(),
    })),
  });
}));

// POST /api/admin/cri/candidates/:slug/promote — promote a CRI candidate into
// the stations table and start polling. Only allowed when icyStatus === "yes".
// Idempotent: re-promoting an already-promoted station re-enables it and
// re-enrolls it in the poller.
router.post("/admin/cri/candidates/:slug/promote", h(async (req, res) => {
  const criSlug = String(req.params["slug"] ?? "");
  if (!criSlug) return res.status(400).json({ error: "slug is required" });

  const [candidate] = await db
    .select()
    .from(criCandidatesTable)
    .where(eq(criCandidatesTable.criSlug, criSlug))
    .limit(1);

  if (!candidate) {
    return res.status(404).json({ error: `CRI candidate "${criSlug}" not found` });
  }
  if (candidate.icyStatus !== "yes") {
    return res.status(422).json({
      error: `Cannot promote: icyStatus is "${candidate.icyStatus}" (must be "yes")`,
    });
  }
  if (!candidate.streamUrl) {
    return res.status(422).json({ error: "Candidate has no stream URL — cannot promote" });
  }

  const stationSlug = `cri-${criSlug}`;
  const country = normalizeCountryToIso2(candidate.country);

  const [stationRow] = await db
    .insert(stationsTable)
    .values({
      slug: stationSlug,
      name: candidate.name,
      org: candidate.name,
      country: country ?? undefined,
      city: candidate.city ?? undefined,
      streamUrl: candidate.streamUrl,
      streamFormat: "mp3",
      source: "cri",
      tier: "longtail",
      active: true,
      nowPlayingSource: "radio_browser_icy",
      nowPlayingConfig: { streamUrl: candidate.streamUrl },
      tags: candidate.genres ?? undefined,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: stationsTable.slug,
      set: {
        active: true,
        nowPlayingSource: "radio_browser_icy",
        nowPlayingConfig: { streamUrl: candidate.streamUrl },
        updatedAt: new Date(),
      },
    })
    .returning();

  if (!stationRow) {
    return res.status(500).json({ error: "Failed to upsert station row" });
  }

  // Mark the candidate as already in Lore.
  await db
    .update(criCandidatesTable)
    .set({ alreadyInLore: true })
    .where(eq(criCandidatesTable.criSlug, criSlug));

  // Reload the fully-configured station row and start polling immediately.
  const [freshStation] = await db
    .select()
    .from(stationsTable)
    .where(eq(stationsTable.id, stationRow.id))
    .limit(1);

  if (freshStation) {
    enrollStationPoller(freshStation);
  }

  console.info(
    `[lore] cri promoted: slug=${stationSlug} name="${candidate.name}" country=${country ?? "unknown"}`,
  );

  return res.status(201).json({
    stationId: stationRow.id,
    stationSlug,
    name: stationRow.name,
    streamUrl: stationRow.streamUrl,
    country: stationRow.country ?? null,
    city: stationRow.city ?? null,
  });
}));

// ---------------------------------------------------------------------------
// AOTY publication import
// ---------------------------------------------------------------------------

// Already-enrolled publications (by home domain) — never re-enrolled.
const ALREADY_ENROLLED_DOMAINS = new Set([
  "pitchfork.com",
  "www.pitchfork.com",
  "stereogum.com",
  "www.stereogum.com",
  "theguardian.com",
  "www.theguardian.com",
  "npr.org",
  "www.npr.org",
  "thewire.co.uk",
  "www.thewire.co.uk",
  "thequietus.com",
  "www.thequietus.com",
  "brooklynvegan.com",
  "www.brooklynvegan.com",
  "gorillavsbear.net",
  "www.gorillavsbear.net",
  "aquariumdrunkard.com",
  "daily.bandcamp.com",
  "bandcamp.com",
  "soundonsound.com",
  "www.soundonsound.com",
]);

/**
 * Parse publication entries from the AOTY publications page HTML.
 * Returns an array of { name, homeUrl } extracted from the page.
 * Captures any external (non-albumoftheyear.org) link that is accompanied by
 * a text label in a nearby heading, td, or anchor.
 */
function parseAotyPublications(
  html: string,
): Array<{ name: string; homeUrl: string }> {
  const results: Array<{ name: string; homeUrl: string }> = [];
  const seen = new Set<string>();

  // Pattern: look for anchor tags with external href and meaningful text.
  // AOTY's publication list rows typically look like:
  //   <a href="https://EXTERNAL.com" ...>Publication Name</a>
  // or contain the external link near the publication name text.
  const linkRe = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;

  while ((m = linkRe.exec(html))) {
    const rawHref = m[1]!.trim();
    const rawText = m[2]!.replace(/<[^>]+>/g, "").trim();

    // Only external links (https, not albumoftheyear.org itself)
    if (!rawHref.startsWith("http")) continue;
    try {
      const u = new URL(rawHref);
      if (u.hostname.includes("albumoftheyear.org")) continue;
      if (u.hostname.includes("albumoftheyear.com")) continue;

      const homeUrl = `${u.protocol}//${u.hostname}`;
      if (seen.has(homeUrl)) continue;
      if (!rawText || rawText.length < 2 || rawText.length > 100) continue;
      // Skip pure icon links, social links, etc.
      if (/^(facebook|twitter|instagram|youtube|spotify|apple|google)/i.test(rawText)) continue;
      if (/^\s*[@#]/.test(rawText)) continue;

      seen.add(homeUrl);
      results.push({ name: rawText, homeUrl });
    } catch {
      /* skip malformed href */
    }
  }

  return results;
}

// POST /api/admin/aoty-publications/import — fetch AOTY's publication list,
// run RSS discovery on each home URL, and enroll as blog or link-out pickers.
router.post("/admin/aoty-publications/import", h(async (req, res) => {
  const AOTY_URL = "https://www.albumoftheyear.org/publication/list.php";

  let html: string;
  try {
    const r = await fetch(AOTY_URL, {
      signal: AbortSignal.timeout(15_000),
      headers: { Accept: "text/html", "User-Agent": "Lore-Admin-Bot/1.0" },
    });
    if (!r.ok) {
      return res.status(502).json({ error: `AOTY fetch failed: ${r.status}` });
    }
    html = await r.text();
  } catch (err) {
    return res
      .status(502)
      .json({ error: `AOTY fetch error: ${err instanceof Error ? err.message : String(err)}` });
  }

  const publications = parseAotyPublications(html);
  if (publications.length === 0) {
    return res.status(200).json({
      enrolled: 0,
      linkOutOnly: 0,
      skipped: 0,
      note: "No publications parsed from AOTY page — HTML structure may have changed",
    });
  }

  let enrolled = 0;
  let linkOutOnly = 0;
  let skipped = 0;

  for (const pub of publications) {
    let domain: string;
    try {
      domain = new URL(pub.homeUrl).hostname;
    } catch {
      skipped++;
      continue;
    }

    // Skip already-enrolled publications
    if (ALREADY_ENROLLED_DOMAINS.has(domain)) {
      skipped++;
      continue;
    }

    const handle = slugify(domain);
    if (!handle) {
      skipped++;
      continue;
    }

    // Skip if a picker for this handle already exists
    const existing = await db
      .select({ id: pickersTable.id })
      .from(pickersTable)
      .where(eq(pickersTable.handle, handle))
      .limit(1);
    if (existing.length > 0) {
      skipped++;
      continue;
    }

    // Try RSS autodiscovery
    const feedUrl = await discoverFeedUrl(pub.homeUrl, {
      timeoutMs: 10_000,
    }).catch(() => null);

    if (feedUrl) {
      // Enroll as an inactive blog picker (requires human review to activate)
      await db
        .insert(pickersTable)
        .values({
          pickerType: "blog",
          name: pub.name,
          handle,
          homeUrl: pub.homeUrl,
          sourceRef: { feedUrl, tolerant: true },
          trustTier: 2,
          active: false,
          description: `AOTY-sourced publication — feed discovered via auto-discovery. Activate after review.`,
        })
        .onConflictDoNothing({ target: pickersTable.handle });
      console.info(`[aoty-import] enrolled ${pub.name} (${feedUrl})`);
      enrolled++;
    } else {
      // Register as a link-out-only picker (no feed to poll)
      await db
        .insert(pickersTable)
        .values({
          pickerType: "collector",
          name: pub.name,
          handle,
          homeUrl: pub.homeUrl,
          sourceRef: { linkOnly: true, aotySourced: true },
          trustTier: 3,
          active: false,
          description: `AOTY-sourced publication — no RSS feed found. Link-out only.`,
        })
        .onConflictDoNothing({ target: pickersTable.handle });
      console.info(`[aoty-import] link-out only: ${pub.name}`);
      linkOutOnly++;
    }
  }

  console.info(
    `[aoty-import] done: ${enrolled} enrolled, ${linkOutOnly} link-out only, ${skipped} skipped`,
  );
  return res.status(200).json({ enrolled, linkOutOnly, skipped });
}));

// POST /api/admin/list-candidates/process-batch — admin-triggered backfill that
// bypasses the rolling DAILY_CAP. Accepts optional ?limit=N (default 20, max 50).
// Secured by the admin token gate above.
router.post("/admin/list-candidates/process-batch", h(async (req, res) => {
  const rawLimit = req.query["limit"] ?? req.body?.limit;
  const limit = Math.min(
    50,
    Math.max(1, parseInt(String(rawLimit ?? "20"), 10) || 20),
  );

  const contact = process.env["MUSICBRAINZ_CONTACT"]?.trim();
  if (!contact) {
    return res.status(503).json({ error: "MUSICBRAINZ_CONTACT not configured" });
  }

  const result = await runListCandidateBatch(limit);
  return res.status(200).json(result);
}));

// POST /api/admin/rym-lists — admin-only RateYourMusic link-out picker.
router.post("/admin/rym-lists", h(async (req, res) => {
  const parsed = AddRymListBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid RYM list" });
  }
  const b = parsed.data;

  const r = await addRymPicker({ name: b.name, url: b.url }).catch((err) => {
    throw new HttpError(400, err instanceof Error ? err.message : "Could not add RYM list");
  });

  const picker = await getPickerByHandle(r.handle);
  if (!picker) {
    return res.status(400).json({ error: "Could not create RYM picker" });
  }
  return res.status(201).json(toPicker(picker));
}));

// POST /api/admin/maintenance/anon-cleanup — on-demand trigger for the
// anonymous session expiry job. Runs the same deletion query that the
// background scheduler uses and returns the row count so the effect is
// immediately observable without waiting for the nightly run.
router.post("/admin/maintenance/anon-cleanup", h(async (_req, res) => {
  const deleted = await runAnonCleanup();
  console.info(`[anonCleanup] admin-triggered run deleted ${deleted} row(s)`);
  return res.json({ deleted });
}));

export default router;
