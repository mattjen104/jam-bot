import { useEffect } from "react";
import {
  useGetStationNowPlaying,
  getGetStationNowPlayingQueryKey,
} from "@workspace/api-client-react";
import { usePlayer } from "../player/PlayerProvider";
import { appendJournal } from "../lib/local";

/**
 * Invisible global recorder: while the listener is actually hearing something
 * — live radio, a segue trail, or a replay — each track lands in the local
 * journal. Radio polling shares the Home page's query key, so mounting this
 * never doubles the traffic; it only keeps the poll alive off the dial page.
 */
export function ListeningLogger() {
  const { radio, ride } = usePlayer();

  // --- Live radio: log the station's now-playing while the stream sounds ---
  const station = radio.station;
  const listening = radio.status === "playing" && !!station;
  const slug = station?.slug ?? "";
  const { data } = useGetStationNowPlaying(slug, {
    query: {
      queryKey: getGetStationNowPlayingQueryKey(slug),
      enabled: listening,
      refetchInterval: 15000,
      refetchIntervalInBackground: false,
    },
  });

  const np = listening ? (data?.nowPlaying ?? null) : null;
  // Every field that distinguishes one play from the next goes into the key,
  // so a transition where only the artist (or just playedAt) changes still
  // fires. appendJournal's own 30-min identity dedup absorbs re-reports.
  const rec = np?.recording ?? null;
  const npTitle = rec?.title ?? np?.rawTitle ?? "";
  const npArtist = rec?.artist ?? np?.rawArtist ?? "";
  const npMbid = rec?.mbid ?? null;
  const npPlayedAt = np?.playedAt ?? null;
  const npArtwork = rec?.artworkUrl ?? np?.artworkUrl ?? null;
  const stationSlug = station?.slug;
  const stationName = station?.name;
  const npKey = np
    ? `${stationSlug}|${npPlayedAt ?? ""}|${npMbid ?? ""}|${npTitle}|${npArtist}`
    : "";

  useEffect(() => {
    if (!npKey || !stationSlug || !stationName) return;
    if (!npTitle && !npArtist) return;
    appendJournal({
      at: npPlayedAt ?? new Date().toISOString(),
      kind: "radio",
      mbid: npMbid,
      artistMbid: rec?.artistMbid ?? null,
      title: npTitle,
      artist: npArtist,
      artworkUrl: npArtwork,
      stationSlug,
      stationName,
    });
  }, [
    npKey,
    stationSlug,
    stationName,
    npTitle,
    npArtist,
    npMbid,
    npPlayedAt,
    npArtwork,
  ]);

  // --- Rides: log each track the moment it actually starts sounding --------
  const cur = ride.current;
  const rideMbid = ride.active && ride.status === "playing" ? cur?.mbid : null;
  const rideTitle = cur?.title ?? "";
  const rideArtist = cur?.artist ?? "";
  const rideArtwork = cur?.artworkUrl ?? null;
  const rideKind = ride.mode === "replay" ? ("replay" as const) : ("trail" as const);
  const rideContext = ride.replayLabel;

  useEffect(() => {
    if (!rideMbid) return;
    appendJournal({
      at: new Date().toISOString(),
      kind: rideKind,
      mbid: rideMbid,
      title: rideTitle,
      artist: rideArtist,
      artworkUrl: rideArtwork,
      ...(rideContext ? { context: rideContext } : {}),
    });
  }, [rideMbid, rideTitle, rideArtist, rideArtwork, rideKind, rideContext]);

  return null;
}
