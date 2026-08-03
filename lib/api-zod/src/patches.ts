/**
 * Hand-maintained schemas for endpoints not yet codegen'd from openapi.yaml.
 *
 * These schemas survive a full clean `pnpm run codegen` run because this file
 * lives outside `src/generated/` (which orval wipes). Do NOT use `zod.date()`
 * here — keep all timestamps as `zod.string()` for JSON transport.
 *
 * When adding a new endpoint to openapi.yaml and regenerating, delete the
 * corresponding export from this file so we don't dual-maintain it.
 */
import zod from "zod";

export const ReplayResolutionJobResponse = zod.object({
  id: zod.number().int(),
  replayId: zod.number().int(),
  status: zod.enum(["pending", "running", "done", "done_with_errors", "error"]),
  total: zod.number().int().nonnegative(),
  processed: zod.number().int().nonnegative(),
  resolved: zod.number().int().nonnegative(),
  missing: zod.number().int().nonnegative(),
  networkErrors: zod.number().int().nonnegative(),
  failed: zod.number().int().nonnegative(),
  committedOffset: zod.number().int().nonnegative(),
  error: zod.string().nullable(),
  finishedAt: zod.string().nullable(),
  failures: zod.array(
    zod.object({
      position: zod.number().int().nonnegative(),
      spinId: zod.number().int().positive(),
      error: zod.string(),
    }),
  ),
  /**
   * Per-reason miss counts for the replay's unresolvable identified tracks.
   * noVector: MBID present but no ISRC or Spotify URL to query Odesli with.
   * noLinks: Odesli returned no service links for the track's vector.
   * noRecording: MBID present but not yet in the recordings table.
   */
  missBreakdown: zod.object({
    noVector: zod.number().int().nonnegative(),
    noLinks: zod.number().int().nonnegative(),
    noRecording: zod.number().int().nonnegative(),
  }),
});

export {
  ReportStationNowPlayingBody as IcecastReportBody,
  ReportStationNowPlayingResponse as IcecastReportResultBody,
} from "./generated/api";

export const CreateManualSpinResponse = zod.object({
  logged: zod.boolean(),
  mbid: zod.string().nullable(),
  confidence: zod.string(),
});

export const SeedBlogPickersBody = zod.object({
  urls: zod.array(zod.string()),
});

export const SeedBlogPickersResponse = zod.object({
  results: zod.array(
    zod.object({
      url: zod.string(),
      feedUrl: zod.string().nullable(),
      handle: zod.string().nullable(),
      status: zod.enum(["discovered", "already_exists", "no_feed", "error"]),
      error: zod.string().optional(),
    }),
  ),
});

export const EnrollNtsShowBody = zod.object({
  alias: zod.string().min(1),
  name: zod.string().optional(),
});

export const EnrollNtsShowResponse = zod.object({
  pickerId: zod.number().int(),
  handle: zod.string(),
  name: zod.string(),
  alias: zod.string(),
  homeUrl: zod.string(),
});


export const PatchSongExploderEpisodeParams = zod.object({
  episodeId: zod.coerce.number().int().positive(),
});

export const PatchSongExploderEpisodeBody = zod.object({
  youtubeUrl: zod.string().url().nullable(),
});

export const PatchSongExploderEpisodeResponse = zod.object({
  id: zod.number().int(),
  youtubeUrl: zod.string().nullable(),
});

export const GetSongExploderChaptersParams = zod.object({
  episodeId: zod.coerce.number().int().positive(),
});

export const GetSongExploderChaptersResponse = zod.object({
  chapters: zod.array(
    zod.object({
      positionMs: zod.number().int(),
      text: zod.string(),
    }),
  ),
});

export const EnrollRadioBrowserBody = zod.object({
  uuid: zod.string().min(1),
});

export const EnrollRadioBrowserResponse = zod.object({
  id: zod.number().int(),
  radioBrowserUuid: zod.string(),
  name: zod.string(),
  streamUrl: zod.string(),
  faviconUrl: zod.string().nullable(),
  icyStatus: zod.string(),
  enrolledAt: zod.string(),
});

export const ListRadioBrowserStationsResponse = zod.object({
  stations: zod.array(
    zod.object({
      id: zod.number().int(),
      radioBrowserUuid: zod.string(),
      name: zod.string(),
      streamUrl: zod.string(),
      faviconUrl: zod.string().nullable(),
      icyStatus: zod.string(),
      lastStreamTitle: zod.string().nullable(),
      lastSuccessAt: zod.string().nullable(),
      consecutiveErrors: zod.number().int(),
      enrolledAt: zod.string(),
    }),
  ),
});

