/**
 * StationScanPanel — fresh-set scan controls inside an expanded station view.
 *
 * Two scan modes, both track-by-track via iTunes previews with the live
 * stream ducked (never stopped) underneath:
 * - "Scan last set": the station's most recent logged spins.
 * - "Scan new music": the station's rolling 48-hour window, surfacing
 *   first-ever plays ("⬦ New") with the hour they aired so airtime patterns
 *   emerge (e.g. "WKCR plays new jazz 2–4 PM").
 *
 * The active track row shows a KeepButton wired to the spin's MBID with
 * provenance { surface: 'stationScan' } — keeps save track MBIDs to the
 * library, which groups them into albums client-side.
 */
import { Pause, Play, SkipBack, SkipForward, Square } from "lucide-react";
import { usePlayer } from "../player/PlayerProvider";
import {
  useStationScan,
  fmtHour,
  STATION_SCAN_DWELLS,
  type StationScanMode,
} from "../hooks/useStationScan";
import { KeepButton } from "./KeepButton";
import { useEffect, useState } from "react";

export function StationScanPanel({ slug }: { slug: string }) {
  const { radio } = usePlayer();
  const [mode, setMode] = useState<StationScanMode | null>(null);
  const scan = useStationScan(mode, slug, radio);

  const selectMode = (m: StationScanMode) => {
    if (mode === m && scan.active) {
      scan.stop();
      setMode(null);
      return;
    }
    scan.stop();
    setMode(m);
  };

  // Auto-start once tracks arrive for the selected mode.
  const canStart = mode != null && !scan.isLoading && scan.tracks.length > 0;
  const { active: scanIsActive, error: scanError, start: scanStart } = scan;
  useEffect(() => {
    if (canStart && !scanIsActive && !scanError) scanStart();
  }, [canStart, scanIsActive, scanError, scanStart]);

  const current = scan.current;

  return (
    <div className="dial-stnscan" data-testid="station-scan-panel">
      <div className="dial-stnscan__triggers">
        <button
          type="button"
          className={`dial-scanbtn${mode === "lastSet" && scan.active ? " dial-scanbtn--on" : ""}`}
          onClick={() => selectMode("lastSet")}
          data-testid="scan-last-set"
        >
          Scan last set
        </button>
        <button
          type="button"
          className={`dial-scanbtn${mode === "newMusic" && scan.active ? " dial-scanbtn--on" : ""}`}
          onClick={() => selectMode("newMusic")}
          data-testid="scan-new-music"
        >
          Scan new music
        </button>
      </div>

      {mode != null && scan.isLoading && (
        <div className="dial-stnscan__note">Loading tracks…</div>
      )}
      {mode != null && scan.error && (
        <div className="dial-stnscan__note">{scan.error}</div>
      )}
      {mode != null && !scan.isLoading && !scan.error && scan.tracks.length === 0 && (
        <div className="dial-stnscan__note">
          {mode === "newMusic"
            ? "Nothing logged in the last 48 hours"
            : "No recent spins logged"}
        </div>
      )}

      {scan.active && current && (
        <div className="dial-stnscan__strip" data-testid="station-scan-strip">
          <div className="dial-stnscan__track">
            <div className="dial-stnscan__title">
              {current.title} · {current.artist}
              {current.isFirstSpin && (
                <span className="dial-stnscan__newchip" data-testid="scan-new-chip">
                  ⬦ New
                </span>
              )}
            </div>
            <div className="dial-stnscan__meta">
              {current.album && <>{current.album} · </>}
              {mode === "newMusic" && current.playedAtHour != null && (
                <span data-testid="scan-hour">{fmtHour(current.playedAtHour)}</span>
              )}
              {mode === "newMusic" && current.playedAtHour != null &&
                (current.djName || current.showName) && " · "}
              {current.showName}
              {current.showName && current.djName && " · "}
              {current.djName && <>with {current.djName}</>}
            </div>
          </div>

          <div className="dial-stnscan__controls">
            <button type="button" onClick={scan.prev} aria-label="Previous track" data-testid="scan-prev">
              <SkipBack size={14} />
            </button>
            <button
              type="button"
              onClick={scan.togglePause}
              aria-label={scan.paused ? "Resume scan" : "Pause scan"}
              data-testid="scan-playpause"
            >
              {scan.paused ? <Play size={14} /> : <Pause size={14} />}
            </button>
            <button type="button" onClick={scan.next} aria-label="Next track" data-testid="scan-next">
              <SkipForward size={14} />
            </button>
            <button
              type="button"
              onClick={() => {
                scan.stop();
                setMode(null);
              }}
              aria-label="Stop scan"
              data-testid="scan-stop"
            >
              <Square size={14} />
            </button>
            <div className="dial-stnscan__dwell" role="group" aria-label="Dwell time">
              {STATION_SCAN_DWELLS.map((d) => (
                <button
                  key={d}
                  type="button"
                  className={scan.dwellMs === d ? "dial-stnscan__dwell--on" : ""}
                  onClick={() => scan.setDwellMs(d)}
                  data-testid={`scan-dwell-${d}`}
                >
                  {d / 1000}s
                </button>
              ))}
            </div>
            {current.mbid && (
              <KeepButton
                mbid={current.mbid}
                provenance={{ surface: "stationScan" }}
                compact
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
