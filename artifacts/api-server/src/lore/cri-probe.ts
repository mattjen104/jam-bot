import {
  classifyIcyStreamTitle,
  fetchIcyMetadata,
} from "./icy.js";

export type CriIcyStatus = "yes" | "no" | "unknown";

export interface CriStreamProbeResult {
  icyStatus: CriIcyStatus;
  currentArtist: string | null;
  currentTitle: string | null;
  stationLabel: string | null;
}

const EMPTY_PROBE_FIELDS = {
  currentArtist: null,
  currentTitle: null,
  stationLabel: null,
} as const;

/**
 * Read through the first ICY metadata block and decide whether the stream is
 * promotable. Headers alone are never enough.
 */
export async function probeCriStream(url: string): Promise<CriStreamProbeResult> {
  const result = await fetchIcyMetadata(url);
  if (!result.ok) {
    return {
      icyStatus: result.kind === "icy_unsupported" ? "no" : "unknown",
      ...EMPTY_PROBE_FIELDS,
    };
  }

  const metadata = classifyIcyStreamTitle(result.streamTitle);
  if (!metadata.usable) {
    return {
      icyStatus: "no",
      currentArtist: null,
      currentTitle: null,
      stationLabel: metadata.stationLabel,
    };
  }

  return {
    icyStatus: "yes",
    currentArtist: metadata.artist,
    currentTitle: metadata.title,
    stationLabel: null,
  };
}