// @refresh reset
import { useState } from "react";
import { Link } from "wouter";
import { ChevronLeft, ChevronRight, Clock, Headphones } from "lucide-react";
import {
  useMyWeeklySummary,
  useIsAuthenticated,
  type WeeklyTrack,
} from "../lib/meHooks";

// ---------------------------------------------------------------------------
// ISO week helpers (client-side, UTC-based — mirrors the server)
// ---------------------------------------------------------------------------

function currentIsoWeekLabel(): string {
  const now = new Date();
  const utcDay = now.getUTCDay() || 7; // 1=Mon … 7=Sun
  const monday = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - (utcDay - 1),
    ),
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
    Math.floor((monday.getTime() - week1Monday.getTime()) / (7 * 86_400_000)) +
    1;
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
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear();
  const fmtMonth = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  const fmtDay = (d: Date) =>
    d.toLocaleDateString("en-US", { day: "numeric", timeZone: "UTC" });
  const fmtYear = (d: Date) => d.getUTCFullYear().toString();

  if (sameMonth) {
    return `${fmtMonth(start)} ${fmtDay(start)}–${fmtDay(end)}, ${fmtYear(start)}`;
  }
  if (sameYear) {
    return `${fmtMonth(start)} ${fmtDay(start)} – ${fmtMonth(end)} ${fmtDay(end)}, ${fmtYear(start)}`;
  }
  return `${fmtMonth(start)} ${fmtDay(start)}, ${fmtYear(start)} – ${fmtMonth(end)} ${fmtDay(end)}, ${fmtYear(end)}`;
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
// Track row
// ---------------------------------------------------------------------------

