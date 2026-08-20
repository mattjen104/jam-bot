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

