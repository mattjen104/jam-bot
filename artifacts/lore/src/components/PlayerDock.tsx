import { useCallback, useEffect, useRef, useState } from "react";
import {
  useGetStationNowPlaying,
  getGetStationNowPlayingQueryKey,
  useListStations,
  type Station,
} from "@workspace/api-client-react";
import { usePlayer } from "../player/PlayerProvider";
import { PlayerBar } from "./PlayerBar";
import { RideBar } from "./RideBar";

const SCAN_INTERVAL_MS = 8_000;

/**
 * The single bottom dock. A ride takes over audio while active (so it wins the
 * dock); otherwise the live-radio bar shows when a station is loaded.
 */
export function PlayerDock() {
  const { radio, ride, spotify } = usePlayer();

  const stationSlug = radio.station?.slug ?? "";
  const { data: npData } = useGetStationNowPlaying(stationSlug, {
    query: {
      queryKey: getGetStationNowPlayingQueryKey(stationSlug),
      enabled: !!radio.station && !ride.active,
      refetchInterval: 30_000,
      staleTime: 15_000,
    },
  });
  const nowPlayingMbid = npData?.nowPlaying?.recording?.mbid ?? null;

  // Station list for scan
  const { data: stationsData } = useListStations();
  const stations: Station[] = stationsData?.stations ?? [];

  // --- Scan state ---
  const [scanActive, setScanActive] = useState(false);
  const [scanIdx, setScanIdx] = useState(0);
  const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stable ref so the scan effect doesn't need radio as a dep (avoids timer restarts on status change)
  const radioRef = useRef(radio);
  radioRef.current = radio;

  // Stop scan if a ride takes over audio
  useEffect(() => {
    if (ride.active) setScanActive(false);
  }, [ride.active]);

  const clearScanTimer = useCallback(() => {
    if (scanTimerRef.current != null) {
      clearTimeout(scanTimerRef.current);
      scanTimerRef.current = null;
    }
  }, []);

  const handleScanToggle = useCallback(() => {
    setScanActive((prev) => {
      if (prev) {
        clearScanTimer();
        return false;
      }
      // Start from the station after the currently playing one
      const currentSlug = radioRef.current.station?.slug;
      const currentPos = currentSlug
        ? stations.findIndex((s) => s.slug === currentSlug)
        : -1;
      const startIdx = stations.length > 0
        ? (currentPos + 1) % stations.length
        : 0;
      setScanIdx(startIdx);
      return true;
    });
  }, [clearScanTimer, stations]);

  const handleScanNext = useCallback(() => {
    if (!scanActive || stations.length === 0) return;
    clearScanTimer();
    setScanIdx((i) => (i + 1) % stations.length);
  }, [scanActive, stations.length, clearScanTimer]);

  // Main scan effect: play current scan station and schedule the next advance
  useEffect(() => {
    if (!scanActive || stations.length === 0) {
      clearScanTimer();
      return;
    }

    const station = stations[scanIdx];
    if (!station) return;

    // Only toggle if it's a different station — avoid toggle-pausing the one already playing
    const { station: current, toggle } = radioRef.current;
    if (station.slug !== current?.slug) {
      void toggle(station);
    }

    scanTimerRef.current = setTimeout(() => {
      setScanIdx((i) => (i + 1) % stations.length);
    }, SCAN_INTERVAL_MS);

    return clearScanTimer;
  }, [scanActive, scanIdx, stations, clearScanTimer]);

  const notice = spotify.notice ? (
    <div
      className="fixed z-50 border border-border bg-secondary/95 backdrop-blur-md shadow-lg bottom-4 left-4 right-4 rounded-[18px] lg:bottom-0 lg:left-[220px] lg:right-0 lg:rounded-none lg:shadow-none lg:border-x-0 lg:border-b-0"
      data-testid="spotify-notice"
    >
      <div className="flex items-center justify-between gap-3 px-5 py-3">
        <p className="truncate font-mono text-[11px] text-muted-foreground">
          {spotify.notice}
        </p>
        <button
          type="button"
          onClick={spotify.clearNotice}
          aria-label="Dismiss"
          className="hover-elevate shrink-0 rounded-full border border-border px-2.5 py-0.5 font-mono text-[11px] text-muted-foreground"
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
        spotify={spotify}
        scanActive={scanActive}
        scanCurrent={scanIdx + 1}
        scanTotal={stations.length}
        onScanToggle={handleScanToggle}
      />
    );
  }
  return null;
}
