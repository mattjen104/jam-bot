import { useState } from "react";
import { proxyArtUrl } from "../lib/proxyArt";
import { ChevronLeft, ChevronRight, Clock, Headphones, CalendarCheck } from "lucide-react";
import { useMyWeeklySummary } from "../lib/meHooks";

// ---------------------------------------------------------------------------
// ISO week helpers (mirrors YourWeekCard / server logic)
// ---------------------------------------------------------------------------

function currentIsoWeekLabel(): string {
  const now = new Date();
  const utcDay = now.getUTCDay() || 7;
  const monday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (utcDay - 1)),
  );
  return mondayToIsoWeekLabel(monday);
}

function mondayToIsoWeekLabel(monday: Date): string {
  const thursday = new Date(monday.getTime() + 3 * 86_400_000);
  const year = thursday.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dow = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4.getTime() - (dow - 1) * 86_400_000);
  const week =
    Math.floor((monday.getTime() - week1Monday.getTime()) / (7 * 86_400_000)) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}

function isoWeekToMonday(label: string): Date {
  const m = /^(\d{4})-W(\d{2})$/.exec(label);
  if (!m) throw new Error(`Bad week label: ${label}`);
  const isoYear = parseInt(m[1]!, 10);
  const isoWeek = parseInt(m[2]!, 10);
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const dow = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4.getTime() - (dow - 1) * 86_400_000);
  return new Date(week1Monday.getTime() + (isoWeek - 1) * 7 * 86_400_000);
}

function stepWeek(label: string, delta: -1 | 1): string {
  const monday = isoWeekToMonday(label);
  const next = new Date(monday.getTime() + delta * 7 * 86_400_000);
  return mondayToIsoWeekLabel(next);
}

function formatWeekRange(weekStart: string, weekEnd: string): string {
  const start = new Date(weekStart);
  const end = new Date(weekEnd);
  const sameMonth = start.getUTCMonth() === end.getUTCMonth();
  const fmtMonth = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  const fmtDay = (d: Date) =>
    d.toLocaleDateString("en-US", { day: "numeric", timeZone: "UTC" });
  const fmtYear = (d: Date) => d.getUTCFullYear().toString();

  if (sameMonth) {
    return `${fmtMonth(start)} ${fmtDay(start)}–${fmtDay(end)}, ${fmtYear(start)}`;
  }
  return `${fmtMonth(start)} ${fmtDay(start)} – ${fmtMonth(end)} ${fmtDay(end)}, ${fmtYear(start)}`;
}