export const ReenrollRadioBrowserParams = zod.object({
  id: zod.coerce.number().int().positive(),
});

export const ReenrollRadioBrowserResponse = zod.object({
  id: zod.number().int(),
  icyStatus: zod.string(),
  consecutiveErrors: zod.number().int(),
  updatedAt: zod.string(),
});

export const DeleteRadioBrowserParams = zod.object({
  id: zod.coerce.number().int().positive(),
});

export const CreateListSourceBody = zod.object({
  kind: zod.string().min(1),
  name: zod.string().min(1),
  homepageUrl: zod.string().url().optional(),
  pickerId: zod.number().int().optional(),
  stationId: zod.number().int().optional(),
});

export const ScrapeListBody = zod.object({
  sourceId: zod.number().int(),
  title: zod.string().min(1),
  year: zod.number().int().optional(),
  kind: zod.string().min(1),
  isRanked: zod.boolean(),
  listLength: zod.number().int().optional(),
  url: zod.string().url(),
});

export const ConfirmListEntryBody = zod.object({
  confirmed: zod.boolean(),
  releaseGroupMbid: zod.string().optional(),
});


// ---- Embed resolution admin schemas ------------------------------------

/**
 * Query params for the embed coverage aggregate endpoint.
 * All filters are optional — omitting them returns all stored metric rows.
 */
export const GetEmbedCoverageQueryParams = zod.object({
  stationId: zod.coerce.number().int().nonnegative().optional(),
  genreCluster: zod.string().min(1).optional(),
  /** ISO-8601 date string; filters rows where week_start >= this value. */
  weekStart: zod.string().optional(),
  /** Maximum rows to return. Defaults to 500; capped at 2000. */
  limit: zod.coerce.number().int().min(1).max(2000).optional(),
});

export const GetEmbedCoverageResponse = zod.object({
  rows: zod.array(
    zod.object({
      stationId: zod.number().int(),
      genreCluster: zod.string(),
      weekStart: zod.string(),
      provider: zod.string(),
      role: zod.string(),
      rung: zod.number().int(),
      outcome: zod.string(),
      count: zod.number().int(),
      updatedAt: zod.string(),
    }),
  ),
  total: zod.number().int(),
});

export const GetEmbedResolutionParams = zod.object({
  mbid: zod.string().min(1),
});

export const GetEmbedResolutionResponse = zod.object({
  mbid: zod.string(),
  links: zod.array(
    zod.object({
      id: zod.number().int(),
      provider: zod.string(),
      role: zod.string(),
      rung: zod.number().int(),
      outcome: zod.string(),
      /** TTL-applied outcome — may be "expired" even when outcome is "embedded". */
      effectiveOutcome: zod.string(),
      confidence: zod.string(),
      resolvedVia: zod.string(),
      reason: zod.string(),
      providerTrackId: zod.string().nullable(),
      providerReleaseId: zod.string().nullable(),
      releaseMbid: zod.string().nullable(),
      sourceUrl: zod.string().nullable(),
      fetchedAt: zod.string(),
      expiresAt: zod.string(),
      updatedAt: zod.string(),
    }),
  ),
  queue: zod.array(
    zod.object({
      provider: zod.string(),
      role: zod.string(),
      status: zod.string(),
      priority: zod.number().int(),
      attempts: zod.number().int(),
      nextAttemptAt: zod.string(),
      lastError: zod.string().nullable(),
      requestedAt: zod.string(),
      expiresAt: zod.string().nullable(),
    }),
  ),
});

export const PostEmbedResolutionRequeueParams = zod.object({
  mbid: zod.string().min(1),
});

export const PostEmbedResolutionRequeueResponse = zod.object({
  mbid: zod.string(),
  requeued: zod.array(
    zod.object({
      provider: zod.string(),
      role: zod.string(),
      status: zod.string(),
      attempts: zod.number().int(),
      nextAttemptAt: zod.string(),
      requestedAt: zod.string(),
    }),
  ),
});

export const GetRecordingSongExploderParams = zod.object({
  mbid: zod.string().min(1),
});

export const GetRecordingSongExploderResponse = zod.object({
  episode: zod
    .object({
      id: zod.number().int(),
      title: zod.string(),
      episodeUrl: zod.string(),
      youtubeUrl: zod.string().nullable(),
      publishedAt: zod.string().nullable(),
      resolvedAt: zod.string().nullable(),
    })
    .nullable(),
  anchors: zod.array(
    zod.object({
      id: zod.number().int(),
      positionMs: zod.number().int(),
      text: zod.string(),
      sourceUrl: zod.string().nullable(),
      sourceLabel: zod.string().nullable(),
    }),
  ),
});

