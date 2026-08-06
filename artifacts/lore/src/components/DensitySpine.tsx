/**
 * DensitySpine — time-axis density visualisation and coarse navigation surface.
 *
 * Renders a horizontal strip of hourly bins showing how much of each hour
 * crossed the listener's library (owned) and how much was new (discover) as
 * two opposed channels off a shared baseline.
 *
 * Coverage invariant (from prerequisites report):
 *   Per-station per-hour polling coverage is NOT derivable from existing data.
 *   Therefore every empty bin (owned=0, discover=0) renders as the "unknown"
 *   texture — never as "covered, nothing crossed".  Drawing absence-of-spins
 *   as silence would fabricate a fact about whether Lore was listening.
 *
 * Two channels, never one number:
 *   owned and discover are rendered as separate opposed bars.  They are never
 *   summed, averaged, or ratioed into a single displayed value.
 */

import { useRef, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DensityBin {
  /** UTC epoch ms for the start of this hour bucket. */
  hourStart: number;
  /** Count of spins whose MBID is in the listener's library. */
  owned: number;
  /** Count of spins whose MBID is NOT in the listener's library but is resolved. */
  discover: number;
}

export interface DensitySpineProps {
  bins: DensityBin[];
  /** UTC epoch ms for "now" — where the live edge is drawn. */
  nowMs: number;
  /** UTC epoch ms for the playhead position (optional). */
  playheadMs?: number;
  /** UTC epoch ms for the live→past pipeline boundary (optional). */
  pipelineBoundaryMs?: number;
  /** Whether more history exists before the earliest bin. */
  hasMoreHistory?: boolean;
  /** Called with the UTC epoch ms of the hour the user dragged/scrubbed to. */
  onScrub?: (hourMs: number) => void;
  /** Called with the UTC epoch ms when the user taps a bin. */
  onTap?: (hourMs: number) => void;
  className?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** px height allocated to each channel (owned up, discover down) */
const CHANNEL_HEIGHT_PX = 20;
/** px height of the shared baseline */
const BASELINE_HEIGHT_PX = 1;
/** Total component height */
const TOTAL_HEIGHT_PX = CHANNEL_HEIGHT_PX * 2 + BASELINE_HEIGHT_PX;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DensitySpine({
  bins,
  nowMs,
  playheadMs,
  pipelineBoundaryMs,
  hasMoreHistory = false,
  onScrub,
  onTap,
  className = "",
}: DensitySpineProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  // Compute max counts for scaling — both channels share the same scale so
  // a bar of equal height means the same count in both directions.
  const maxCount = Math.max(
    1,
    ...bins.map((b) => Math.max(b.owned, b.discover)),
  );

  // Convert a pointer X position to the nearest bin's hourStart ms
  const xToHourMs = useCallback(
    (clientX: number): number | null => {
      const el = containerRef.current;
      if (!el || bins.length === 0) return null;
      const { left, width } = el.getBoundingClientRect();
      const fraction = Math.max(0, Math.min(1, (clientX - left) / width));
      const idx = Math.min(bins.length - 1, Math.floor(fraction * bins.length));
      return bins[idx].hourStart;
    },
    [bins],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      isDragging.current = true;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      const ms = xToHourMs(e.clientX);
      if (ms !== null) onScrub?.(ms);
    },
    [xToHourMs, onScrub],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging.current) return;
      const ms = xToHourMs(e.clientX);
      if (ms !== null) onScrub?.(ms);
    },
    [xToHourMs, onScrub],
  );

  const handlePointerUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      const ms = xToHourMs(e.clientX);
      if (ms !== null) onTap?.(ms);
    },
    [xToHourMs, onTap],
  );

  // Position (0–1) of a given ms within the visible bin range
  const msToFraction = (ms: number): number => {
    if (bins.length === 0) return 0;
    const first = bins[0].hourStart;
    const last = bins[bins.length - 1].hourStart + 3_600_000;
    return Math.max(0, Math.min(1, (ms - first) / (last - first)));
  };

  const liveEdgeFraction = msToFraction(nowMs);
  const playheadFraction = playheadMs != null ? msToFraction(playheadMs) : null;
  const boundaryFraction =
    pipelineBoundaryMs != null ? msToFraction(pipelineBoundaryMs) : null;

  return (
    <div
      ref={containerRef}
      className={`density-spine${className ? ` ${className}` : ""}`}
      style={{ height: TOTAL_HEIGHT_PX, position: "relative", cursor: onScrub ? "grab" : undefined }}
      role="slider"
      aria-label="Timeline density — drag to navigate"
      aria-orientation="horizontal"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onClick={handleClick}
    >
      {/* Bin columns */}
      <div
        className="density-spine__bins"
        style={{
          display: "flex",
          height: "100%",
          alignItems: "center",
          gap: 1,
        }}
      >
        {bins.map((bin) => {
          const isEmpty = bin.owned === 0 && bin.discover === 0;
          const ownedH = isEmpty ? 0 : Math.max(2, Math.round((bin.owned / maxCount) * CHANNEL_HEIGHT_PX));
          const discoverH = isEmpty ? 0 : Math.max(2, Math.round((bin.discover / maxCount) * CHANNEL_HEIGHT_PX));

          return (
            <div
              key={bin.hourStart}
              className={`density-spine__bin${isEmpty ? " density-spine__bin--unknown" : ""}`}
              style={{
                flex: 1,
                height: "100%",
                display: "flex",
                flexDirection: "column",
                alignItems: "stretch",
                justifyContent: "center",
                position: "relative",
                // Unknown bins use a subtle hatch pattern via CSS class
              }}
            >
              {!isEmpty && (
                <>
                  {/* Owned channel — extends upward */}
                  <div
                    className="density-spine__owned"
                    style={{
                      position: "absolute",
                      bottom: "50%",
                      left: 0,
                      right: 0,
                      height: ownedH,
                    }}
                  />
                  {/* Baseline */}
                  <div
                    className="density-spine__baseline"
                    style={{
                      position: "absolute",
                      top: "50%",
                      left: 0,
                      right: 0,
                      height: BASELINE_HEIGHT_PX,
                      transform: "translateY(-50%)",
                    }}
                  />
                  {/* Discover channel — extends downward */}
                  <div
                    className="density-spine__discover"
                    style={{
                      position: "absolute",
                      top: "50%",
                      left: 0,
                      right: 0,
                      height: discoverH,
                    }}
                  />
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* Live edge — the boundary at "now"; listener cannot scrub past it */}
      {liveEdgeFraction < 1 && (
        <div
          className="density-spine__live-edge"
          aria-label="Live"
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: `${liveEdgeFraction * 100}%`,
            width: 2,
            pointerEvents: "none",
          }}
        />
      )}

      {/* Pipeline boundary — where live passthrough becomes service playback */}
      {boundaryFraction !== null && (
        <div
          className="density-spine__pipeline-boundary"
          aria-label="Switch to replay"
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: `${boundaryFraction * 100}%`,
            width: 1,
            pointerEvents: "none",
          }}
        />
      )}

      {/* Playhead — agrees with the byline's relative-time phrasing */}
      {playheadFraction !== null && (
        <div
          className="density-spine__playhead"
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: `${playheadFraction * 100}%`,
            width: 2,
            pointerEvents: "none",
          }}
        />
      )}

      {/* Edge affordance — more history available */}
      {hasMoreHistory && (
        <div
          className="density-spine__history-edge"
          aria-label="More history"
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: 0,
            width: 12,
            pointerEvents: "none",
          }}
        />
      )}
    </div>
  );
}
