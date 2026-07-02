import { usePlayer } from "../player/PlayerProvider";
import { PlayerBar } from "./PlayerBar";
import { RideBar } from "./RideBar";

/**
 * The single bottom dock. A ride takes over audio while active (so it wins the
 * dock); otherwise the live-radio bar shows when a station is loaded.
 */
export function PlayerDock() {
  const { radio, ride } = usePlayer();

  if (ride.active) {
    return <RideBar ride={ride} />;
  }
  if (radio.station) {
    return (
      <PlayerBar
        station={radio.station}
        status={radio.status}
        volume={radio.volume}
        error={radio.error}
        onToggle={radio.toggle}
        onStop={radio.stop}
        onVolume={radio.setVolume}
      />
    );
  }
  return null;
}
