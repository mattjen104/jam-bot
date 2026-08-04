import { useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useGetStationNowPlaying,
  getGetStationNowPlayingQueryKey,
} from "@workspace/api-client-react";
import { usePlayer } from "../player/PlayerProvider";
import { appendJournal } from "../lib/local";
import { useIcecastFallback } from "../hooks/useIcecastFallback";
import { useSpotifyHistorySync } from "../hooks/useSpotifyHistorySync";
import {
  useLatestImportJob,
  useMyPreferences,
  postListen,
  patchListen,
} from "../lib/meHooks";
import { writeRadioLastTrack } from "../player/sectionMemory";

/** How often to send progress patches to the ledger (ms). */
const LEDGER_PATCH_INTERVAL_MS = 10_000;

// How long to wait before attempting an ACR fingerprint when neither the
// server poller nor Icecast metadata have identified the playing track.
const ACR_INITIAL_DELAY_MS = 45_000;
// How often to re-fingerprint (tracks are typically 3-5 min; 2 min catches
// a new song without hammering ACRCloud or the rate limiter).
const ACR_POLL_INTERVAL_MS = 2 * 60_000;

/**
 * Invisible global recorder: while the listener is actually hearing something
 * — live radio, a segue trail, or a replay — each track lands in the local
 * journal. Radio polling shares the Home page's query key, so mounting this
 * never doubles the traffic; it only keeps the poll alive off the dial page.
 */
