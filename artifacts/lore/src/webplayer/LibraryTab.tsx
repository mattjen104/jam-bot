import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { proxyArtUrl } from "../lib/proxyArt";
import { Disc3, Radio, Loader2, Search, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@workspace/api-client-react";
import {
  useMyLibraryInfinite,
  useIsAuthenticated,
  useLatestSyncJob,
  useAppConfig,
  startSpotifyLibraryConnect,
  startSpotifyLibraryReconnect,
  postImportLibraryFile,
  postStartSync,
  type FileImportSummary,
  type LibraryItem,
  type LibraryQueryOptions,
  ME_LATEST_SYNC_JOB_KEY,
} from "../lib/meHooks";
import { useWpLoreCounts, useWpRecordingSpins, useWpAlbumTracks, type WpSpinRow } from "./hooks";
import { LoreChip } from "./LoreChip";

function VinylIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="11" fill="#1a1a1a" />
      <circle cx="12" cy="12" r="9" fill="none" stroke="#3a3a3a" strokeWidth="0.7" />
      <circle cx="12" cy="12" r="7" fill="none" stroke="#2e2e2e" strokeWidth="0.7" />
      <circle cx="12" cy="12" r="5" fill="none" stroke="#3a3a3a" strokeWidth="0.7" />
      <circle cx="12" cy="12" r="3.2" fill="#c8a84b" />
      <circle cx="12" cy="12" r="1.1" fill="#1a1a1a" />
    </svg>
  );
}

function GhostIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 2C8.134 2 5 5.134 5 9v10.5l2-1.8 2 1.8 2-1.8 2 1.8 2-1.8 2 1.8V9c0-3.866-3.134-7-7-7z"
        fill="currentColor"
      />
      <circle cx="9.5" cy="10" r="1.2" fill="#1a1a1a" />
      <circle cx="14.5" cy="10" r="1.2" fill="#1a1a1a" />
    </svg>
  );
}

interface RunRef {
  runId: number | null;
  slug: string;
  stationName: string;
  showName: string | null;
  djName: string | null;
  day: string;
}

/** Group a recording's broadcast spins into distinct runs, newest first. */
function groupRuns(spins: WpSpinRow[]): RunRef[] {
  const seen = new Map<string, RunRef>();
  for (const s of spins) {
    if (!s.station) continue;
    const day = s.playedAt.slice(0, 10);
    const key = s.runId != null ? `run-${s.runId}` : `${s.station.slug}-${day}`;
    if (seen.has(key)) continue;
    seen.set(key, {
      runId: s.runId,
      slug: s.station.slug,
      stationName: s.station.name,
      showName: s.show?.name ?? null,
      djName: s.show?.djName ?? null,
      day,
    });
  }
  return [...seen.values()];
}

type PlayMode = "song" | "album" | "ghost";
const PLAY_MODES: PlayMode[] = ["song", "album", "ghost"];
const CONTAINER = 52;
const CX = CONTAINER / 2;
const DOT_RADIUS = 20; // px from center to dot midpoint
const DOT_SIZE = 6;
const MAX_DOTS = 8;

/**
 * Three-mode play button:
 *   song  → ▶ opens Spotify track
 *   album → vinyl record, opens Spotify album (click ring to cycle)
 *   ghost → ghost icon, opens runs; radial dot ring shows all available runs
 *
 * Click center = action. Click ring area (outside center, inside container) = cycle mode.
 * Scroll wheel = page through runs when in ghost mode with >8 runs.
 */
