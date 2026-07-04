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
  IngestDiscogsListBody,
  AddSongExploderClaimParams,
  AddSongExploderClaimBody,
  AddRymListBody,
  EnrollNtsShowBody,
  EnrollNtsShowResponse,
  ListAllDraftClaimsResponse,
  GetWikipediaDraftsParams,
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
} from "@workspace/db";
import { eq, and, asc, desc, sql, count } from "drizzle-orm";
import { ingestManualSpin } from "../../lore/resolve.js";
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
import { ingestBlogFeed } from "../../lore/blog.js";
import { ingestDiscogsList, addRymPicker } from "../../lore/collector.js";
import { addSongExploderClaim } from "../../lore/song-exploder.js";
import { publishGeniusDraft, rejectGeniusDraft } from "../../lore/genius-annotations.js";
import { h, HttpError } from "../../middlewares/asyncHandler.js";
import { toPicker } from "./shared.js";

const router: IRouter = Router();

// Rate limit: 10 requests per 15 minutes per IP — brute-force protection.
// Applied before auth so lockout happens before any token comparison.
router.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }),
);

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
  const parsed = GetWikipediaDraftsParams.safeParse({ mbid: req.query["mbid"] });
  if (!parsed.success) {
    return res.status(400).json({ error: "mbid query parameter is required" });
  }

  const rows = await db
    .select()
    .from(trackClaimsTable)
    .where(
      and(
        eq(trackClaimsTable.mbid, parsed.data.mbid),
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
        fragment: r.fragment,
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

export default router;