function WeekTrackRow({ track }: { track: WeeklyTrack }) {
  const hasArt = Boolean(track.artworkUrl);

  return (
    <li
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 15px",
        borderBottom: "1px solid hsl(var(--border) / 0.35)",
        minWidth: 0,
      }}
      data-testid="your-week-track"
    >
      {/* Artwork / placeholder */}
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 3,
          flexShrink: 0,
          overflow: "hidden",
          background: hasArt ? "transparent" : "hsl(var(--secondary))",
          border: "1px solid hsl(var(--border) / 0.5)",
        }}
      >
        {hasArt ? (
          <img
            src={track.artworkUrl!}
            alt=""
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
            loading="lazy"
          />
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Headphones
              style={{
                width: 14,
                height: 14,
                color: "hsl(var(--faint))",
              }}
            />
          </div>
        )}
      </div>

      {/* Title + artist */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {track.mbid ? (
          <Link
            href={`/song/${track.mbid}`}
            style={{
              fontFamily: "var(--app-font-display)",
              fontSize: 13,
              fontWeight: 600,
              color: "hsl(var(--foreground))",
              textDecoration: "none",
              display: "block",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {track.title ?? "Unknown"}
          </Link>
        ) : (
          <span
            style={{
              fontFamily: "var(--app-font-display)",
              fontSize: 13,
              fontWeight: 600,
              color: "hsl(var(--foreground))",
              display: "block",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {track.title ?? "Unknown"}
          </span>
        )}
        <span
          style={{
            fontFamily: "var(--app-font-mono)",
            fontSize: 10,
            color: "hsl(var(--dim))",
            display: "block",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {track.artist ?? "Unknown artist"}
        </span>
      </div>

      {/* Spin count + dwell */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: 3,
          flexShrink: 0,
        }}
      >
        {track.spinCount > 1 && (
          <span
            style={{
              fontFamily: "var(--app-font-mono)",
              fontSize: 9,
              fontWeight: 700,
              color: "hsl(var(--library))",
              background: "hsl(var(--library) / 0.12)",
              border: "1px solid hsl(var(--library) / 0.25)",
              borderRadius: 3,
              padding: "2px 5px",
              letterSpacing: "0.04em",
            }}
          >
            ×{track.spinCount}
          </span>
        )}
        <span
          style={{
            fontFamily: "var(--app-font-mono)",
            fontSize: 9,
            color: "hsl(var(--faint))",
            display: "flex",
            alignItems: "center",
            gap: 2,
          }}
        >
          <Clock style={{ width: 8, height: 8 }} />
          {formatDwell(track.dwellSeconds)}
        </span>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Main card
// ---------------------------------------------------------------------------

const CURRENT_WEEK = currentIsoWeekLabel();

/**
 * "Your Week" card — shows the listener's confirmed on-air listening for the
 * selected ISO week.  Only rendered when the user has attendance data or is
 * authenticated (so they know the feature exists even when the first week is
 * empty).
 */
export function YourWeekCard() {
  const isAuthenticated = useIsAuthenticated();
  // null → still loading auth; false → not logged in; true → logged in
  const [selectedWeek, setSelectedWeek] = useState<string>(CURRENT_WEEK);
  const isCurrentWeek = selectedWeek === CURRENT_WEEK;

  const { data: summary, isLoading } = useMyWeeklySummary(selectedWeek);

  // Suppress the card entirely for unauthenticated users or while auth loads.
  // Once we know they're authenticated (even if empty week), show the card.
  if (isAuthenticated === false) return null;

  // If auth is still loading, don't flash the card.
  if (isAuthenticated === null && !summary) return null;

  const hasTracks = (summary?.tracks.length ?? 0) > 0;
  const totalDwell = summary?.totalDwellSeconds ?? 0;

  return (
    <div
      data-testid="your-week-card"
      style={{
        borderBottom: "1px solid hsl(var(--border))",
        background: "hsl(var(--card))",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 15px 8px",
          borderBottom: "1px solid hsl(var(--border) / 0.5)",
        }}
      >
        {/* Kicker */}
        <span
          style={{
            fontFamily: "var(--app-font-display)",
            fontSize: 9,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.12em",
            color: "hsl(var(--library))",
            flexShrink: 0,
          }}
        >
          Your week
        </span>

        <div style={{ flex: 1 }} />

        {/* Week nav */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          <button
            type="button"
            onClick={() => setSelectedWeek((w) => stepWeek(w, -1))}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "hsl(var(--dim))",
              display: "flex",
              alignItems: "center",
              padding: "2px 4px",
              borderRadius: 3,
            }}
            aria-label="Previous week"
            data-testid="your-week-prev"
          >
            <ChevronLeft style={{ width: 12, height: 12 }} />
          </button>

          <span
            style={{
              fontFamily: "var(--app-font-mono)",
              fontSize: 10,
              color: "hsl(var(--dim))",
              whiteSpace: "nowrap",
            }}
            data-testid="your-week-label"
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
              color: isCurrentWeek
                ? "hsl(var(--faint))"
                : "hsl(var(--dim))",
              display: "flex",
              alignItems: "center",
              padding: "2px 4px",
              borderRadius: 3,
            }}
            aria-label="Next week"
            data-testid="your-week-next"
          >
            <ChevronRight style={{ width: 12, height: 12 }} />
          </button>
        </div>
      </div>

      {/* Body */}
      {isLoading ? (
        <div
          style={{ display: "flex", flexDirection: "column" }}
          data-testid="your-week-loading"
        >
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              style={{
                height: 54,
                borderBottom: "1px solid hsl(var(--border) / 0.35)",
                background: "hsl(var(--secondary))",
                opacity: 0.3 + i * 0.08,
              }}
            />
          ))}
        </div>
      ) : !hasTracks ? (
        <div
          style={{
            padding: "18px 15px",
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
          data-testid="your-week-empty"
        >
          <span
            style={{
              fontFamily: "var(--app-font-reading)",
              fontSize: 13,
              color: "hsl(var(--muted-foreground))",
            }}
          >
            {isCurrentWeek
              ? "No confirmed listens this week yet."
              : "Nothing confirmed for this week."}
          </span>
          <span
            style={{
              fontFamily: "var(--app-font-mono)",
              fontSize: 10,
              color: "hsl(var(--faint))",
            }}
          >
            {isCurrentWeek
              ? "Lore counts a track once you've heard enough of it on air."
              : "Tracks are counted when you heard enough of them on air."}
          </span>
        </div>
      ) : (
        <>
          {/* Summary stat */}
          <div
            style={{
              padding: "6px 15px",
              display: "flex",
              gap: 12,
              alignItems: "center",
              borderBottom: "1px solid hsl(var(--border) / 0.35)",
            }}
          >
            <span
              style={{
                fontFamily: "var(--app-font-mono)",
                fontSize: 10,
                color: "hsl(var(--dim))",
              }}
            >
              <b style={{ color: "hsl(var(--foreground))" }}>
                {summary!.totalTracks}
              </b>{" "}
              track{summary!.totalTracks === 1 ? "" : "s"}
            </span>
            <span
              style={{
                fontFamily: "var(--app-font-mono)",
                fontSize: 10,
                color: "hsl(var(--faint))",
                display: "flex",
                alignItems: "center",
                gap: 3,
              }}
            >
              <Clock style={{ width: 9, height: 9 }} />
              {formatDwell(totalDwell)} on air
            </span>
          </div>

          {/* Track list */}
          <ul
            style={{ margin: 0, padding: 0, listStyle: "none" }}
            data-testid="your-week-tracks"
          >
            {summary!.tracks.map((track) => (
              <WeekTrackRow key={track.mbid} track={track} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
