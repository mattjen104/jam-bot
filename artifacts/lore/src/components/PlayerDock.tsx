import { useGetStationNowPlaying, getGetStationNowPlayingQueryKey } from "@workspace/api-client-react";
import { usePlayer } from "../player/PlayerProvider";
import { PlayerBar } from "./PlayerBar";
import { RideBar } from "./RideBar";

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
        nowPlayingMbid={nowPlayingMbid}
        onToggle={radio.toggle}
        onStop={radio.stop}
        onVolume={radio.setVolume}
      />
    );
  }
  return null;
}
