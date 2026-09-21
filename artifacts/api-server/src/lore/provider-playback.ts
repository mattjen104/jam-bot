export type ProviderName = "spotify" | "appleMusic" | "bandcamp" | "qobuz";
export type PlaybackCapability =
  | "embed"
  | "full_authenticated_playback"
  | "external_only"
  | "unavailable";

export interface ProviderMappingFact {
  id: number;
  provider: string;
  providerAlbumId: string;
  externalUrl: string;
  officialEmbedUrl: string | null;
  confidence: string;
  verification: string;
  deadLink: boolean;
}

export interface ProviderTrackFact {
  mappingId: number;
  recordingMbid: string;
  providerTrackId: string;
  providerTrackUrl: string;
  position: number;
  confidence: string;
  verification: string;
  deadLink: boolean;
}

export interface ProviderPlaybackValue {
  capability: PlaybackCapability;
  reason: string;
  albumId?: string;
  externalUrl?: string;
  embedUrl?: string;
  tracks?: ProviderTrackFact[];
}

const providers: ProviderName[] = ["spotify", "appleMusic", "bandcamp", "qobuz"];

function httpsUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port
      ? url
      : null;
  } catch {
    return null;
  }
}

export function validProviderExternalUrl(fact: ProviderMappingFact): boolean {
  const external = httpsUrl(fact.externalUrl);
  if (!external) return false;
  if (fact.provider === "spotify") {
    if (!/^[A-Za-z0-9]{22}$/.test(fact.providerAlbumId)) return false;
    return external.hostname === "open.spotify.com" &&
      external.pathname === `/album/${fact.providerAlbumId}`;
  }
  if (fact.provider === "appleMusic") {
    return /^\d+$/.test(fact.providerAlbumId) &&
      external.hostname === "music.apple.com" &&
      external.pathname.endsWith(`/${fact.providerAlbumId}`);
  }
  if (fact.provider === "bandcamp") {
    if (!/^\d+$/.test(fact.providerAlbumId)) return false;
    const host = external.hostname;
    const validHost = host === "bandcamp.com" || host.endsWith(".bandcamp.com");
    return validHost && /\/album\/[^/]+/.test(external.pathname);
  }
  return /^[A-Za-z0-9_-]{1,80}$/.test(fact.providerAlbumId) &&
    external.hostname === "www.qobuz.com" &&
    external.pathname.endsWith(`/${fact.providerAlbumId}`);
}

export function validAppleTrack(fact: ProviderMappingFact, track: ProviderTrackFact): boolean {
  if (fact.provider !== "appleMusic" || !/^\d+$/.test(track.providerTrackId)) return false;
  const url = httpsUrl(track.providerTrackUrl);
  if (!url || url.hostname !== "music.apple.com") return false;
  return url.pathname.endsWith(`/${fact.providerAlbumId}`) &&
    url.searchParams.get("i") === track.providerTrackId;
}

function validBandcampEmbed(fact: ProviderMappingFact): string | undefined {
  if (!fact.officialEmbedUrl) return undefined;
  const embed = httpsUrl(fact.officialEmbedUrl);
  if (
    embed?.hostname === "bandcamp.com" &&
    new RegExp(`^/EmbeddedPlayer/album=${fact.providerAlbumId}(?:/|$)`).test(embed.pathname)
  ) {
    return fact.officialEmbedUrl;
  }
  return undefined;
}

export function projectProviderPlayback(
  facts: ProviderMappingFact[],
  tracks: ProviderTrackFact[],
  spotifyPremiumAuthorized: boolean,
  expectedRecordingMbids?: string[],
): Record<ProviderName, ProviderPlaybackValue> {
  const result = {} as Record<ProviderName, ProviderPlaybackValue>;
  for (const provider of providers) {
    const fact = facts.find((row) => row.provider === provider);
    if (!fact || fact.confidence !== "exact" || fact.verification !== "verified" || fact.deadLink || !validProviderExternalUrl(fact)) {
      result[provider] = {
        capability: "unavailable",
        reason: "No exact, verified, live provider mapping is available.",
      };
      continue;
    }
    const verifiedTracks = tracks
      .filter((track) => track.mappingId === fact.id)
      .filter((track) =>
        track.confidence === "exact" &&
        track.verification === "verified" &&
        !track.deadLink,
      )
      .filter((track) => provider !== "appleMusic" || validAppleTrack(fact, track))
      .sort((a, b) => a.position - b.position);
    const base = { albumId: fact.providerAlbumId, externalUrl: fact.externalUrl };
    if (provider === "spotify") {
      const embedUrl = `https://open.spotify.com/embed/album/${fact.providerAlbumId}`;
      result[provider] = spotifyPremiumAuthorized
        ? { ...base, capability: "full_authenticated_playback", reason: "Spotify Premium is connected and authorized in Lore.", embedUrl }
        : { ...base, capability: "embed", reason: "Play in the official Spotify embed, or connect Spotify Premium for full playback.", embedUrl };
    } else if (provider === "appleMusic") {
      const expected = new Set(expectedRecordingMbids ?? []);
      const mapped = new Set(verifiedTracks.map((track) => track.recordingMbid));
      const firstPosition = verifiedTracks[0]?.position;
      const positionsAreContiguous = verifiedTracks.every(
        (track, index) => track.position === (firstPosition ?? 0) + index,
      );
      const isCompleteAlbumMapping = expectedRecordingMbids === undefined
        ? verifiedTracks.length > 0
        : expected.size > 0 &&
          verifiedTracks.length === expected.size &&
          mapped.size === expected.size &&
          [...expected].every((mbid) => mapped.has(mbid)) &&
          positionsAreContiguous;
      result[provider] = isCompleteAlbumMapping
        ? { ...base, capability: "full_authenticated_playback", reason: "Apple Music subscription required for full playback.", tracks: verifiedTracks }
        : { ...base, capability: "external_only", reason: "Open this album on Apple Music; a subscription is required for playback." };
    } else if (provider === "bandcamp") {
      const embedUrl = validBandcampEmbed(fact);
      result[provider] = embedUrl
        ? { ...base, capability: "embed", reason: "Official Bandcamp album embed.", embedUrl }
        : { ...base, capability: "external_only", reason: "Open this album on Bandcamp." };
    } else {
      result[provider] = { ...base, capability: "external_only", reason: "Qobuz playback requires partner access; open the album on Qobuz." };
    }
  }
  return result;
}