function formatDwell(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem > 0 ? `${h}h ${rem}m` : `${h}h`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const CURRENT_WEEK = currentIsoWeekLabel();

/**
 * Compact "Your Week" panel for the web player.
 * Shows confirmed on-air listening for the selected ISO week with week navigation.
 * Only rendered when the user has the listening ledger enabled.
 */
export function YourWeekTab() {
  const [selectedWeek, setSelectedWeek] = useState<string>(CURRENT_WEEK);
  const isCurrentWeek = selectedWeek === CURRENT_WEEK;

  const { data: summary, isLoading, isError } = useMyWeeklySummary(selectedWeek);

  const hasTracks = (summary?.tracks.length ?? 0) > 0;
  const totalDwell = summary?.totalDwellSeconds ?? 0;

  return (
    <div className="wp-card" style={{ overflow: "hidden" }} data-testid="wp-yourweek-tab">
      {/* Header with week navigation */}
      <div
        style={{
          padding: "10px 14px 8px",
          borderBottom: "0.5px solid var(--wp-border)",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <CalendarCheck
          size={13}
          style={{ color: "var(--wp-text-accent)", flexShrink: 0 }}
          aria-hidden="true"
        />
        <p
          className="wp-mono"
          style={{ margin: 0, fontSize: 11, color: "var(--wp-text-muted)", letterSpacing: "0.04em", flex: 1 }}
        >
          YOUR WEEK
        </p>

        {/* Week nav */}
        <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
          <button
            type="button"
            onClick={() => setSelectedWeek((w) => stepWeek(w, -1))}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--wp-text-muted)",
              display: "flex",
              alignItems: "center",
              padding: "2px 4px",
              borderRadius: 3,
            }}
            aria-label="Previous week"
            data-testid="wp-yourweek-prev"
          >
            <ChevronLeft size={13} />
          </button>

          <span
            className="wp-mono"
            style={{ fontSize: 10, color: "var(--wp-text-secondary)", whiteSpace: "nowrap" }}
            data-testid="wp-yourweek-label"
          >
            {summary
              ? formatWeekRange(summary.weekStart, summary.weekEnd)
              : selectedWeek}
          </span>

          <button
            type="button"
            onClick={() => setSelectedWeek((w) => stepWeek(w, 1))}
            disabled={isCurrentWeek}
            style={{
              background: "none",
              border: "none",
              cursor: isCurrentWeek ? "default" : "pointer",
              color: isCurrentWeek ? "var(--wp-text-muted)" : "var(--wp-text-secondary)",
              display: "flex",
              alignItems: "center",
              padding: "2px 4px",
              borderRadius: 3,
              opacity: isCurrentWeek ? 0.4 : 1,
            }}
            aria-label="Next week"
            data-testid="wp-yourweek-next"
          >
            <ChevronRight size={13} />
          </button>
        </div>
      </div>

      {/* Body */}
      {isLoading && (
        <div data-testid="wp-yourweek-loading">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              style={{
                height: 46,
                borderBottom: "0.5px solid var(--wp-border)",
                background: "var(--wp-surface-2)",
                opacity: 0.3 + i * 0.1,
              }}
            />
          ))}
        </div>
      )}

      {isError && !isLoading && (
        <p
          style={{ padding: "14px 16px", margin: 0, fontSize: 13, color: "var(--wp-text-muted)" }}
          data-testid="wp-yourweek-error"
        >
          Couldn't load your week — try again later.
        </p>
      )}

      {!isLoading && !isError && !hasTracks && (
        <div
          style={{ padding: "14px 16px" }}
          data-testid="wp-yourweek-empty"
        >
          <p style={{ margin: "0 0 4px", fontSize: 13, color: "var(--wp-text-secondary)" }}>
            {isCurrentWeek
              ? "No confirmed listens this week yet."
              : "Nothing confirmed for this week."}
          </p>
          <p className="wp-mono" style={{ margin: 0, fontSize: 11, color: "var(--wp-text-muted)" }}>
            {isCurrentWeek
              ? "Lore counts a track once you've heard enough of it on air."
              : "Tracks are counted when you heard enough of them on air."}
          </p>
        </div>
      )}

      {!isLoading && !isError && hasTracks && (
        <>
          {/* Summary stats */}
          <div
            style={{
              padding: "6px 14px",
              display: "flex",
              gap: 14,
              alignItems: "center",
              borderBottom: "0.5px solid var(--wp-border)",
            }}
          >
            <span className="wp-mono" style={{ fontSize: 11, color: "var(--wp-text-secondary)" }}>
              <strong style={{ color: "var(--wp-text-primary)" }}>{summary!.totalTracks}</strong>{" "}
              track{summary!.totalTracks === 1 ? "" : "s"}
            </span>
            <span
              className="wp-mono"
              style={{
                fontSize: 11,
                color: "var(--wp-text-muted)",
                display: "flex",
                alignItems: "center",
                gap: 3,
              }}
            >
              <Clock size={10} aria-hidden="true" />
              {formatDwell(totalDwell)} on air
            </span>
          </div>

          {/* Track list */}
          <div data-testid="wp-yourweek-tracks">
            {summary!.tracks.map((track, i) => (
              <div
                key={track.mbid}
                style={{
                  padding: "7px 14px",
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  borderBottom:
                    i < summary!.tracks.length - 1
                      ? "0.5px solid var(--wp-border)"
                      : "none",
                }}
                data-testid="wp-yourweek-track"
              >
                {/* Artwork / placeholder */}
                {track.artworkUrl ? (
                  <img
                    src={proxyArtUrl(track.artworkUrl)!}
                    alt=""
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 3,
                      objectFit: "cover",
                      flexShrink: 0,
                    }}
                    loading="lazy"
                  />
                ) : (
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 3,
                      background: "var(--wp-surface-2)",
                      flexShrink: 0,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Headphones size={11} style={{ color: "var(--wp-text-muted)" }} aria-hidden="true" />
                  </div>
                )}

                {/* Title + artist */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p
                    style={{
                      margin: 0,
                      fontSize: 13,
                      fontWeight: 500,
                      color: "var(--wp-text-primary)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {track.title ?? "Unknown"}
                  </p>
                  <p
                    className="wp-mono"
                    style={{
                      margin: "1px 0 0",
                      fontSize: 10,
                      color: "var(--wp-text-muted)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {track.artist ?? "Unknown artist"}
                  </p>
                </div>

                {/* Spin count + dwell */}
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-end",
                    gap: 2,
                    flexShrink: 0,
                  }}
                >
                  {track.spinCount > 1 && (
                    <span
                      className="wp-mono"
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        color: "var(--wp-text-success)",
                        background: "var(--wp-bg-success)",
                        borderRadius: 3,
                        padding: "1px 5px",
                        letterSpacing: "0.04em",
                      }}
                    >
                      ×{track.spinCount}
                    </span>
                  )}
                  <span
                    className="wp-mono"
                    style={{
                      fontSize: 9,
                      color: "var(--wp-text-muted)",
                      display: "flex",
                      alignItems: "center",
                      gap: 2,
                    }}
                  >
                    <Clock size={8} aria-hidden="true" />
                    {formatDwell(track.dwellSeconds)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
