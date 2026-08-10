import { useState } from "react";
import { useLocation } from "wouter";
import {
  useGetStationNowPlaying,
  getGetStationNowPlayingQueryKey,
} from "@workspace/api-client-react";
import { usePlayer } from "../player/PlayerProvider";
import { PlayerBar } from "./PlayerBar";
import { PlayerSheet } from "./PlayerSheet";
import { RideBar } from "./RideBar";

/** Matches the shell's phone-width CSS convention (one-line dock breakpoint). */
const MOBILE_SHELL_QUERY = "(orientation: portrait), (max-width: 720px)";

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

  const stationSlug = radio.station?.slug ?? "";
  const { data: npData } = useGetStationNowPlaying(stationSlug, {
    query: {
      queryKey: getGetStationNowPlayingQueryKey(stationSlug),
      enabled: !!radio.station && !ride.active,
      refetchInterval: 30_000,
      staleTime: 15_000,
    },
  });

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
          onToggle={radio.toggle}
          onStop={radio.stop}
          onVolume={radio.setVolume}
          nowPlaying={npData?.nowPlaying}
          spotify={spotify}
          scanActive={scan.active}
          onScanToggle={scan.toggle}
          scanDir={scan.dir}
          onScanDirToggle={scan.toggleDir}
          onExpand={() => {
            // Expand only at phone widths — desktop keeps the plain dock.
            if (window.matchMedia(MOBILE_SHELL_QUERY).matches) setExpanded(true);
          }}
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
            scanActive={scan.active}
            onScanToggle={scan.toggle}
            onCollapse={() => setExpanded(false)}
          />
        )}
      </>
    );
  }
  return null;
}
