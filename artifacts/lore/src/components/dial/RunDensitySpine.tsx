/**
 * RunDensitySpine — timeline-scan UI components extracted from DialView.tsx.
 *
 * Exports:
 *   ScrubItem         — shape for PopScrubber items (needed by DialView useMemo)
 *   PopScrubber       — right-edge station scrubber
 *   RunDensitySpine   — horizontal run-bin navigator
 *   TtMode            — time-travel mode ("live" | "past" | "top")
 *   PAST_SCAN_BIN_*   — spine coordinate constants
 *   RunRow            — single crossing-run row (navigates to archive page)
 */
import { useState, useRef, useEffect, useCallback } from "react";
import type React from "react";
import { useLocation } from "wouter";
import type { OverlapRun } from "../../lib/meHooks";
import { classifySetTimeContext } from "../dialViewHelpers";

// ---------------------------------------------------------------------------
// PopScrubber
// ---------------------------------------------------------------------------

export interface ScrubItem {
  slug: string;
  name: string;
  /** Popular-crossing weight (same stat as the triangle sort). */
  score: number;
  /** Set carries at least one new-to-Lore / new-to-you artist. */
  hasNew: boolean;
}

/**
 * Right-edge scrubber for the Also-On-Air list. One tick per station in the
 * current sort order — tick length tracks the station's popular-crossing
 * weight (so the lime gradient IS the sort, in either triangle direction),
 * canary ticks mark sets carrying new artists. Dragging scrubs the full
 * list; a bubble names the station under the finger.
 */
