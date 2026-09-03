import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetStationNowPlaying,
  getGetStationNowPlayingQueryKey,
  type Station,
} from "@workspace/api-client-react";
import { usePlayer } from "../player/PlayerProvider";
import { useWpOnAir } from "../webplayer/hooks";
import { subscribeSpinStream } from "../webplayer/nowPlayingStream";
import { PlayerBar } from "./PlayerBar";
import { PlayerSheet } from "./PlayerSheet";
import { RideBar } from "./RideBar";
import { useLiveHandoff } from "../player/useLiveHandoff";
import { commitLiveHandoff } from "../player/liveHandoff";
import { useStationFastLane } from "../hooks/useStationFastLane";

/** Matches the shell's phone-width CSS convention (one-line dock breakpoint). */
const MOBILE_SHELL_QUERY = "(orientation: portrait), (max-width: 720px)";

/**
 * Upper bound for how long a provisional now-playing track may stay on screen
 * without its terminal SSE frame (spin-changed or spin-raw-failed). Terminal
 * frames normally land within seconds; this only fires when the server died
 * mid-pipeline, in which case the dock falls back to the 30s REST poll.
 */
const PROVISIONAL_EXPIRY_MS = 120_000;

/**
 * The single bottom dock. A ride takes over audio while active (so it wins the
 * dock); otherwise the live-radio bar shows when a station is loaded.
 *
 * On phones the live-radio bar is a tappable mini player: tapping its surface
 * (not a control) expands the full now-playing sheet (PlayerSheet).
 */
