import {
  enrichTrack,
  enrichContext,
  fetchArtistCatalogue,
  fetchTrackLinks,
  getInsightsFor,
  type AcrMatch,
  type SearchResultTrack,
  type TrackKnowledge,
  type TrackContext,
  type ArtistCatalogue,
  type TrackLinks,
  type TrackInsight,
} from "@workspace/song-enrichment";
import { wireSongEnrichment } from "./wire.js";
import { type SpotifyTrackRaw } from "../spotify/appClient.js";

wireSongEnrichment();

/** The consolidated dossier the graph + panel render, mirroring SongContext. */
export interface SongContextResult {
  knowledge: TrackKnowledge | null;
  context: TrackContext | null;
  catalogue: ArtistCatalogue | null;
  links: TrackLinks | null;
  insights: TrackInsight[];
}

/**
 * Run the SAME enrichment jam-bot's track card serves for a resolved Spotify
 * track. Each section degrades to null/empty when its source is unconfigured or
 * has no data — the lib never throws for a missing key.
 */
export async function buildSongContext(
  track: SpotifyTrackRaw,
): Promise<SongContextResult> {
  const primaryArtist = track.artists[0];
  const match: AcrMatch = {
    acrid: track.id,
    title: track.name,
    artist: primaryArtist?.name ?? "",
    album: track.album ?? "",
    isrc: track.isrc ?? undefined,
    playOffsetMs: 0,
  };
  const searchTrack: SearchResultTrack = {
    id: track.id,
    uri: track.uri,
    title: track.name,
    artist: primaryArtist?.name ?? "",
    album: track.album ?? "",
    durationMs: track.durationMs,
  };
  const viaIsrc = !!track.isrc;

  // Knowledge first: its resolved MusicBrainz recording/artist ids feed context
  // and the timed insights lookup.
  const knowledge = await enrichTrack({ match, track: searchTrack, viaIsrc });

  const [context, catalogue, links] = await Promise.all([
    enrichContext({ match, track: searchTrack, viaIsrc, knowledge }),
    fetchArtistCatalogue({
      artistName: match.artist,
      // The catalogue port needs a SPOTIFY artist id (knowledge.artistId is a
      // MusicBrainz id), so pass the track's own Spotify artist id.
      spotifyArtistId: primaryArtist?.id ?? null,
    }),
    fetchTrackLinks(track.id),
  ]);

  const insights = getInsightsFor({
    isrc: track.isrc,
    recordingId: knowledge?.recordingId,
  });

  return { knowledge, context, catalogue, links, insights };
}
