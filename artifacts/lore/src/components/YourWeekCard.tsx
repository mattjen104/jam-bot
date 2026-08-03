// @refresh reset
import { useState, useRef, useEffect } from "react";
import { Link } from "wouter";
import { ChevronLeft, ChevronRight, Clock, Headphones, ChevronDown } from "lucide-react";
import {
  useMyWeeklySummary,
  useMyWeeklyHistory,
  useIsAuthenticated,
  useServerCurrentWeek,
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

/** Format a week label's Monday date into a compact "Mon D" or "Mon D–D" label. */
function formatWeekRangeFromLabel(weekLabel: string): string {
  try {
    const monday = isoWeekToMonday(weekLabel);
    const sunday = new Date(monday.getTime() + 6 * 86_400_000);
    return formatWeekRange(monday.toISOString(), sunday.toISOString());
  } catch {
    return weekLabel;
  }
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
// Week picker dropdown
// ---------------------------------------------------------------------------

interface WeekPickerProps {
  selectedWeek: string;
  currentWeek: string;
  onSelect: (week: string) => void;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
}

function WeekPickerDropdown({
  selectedWeek,
  currentWeek,
  onSelect,
  onClose,
  anchorRef,
}: WeekPickerProps) {
  const { data: history = [] } = useMyWeeklyHistory(8);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose, anchorRef]);

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // Build displayed weeks: current week always at top, then history weeks
  // (dedup current week if it appears in history).
  const historyWeeks = history.filter((w) => w.week !== currentWeek);
  // Check if current week has data from history
  const currentWeekData = history.find((w) => w.week === currentWeek);

  const items: Array<{ week: string; label: string; trackCount: number | null; isCurrent: boolean }> = [
    {
      week: currentWeek,
      label: formatWeekRangeFromLabel(currentWeek),
      trackCount: currentWeekData?.trackCount ?? null,
      isCurrent: true,
    },
    ...historyWeeks.map((w) => ({
      week: w.week,
      label: formatWeekRange(w.weekStart, w.weekEnd),
      trackCount: w.trackCount,
      isCurrent: false,
    })),
  ];

  return (
    <div
      ref={dropdownRef}
      role="listbox"
      aria-label="Select a week"
      style={{
        position: "absolute",
        top: "calc(100% + 4px)",
        right: 0,
        zIndex: 100,
        background: "hsl(var(--card))",
        border: "1px solid hsl(var(--border))",
        borderRadius: 6,
        boxShadow: "0 4px 20px hsl(0 0% 0% / 0.35)",
        minWidth: 220,
        overflow: "hidden",
      }}
    >
      {/* Header row */}
      <div
        style={{
          padding: "6px 12px",
          borderBottom: "1px solid hsl(var(--border) / 0.5)",
          fontFamily: "var(--app-font-mono)",
          fontSize: 9,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          color: "hsl(var(--faint))",
        }}
      >
        Jump to week
      </div>

      {items.map((item) => {
        const isSelected = item.week === selectedWeek;
        return (
          <button
            key={item.week}
            type="button"
            role="option"
            aria-selected={isSelected}
            onClick={() => {
              onSelect(item.week);
              onClose();
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              width: "100%",
              padding: "7px 12px",
              background: isSelected
                ? "hsl(var(--library) / 0.12)"
                : "none",
              border: "none",
              borderBottom: "1px solid hsl(var(--border) / 0.25)",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <span
                style={{
                  display: "block",
                  fontFamily: "var(--app-font-display)",
                  fontSize: 12,
                  fontWeight: isSelected ? 700 : 500,
                  color: isSelected
                    ? "hsl(var(--library))"
                    : "hsl(var(--foreground))",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {item.label}
              </span>
              {item.isCurrent && (
                <span
                  style={{
                    fontFamily: "var(--app-font-mono)",
                    fontSize: 9,
                    color: "hsl(var(--faint))",
                  }}
                >
                  this week
                </span>
              )}
            </div>
            {item.trackCount != null && item.trackCount > 0 ? (
              <span
                style={{
                  fontFamily: "var(--app-font-mono)",
                  fontSize: 9,
                  color: "hsl(var(--dim))",
                  flexShrink: 0,
                }}
              >
                {item.trackCount} track{item.trackCount === 1 ? "" : "s"}
              </span>
            ) : (
              <span
                style={{
                  fontFamily: "var(--app-font-mono)",
                  fontSize: 9,
                  color: "hsl(var(--faint))",
                  flexShrink: 0,
                }}
              >
                —
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main card
// ---------------------------------------------------------------------------

/**
 * "Your Week" card — shows the listener's confirmed on-air listening for the
 * selected ISO week.  Only rendered when the user has attendance data or is
 * authenticated (so they know the feature exists even when the first week is
 * empty).
 */
export function YourWeekCard() {
  const isAuthenticated = useIsAuthenticated();
  // null → still loading auth; false → not logged in; true → logged in

  // The server is the authority for what the current week is. The client
  // clock may be ahead, which would let forward navigation reach a future
  // week. We fall back to a client-side estimate only while the server
  // response is in flight.
  const serverCurrentWeek = useServerCurrentWeek();
  const clientCurrentWeek = currentIsoWeekLabel();
  const currentWeek = serverCurrentWeek ?? clientCurrentWeek;

  const [selectedWeek, setSelectedWeek] = useState<string>(clientCurrentWeek);
  const [pickerOpen, setPickerOpen] = useState(false);

  // If the client clock is ahead and selectedWeek points to a future week
  // that the server hasn't reached yet, snap it back as soon as the server
  // current week is known.
  useEffect(() => {
    if (serverCurrentWeek && selectedWeek > serverCurrentWeek) {
      setSelectedWeek(serverCurrentWeek);
    }
  }, [serverCurrentWeek, selectedWeek]);

  const isCurrentWeek = selectedWeek >= currentWeek;
  const weekLabelRef = useRef<HTMLButtonElement>(null);

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
            position: "relative",
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

          {/* Clickable week label — opens the picker */}
          <button
            ref={weekLabelRef}
            type="button"
            onClick={() => setPickerOpen((o) => !o)}
            aria-haspopup="listbox"
            aria-expanded={pickerOpen}
            data-testid="your-week-label-button"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 3,
              padding: "2px 4px",
              borderRadius: 3,
              color: pickerOpen ? "hsl(var(--foreground))" : "hsl(var(--dim))",
            }}
          >
            <span
              style={{
                fontFamily: "var(--app-font-mono)",
                fontSize: 10,
                whiteSpace: "nowrap",
              }}
              data-testid="your-week-label"
            >
              {summary
                ? formatWeekRange(summary.weekStart, summary.weekEnd)
                : selectedWeek}
            </span>
            <ChevronDown
              style={{
                width: 10,
                height: 10,
                flexShrink: 0,
                transform: pickerOpen ? "rotate(180deg)" : "none",
                transition: "transform 0.15s ease",
              }}
            />
          </button>

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

          {/* Picker dropdown */}
          {pickerOpen && (
            <WeekPickerDropdown
              selectedWeek={selectedWeek}
              currentWeek={currentWeek}
              onSelect={(week) => {
                // Guard: never navigate to a week beyond the server's current week.
                if (serverCurrentWeek && week > serverCurrentWeek) return;
                setSelectedWeek(week);
              }}
              onClose={() => setPickerOpen(false)}
              anchorRef={weekLabelRef}
            />
          )}
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