export function PopScrubber({ items, onScrub }: {
  items: ScrubItem[];
  onScrub: (item: ScrubItem, index: number) => void;
}) {
  const railRef = useRef<HTMLDivElement | null>(null);
  // Active selection is tracked by slug so a live-data reorder mid-drag can't
  // silently retarget the bubble/ARIA state at a different station.
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const pointerId = useRef<number | null>(null);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (clearTimer.current) clearTimeout(clearTimer.current); }, []);
  const maxScore = Math.max(1, ...items.map((i) => i.score));
  const active = activeSlug != null ? items.findIndex((i) => i.slug === activeSlug) : -1;

  const select = (idx: number) => {
    const it = items[idx];
    if (!it) return;
    if (clearTimer.current) { clearTimeout(clearTimer.current); clearTimer.current = null; }
    setActiveSlug(it.slug);
    onScrub(it, idx);
  };
  const pick = (clientY: number) => {
    const el = railRef.current;
    if (!el || items.length === 0) return;
    const r = el.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientY - r.top) / r.height));
    select(Math.min(items.length - 1, Math.floor(f * items.length)));
  };
  const release = () => {
    pointerId.current = null;
    if (clearTimer.current) clearTimeout(clearTimer.current);
    clearTimer.current = setTimeout(() => { setActiveSlug(null); clearTimer.current = null; }, 700);
  };

  return (
    <div
      ref={railRef}
      className="popscrub"
      role="slider"
      tabIndex={0}
      aria-label="Scrub the station list"
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={items.length - 1}
      aria-valuenow={active >= 0 ? active : 0}
      aria-valuetext={active >= 0 ? items[active]?.name : undefined}
      onPointerDown={(e) => {
        pointerId.current = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        pick(e.clientY);
      }}
      onPointerMove={(e) => { if (pointerId.current === e.pointerId) pick(e.clientY); }}
      onPointerUp={(e) => { if (pointerId.current === e.pointerId) release(); }}
      onPointerCancel={(e) => { if (pointerId.current === e.pointerId) release(); }}
      onKeyDown={(e) => {
        const cur = active >= 0 ? active : -1;
        if (e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); select(Math.min(items.length - 1, cur + 1)); }
        else if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); select(Math.max(0, cur - 1)); }
        else if (e.key === "Home") { e.preventDefault(); select(0); }
        else if (e.key === "End") { e.preventDefault(); select(items.length - 1); }
      }}
      onBlur={release}
    >
      {items.map((it, i) => (
        <div
          key={it.slug}
          className={[
            "popscrub__tick",
            it.hasNew ? "popscrub__tick--new" : "",
            i === active ? "popscrub__tick--active" : "",
          ].filter(Boolean).join(" ")}
          style={{ width: 4 + Math.round((it.score / maxScore) * 10) }}
        />
      ))}
      {active != null && items[active] && (
        <div
          className="popscrub__bubble"
          style={{ top: `${((active + 0.5) / items.length) * 100}%` }}
        >
          {items[active].name}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// RunDensitySpine
// ---------------------------------------------------------------------------

/**
 * A horizontal row of clickable bins, one per crossing run, ordered oldest
 * (left) to newest (right).  Displays crossing density (owned count) as a
 * proportional bar height so dense regions are visually prominent.
 *
 * Interactions:
 * - Click a bin → onRunSelect(runIdx)
 * - Pointer-drag along the spine → continuously calls onRunSelect as the
 *   pointer moves, giving the "scan" feel of the coarse detent drag.
 *
 * Suppressed in Top Sets mode (caller controls visibility).
 */
export function RunDensitySpine({
  runs,
  activeIdx,
  onRunSelect,
}: {
  runs: OverlapRun[];
  activeIdx: number | null;
  onRunSelect: (idx: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  /** Map a clientX pixel to the nearest run index (newest=right, oldest=left). */
  const clientXToIdx = useCallback((clientX: number): number => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || runs.length === 0) return 0;
    // x=0 → oldest run (highest array index); x=1 → newest (idx 0)
    const ratio = (clientX - rect.left) / rect.width;
    const raw = (1 - Math.max(0, Math.min(1, ratio))) * (runs.length - 1);
    return Math.round(raw);
  }, [runs.length]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    isDragging.current = true;
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    onRunSelect(clientXToIdx(e.clientX));
  }, [clientXToIdx, onRunSelect]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging.current) return;
    onRunSelect(clientXToIdx(e.clientX));
  }, [clientXToIdx, onRunSelect]);

  const handlePointerUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  if (runs.length === 0) return null;

  const maxOwned = Math.max(...runs.map((r) => r.owned), 1);

  return (
    <div
      ref={containerRef}
      className={`dial-density-spine${runs.length > 60 ? " dial-density-spine--dense" : ""}`}
      role="slider"
      aria-label="Crossing run navigator — drag to scan"
      aria-valuemin={0}
      aria-valuemax={runs.length - 1}
      aria-valuenow={activeIdx ?? 0}
      data-spine="true"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {/* Display oldest → newest (runs array is newest-first, so reverse) */}
      {[...runs].reverse().map((run, displayIdx, reversed) => {
        const runIdx = runs.length - 1 - displayIdx; // convert back to array index
        const isActive = runIdx === activeIdx;
        const heightPct = Math.max(10, Math.round((run.owned / maxOwned) * 100));
        // Mark the first run of each calendar day so wide ranges stay legible.
        const dayStart = displayIdx > 0 && reversed[displayIdx - 1]!.day !== run.day;
        return (
          <button
            key={run.runId}
            type="button"
            className={`dial-density-spine__bin${isActive ? " dial-density-spine__bin--active" : ""}${dayStart ? " dial-density-spine__bin--daystart" : ""}`}
            style={{ height: `${heightPct}%` }}
            data-run-idx={runIdx}
            data-day={run.day}
            aria-label={`${run.day} — ${run.owned} library tracks`}
            onClick={(e) => {
              e.stopPropagation();
              onRunSelect(runIdx);
            }}
          />
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TtMode + spine coordinate constants
// ---------------------------------------------------------------------------

export type TtMode = "live" | "past" | "top";

// Constants for the past-scan density spine.
// Synthetic timestamps assign each run a unique X-position (oldest run → smallest
// timestamp) so that multiple runs on the same calendar day get distinct spine bins.
// The spine maps hourMs back to a run index via:
//   binIdx = round((hourMs - PAST_SCAN_BIN_BASE_MS) / PAST_SCAN_BIN_STEP_MS)
//   runIdx = runs.length - 1 - binIdx   (reversal: pastScanBins is oldest-first)
export const PAST_SCAN_BIN_BASE_MS = new Date("2020-01-01T00:00:00Z").getTime();
export const PAST_SCAN_BIN_STEP_MS = 3_600_000; // 1 hour per bin slot

// ---------------------------------------------------------------------------
// RunRow — a historical crossing run row (day mode / top sets mode)
// ---------------------------------------------------------------------------

/**
 * A single run from /me/overlaps/runs, rendered in the style of a FrontDoorRow.
 * Clicking navigates to /archive/station-runs/{runId} — the station-run archive
 * page that shows the full tracklist and optionally starts a ride.
 *
 * NOTE: runId here is min(spin.id) for the run grouping, which is the same anchor
 * the station-run archive uses. It is NOT a replay manifest ID; routing to
 * /replay/{runId} would silently fail for runs without a manifest.
 */
export function RunRow({ run, focused = false }: { run: OverlapRun; focused?: boolean }) {
  const [, navigate] = useLocation();
  const djName = run.show?.djName ?? null;
  const showName = run.show?.name ?? null;
  const time = classifySetTimeContext({
    startedAt: new Date(run.startedAt),
    stationIanaTimezone: run.station.ianaTimezone,
  });

  return (
    <div
      className={`fdrow fdrow--run${focused ? " fdrow--run-focused" : ""}`}
      role="button"
      tabIndex={0}
      data-run-id={run.runId}
      onClick={() => navigate(`/archive/station-runs/${run.runId}`)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          navigate(`/archive/station-runs/${run.runId}`);
        }
      }}
    >
      <div className="fdrow__run-main">
        <span className="fdrow__station">{run.station.name}</span>
        {djName && <b className="fdrow__dj"> · {djName}</b>}
        {showName && !djName && (
          <span className="fdrow__show"> · {showName}</span>
        )}
      </div>
      <div className="fdrow__run-sub">
        <span className="fdrow__owned">{run.owned} of yours</span>
        {run.discover > 0 && (
          <span className="fdrow__discover"> · {run.discover} new</span>
        )}
        <span className="fdrow__replay-badge"> · ▶ hear it</span>
        <span className="fdrow__run-day">{time.label}</span>
      </div>
    </div>
  );
}
