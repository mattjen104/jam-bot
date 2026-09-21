import { resolveToMbid, upsertRecording, type MbidResolution } from "./resolve.js";

export interface JamBotEvidenceInput {
  isrc: string;
  title: string;
  artist: string;
  durationMs?: number;
}

interface JamBotEvidenceDependencies {
  resolve: typeof resolveToMbid;
  upsert: typeof upsertRecording;
}

const defaultDependencies: JamBotEvidenceDependencies = {
  resolve: resolveToMbid,
  upsert: upsertRecording,
};

/**
 * Converge a strongly identified JamBot track into Lore. The ISRC resolver may
 * fall through to text/Spotify internally, but this boundary accepts only an
 * ISRC-confidence result, so provider failures and weak matches never write.
 */
export async function resolveJamBotEvidence(
  input: JamBotEvidenceInput,
  deps: JamBotEvidenceDependencies = defaultDependencies,
): Promise<MbidResolution | null> {
  const resolution = await deps.resolve(
    input.artist,
    input.title,
    input.durationMs,
    { isrc: input.isrc },
  );
  if (!resolution.mbid || resolution.confidence !== "isrc") return null;
  await deps.upsert(resolution);
  return resolution;
}