export function PlayerDock() {
  const { radio, ride, spotify, scan } = usePlayer();
  const [expandedRaw, setExpanded] = useState(false);
  const [location] = useLocation();
  const queryClient = useQueryClient();

  const stationSlug = radio.station?.slug ?? "";
  const { data: onAirData } = useWpOnAir();
  // useLiveHandoff snapshots candidate order during render. Keep its empty
  // input referentially stable while the on-air query is loading so that
  // snapshot adjustment cannot trigger a render loop in the global dock.
  const onAirItems = useMemo(() => onAirData?.items ?? [], [onAirData?.items]);
  const radioStationSlug = radio.station?.slug;
  const toggleRadio = radio.toggle;
  const scanActive = scan.active;
  const toggleScan = scan.toggle;
  const switchHandoffStation = useCallback((target: Station) => {
    commitLiveHandoff(target, radioStationSlug, scanActive, toggleScan, toggleRadio);
  }, [radioStationSlug, scanActive, toggleRadio, toggleScan]);
  const handoffState = useLiveHandoff(
    ride.active ? null : radio.station,
    onAirItems,
    switchHandoffStation,
  );
  const stopScanBefore = (action: () => void) => {
    if (scan.active) scan.toggle();
    action();
  };
  const handoff = {
    ...handoffState,
    scanning: scan.active,
    onCatchCurrent: () => stopScanBefore(handoffState.catchCurrent),
    onCatchBest: () => stopScanBefore(handoffState.catchBest),
    onCatchCandidate: (candidate: Parameters<typeof handoffState.catchCandidate>[0]) =>
      stopScanBefore(() => handoffState.catchCandidate(candidate)),
    onCancel: handoffState.cancel,
    onSwitchNow: handoffState.switchNow,
    onKeepWatching: handoffState.keepWatching,
  };
  const { data: npData } = useGetStationNowPlaying(stationSlug, {
    query: {
      queryKey: getGetStationNowPlayingQueryKey(stationSlug),
      enabled: !!radio.station && !ride.active,
      refetchInterval: 30_000,
      staleTime: 15_000,
    },
  });
  const {
    landOnStation,
    confirmation: landingConfirmation,
  } = useStationFastLane((slug) => {
    void queryClient.invalidateQueries({
      queryKey: getGetStationNowPlayingQueryKey(slug),
    });
  });

  // Audio startup remains owned by the radio player. In parallel, every new
  // station selection gets its own targeted live check; the hook's generation
  // guard prevents a slow response from a superseded click updating the dock.
  useEffect(() => {
    if (!stationSlug || ride.active) return;
    landOnStation(stationSlug, null);
  }, [landOnStation, ride.active, stationSlug]);

  // Provisional fast path: the SSE stream's spin-raw frame carries the new
  // track's raw artist/title seconds before resolution + persistence complete
  // and the 30s REST poll catches up. Held locally (never written into the
  // shared query cache) and cleared once the polled data shows the track.
  const [provisional, setProvisional] = useState<{
    artist: string;
    title: string;
    resolving: boolean;
  } | null>(null);
  useEffect(() => {
    if (!stationSlug) return;
    // Bounded expiry: a terminal frame (spin-changed or spin-raw-failed)
    // normally lands within seconds, but if the server dies mid-pipeline no
    // terminal frame is ever emitted — the timer guarantees the dock falls
    // back to the 30s REST poll instead of showing an unpersisted track
    // forever.
    let expiry: ReturnType<typeof setTimeout> | null = null;
    const arm = () => {
      if (expiry) clearTimeout(expiry);
      expiry = setTimeout(() => setProvisional(null), PROVISIONAL_EXPIRY_MS);
    };
    const unsub = subscribeSpinStream((ev) => {
      if (ev.stationSlug !== stationSlug) return;
      if (ev.type === "spin-raw-failed") {
        // The provisional track never persisted — revert to polled data, but
        // only when the failure matches the track currently shown (a stale
        // failure for a superseded track must not clear a newer provisional).
        setProvisional((cur) =>
          cur && cur.artist === ev.rawArtist && cur.title === ev.rawTitle
            ? null
            : cur,
        );
        return;
      }
      if (ev.provisional) {
        setProvisional({ artist: ev.rawArtist, title: ev.rawTitle, resolving: true });
      } else {
        // Resolved frame: keep showing the track, just stop the resolving cue
        // until the REST poll reflects the persisted spin.
        setProvisional({ artist: ev.rawArtist, title: ev.rawTitle, resolving: false });
      }
      arm();
    });
    return () => {
      if (expiry) clearTimeout(expiry);
      unsub();
    };
  }, [stationSlug]);
  // Provisional lifecycle housekeeping is a pure derivation, applied during
  // render (the sanctioned "adjust state while rendering" pattern, same as
  // prevLocation below): reset on station change, and clear once the polled
  // REST data catches up to the provisional track.
  const np = npData?.nowPlaying;
  const [prevSlug, setPrevSlug] = useState(stationSlug);
  if (stationSlug !== prevSlug) {
    setPrevSlug(stationSlug);
    setProvisional(null);
  } else if (provisional && np) {
    const currentArtist = np.recording?.artist ?? np.rawArtist;
    const currentTitle = np.recording?.title ?? np.rawTitle;
    if (
      currentArtist === provisional.artist &&
      currentTitle === provisional.title
    ) {
      setProvisional(null);
    }
  }

  // Collapse when the station goes away, a ride takes over, or the listener
  // navigates (e.g. taps a song/artist link inside the sheet).
  const hasStation = !!radio.station;
  // Navigation resets the dock: track the previous location and drop the raw
  // expanded flag during render (React's "adjust state while rendering"
  // pattern) rather than syncing it from an effect.
  const [prevLocation, setPrevLocation] = useState(location);
  if (location !== prevLocation) {
    setPrevLocation(location);
    setExpanded(false);
  }
  // Station-gone / ride-active collapse is a pure derivation — no state sync
  // needed. The dock is only ever expanded when a station is present and no
  // ride is taking over the dock.
  const expanded = expandedRaw && hasStation && !ride.active;

  const notice = spotify.notice ? (
    <div
      className="fixed z-50 border border-border bg-secondary/95 backdrop-blur-md shadow-lg bottom-[200px] left-4 right-4 rounded-[18px]"
      data-testid="spotify-notice"
    >
      <div className="flex items-center justify-between gap-3 px-5 py-3">
        <p className="truncate font-mono text-[13px] text-muted-foreground">
          {spotify.notice}
        </p>
        <button
          type="button"
          onClick={spotify.clearNotice}
          aria-label="Dismiss"
          className="hover-elevate shrink-0 rounded-full border border-border px-2.5 py-0.5 font-mono text-[13px] text-muted-foreground"
        >
          OK
        </button>
      </div>
    </div>
  ) : null;

  if (ride.active) {
    return <RideBar ride={ride} spotify={spotify} />;
  }
  if (notice) {
    return notice;
  }
  if (radio.station) {
    return (
      <>
        <PlayerBar
          station={radio.station}
          status={radio.status}
          volume={radio.volume}
          error={radio.error}
          casting={radio.casting}
          castFallbackReason={radio.castFallbackReason}
          castPaused={radio.castPaused}
          onCastRetry={radio.castRetry}
          onRetry={radio.retry}
          onToggle={radio.toggle}
          onStop={radio.stop}
          onVolume={radio.setVolume}
          nowPlaying={npData?.nowPlaying}
          provisionalNowPlaying={provisional}
          spotify={spotify}
          scanActive={scan.active}
          scanCurrent={scan.current}
          onScanToggle={scan.toggle}
          scanDir={scan.dir}
          onScanDirToggle={scan.toggleDir}
          onExpand={() => {
            // Expand only at phone widths — desktop keeps the plain dock.
            if (window.matchMedia(MOBILE_SHELL_QUERY).matches) setExpanded(true);
          }}
          handoff={handoff}
          landingConfirmation={landingConfirmation}
        />
        {expanded && (
          <PlayerSheet
            station={radio.station}
            nowPlayingData={npData}
            status={radio.status}
            volume={radio.volume}
            onToggle={radio.toggle}
            onStop={radio.stop}
            onVolume={radio.setVolume}
            onRetry={radio.retry}
            scanActive={scan.active}
            onScanToggle={scan.toggle}
            onCollapse={() => setExpanded(false)}
            handoff={handoff}
            landingConfirmation={landingConfirmation}
          />
        )}
      </>
    );
  }
  return null;
}