export function ListeningLogger() {
  const { radio, ride, spotify } = usePlayer();
  const queryClient = useQueryClient();

  // Pause Spotify history polling while a library import is in progress —
  // both use the same access token and competing requests trigger 429s.
  const { data: importJob } = useLatestImportJob();
  const importActive = importJob?.status === "pending" || importJob?.status === "running";
  useSpotifyHistorySync(spotify.connected, importActive);

  // Whether the listener opted into ledger recording.
  const { data: prefs } = useMyPreferences();
  const ledgerEnabled = prefs?.ledgerEnabled ?? false;

  // Latest ride.progressMs kept fresh in a ref so interval callbacks always
  // read the current position without being listed in their dependency arrays.
  const rideProgressMsRef = useRef(ride.progressMs);
  rideProgressMsRef.current = ride.progressMs;

  // --- Live radio: log the station's now-playing while the stream sounds ---
  const station = radio.station;
  // Suppress all ledger + journal writes during a scan preview — the listener
  // is browsing, not committing. `radio.scanning` is cleared by `radio.toggle`
  // when they actually land on a station.
  const listening = radio.status === "playing" && !!station && !radio.scanning;
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
    // Persist the last resolved track so the Radio nav tile can show its art.
    if (npTitle || npArtist) {
      writeRadioLastTrack({
        artworkUrl: npArtwork,
        title: npTitle,
        artist: npArtist,
        mbid: npMbid,
      });
    }
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

  // --- Broadcast ledger: record each spin in the server ledger ---------------
  // npKey is non-empty only while listening AND now-playing data is available.
  // Fires once per distinct track; a 10 s interval keeps msPlayed current.
  // stationId is not in the public Station schema, so the server derives it
  // from spinId when present.
  const npSpinId = np?.spinId ?? null;
  const broadcastOutputService = radio.casting === "casting" ? "spotify" : "broadcast";

  useEffect(() => {
    if (!ledgerEnabled) return;
    if (!npKey || !stationSlug) return;
    if (!npTitle && !npArtist) return;

    let listenId: number | null = null;
    const startMs = Date.now();

    void postListen({
      ...(npMbid ? { mbid: npMbid } : {}),
      ...(npSpinId != null ? { spinId: npSpinId } : {}),
      ...(station?.id != null ? { stationId: station.id } : {}),
      context: "broadcast",
      outputService: broadcastOutputService,
      startedAt: npPlayedAt ?? new Date().toISOString(),
    }).then((res) => {
      listenId = res.id;
    }).catch(() => {/* silent — ledger is best-effort */});

    const interval = setInterval(() => {
      if (listenId == null) return;
      const msPlayed = Date.now() - startMs;
      void patchListen(listenId, msPlayed).catch(() => {});
    }, LEDGER_PATCH_INTERVAL_MS);

    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [npKey, ledgerEnabled]);

  // --- Icecast fallback: client-side stream metadata for unpolled stations ---
  // When the server has no now-playing data (no poller configured), try the
  // Icecast status JSON endpoint on the stream domain as a zero-bandwidth
  // fallback. Polls every 30 s; fires immediately when a track is found.
  const icecastNp = useIcecastFallback(
    station?.streamUrl,
    listening && !np,
  );
  const icecastKey = icecastNp
    ? `icecast|${stationSlug}|${icecastNp.rawArtist}|${icecastNp.rawTitle}`
    : "";

  useEffect(() => {
    if (!icecastKey || !stationSlug || !stationName) return;
    if (!icecastNp) return;
    if (!icecastNp.rawTitle && !icecastNp.rawArtist) return;
    appendJournal({
      at: new Date().toISOString(),
      kind: "radio",
      mbid: null,
      artistMbid: null,
      title: icecastNp.rawTitle,
      artist: icecastNp.rawArtist,
      artworkUrl: null,
      stationSlug,
      stationName,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [icecastKey, stationSlug, stationName]);

  // Resolve the client-discovered raw track through the same
  // MusicBrainz/Spotify pipeline as a server-polled spin. Fires once per
  // distinct discovered track (icecastKey), then invalidates the
  // now-playing query so the resolved recording replaces the raw text.
  const reportIcecastNowPlaying = useMutation({
    mutationFn: async (vars: { slug: string; rawArtist: string; rawTitle: string }) => {
      const res = await fetch(`/api/stations/${vars.slug}/report-now-playing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawArtist: vars.rawArtist, rawTitle: vars.rawTitle }),
      });
      if (!res.ok) throw new Error(`report-now-playing failed: ${res.status}`);
      return res.json() as Promise<{ logged: boolean; mbid: string | null }>;
    },
    onSuccess: (result, vars) => {
      if (result.logged) {
        queryClient.invalidateQueries({
          queryKey: getGetStationNowPlayingQueryKey(vars.slug),
        });
      }
    },
  });
  const { mutate: reportIcecast } = reportIcecastNowPlaying;

  useEffect(() => {
    if (!icecastKey || !stationSlug) return;
    if (!icecastNp) return;
    if (!icecastNp.rawTitle) return;
    reportIcecast({
      slug: stationSlug,
      rawArtist: icecastNp.rawArtist,
      rawTitle: icecastNp.rawTitle,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [icecastKey, stationSlug]);

  // --- ACR absolute fallback: fingerprint via ACRCloud when Icecast silent ---
  // When neither the server poller nor Icecast metadata have found a track
  // after ACR_INITIAL_DELAY_MS, ask the server to grab a short audio clip
  // from the station's stream URL and fingerprint it via ACRCloud. The server
  // uses the DB stream URL (not client-supplied), so there's no SSRF risk.
  // Re-polls every ACR_POLL_INTERVAL_MS while the station remains unidentified.
  const needsAcr = listening && !np && !icecastNp;
  const acrSlugRef = useRef<string | null>(null);
  const acrTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const requestFingerprint = useMutation({
    mutationFn: async (vars: { slug: string }) => {
      const res = await fetch(`/api/stations/${vars.slug}/fingerprint`, {
        method: "POST",
      });
      // 503 = ACR not configured; 429 = rate limited — swallow silently.
      if (res.status === 503 || res.status === 429) return null;
      if (!res.ok) throw new Error(`fingerprint failed: ${res.status}`);
      return res.json() as Promise<{ logged: boolean; mbid: string | null }>;
    },
    onSuccess: (result, vars) => {
      if (result?.logged) {
        queryClient.invalidateQueries({
          queryKey: getGetStationNowPlayingQueryKey(vars.slug),
        });
      }
    },
  });
  const { mutate: fingerprint } = requestFingerprint;

  useEffect(() => {
    if (!needsAcr || !stationSlug) {
      // Station changed, resolved, or stopped — cancel any pending ACR timer.
      if (acrTimerRef.current) {
        clearTimeout(acrTimerRef.current);
        acrTimerRef.current = null;
      }
      acrSlugRef.current = null;
      return;
    }

    // Station slug changed while still needing ACR — reset the timer so we
    // don't fire the previous station's fingerprint for the new one.
    if (acrSlugRef.current !== stationSlug) {
      if (acrTimerRef.current) {
        clearTimeout(acrTimerRef.current);
        acrTimerRef.current = null;
      }
      acrSlugRef.current = stationSlug;
    }

    // Already have a timer running for this station — don't double-schedule.
    if (acrTimerRef.current) return;

    function scheduleNext(delayMs: number) {
      acrTimerRef.current = setTimeout(() => {
        acrTimerRef.current = null;
        if (acrSlugRef.current !== stationSlug) return;
        fingerprint({ slug: stationSlug! });
        // Re-arm for the poll interval; the effect cleans up when no longer needed.
        scheduleNext(ACR_POLL_INTERVAL_MS);
      }, delayMs);
    }

    scheduleNext(ACR_INITIAL_DELAY_MS);

    return () => {
      if (acrTimerRef.current) {
        clearTimeout(acrTimerRef.current);
        acrTimerRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsAcr, stationSlug]);

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

  // --- Ride / replay ledger: record each track when it starts playing -------
  // rideMbid is non-null only while the ride is active AND status='playing'.
  // Progress is read from the ref (kept sync'd above) so the interval never
  // needs to be re-armed when progressMs updates.
  const rideOutputService = ride.source === "spotify" ? "spotify" : "preview";
  // Use the context tag supplied to startReplay (e.g. 'library' for ghost-radio
  // plays launched from the library tab); fall back to the mode-derived default.
  const rideListenContext =
    ride.listenContext ?? (ride.mode === "replay" ? "replay" : "ride");

  useEffect(() => {
    if (!ledgerEnabled) return;
    if (!rideMbid) return;

    let listenId: number | null = null;

    void postListen({
      mbid: rideMbid,
      context: rideListenContext,
      outputService: rideOutputService,
      startedAt: new Date().toISOString(),
    }).then((res) => {
      listenId = res.id;
    }).catch(() => {/* silent — ledger is best-effort */});

    const interval = setInterval(() => {
      if (listenId == null) return;
      const msPlayed = rideProgressMsRef.current ?? 0;
      if (msPlayed <= 0) return;
      void patchListen(listenId, msPlayed).catch(() => {});
    }, LEDGER_PATCH_INTERVAL_MS);

    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rideMbid, ledgerEnabled]);

  return null;
}