function PlayModeButton({
  mbid,
  rec,
  onOpenRun,
}: {
  mbid: string;
  rec: LibraryItem["recording"];
  onOpenRun: (slug: string, runId: number | null) => void;
}) {
  const [mode, setMode] = useState<PlayMode>("song");
  const [ghostFetched, setGhostFetched] = useState(false);
  const [albumFetched, setAlbumFetched] = useState(false);
  const [activeRunIdx, setActiveRunIdx] = useState(0);
  const [scrollBase, setScrollBase] = useState(0);
  const [activeTrackIdx, setActiveTrackIdx] = useState(0);
  const [trackScrollBase, setTrackScrollBase] = useState(0);

  const { data: spinData, isLoading: spinsLoading } = useWpRecordingSpins(
    ghostFetched ? mbid : null,
  );
  const allRuns = groupRuns(spinData?.spins ?? []);
  const pageEnd = Math.min(scrollBase + MAX_DOTS, allRuns.length);
  const visibleRuns = allRuns.slice(scrollBase, pageEnd);
  const hasMore = allRuns.length > MAX_DOTS;

  // Extract the Spotify track ID from the track URL, e.g.
  // "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT" → "4cOdK2wGLETKBW3PvgPWqT"
  const spotifyTrackId = rec?.spotifyUrl
    ? (() => { try { return new URL(rec.spotifyUrl).pathname.split("/").pop() ?? null; } catch { return null; } })()
    : null;

  const { data: albumData, isLoading: albumLoading } = useWpAlbumTracks(
    albumFetched ? spotifyTrackId : null,
  );
  const allTracks = albumData?.tracks ?? [];
  const trackPageEnd = Math.min(trackScrollBase + MAX_DOTS, allTracks.length);
  const visibleTracks = allTracks.slice(trackScrollBase, trackPageEnd);
  const hasMoreTracks = allTracks.length > MAX_DOTS;

  const cycleMode = () => {
    setMode((m) => {
      const next = PLAY_MODES[(PLAY_MODES.indexOf(m) + 1) % PLAY_MODES.length];
      if (next === "ghost") setGhostFetched(true);
      if (next === "album") setAlbumFetched(true);
      return next;
    });
  };

  const handleCenterClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (mode === "song") {
      if (rec?.spotifyUrl) window.open(rec.spotifyUrl, "_blank", "noopener noreferrer");
    } else if (mode === "album") {
      const track = allTracks[activeTrackIdx] ?? allTracks[0];
      if (track) {
        window.open(`https://open.spotify.com/track/${track.id}`, "_blank", "noopener noreferrer");
      } else if (rec?.albumTitle) {
        const q = encodeURIComponent(`${rec?.artist ?? ""} ${rec.albumTitle}`);
        window.open(`https://open.spotify.com/search/${q}/albums`, "_blank", "noopener noreferrer");
      }
    } else {
      const run = allRuns[activeRunIdx] ?? allRuns[0];
      if (run) onOpenRun(run.slug, run.runId);
    }
  };

  const handleRingClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Only cycle if click was outside the center button (dots have stopPropagation)
    const rect = e.currentTarget.getBoundingClientRect();
    const dx = e.clientX - rect.left - CX;
    const dy = e.clientY - rect.top - CX;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 14) cycleMode(); // outside center 28px button radius=14
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (mode === "ghost" && hasMore) {
      e.preventDefault();
      const dir = e.deltaY > 0 ? 1 : -1;
      setScrollBase((b) => Math.max(0, Math.min(b + dir, allRuns.length - MAX_DOTS)));
    } else if (mode === "album" && hasMoreTracks) {
      e.preventDefault();
      const dir = e.deltaY > 0 ? 1 : -1;
      setTrackScrollBase((b) => Math.max(0, Math.min(b + dir, allTracks.length - MAX_DOTS)));
    }
  };

  // Visual config per mode
  const modeAccent =
    mode === "ghost" ? "var(--wp-fill-accent)" : mode === "album" ? "#c8a84b" : "var(--wp-text-muted)";
  const centerBg =
    mode === "ghost"
      ? "var(--wp-fill-accent)"
      : mode === "album"
        ? "var(--wp-surface-2)"
        : "var(--wp-surface-2)";
  const centerColor = mode === "ghost" ? "#fff" : "var(--wp-text-secondary)";

  return (
    <div
      role="group"
      aria-label="Play mode"
      style={{ position: "relative", width: CONTAINER, height: CONTAINER, flexShrink: 0, cursor: "pointer" }}
      onClick={handleRingClick}
      onWheel={handleWheel}
    >
      {/* Dashed orbit ring (album/ghost modes) */}
      {mode !== "song" && (
        <svg
          width={CONTAINER}
          height={CONTAINER}
          style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
          aria-hidden="true"
        >
          <circle
            cx={CX}
            cy={CX}
            r={DOT_RADIUS}
            fill="none"
            stroke={modeAccent}
            strokeWidth={1}
            strokeOpacity={0.25}
            strokeDasharray="2 3"
          />
        </svg>
      )}

      {/* Ghost mode: radial run dots */}
      {mode === "ghost" && !spinsLoading &&
        visibleRuns.map((run, i) => {
          const absIdx = scrollBase + i;
          const total = visibleRuns.length;
          const angle =
            total === 1
              ? -Math.PI / 2
              : (i / total) * 2 * Math.PI - Math.PI / 2;
          const x = CX + DOT_RADIUS * Math.cos(angle) - DOT_SIZE / 2;
          const y = CX + DOT_RADIUS * Math.sin(angle) - DOT_SIZE / 2;
          const isActive = absIdx === activeRunIdx;
          return (
            <button
              key={`${run.runId ?? run.slug}-${run.day}`}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setActiveRunIdx(absIdx);
                onOpenRun(run.slug, run.runId);
              }}
              title={`${run.showName ?? run.stationName}${run.djName ? " · " + run.djName : ""} · ${run.day}`}
              style={{
                position: "absolute",
                left: x,
                top: y,
                width: DOT_SIZE,
                height: DOT_SIZE,
                borderRadius: "50%",
                background: isActive ? "#fff" : "rgba(255,255,255,0.28)",
                border: "none",
                padding: 0,
                cursor: "pointer",
                transition: "background 0.15s, transform 0.1s",
                transform: isActive ? "scale(1.4)" : "scale(1)",
                zIndex: 2,
              }}
              aria-label={`Run: ${run.showName ?? run.stationName} ${run.day}`}
            />
          );
        })}

      {/* Ghost loading spinner arc */}
      {mode === "ghost" && spinsLoading && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          <Loader2
            size={CONTAINER - 4}
            style={{ color: "rgba(232,106,78,0.2)", position: "absolute" }}
            className="animate-spin"
            aria-hidden="true"
          />
        </div>
      )}

      {/* Scroll hint when more runs than MAX_DOTS */}
      {mode === "ghost" && hasMore && !spinsLoading && (
        <div
          style={{
            position: "absolute",
            bottom: 1,
            left: "50%",
            transform: "translateX(-50%)",
            fontSize: 7,
            color: "rgba(255,255,255,0.35)",
            pointerEvents: "none",
            lineHeight: 1,
            userSelect: "none",
          }}
        >
          ↕ scroll
        </div>
      )}

      {/* Album mode: radial track dots — one dot per track, gold accent */}
      {mode === "album" && !albumLoading &&
        visibleTracks.map((track, i) => {
          const absIdx = trackScrollBase + i;
          const total = visibleTracks.length;
          const angle =
            total === 1
              ? -Math.PI / 2
              : (i / total) * 2 * Math.PI - Math.PI / 2;
          const x = CX + DOT_RADIUS * Math.cos(angle) - DOT_SIZE / 2;
          const y = CX + DOT_RADIUS * Math.sin(angle) - DOT_SIZE / 2;
          const isActive = absIdx === activeTrackIdx;
          return (
            <button
              key={track.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setActiveTrackIdx(absIdx);
                window.open(
                  `https://open.spotify.com/track/${track.id}`,
                  "_blank",
                  "noopener noreferrer",
                );
              }}
              title={`${track.trackNumber}. ${track.name}`}
              style={{
                position: "absolute",
                left: x,
                top: y,
                width: DOT_SIZE,
                height: DOT_SIZE,
                borderRadius: "50%",
                background: isActive ? "#c8a84b" : "rgba(200,168,75,0.35)",
                border: "none",
                padding: 0,
                cursor: "pointer",
                transition: "background 0.15s, transform 0.1s",
                transform: isActive ? "scale(1.4)" : "scale(1)",
                zIndex: 2,
              }}
              aria-label={`Track ${track.trackNumber}: ${track.name}`}
            />
          );
        })}

      {/* Album loading spinner */}
      {mode === "album" && albumLoading && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          <Loader2
            size={CONTAINER - 4}
            style={{ color: "rgba(200,168,75,0.2)", position: "absolute" }}
            className="animate-spin"
            aria-hidden="true"
          />
        </div>
      )}

      {/* Scroll hint when more tracks than MAX_DOTS */}
      {mode === "album" && hasMoreTracks && !albumLoading && (
        <div
          style={{
            position: "absolute",
            bottom: 1,
            left: "50%",
            transform: "translateX(-50%)",
            fontSize: 7,
            color: "rgba(200,168,75,0.45)",
            pointerEvents: "none",
            lineHeight: 1,
            userSelect: "none",
          }}
        >
          ↕ scroll
        </div>
      )}

      {/* Mode indicator: three tiny dots at the bottom edge */}
      <div
        style={{
          position: "absolute",
          bottom: 3,
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          gap: 3,
          pointerEvents: "none",
        }}
        aria-hidden="true"
      >
        {PLAY_MODES.map((m) => (
          <div
            key={m}
            style={{
              width: 3,
              height: 3,
              borderRadius: "50%",
              background: m === mode ? modeAccent : "rgba(255,255,255,0.2)",
              transition: "background 0.2s",
            }}
          />
        ))}
      </div>

      {/* Center action button */}
      <button
        type="button"
        onClick={handleCenterClick}
        title={
          mode === "song"
            ? rec?.spotifyUrl
              ? "Play track on Spotify"
              : "No Spotify link"
            : mode === "album"
              ? allTracks.length > 0
                ? `${(allTracks[activeTrackIdx] ?? allTracks[0])?.trackNumber}. ${(allTracks[activeTrackIdx] ?? allTracks[0])?.name ?? "…"}`
                : albumLoading
                  ? "Loading album tracks…"
                  : `Open ${rec?.albumTitle ?? "album"} on Spotify`
              : allRuns.length === 0 && !spinsLoading
                ? "No broadcast runs found"
                : `Open run: ${(allRuns[activeRunIdx] ?? allRuns[0])?.showName ?? (allRuns[activeRunIdx] ?? allRuns[0])?.stationName ?? "…"}`
        }
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
          width: 28,
          height: 28,
          borderRadius: "50%",
          background: centerBg,
          border: `1.5px solid ${mode === "ghost" ? "rgba(232,106,78,0.6)" : "var(--wp-border)"}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: centerColor,
          padding: 0,
          cursor: "pointer",
          zIndex: 3,
          transition: "background 0.2s, border-color 0.2s",
        }}
        aria-label={`${mode} mode`}
      >
        {mode === "song" && (
          <span style={{ fontSize: 10, marginLeft: 2, lineHeight: 1 }}>▶</span>
        )}
        {mode === "album" && <VinylIcon size={16} />}
        {mode === "ghost" && <GhostIcon size={15} />}
      </button>
    </div>
  );
}

/* Legacy single-run list — kept for test compatibility, no longer rendered in the default UI. */
function HearInRuns({
  mbid,
  onOpenRun,
}: {
  mbid: string;
  onOpenRun: (slug: string, runId: number | null) => void;
}) {
  const { data, isLoading, isError, refetch } = useWpRecordingSpins(mbid);
  const runs = groupRuns(data?.spins ?? []).slice(0, 6);

  if (isError) {
    return (
      <p
        style={{ margin: "6px 0 2px", fontSize: 12, color: "var(--wp-text-muted)" }}
        data-testid="runs-error"
      >
        Couldn't load run history.{" "}
        <button type="button" onClick={() => void refetch()} style={{ fontSize: 12 }}>
          Try again
        </button>
      </p>
    );
  }
  if (isLoading) {
    return (
      <p
        style={{
          margin: "6px 0 2px",
          fontSize: 12,
          color: "var(--wp-text-muted)",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <Loader2 size={12} className="animate-spin" aria-hidden="true" /> finding runs…
      </p>
    );
  }
  if (runs.length === 0) {
    return (
      <p style={{ margin: "6px 0 2px", fontSize: 12, color: "var(--wp-text-muted)" }}>
        Not aired in any documented run yet.
      </p>
    );
  }
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "6px 0 2px" }}>
      {runs.map((r) => (
        <button
          key={`${r.runId ?? r.slug}-${r.day}`}
          type="button"
          onClick={() => onOpenRun(r.slug, r.runId)}
          style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 5 }}
          data-testid={`hear-run-${r.runId ?? r.slug}`}
        >
          <Radio size={12} aria-hidden="true" />
          {r.showName ?? r.stationName}
          {r.djName ? ` · ${r.djName}` : ""} · {r.day}
        </button>
      ))}
    </div>
  );
}

/** Private note hook — localStorage only, never sent to the server. */
function usePrivateNote(mbid: string | null): [string, (v: string) => void] {
  const key = mbid ? `lore:note:${mbid}` : null;
  const [note, setNoteState] = useState<string>(() => {
    if (!key) return "";
    try { return localStorage.getItem(key) ?? ""; } catch { return ""; }
  });
  useEffect(() => {
    if (!key) return;
    try { setNoteState(localStorage.getItem(key) ?? ""); } catch { /* noop */ }
  }, [key]);
  const setNote = useCallback((v: string) => {
    setNoteState(v);
    if (!key) return;
    try {
      if (v) localStorage.setItem(key, v);
      else localStorage.removeItem(key);
    } catch { /* noop */ }
  }, [key]);
  return [note, setNote];
}

function LibraryRow({
  item,
  loreCounts,
  onOpenLore,
  onOpenRun,
}: {
  item: LibraryItem;
  loreCounts: Map<string, import("./hooks").WpLoreCount> | undefined;
  onOpenLore: (mbid: string) => void;
  onOpenRun: (slug: string, runId: number | null) => void;
}) {
  const rec = item.recording;
  const [note, setNote] = usePrivateNote(item.mbid ?? null);
  const [noteExpanded, setNoteExpanded] = useState(false);

  return (
    <div
      style={{ padding: "8px 14px", borderBottom: "0.5px solid var(--wp-border)" }}
      data-testid={`wp-library-${item.mbid}`}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {rec?.artworkUrl ? (
          <img
            src={proxyArtUrl(rec.artworkUrl)!}
            alt=""
            style={{ width: 36, height: 36, borderRadius: 6, objectFit: "cover", flexShrink: 0 }}
          />
        ) : (
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 6,
              background: "var(--wp-surface-2)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Disc3 size={16} style={{ color: "var(--wp-text-muted)" }} aria-hidden="true" />
          </div>
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={{ margin: 0, fontSize: 14 }}>
            {rec ? `${rec.artist} — ${rec.title}` : (item.mbid ?? "Unknown track")}
          </p>
          {rec?.albumTitle && (
            <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--wp-text-secondary)" }}>
              {rec.albumTitle}
            </p>
          )}
          <p className="wp-mono" style={{ margin: "2px 0 0", fontSize: 11, color: "var(--wp-text-muted)" }}>
            kept {item.addedAt.slice(0, 10)}
            {item.provenance.stationSlug
              ? ` · via ${item.provenance.stationSlug}`
              : item.provenance.service
                ? ` · via ${item.provenance.service}`
                : ""}
          </p>
        </div>
        {item.mbid && (
          <>
            <LoreChip count={loreCounts?.get(item.mbid)} onOpen={() => onOpenLore(item.mbid!)} />
            <PlayModeButton
              mbid={item.mbid}
              rec={rec}
              onOpenRun={onOpenRun}
              data-testid={`hear-in-runs-${item.mbid}`}
            />
          </>
        )}
      </div>
      {/* Private note — localStorage only, never sent to the server */}
      {item.mbid && (
        <div style={{ marginTop: 4 }}>
          <button
            type="button"
            onClick={() => setNoteExpanded((v) => !v)}
            aria-expanded={noteExpanded}
            aria-label={noteExpanded ? "Hide private note" : "Add private note"}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "2px 0",
              fontSize: 11,
              color: note
                ? "var(--wp-text-secondary)"
                : "var(--wp-text-muted)",
              display: "flex",
              alignItems: "center",
              gap: 4,
              opacity: note || noteExpanded ? 1 : 0.5,
            }}
            data-testid={`library-note-toggle-${item.mbid}`}
          >
            🔒 {note ? "private note" : "add private note"}
          </button>
          {noteExpanded && (
            <textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="a private thought about this track…"
              data-testid={`library-note-input-${item.mbid}`}
              style={{
                width: "100%",
                marginTop: 4,
                resize: "none",
                background: "var(--wp-surface-2)",
                border: "0.5px solid var(--wp-border)",
                borderRadius: 8,
                padding: "6px 8px",
                fontSize: 13,
                fontStyle: "italic",
                color: "var(--wp-text-secondary)",
                fontFamily: "inherit",
                lineHeight: 1.6,
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * One page of library rows. Isolated as a component so each page batches its
 * own lore-counts request (≤ page size MBIDs) instead of capping chips at the
 * first N items overall.
 */
function LibraryPage({
  items,
  onOpenLore,
  onOpenRun,
}: {
  items: LibraryItem[];
  onOpenLore: (mbid: string) => void;
  onOpenRun: (slug: string, runId: number | null) => void;
}) {
  const { data: loreCounts } = useWpLoreCounts(items.flatMap((i) => i.mbid ? [i.mbid] : []));
  return (
    <>
      {items.map((item) => (
        <LibraryRow
          key={item.mbid ?? item.spotifyId ?? item.addedAt}
          item={item}
          loreCounts={loreCounts}
          onOpenLore={onOpenLore}
          onOpenRun={onOpenRun}
        />
      ))}
    </>
  );
}

/**
 * Library tab — the user's kept/imported tracks with lore chips and a
 * "Hear in runs" expander that lists documented runs containing each
 * recording; tapping one opens that run's drawer. Pages load automatically
 * as you scroll (with a manual Load more fallback).
 */
export function LibraryTab({
  onOpenLore,
  onOpenRun,
}: {
  onOpenLore: (mbid: string) => void;
  onOpenRun: (slug: string, runId: number | null) => void;
}) {
  const isAuthenticated = useIsAuthenticated();
  const queryClient = useQueryClient();

  // Apple Music config — if the server has a developer token, show the import.
  const { data: appConfig } = useAppConfig();
  const appleMusicConfigured = Boolean(appConfig?.appleMusic?.developerToken ?? null);

  // Apple Music library import local state.
  const [amImporting, setAmImporting] = useState(false);
  const [amImportProgress, setAmImportProgress] = useState<{
    received: number;
    total: number | null;
    resolved: number;
  } | null>(null);
  const [amImportDone, setAmImportDone] = useState(false);
  const [amImportError, setAmImportError] = useState<string | null>(null);

  const handleAppleMusicImport = useCallback(async () => {
    // Access MusicKit instance (initialized by the Apple Music driver).
    const mk = (window as unknown as Record<string, unknown>).MusicKit;
    if (!mk || typeof (mk as { getInstance?: () => { isAuthorized?: boolean; api?: unknown } }).getInstance !== "function") {
      setAmImportError("Apple Music not available — connect it from the player first.");
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const instance = (mk as any).getInstance() as {
      isAuthorized?: boolean;
      api?: {
        music?: (
          path: string,
          opts?: { limit?: number; offset?: number },
        ) => Promise<{
          data: {
            data?: Array<{
              id: string;
              attributes?: {
                name?: string;
                artistName?: string;
                albumName?: string;
                artwork?: { url?: string };
                isrc?: string;
              };
            }>;
          };
        }>;
      };
    };
    if (!instance.isAuthorized) {
      setAmImportError("Authorize Apple Music first by playing a track.");
      return;
    }

    setAmImporting(true);
    setAmImportDone(false);
    setAmImportError(null);
    setAmImportProgress({ received: 0, total: null, resolved: 0 });

    try {
      const limit = 100;
      let offset = 0;
      let total: number | null = null;
      let received = 0;
      let resolved = 0;

      // Track whether the loop ended normally (reached last page) vs. via error.
      let fetchError: Error | null = null;

      while (true) {
        // Fetch a page of library songs via MusicKit JS.
        let page: { data: { data?: Array<{ id: string; attributes?: { name?: string; artistName?: string; albumName?: string; artwork?: { url?: string }; isrc?: string } }> } };
        try {
          page = await instance.api!.music!("/v1/me/library/songs", { limit, offset });
        } catch (e) {
          // MusicKit API error — abort the import with an error state.
          // Do NOT treat this as a natural end-of-library: the user would
          // see "done" when the import is actually incomplete.
          fetchError = e instanceof Error ? e : new Error("MusicKit API error");
          break;
        }

        const songs = page.data.data ?? [];

        // Empty page = confirmed end of library.
        if (songs.length === 0) break;

        // Build batch payload.
        const batch = songs.map((s) => ({
          appleId: s.id,
          title: s.attributes?.name ?? "",
          artist: s.attributes?.artistName ?? "",
          albumName: s.attributes?.albumName ?? null,
          artworkUrl: s.attributes?.artwork?.url?.replace("{w}x{h}", "300x300") ?? null,
          isrc: s.attributes?.isrc ?? null,
        }));

        // POST batch to server.
        const res = await fetch("/api/me/apple-library-import", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ songs: batch }),
        });
        if (res.ok) {
          const json = await res.json() as { inserted?: number; resolved?: number };
          received += songs.length;
          resolved += json.resolved ?? 0;
          setAmImportProgress({ received, total, resolved });
        } else {
          // Server-side error posting this batch — abort with error.
          fetchError = new Error(`Server error ${res.status} while importing batch`);
          break;
        }

        offset += limit;
        // songs.length < limit = last page (Apple returns shorter final pages).
        if (songs.length < limit) break;
      }

      if (fetchError) {
        // A fetch/server error occurred — report it rather than marking done.
        setAmImportError(fetchError.message);
      } else {
        setAmImportDone(true);
        setAmImportProgress({ received, total, resolved });
      }
    } catch (err) {
      setAmImportError(err instanceof Error ? err.message : "Import failed — please try again.");
    } finally {
      setAmImporting(false);
    }
  }, []);

  // Sync state
  const { data: syncJobData } = useLatestSyncJob();
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncNeedsReconnect, setSyncNeedsReconnect] = useState(false);
  const [reconnectBusy, setReconnectBusy] = useState(false);
  const [syncReceiptOpen, setSyncReceiptOpen] = useState(false);
  const isSyncActive = syncJobData?.status === "pending" || syncJobData?.status === "running";

  const handleSync = async () => {
    setSyncBusy(true);
    setSyncError(null);
    setSyncNeedsReconnect(false);
    try {
      await postStartSync("spotify");
      void queryClient.invalidateQueries({ queryKey: ME_LATEST_SYNC_JOB_KEY });
    } catch (err) {
      const isCanWriteError =
        err instanceof ApiError &&
        err.data &&
        typeof err.data === "object" &&
        "error" in err.data &&
        (err.data as { error: string }).error === "canWrite:false";
      if (isCanWriteError) {
        setSyncNeedsReconnect(true);
        setSyncError("Your Spotify connection doesn't have write access.");
      } else {
        const msg =
          err instanceof ApiError && err.data && typeof err.data === "object" && "error" in err.data
            ? String((err.data as { error: unknown }).error)
            : "Sync failed. Try again.";
        setSyncError(msg);
      }
    } finally {
      setSyncBusy(false);
    }
  };

  const handleReconnect = async () => {
    setReconnectBusy(true);
    try {
      await startSpotifyLibraryReconnect();
    } finally {
      setReconnectBusy(false);
    }
  };

  const importFileRef = useRef<HTMLInputElement | null>(null);
  const [importingFile, setImportingFile] = useState(false);
  const [fileImportSummary, setFileImportSummary] = useState<FileImportSummary | null>(null);
  const [fileImportError, setFileImportError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [sort, setSort] = useState<NonNullable<LibraryQueryOptions["sort"]>>("added");
  const [source, setSource] = useState<NonNullable<LibraryQueryOptions["source"]>>("");

  // Debounce search input so we don't refetch on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const handleImportFile = async (file: File) => {
    setImportingFile(true);
    setFileImportError(null);
    setFileImportSummary(null);
    try {
      let body: unknown;
      try {
        body = JSON.parse(await file.text());
      } catch {
        setFileImportError("That file isn't valid JSON.");
        return;
      }
      const summary = await postImportLibraryFile(body);
      setFileImportSummary(summary);
      void queryClient.invalidateQueries({ queryKey: ["me", "library"] });
    } catch (err) {
      const msg =
        err instanceof ApiError && err.data && typeof err.data === "object" && "error" in err.data
          ? String((err.data as { error: unknown }).error)
          : "Import failed. Try again.";
      setFileImportError(msg);
    } finally {
      setImportingFile(false);
    }
  };

  const hasFilters = debouncedQ !== "" || sort !== "added" || source !== "";
  const {
    data,
    isLoading,
    isFetching,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useMyLibraryInfinite({ q: debouncedQ, sort, source });
  const pages = data?.pages ?? [];
  const totalLoaded = pages.reduce((n, p) => n + p.items.length, 0);

  // Auto-load the next page when the sentinel scrolls into view.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !isFetchingNextPage) {
          void fetchNextPage();
        }
      },
      { rootMargin: "300px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (isAuthenticated === false) {
    return (
      <div className="wp-card" style={{ padding: "18px 16px", textAlign: "center" }}>
        <p style={{ margin: "0 0 10px", fontSize: 14, color: "var(--wp-text-secondary)" }}>
          Connect Spotify to see your kept and imported tracks here — with their
          lore and the runs they aired in.
        </p>
        <button
          type="button"
          onClick={() => void startSpotifyLibraryConnect()}
          style={{
            background: "var(--wp-fill-primary)",
            color: "var(--wp-on-primary)",
            border: "none",
            fontSize: 13,
            padding: "8px 16px",
          }}
          data-testid="wp-library-connect"
        >
          Connect Spotify
        </button>
      </div>
    );
  }

  const selectStyle: CSSProperties = {
    fontSize: 12,
    background: "var(--wp-surface-2)",
    color: "var(--wp-text-secondary)",
    border: "0.5px solid var(--wp-border)",
    borderRadius: 6,
    padding: "5px 6px",
  };

  return (
    <div className="wp-card" style={{ overflow: "hidden" }} data-testid="wp-library-tab">
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 8,
          padding: "10px 14px",
          borderBottom: "0.5px solid var(--wp-border)",
        }}
        data-testid="wp-library-controls"
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            flex: "1 1 160px",
            minWidth: 140,
            background: "var(--wp-surface-2)",
            border: "0.5px solid var(--wp-border)",
            borderRadius: 6,
            padding: "5px 8px",
          }}
        >
          <Search size={13} style={{ color: "var(--wp-text-muted)", flexShrink: 0 }} aria-hidden="true" />
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search title or artist…"
            aria-label="Search library"
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 13,
              background: "transparent",
              border: "none",
              outline: "none",
              color: "var(--wp-text)",
            }}
            data-testid="wp-library-search"
          />
          {searchInput !== "" && (
            <button
              type="button"
              onClick={() => setSearchInput("")}
              aria-label="Clear search"
              style={{
                display: "inline-flex",
                alignItems: "center",
                background: "transparent",
                border: "none",
                padding: 0,
                color: "var(--wp-text-muted)",
                cursor: "pointer",
              }}
              data-testid="wp-library-search-clear"
            >
              <X size={13} aria-hidden="true" />
            </button>
          )}
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as typeof sort)}
          aria-label="Sort library"
          style={selectStyle}
          data-testid="wp-library-sort"
        >
          <option value="added">Recently added</option>
          <option value="artist">Artist A–Z</option>
          <option value="title">Title A–Z</option>
        </select>
        <select
          value={source}
          onChange={(e) => setSource(e.target.value as typeof source)}
          aria-label="Filter by source"
          style={selectStyle}
          data-testid="wp-library-source"
        >
          <option value="">All sources</option>
          <option value="keep">Kept here</option>
          <option value="import">Imported</option>
        </select>
        {isFetching && !isLoading && !isFetchingNextPage && (
          <Loader2
            size={13}
            className="animate-spin"
            style={{ color: "var(--wp-text-muted)", flexShrink: 0 }}
            aria-label="Updating results"
          />
        )}
      </div>
      {isLoading && (
        <p style={{ padding: "14px 16px", margin: 0, fontSize: 13, color: "var(--wp-text-muted)" }}>
          Loading your library…
        </p>
      )}
      {!isLoading && totalLoaded === 0 && (
        <p
          style={{ padding: "14px 16px", margin: 0, fontSize: 13, color: "var(--wp-text-muted)" }}
          data-testid="wp-library-empty"
        >
          {hasFilters
            ? "No tracks match — try a different search or filter."
            : "Nothing kept yet — keep a track from the on-air list or import your Spotify library."}
        </p>
      )}
      {pages.map((page, i) => (
        <LibraryPage
          key={i}
          items={page.items}
          onOpenLore={onOpenLore}
          onOpenRun={onOpenRun}
        />
      ))}
      {hasNextPage && <div ref={sentinelRef} aria-hidden="true" style={{ height: 1 }} />}
      {isFetchingNextPage && (
        <div
          style={{
            padding: "10px 16px",
            display: "flex",
            alignItems: "center",
            gap: 8,
            borderTop: "0.5px solid var(--wp-border)",
          }}
          aria-live="polite"
          aria-label="Loading more tracks"
        >
          <Loader2
            size={13}
            className="animate-spin"
            style={{ color: "var(--wp-text-muted)", flexShrink: 0 }}
            aria-hidden="true"
          />
          <span style={{ fontSize: 12, color: "var(--wp-text-muted)" }}>Loading more tracks…</span>
        </div>
      )}
      {totalLoaded > 0 && !isFetchingNextPage && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            padding: "12px 16px",
          }}
          data-testid="wp-library-footer"
        >
          {hasNextPage ? (
            <button
              type="button"
              onClick={() => void fetchNextPage()}
              disabled={isFetchingNextPage}
              style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6 }}
              data-testid="wp-library-load-more"
            >
              Load more
            </button>
          ) : (
            <p className="wp-mono" style={{ margin: 0, fontSize: 11, color: "var(--wp-text-muted)" }}>
              that's everything · {totalLoaded} tracks
            </p>
          )}
          {hasNextPage && (
            <p className="wp-mono" style={{ margin: 0, fontSize: 11, color: "var(--wp-text-muted)" }}>
              {totalLoaded} loaded
            </p>
          )}
        </div>
      )}
      {isAuthenticated && (
        <div
          style={{ padding: "12px 16px", borderTop: "0.5px solid var(--wp-border)" }}
          data-testid="wp-library-export"
        >
          <p className="wp-mono" style={{ margin: "0 0 8px", fontSize: 11, color: "var(--wp-text-muted)" }}>
            take it with you — fields we don't have export empty, never guessed
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {(["csv", "json", "m3u8", "txt"] as const).map((fmt) => (
              <a
                key={fmt}
                href={`/api/me/library/export?format=${fmt}`}
                download
                className="wp-mono"
                style={{
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  color: "var(--wp-text-secondary)",
                  border: "0.5px solid var(--wp-border)",
                  borderRadius: 999,
                  padding: "5px 12px",
                  textDecoration: "none",
                }}
                data-testid={`wp-library-export-${fmt}`}
              >
                {fmt}
              </a>
            ))}
          </div>
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: "0.5px solid var(--wp-border)" }} data-testid="wp-library-import-file">
            <input
              ref={importFileRef}
              type="file"
              accept="application/json,.json"
              style={{ display: "none" }}
              data-testid="wp-library-import-file-input"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleImportFile(file);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              disabled={importingFile}
              onClick={() => importFileRef.current?.click()}
              className="wp-mono"
              style={{
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                color: "var(--wp-text-secondary)",
                background: "none",
                border: "0.5px solid var(--wp-border)",
                borderRadius: 999,
                padding: "5px 12px",
                cursor: importingFile ? "default" : "pointer",
                opacity: importingFile ? 0.5 : 1,
              }}
              data-testid="wp-library-import-file-button"
            >
              {importingFile ? "importing…" : "import json file"}
            </button>
            {fileImportError && (
              <p className="wp-mono" style={{ margin: "8px 0 0", fontSize: 11, color: "var(--wp-danger, #c0605f)" }} data-testid="wp-library-import-file-error">
                {fileImportError}
              </p>
            )}
            {fileImportSummary && (
              <p className="wp-mono" style={{ margin: "8px 0 0", fontSize: 11, color: "var(--wp-text-muted)" }} data-testid="wp-library-import-file-summary">
                imported {fileImportSummary.imported} · skipped {fileImportSummary.skipped} · rejected {fileImportSummary.rejected}
                {fileImportSummary.errors.length > 0 &&
                  ` — first issue: item ${fileImportSummary.errors[0].index + 1}: ${fileImportSummary.errors[0].reason}`}
              </p>
            )}
          </div>
          {/* Sync to Spotify */}
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: "0.5px solid var(--wp-border)" }} data-testid="wp-library-sync">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <div style={{ minWidth: 0 }}>
                <p className="wp-mono" style={{ margin: 0, fontSize: 11, color: "var(--wp-text-secondary)", fontWeight: 500 }}>sync to spotify</p>
                <p className="wp-mono" style={{ margin: "2px 0 0", fontSize: 11, color: "var(--wp-text-muted)" }}>
                  push kept tracks · unavailable ones get a Bandcamp link
                </p>
              </div>
              <button
                type="button"
                disabled={syncBusy || isSyncActive}
                onClick={() => void handleSync()}
                className="wp-mono"
                style={{
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  color: "var(--wp-text-secondary)",
                  background: "none",
                  border: "0.5px solid var(--wp-border)",
                  borderRadius: 999,
                  padding: "5px 12px",
                  cursor: syncBusy || isSyncActive ? "default" : "pointer",
                  opacity: syncBusy || isSyncActive ? 0.5 : 1,
                  flexShrink: 0,
                }}
                data-testid="wp-library-sync-button"
              >
                {isSyncActive ? "syncing…" : "sync now"}
              </button>
            </div>

            {syncError && (
              <div style={{ margin: "8px 0 0" }} data-testid="wp-library-sync-error">
                <p className="wp-mono" style={{ margin: 0, fontSize: 11, color: "var(--wp-danger, #c0605f)" }}>
                  {syncError}
                </p>
                {syncNeedsReconnect && (
                  <button
                    type="button"
                    onClick={() => void handleReconnect()}
                    disabled={reconnectBusy}
                    className="wp-mono"
                    style={{
                      marginTop: 6,
                      fontSize: 11,
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                      color: "var(--wp-text-secondary)",
                      background: "none",
                      border: "0.5px solid var(--wp-border)",
                      borderRadius: 999,
                      padding: "5px 12px",
                      cursor: reconnectBusy ? "default" : "pointer",
                      opacity: reconnectBusy ? 0.5 : 1,
                    }}
                    data-testid="wp-library-reconnect-spotify"
                  >
                    {reconnectBusy ? "opening…" : "reconnect spotify"}
                  </button>
                )}
              </div>
            )}

            {/* Active progress */}
            {isSyncActive && syncJobData && (
              <div style={{ marginTop: 8 }} data-testid="wp-library-sync-progress">
                <p className="wp-mono" style={{ margin: 0, fontSize: 11, color: "var(--wp-text-muted)" }}>
                  {syncJobData.phase === "matching" && "matching tracks…"}
                  {syncJobData.phase === "checking" && "checking already saved…"}
                  {syncJobData.phase === "saving" && "saving to spotify…"}
                  {!syncJobData.phase && "preparing…"}
                  {syncJobData.total > 0 && ` ${syncJobData.processed}/${syncJobData.total}`}
                </p>
                {syncJobData.total > 0 && (
                  <div style={{ marginTop: 4, height: 2, background: "var(--wp-border)", borderRadius: 1, overflow: "hidden" }}>
                    <div style={{ height: "100%", background: "var(--wp-green, #C6F53F)", borderRadius: 1, width: `${Math.min(100, (syncJobData.processed / syncJobData.total) * 100)}%`, transition: "width 0.4s" }} />
                  </div>
                )}
              </div>
            )}

            {/* Receipt */}
            {syncJobData?.status === "done" && syncJobData.results && (
              <div style={{ marginTop: 8 }} data-testid="wp-library-sync-receipt">
                <p className="wp-mono" style={{ margin: 0, fontSize: 11, color: "var(--wp-text-muted)" }}>
                  {syncJobData.results.synced} synced
                  {syncJobData.results.searchMatched > 0 && ` · ${syncJobData.results.searchMatched} by search`}
                  {syncJobData.results.alreadySaved > 0 && ` · ${syncJobData.results.alreadySaved} already saved`}
                  {syncJobData.results.unavailable > 0 && ` · ${syncJobData.results.unavailable} not on spotify`}
                </p>
                {syncJobData.results.unavailableItems.length > 0 && (
                  <>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 6 }}>
                      <button
                        type="button"
                        onClick={() => setSyncReceiptOpen((v) => !v)}
                        className="wp-mono"
                        style={{ fontSize: 11, color: "var(--wp-text-muted)", background: "none", border: "none", padding: 0, cursor: "pointer" }}
                        data-testid="wp-library-sync-receipt-toggle"
                      >
                        {syncReceiptOpen ? "▲ hide" : "▼ not on spotify"}
                      </button>
                      {syncJobData.results.unavailable > 200 && (
                        <a
                          href={`/api/me/library/sync/${syncJobData.jobId}/unavailable?format=csv`}
                          download
                          className="wp-mono"
                          style={{ fontSize: 11, color: "var(--wp-text-muted)", flexShrink: 0, textDecoration: "none" }}
                          data-testid="wp-library-sync-unavailable-download"
                        >
                          download full list ↓
                        </a>
                      )}
                    </div>
                    {syncReceiptOpen && (
                      <ul style={{ margin: "6px 0 0", padding: 0, listStyle: "none" }}>
                        {syncJobData.results.unavailableItems.slice(0, 20).map((item) => (
                          <li key={item.mbid} style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
                            <span className="wp-mono" style={{ fontSize: 11, color: "var(--wp-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {item.artist} — {item.title}
                            </span>
                            <a
                              href={item.bandcampUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="wp-mono"
                              style={{ fontSize: 11, color: "var(--wp-text-muted)", flexShrink: 0, textDecoration: "none" }}
                            >
                              bandcamp ↗
                            </a>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
                {syncJobData.results.searchMatchedItems.length > 0 && (
                  <div style={{ marginTop: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      <p className="wp-mono" style={{ margin: 0, fontSize: 11, color: "var(--wp-text-muted)" }}>
                        matched by search
                      </p>
                      {syncJobData.results.searchMatched > 200 && (
                        <a
                          href={`/api/me/library/sync/${syncJobData.jobId}/search-matched?format=csv`}
                          download
                          className="wp-mono"
                          style={{ fontSize: 11, color: "var(--wp-text-muted)", flexShrink: 0, textDecoration: "none" }}
                          data-testid="wp-library-sync-search-matched-download"
                        >
                          download full list ↓
                        </a>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {syncJobData?.status === "error" && (
              <div style={{ margin: "8px 0 0" }} data-testid="wp-library-sync-job-error">
                <p className="wp-mono" style={{ margin: 0, fontSize: 11, color: "var(--wp-danger, #c0605f)" }}>
                  {syncJobData.error ?? "sync failed — please try again"}
                </p>
                {syncJobData.error?.toLowerCase().includes("reconnect spotify") ? (
                  <button
                    type="button"
                    onClick={() => void handleReconnect()}
                    disabled={reconnectBusy}
                    className="wp-mono"
                    style={{
                      marginTop: 6,
                      fontSize: 11,
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                      color: "var(--wp-text-secondary)",
                      background: "none",
                      border: "0.5px solid var(--wp-border)",
                      borderRadius: 999,
                      padding: "5px 12px",
                      cursor: reconnectBusy ? "default" : "pointer",
                      opacity: reconnectBusy ? 0.5 : 1,
                    }}
                    data-testid="wp-library-reconnect-spotify"
                  >
                    {reconnectBusy ? "opening…" : "reconnect spotify"}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleSync()}
                    disabled={syncBusy || isSyncActive}
                    className="wp-mono"
                    style={{
                      marginTop: 6,
                      fontSize: 11,
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                      color: "var(--wp-text-secondary)",
                      background: "none",
                      border: "0.5px solid var(--wp-border)",
                      borderRadius: 999,
                      padding: "5px 12px",
                      cursor: syncBusy || isSyncActive ? "default" : "pointer",
                      opacity: syncBusy || isSyncActive ? 0.5 : 1,
                    }}
                    data-testid="wp-library-sync-again"
                  >
                    try again
                  </button>
                )}
              </div>
            )}
          </div>

          <p className="wp-mono" style={{ margin: "8px 0 0", fontSize: 11, color: "var(--wp-text-muted)" }}>
            move to another service via{" "}
            <a href="https://soundiiz.com" target="_blank" rel="noreferrer" style={{ color: "inherit" }}>
              Soundiiz
            </a>{" "}
            or{" "}
            <a href="https://www.tunemymusic.com" target="_blank" rel="noreferrer" style={{ color: "inherit" }}>
              TuneMyMusic
            </a>
          </p>

          {/* Apple Music library import */}
          {appleMusicConfigured && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: "0.5px solid var(--wp-border)" }} data-testid="wp-apple-library-import">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <p className="wp-mono" style={{ margin: 0, fontSize: 11, color: "var(--wp-text-secondary)", fontWeight: 500 }}>import apple music library</p>
                  <p className="wp-mono" style={{ margin: "2px 0 0", fontSize: 11, color: "var(--wp-text-muted)" }}>
                    authorize apple music first, then import · matched tracks appear in your library
                  </p>
                </div>
                <button
                  type="button"
                  disabled={amImporting}
                  onClick={() => void handleAppleMusicImport()}
                  className="wp-mono"
                  style={{
                    fontSize: 11,
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                    color: "var(--wp-text-secondary)",
                    background: "none",
                    border: "0.5px solid var(--wp-border)",
                    borderRadius: 999,
                    padding: "5px 12px",
                    cursor: amImporting ? "default" : "pointer",
                    opacity: amImporting ? 0.5 : 1,
                    flexShrink: 0,
                  }}
                  data-testid="wp-apple-library-import-button"
                >
                  {amImporting ? "importing…" : "import now"}
                </button>
              </div>
              {/* Progress bar */}
              {amImporting && amImportProgress && (
                <div style={{ marginTop: 8 }}>
                  <p className="wp-mono" style={{ margin: "0 0 4px", fontSize: 11, color: "var(--wp-text-muted)" }}>
                    {amImportProgress.received} songs received · {amImportProgress.resolved} matched
                  </p>
                  <div style={{ height: 2, background: "var(--wp-border)", borderRadius: 1 }}>
                    {amImportProgress.total && amImportProgress.total > 0 && (
                      <div style={{ height: "100%", background: "var(--wp-green, #C6F53F)", borderRadius: 1, width: `${Math.min(100, (amImportProgress.received / amImportProgress.total) * 100)}%`, transition: "width 0.4s" }} />
                    )}
                  </div>
                </div>
              )}
              {/* Done state */}
              {amImportDone && amImportProgress && !amImporting && (
                <p className="wp-mono" style={{ margin: "8px 0 0", fontSize: 11, color: "var(--wp-text-muted)" }} data-testid="wp-apple-library-import-done">
                  {amImportProgress.received} songs scanned · {amImportProgress.resolved} matched to recordings
                </p>
              )}
              {/* Error state */}
              {amImportError && (
                <p className="wp-mono" style={{ margin: "8px 0 0", fontSize: 11, color: "var(--wp-danger, #c0605f)" }} data-testid="wp-apple-library-import-error">
                  {amImportError}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
