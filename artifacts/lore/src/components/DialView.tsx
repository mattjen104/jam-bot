/**
 * DialView — the Dial Radio timeline.
 *
 * Manages a level state machine (all → station → show → dj) and renders the
 * appropriate view at each level. The bottom pill-nav (Radio · Selectors ·
 * Library) lives in AppLayout; DialView renders the topbar/scanbar/subnav
 * chrome above the scroll body.
 */
import { useState, useEffect, useRef, useCallback, useMemo, type ReactNode } from "react";
import { Download, Play, X } from "lucide-react";
import { useLocation } from "wouter";
import { useMyGhostMissed, useSpotifyLibraryConnected, useMyTasteSeeds, useSetTasteSeeds, useMattStarterLibrary, useStartMattLibrary, useMyWeeklyRecap, useMyAlbumAvatar, useMyPopularCrossings, useMyOverlapRunsFor, useMyOverlapRunsRecent, useMyRunCrossings, type GhostStation, type OverlapRun, type RunCrossingMoment } from "../lib/meHooks";
import { useGetStationNowPlaying, getGetStationNowPlayingQueryKey, type Station } from "@workspace/api-client-react";
import { useFrontDoorScan } from "../hooks/useFrontDoorScan";
import { resolvePlaybackSource } from "../hooks/useRadioPlayer";
import { ContextRail, artistFrameId, decodeArtistFrame } from "./ContextRail";
import { SearchOverlay } from "./SearchOverlay";
import { usePlayer, type RideSeed } from "../player/PlayerProvider";
import { AlbumAvatarPicker } from "./AlbumAvatarPicker";
import { RUMOURS, onArtError } from "../lib/rumours";
import { useSocialMode } from "../lib/social";
import { useSleepMode } from "../lib/sleepMode";
import { useEraGenreMode } from "../lib/eraGenreMode";
import { eligibleDjNames } from "@workspace/lore-attribution";
import { DialFilterBar, type StationCategory } from "./dial/DialFilterBar";
import { type AgeTier } from "../lib/dialAgeFilter";
import { toggleAgeTier, toggleStationCategory } from "../lib/dialFilterState";
import {
  cleanLiveValue,
  nameNodes,
  reason,
  usableShowName,
  buildAttributedSentence,
  dialShowAsAttribution,
  classifySetTimeContext,
  type SetDaypart,
} from "./dialViewHelpers";
import { proxyArtUrl } from "../lib/proxyArt";
import { useDialSurface } from "../dial/useDialSurface";
import { DialContextRegion } from "../dial/DialContextRegion";
import { railHasRealContent } from "../dial/railContent";
import { contextStationSlug } from "../dial/dialContext";
import { heroArtCandidates } from "../lib/artRes";
import { runDate, clockTime } from "../lib/format";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
import {
  useDialData,
  readPins,
  normalizeDjName,
  liveIdentityKey,
  type DialStation,
  type DialShow,
  type DialSpin,
  type LiveArtistSuggestion,
  type OnboardingArtistSuggestion,
  type DialDisplayMode,
} from "../hooks/useDialData";
import { useStationPresence } from "../hooks/useStationPresence";
import {
  FrontDoorRow,
  PopCrossingLine,
  SetQueueList,
  agoLabel,
  type QueueArtist,
} from "./dial/FrontDoorRow";
import { DialFeedLane, type DialLaneRow } from "./dial/DialFeedLane";
import { FirstRunSidebar } from "./FirstRunSidebar";
import { Zone2Lane } from "./dial/Zone2Lane";
import {
  findRunIndexByHour,
  useSwipeHandler,
  usePastScanState,
} from "../hooks/useDialNavigation";

// Re-exports — these lived in DialView.tsx before the decomposition; external
// imports (tests included) continue to resolve through this module.
export { FrontDoorRow, PopCrossingLine, SetQueueList, type QueueArtist };
export { findRunIndexByHour, useSwipeHandler, usePastScanState };
/**
 * Returns a version of `value` that only flips to `true` after it has been
 * `true` continuously for `delayMs` milliseconds.  Flipping back to `false`
 * is immediate, so skeleton rows vanish the instant real data arrives.
 *
 * Usage: avoids a jarring flash of skeleton rows on fast connections where
 * the loading state resolves in under ~150 ms.
 *
 * The return expression is `value && delayed` (not just `delayed`) to close a
 * subtle race: `useEffect` runs after the render, so when `value` flips false
 * there is one render where the state variable `delayed` is still `true`.
 * Without the `value &&` guard that render would emit `showSkeleton=true` while
 * `!crossingsLoading` is already `true`, causing skeleton rows and real zone
 * rows to coexist for one frame.
 */
function useDelayedBoolean(value: boolean, delayMs = 150): boolean {
  const [delayed, setDelayed] = useState(false);
  useEffect(() => {
    if (!value) return;
    const id = setTimeout(() => setDelayed(true), delayMs);
    // Clearing `delayed` on teardown (rather than synchronously in the effect
    // body) resets it for the next `value=true` window without a
    // setState-in-effect. The `value && delayed` return already suppresses the
    // stale-true frame while this cleanup is pending.
    return () => {
      clearTimeout(id);
      setDelayed(false);
    };
  }, [value, delayMs]);
  // Short-circuit: when value is false, always return false regardless of the
  // pending effect clearing `delayed`.  This prevents a one-frame coexistence
  // of skeleton rows and real content when crossingsLoading flips false.
  return value && delayed;
}

function _todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtHM(iso: string, timeZone?: string | null): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      ...(timeZone ? { timeZone } : {}),
    }).formatToParts(d);
    const value = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value ?? "";
    return `${value("hour")}:${value("minute")}${value("dayPeriod").toLowerCase()}`;
  } catch {
    return fmtHM(iso);
  }
}
type Level = "all" | "station" | "show" | "dj";
/** Cap on setlist names shown before the "N more" expand affordance. */
const _SETLIST_VISIBLE = 8;

export type DialHeroQueueLayout = "side" | "below";

/**
 * Pick the arrangement that leaves the largest square for the album art.
 *
 * The art region is the part of a landscape viewport reserved for the hero;
 * the dial column is not allowed to shrink below its readable width.  The
 * queue dimensions are conservative estimates used only for choosing a mode;
 * the queue itself remains independently scrollable in either arrangement.
 */
export function chooseDialHeroQueueLayout({
  viewportWidth,
  viewportHeight,
  shellHeight,
  queueWidth = Math.min(360, viewportWidth * 0.3),
  queueHeight = 220,
  dialColumnWidth = viewportWidth >= 1100
    ? Math.min(540, Math.max(380, viewportWidth * 0.32))
    : 300,
}: {
  viewportWidth: number;
  viewportHeight: number;
  shellHeight: number;
  queueWidth?: number;
  queueHeight?: number;
  dialColumnWidth?: number;
}): DialHeroQueueLayout {
  const availableHeight = Math.max(0, viewportHeight - shellHeight);
  const artRegionWidth = Math.max(0, viewportWidth - dialColumnWidth);
  const sideSquare = Math.min(availableHeight, Math.max(0, artRegionWidth - queueWidth));
  const belowSquare = Math.min(artRegionWidth, Math.max(0, availableHeight - queueHeight));
  return sideSquare >= belowSquare ? "side" : "below";
}
/**
 * Compute the set-panel snapshot for a live station row.
 * Pure function — exported so it can be tested independently of the component.
 * `listedArtists` (from the crossing popMap) takes precedence over spin-derived
 * artists when provided, matching the behaviour of `openLiveQueue`.
 */
export function computeLivePanel(
  row: { ds: DialStation; show: DialShow | null },
  listedArtists?: Array<{ name: string; inLibrary: boolean }> | null,
): { slug: string; stationName: string; startedAt: string; artists: QueueArtist[]; progress: number } {
  const spins = row.show?.spins ?? [];
  const spinArtists = spins
    .map((spin) => ({ name: spin.artist, inLibrary: spin.isLibraryHit || spin.isArtistHit, title: spin.title || null }))
    .filter((a) => a.name.trim());
  const artists = listedArtists?.length
    ? listedArtists.map((a) => ({ name: a.name, inLibrary: a.inLibrary }))
    : spinArtists;
  const currentIndex = Math.max(0, spins.findIndex((spin) =>
    spin.playedAt === row.show?.currentTrack?.playedAt,
  ));
  return {
    slug: row.ds.station.slug,
    stationName: row.ds.station.name,
    startedAt: row.show?.startedAt ?? new Date().toISOString(),
    artists,
    progress: artists.length > 0 ? Math.min(1, (currentIndex + 1) / artists.length) : 0,
  };
}

/**
 * Keeps an open live-set panel's progress in sync with live now-playing data.
 *
 * Exported so it can be tested in isolation via a thin wrapper component.
 *
 * Call with the full set of live rows (`sortedRows`, not just Zone 1) so that
 * stations that shift zones — or that were opened from Zone 3 — are covered.
 * Replay panels (slug === "replay") are driven by the ride effect and are
 * intentionally skipped here.
 *
 * The internal ref prevents `panel` from appearing in the sync-effect's dep
 * array, which would cause a write→re-run→write loop.
 */
export function useLivePanelSync(
  panel: { slug: string; artists: QueueArtist[] } | null,
  liveRows: Array<{ ds: DialStation; show: DialShow | null }>,
  onProgress: (progress: number) => void,
): void {
  // Stable refs — updated every render so the effect always sees current values
  // without needing them as explicit deps.
  const panelRef = useRef(panel);
  useEffect(() => { panelRef.current = panel; }, [panel]);
  const onProgressRef = useRef(onProgress);
  useEffect(() => { onProgressRef.current = onProgress; }, [onProgress]);

  useEffect(() => {
    const p = panelRef.current;
    if (!p || p.slug === "replay") return;
    const row = liveRows.find((r) => r.ds.station.slug === p.slug);
    if (!row) return;
    const spins = row.show?.spins ?? [];
    const currentIndex = Math.max(0, spins.findIndex((s) =>
      s.playedAt === row.show?.currentTrack?.playedAt,
    ));
    const progress = p.artists.length > 0
      ? Math.min(1, (currentIndex + 1) / p.artists.length)
      : 0;
    onProgressRef.current(progress);
  }, [liveRows]);
}

/** A complete broadcast run retained by the set-panel tab model. */
export interface SetPanelSet {
  id: string;
  /** Archive run id when known — the set's canonical /archive/station-runs
   * route is built from THIS, never from the currently-tuned show. */
  runId: number | string | null;
  stationSlug: string;
  stationName: string;
  startedAt: string;
  /** Station-local IANA timezone the set aired in — clock labels must render
   * in this zone, never the listener's. */
  ianaTimezone: string | null;
  showName: string | null;
  /** Individual eligible DJ identities — scope matching is by membership so a
   * co-hosted set surfaces under EACH host's drill, never only under the
   * joined display label. */
  djNames: string[];
  artists: QueueArtist[];
  spins: DialSpin[];
  progress: number;
}

export type SetPanelScope =
  | { kind: "set"; setId: string }
  | { kind: "dj"; value: string }
  | { kind: "show"; value: string }
  | { kind: "station"; value: string }
  /** An artist page rendered as a tab. `value` is the stable artist
   * identifier: the MBID when known, else `name:<name>` (same encoding as
   * the retired artist lens frames, so serialized lens URLs map cleanly). */
  | { kind: "artist"; value: string; label?: string }
  /** The tuned station context rendered AS a tab (sidebar layout only).
   * `value` is the station slug. There is at most one context tab; its id is
   * always CONTEXT_TAB_ID so re-tuning retargets the same tab. */
  | { kind: "context"; value: string };

export interface SetPanelTab {
  id: string;
  scope: SetPanelScope;
}

/** Fixed id for the single station-context tab. */
export const CONTEXT_TAB_ID = "context";

export function setPanelScopeId(scope: SetPanelScope): string {
  if (scope.kind === "context") return CONTEXT_TAB_ID;
  return `${scope.kind}:${scope.kind === "set" ? scope.setId : scope.value}`;
}

/**
 * The synthetic replay tab may only take focus when the panel is empty:
 * playback started from a selected set/scope keeps that tab visible while the
 * replay tab updates in the background.
 */
export function shouldActivateReplayTab(activeTabId: string | null): boolean {
  return activeTabId === null;
}

/**
 * Scope resolution is always in units of FULL sets: a DJ/show/station scope
 * returns every complete matching set (chronological), never a crossing
 * excerpt. Crossing artists stay highlighted white via each set's own
 * inLibrary flags inside SetQueueList.
 */
export function scopedSets(scope: SetPanelScope, allSets: SetPanelSet[]): SetPanelSet[] {
  // The context and artist tabs render their own bodies, never a set list —
  // they scope over nothing.
  if (scope.kind === "context" || scope.kind === "artist") return [];
  const matches = scope.kind === "set"
    ? allSets.filter((set) => set.id === scope.setId)
    : scope.kind === "dj"
      ? allSets.filter((set) => set.djNames.includes(scope.value))
      : scope.kind === "show"
        ? allSets.filter((set) => set.showName === scope.value)
        : allSets.filter((set) => set.stationSlug === scope.value);
  return [...matches].sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
}

export function setPanelTabLabel(tab: SetPanelTab, sets: SetPanelSet[], contextLabel?: string | null): string {
  if (tab.scope.kind === "context") {
    // Prefer the caller-resolved station name; fall back to any loaded set's
    // station name for the slug, then the slug itself.
    return contextLabel
      ?? sets.find((candidate) => candidate.stationSlug === (tab.scope as { value: string }).value)?.stationName
      ?? tab.scope.value;
  }
  if (tab.scope.kind === "dj") return tab.scope.value;
  if (tab.scope.kind === "show") return tab.scope.value;
  if (tab.scope.kind === "artist") {
    if (tab.scope.label) return tab.scope.label;
    const value = tab.scope.value;
    if (value.startsWith("name:")) return value.slice(5);
    // MBID identifier — recover a display name from loaded spins.
    for (const set of sets) {
      for (const spin of set.spins) {
        if (spin.artistMbid === value) return spin.artist;
      }
    }
    return "Artist";
  }
  if (tab.scope.kind === "station") {
    const slug = tab.scope.value;
    const set = sets.find((candidate) => candidate.stationSlug === slug);
    return set?.stationName ?? slug;
  }
  const setId = tab.scope.setId;
  const set = sets.find((candidate) => candidate.id === setId);
  return set ? `${fmtHM(set.startedAt, set.ianaTimezone)} · ${set.stationName}` : "Set";
}

/** Streaming services a displayed setlist can export to. Qobuz has no
 * playlist-write connector, so every service exports as ordered per-track
 * deep links into that service's own search — honest about matching rather
 * than pretending a remote playlist was created. */
export const SET_EXPORT_SERVICES = ["Spotify", "Apple Music", "Tidal", "Deezer", "YouTube", "Qobuz"] as const;
export type SetExportService = (typeof SET_EXPORT_SERVICES)[number];

const EXPORT_URL_BUILDERS: Record<SetExportService, (q: string) => string> = {
  Spotify: (q) => `https://open.spotify.com/search/${encodeURIComponent(q)}`,
  "Apple Music": (q) => `https://music.apple.com/search?term=${encodeURIComponent(q)}`,
  Tidal: (q) => `https://listen.tidal.com/search?q=${encodeURIComponent(q)}`,
  Deezer: (q) => `https://www.deezer.com/search/${encodeURIComponent(q)}`,
  YouTube: (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`,
  Qobuz: (q) => `https://www.qobuz.com/search?q=${encodeURIComponent(q)}`,
};

export interface SetExportResult {
  entries: { label: string; url: string }[];
  /** Tracks that couldn't be matched (missing artist or title) — degrade
   * gracefully by counting them instead of exporting broken links. */
  skipped: number;
}

export function buildSetExport(sets: SetPanelSet[], service: SetExportService): SetExportResult {
  const entries: SetExportResult["entries"] = [];
  let skipped = 0;
  for (const set of sets) {
    for (const spin of set.spins) {
      const artist = spin.artist?.trim();
      const title = spin.title?.trim();
      if (!artist || !title) { skipped += 1; continue; }
      entries.push({ label: `${artist} — ${title}`, url: EXPORT_URL_BUILDERS[service](`${artist} ${title}`) });
    }
  }
  return { entries, skipped };
}

export const STATION_SET_EXPORT_FORMATS = ["m3u8", "csv", "xspf", "jspf"] as const;
export type StationSetExportFormat = (typeof STATION_SET_EXPORT_FORMATS)[number];
export interface StationSetExportTrack {
  artist: string;
  title: string;
  playedAt?: string | null;
  mbid?: string | null;
  location?: string | null;
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function stationSetIdentity(
  set: Pick<SetPanelSet, "djNames" | "showName" | "stationName" | "startedAt" | "ianaTimezone">,
): { provenance: string; date: string; time: string } {
  const labels = [...set.djNames, set.showName, set.stationName]
    .filter((value): value is string => !!value?.trim())
    .filter((value, index, all) =>
      all.findIndex((other) => other.localeCompare(value, undefined, { sensitivity: "accent" }) === 0) === index);
  const date = new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "2-digit", day: "2-digit",
    ...(set.ianaTimezone ? { timeZone: set.ianaTimezone } : {}),
  }).format(new Date(set.startedAt));
  return { provenance: labels.join(" | "), date, time: fmtHM(set.startedAt, set.ianaTimezone) };
}

export function stationSetFilename(set: SetPanelSet, format: StationSetExportFormat): string {
  const identity = stationSetIdentity(set);
  const safe = `${identity.provenance}-${identity.date}-${identity.time}`
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-")
    .slice(0, 140) || "lore-set";
  return `${safe}.${format}`;
}

export function buildStationSetExport(
  format: StationSetExportFormat,
  set: SetPanelSet,
  tracks: StationSetExportTrack[],
): { content: string; skipped: number; contentType: string } {
  const valid = tracks.filter((track) => track.artist.trim() && track.title.trim());
  let skipped = tracks.length - valid.length;
  const identity = stationSetIdentity(set);
  if (format === "csv") {
    const rows = ["played_at,artist,title,recording_mbid", ...valid.map((track) =>
      [track.playedAt ?? "", track.artist, track.title, track.mbid ?? ""].map(csvField).join(","))];
    return { content: `${rows.join("\r\n")}\r\n`, skipped, contentType: "text/csv;charset=utf-8" };
  }
  if (format === "jspf") {
    return {
      content: `${JSON.stringify({ playlist: {
        title: `${identity.provenance} · ${identity.date} ${identity.time}`,
        creator: "Lore Radio",
        track: valid.map((track) => ({
          creator: track.artist, title: track.title,
          ...(track.location ? { location: [track.location] } : {}),
          ...(track.mbid ? { identifier: [`https://musicbrainz.org/recording/${track.mbid}`] } : {}),
        })),
      } }, null, 2)}\n`,
      skipped,
      contentType: "application/jspf+json;charset=utf-8",
    };
  }
  if (format === "xspf") {
    const body = valid.map((track) => [
      "    <track>",
      `      <creator>${xmlEscape(track.artist)}</creator>`,
      `      <title>${xmlEscape(track.title)}</title>`,
      track.location ? `      <location>${xmlEscape(track.location)}</location>` : "",
      track.mbid ? `      <identifier>https://musicbrainz.org/recording/${xmlEscape(track.mbid)}</identifier>` : "",
      "    </track>",
    ].filter(Boolean).join("\n")).join("\n");
    return {
      content: `<?xml version="1.0" encoding="UTF-8"?>\n<playlist version="1" xmlns="http://xspf.org/ns/0/">\n  <title>${xmlEscape(identity.provenance)} · ${identity.date} ${identity.time}</title>\n  <trackList>\n${body}\n  </trackList>\n</playlist>\n`,
      skipped,
      contentType: "application/xspf+xml;charset=utf-8",
    };
  }
  const located = valid.filter((track) => track.location || track.mbid);
  skipped += valid.length - located.length;
  return {
    content: `#EXTM3U\n${located.map((track) =>
      `#EXTINF:-1,${track.artist} - ${track.title}\n${track.location ?? `https://musicbrainz.org/recording/${track.mbid}`}`).join("\n")}\n`,
    skipped,
    contentType: "audio/mpegurl;charset=utf-8",
  };
}

/**
 * Tabbed set browser — fully controlled by the parent so that front-door row
 * clicks, replay updates, and provenance drills all share one tab model.
 * Each tab header card leads with the most specific provenance (DJ, then
 * show), while the station link is anchored last on every card.
 */
export function TabbedSetPanel({
  tabs,
  activeId,
  allSets,
  seedsLower,
  onSelect,
  onClose,
  onScope,
  onAdd,
  onRemove,
  onPlay,
  contextLabel,
  contextBody,
  renderArtistBody,
}: {
  tabs: SetPanelTab[];
  activeId: string | null;
  allSets: SetPanelSet[];
  seedsLower: Set<string>;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onScope: (scope: SetPanelScope) => void;
  onAdd: (name: string) => void;
  onRemove: (name: string) => void;
  onPlay: (sets: SetPanelSet[], label: string) => void;
  /** Display label for the station-context tab (resolved station name). */
  contextLabel?: string | null;
  /** Body of the station-context tab — breadcrumb + summary + rail. */
  contextBody?: ReactNode;
  /** Body of an artist tab — the artist page content (runs, spins, taste
   * control). When absent, artist tabs render nothing below the strip. */
  renderArtistBody?: (scope: Extract<SetPanelScope, { kind: "artist" }>) => ReactNode;
}) {
  const [service, setService] = useState<SetExportService>("Spotify");
  const [exportOpen, setExportOpen] = useState(false);
  // Phone widths collapse the Play/service/Export row behind this one quiet
  // control (CSS-gated — desktop always shows the row and hides the toggle).
  const [actionsOpen, setActionsOpen] = useState(false);
  const activeTab = tabs.find((tab) => tab.id === activeId) ?? null;
  // The context and artist tabs render their own bodies; every set-oriented
  // affordance (actions, export, cards) treats them as "no set tab active".
  const isContextActive = activeTab?.scope.kind === "context";
  const activeArtistScope = activeTab?.scope.kind === "artist" ? activeTab.scope : null;
  const active = isContextActive || activeArtistScope ? null : activeTab;
  const displayed = active ? scopedSets(active.scope, allSets) : [];
  const exported = exportOpen && active ? buildSetExport(displayed, service) : null;
  // Artist name → MBID from every loaded set, so a queue name click opens a
  // strongly-identified tab whenever the dial already knows the MBID.
  const artistMbids = useMemo(() => {
    const map = new Map<string, string>();
    for (const set of allSets) {
      for (const spin of set.spins) {
        if (spin.artistMbid && !map.has(spin.artist.toLowerCase())) {
          map.set(spin.artist.toLowerCase(), spin.artistMbid);
        }
      }
    }
    return map;
  }, [allSets]);
  const openArtist = (name: string) => onScope({
    kind: "artist",
    value: artistFrameId(name, artistMbids.get(name.trim().toLowerCase()) ?? null),
    label: name,
  });
  return (
    <>
      {tabs.length > 0 && (
        <div className="set-tabs" role="tablist" aria-label="Open sets">
          {tabs.map((tab) => (
            <div key={tab.id} className={`set-tabs__tab${tab.id === activeId ? " set-tabs__tab--active" : ""}${tab.scope.kind === "context" ? " set-tabs__tab--context" : ""}`}>
              <button type="button" role="tab" aria-selected={tab.id === activeId} onClick={() => onSelect(tab.id)}>
                {setPanelTabLabel(tab, allSets, contextLabel)}
              </button>
              <button type="button" className="set-tabs__close" aria-label={`Close ${setPanelTabLabel(tab, allSets, contextLabel)}`} onClick={() => onClose(tab.id)}><X /></button>
            </div>
          ))}
        </div>
      )}
      {isContextActive && contextBody != null && (
        <div className="set-panel__context">{contextBody}</div>
      )}
      {activeArtistScope && renderArtistBody != null && (
        <div className="set-panel__artist">{renderArtistBody(activeArtistScope)}</div>
      )}
      {/* The station archive workspace is retired (Task #37): a station-scoped
          tab now renders the same complete-set cards as dj/show scopes, and the
          pinned dial sentence owns live + one-back set browsing. */}
      {active && (
        <button
          type="button"
          className="set-panel__actions-toggle"
          aria-label={actionsOpen ? "Hide set actions" : "Show set actions"}
          aria-expanded={actionsOpen}
          onClick={() => setActionsOpen((open) => !open)}
        >{actionsOpen ? "less" : "play · export"}</button>
      )}
      {active && (
        <div className={`set-panel__actions${actionsOpen ? " set-panel__actions--open" : ""}`}>
          <button
            type="button"
            className="set-panel__action"
            disabled={!displayed.some((set) => set.spins.some((spin) => spin.mbid))}
            onClick={() => onPlay(displayed, setPanelTabLabel(active, allSets))}
          >
            <Play /> Play set{displayed.length > 1 ? "s" : ""}
          </button>
          <label className="set-panel__service">
            <span className="sr-only">Export service</span>
            <select aria-label="Export service" value={service} onChange={(e) => { setService(e.target.value as SetExportService); setExportOpen(false); }}>
              {SET_EXPORT_SERVICES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <button
            type="button"
            className="set-panel__action"
            disabled={!displayed.some((set) => set.spins.length)}
            onClick={() => setExportOpen((open) => !open)}
          >
            <Download /> Export
          </button>
        </div>
      )}
      {exported && (
        <div className="set-panel__export" aria-label={`Export to ${service}`}>
          {exported.entries.map((entry, i) => (
            <a key={`${entry.url}:${i}`} href={entry.url} target="_blank" rel="noreferrer">{entry.label}</a>
          ))}
          {exported.skipped > 0 && (
            <p className="set-panel__export-skips">{exported.skipped} track{exported.skipped > 1 ? "s" : ""} couldn't be matched and {exported.skipped > 1 ? "were" : "was"} skipped.</p>
          )}
        </div>
      )}
      {active && displayed.length === 0 && <p className="dial-hero__setpanel-empty">No complete sets are available for this attribution yet.</p>}
      {displayed.length > 0 && (
        <div className="set-panel__sets">
          {displayed.map((set) => (
            <article className="set-panel__card" key={set.id}>
              <header className="set-panel__provenance">
                {/* No date · time row — the tab chip already carries time · station. */}
                <div className="set-panel__cascade">
                  {set.djNames.map((dj) => (
                    <button key={dj} type="button" onClick={() => onScope({ kind: "dj", value: dj })}>{dj}</button>
                  ))}
                  {set.showName && <button type="button" onClick={() => onScope({ kind: "show", value: set.showName! })}>{set.showName}</button>}
                </div>
                <button type="button" className="set-panel__station fdrow__station-chip" onClick={() => onScope({ kind: "station", value: set.stationSlug })}>{set.stationName}</button>
              </header>
              <SetQueueList artists={set.artists} seedsLower={seedsLower} onAdd={onAdd} onRemove={onRemove} onOpenArtist={openArtist} progress={set.progress} />
            </article>
          ))}
        </div>
      )}
    </>
  );
}
interface ScrubItem {
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
function PopScrubber({ items, onScrub }: {
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
function RunRow({ run, focused = false }: { run: OverlapRun; focused?: boolean }) {
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

// ---------------------------------------------------------------------------
// Per-zone visible-row budgets (truncation defaults).
// Zone distribution over a representative 7-day window (scripts/zoneDistribution.ts):
//   Zone 1 p50≈4  p90≈9  max≈18
//   Zone 3 p50≈3  p90≈7  max≈12
// Zone 1 p90 > 5, so truncation is worth shipping.
// ---------------------------------------------------------------------------
/** Max taste seeds per user — must match MAX_SEEDS in api-server taste-seeds.ts. */
const MAX_TASTE_SEEDS = 50;
/** Stable, case-insensitive ordering for the listener's configured artists. */
export function sortTasteSeeds(seeds: string[]): string[] {
  return [...seeds].sort((a, b) => {
    const lowerA = a.toLocaleLowerCase();
    const lowerB = b.toLocaleLowerCase();
    if (lowerA < lowerB) return -1;
    if (lowerA > lowerB) return 1;
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

// ---------------------------------------------------------------------------
// Stations list view
// ---------------------------------------------------------------------------
function _StationsListView({
  stations,
  onStationClick,
}: {
  stations: DialStation[];
  onStationClick: (slug: string) => void;
}) {
  return (
    <div>
      {stations.map((ds) => (
        <div
          key={ds.station.slug}
          className="dial-stn-row"
          onClick={() => onStationClick(ds.station.slug)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === "Enter" && onStationClick(ds.station.slug)}
        >
          <span className={`dial-stn-dot${ds.isLive ? " dial-stn-dot--live" : ""}`} />
          <div className="dial-stn-info">
            <div className="dial-stn-name">{ds.station.name}</div>
            {ds.shows.length > 0 && ds.shows[ds.shows.length - 1].showName && (
              <div className="dial-stn-now">
                {ds.shows[ds.shows.length - 1].showName}
                {ds.shows[ds.shows.length - 1].djName && (
                  <> · <b>{ds.shows[ds.shows.length - 1].djName}</b></>
                )}
              </div>
            )}
          </div>
          <div className={`dial-stn-cross${ds.crossings === 0 ? " dial-stn-cross--zero" : ""}`}>
            <span className="dial-stn-cross__num">{ds.crossings > 0 ? `◆ ${ds.crossings}` : "—"}</span>
            <span className="dial-stn-cross__lbl">crossings</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Station detail (fat-block list)
// ---------------------------------------------------------------------------
function StationDetailView({
  dialStation,
  onShowClick,
}: {
  dialStation: DialStation;
  onShowClick: (show: DialShow) => void;
}) {
  const shows = [...dialStation.shows].reverse(); // newest first

  return (
    <div className="dial-fat-list">
      {shows.map((show, i) => {
        const isLive = show.state === "live";
        const _isPast = show.state === "past";
        const isFuture = show.state === "future";
        const warm = show.crossings > 0 && !isFuture;
        const isPicker = show.isPickerShow;

        const bars = show.spins.slice(0, 28).map((sp, j) => (
          <i key={j} className={sp.isLibraryHit ? "dial-fbar__hit" : ""} />
        ));

        const first = show.spins.find((sp) => sp.isLibraryHit);
        const when = `${fmtHM(show.startedAt, show.ianaTimezone)}–${isLive ? "now" : fmtHM(show.endedAt, show.ianaTimezone)} · ${agoLabel(show.endedAt)}`;

        let cls = "dial-fatblk";
        if (isLive) cls += " dial-fatblk--live";
        if (isFuture) cls += " dial-fatblk--future";
        if (warm && !isPicker && !isFuture) cls += " dial-fatblk--warm";
        if (isPicker && !isFuture) cls += " dial-fatblk--picker";

        return (
          <div key={show.runId ?? i} className={cls} onClick={() => onShowClick(show)} role="button" tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && onShowClick(show)}>
            <div className="dial-fatblk__top">
              <div className="dial-fatblk__show">{show.showName}</div>
              <div className="dial-fatblk__when">{when}</div>
            </div>
            {(show.djName || isPicker) && (
              <div className="dial-fatblk__dj">
                {show.djName && <>with <b>{show.djName}</b></>}
                {isPicker && <span className="dial-fatblk__pickerbadge">◆ Selector</span>}
              </div>
            )}
            {!isFuture && (
              <>
                <div className="dial-fbar">{bars}</div>
                <div className={`dial-fatblk__cross${show.crossings === 0 ? " dial-fatblk__cross--zero" : ""}`}>
                  {show.crossings} of {show.spins.length} were yours
                </div>
                {first && (
                  <div className="dial-fatblk__peek">
                    opened with{" "}
                    <span className="dial-fatblk__peek-hit">
                      {first.artist} — {first.title}
                    </span>
                  </div>
                )}
              </>
            )}
            {isFuture && (
              <div className="dial-fatblk__cross dial-fatblk__cross--zero" style={{ marginTop: 8 }}>
                scheduled · no data yet
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Show tracklist view
// ---------------------------------------------------------------------------
function ShowTracklistView({
  show,
  station,
  allStationsData: allStations,
  onDjClick,
}: {
  show: DialShow;
  station: DialStation;
  allStationsData: DialStation[];
  onDjClick: (name: string) => void;
}) {
  const isLive = show.state === "live";
  const isPicker = show.isPickerShow;
  const djFirst = show.djName ? show.djName.split(" ")[0] : "DJ";

  // Count how many sets this DJ has across all stations in today's data
  const sameSetCount = allStations
    .flatMap((ds) => ds.shows)
    .filter((sh) => sh.djName === show.djName && sh !== show).length;

  return (
    <div>
      <div className="dial-djhd">
        <div className="dial-djhd__name">{show.showName}</div>
        <div className="dial-djhd__sub">
          {show.djName && <><b style={{ fontStyle: "normal", fontWeight: 400 }}>{show.djName}</b>{" · "}</>}
          {station.station.name} · {fmtHM(show.startedAt, show.ianaTimezone)}{isLive ? "–now" : `–${fmtHM(show.endedAt, show.ianaTimezone)}`}
        </div>
        <div className="dial-djhd__stats">
          <div className="dial-djhd__stat">
            <b>{show.spins.length}</b>spins
          </div>
          <div className="dial-djhd__stat dial-djhd__stat--warm">
            <b>{show.crossings}</b>yours
          </div>
          <div className="dial-djhd__stat">
            <b>{sameSetCount + 1}</b>sets logged
          </div>
        </div>
        {isPicker && (
          <div className="dial-pickerbadge">◆ Selector — high overlap DJ</div>
        )}
        {show.djName && (
          <button
            type="button"
            className="dial-dj-chip"
            onClick={() => onDjClick(show.djName!)}
          >
            All of {djFirst}'s sets →
          </button>
        )}
      </div>

      <div className="dial-sec-lbl">
        In order
        <span className="dial-sec-lbl__hint">tap to ride from here</span>
      </div>

      {show.spins.map((sp, i) => (
        <div key={i} className={`dial-trow${sp.isLibraryHit ? " dial-trow--hit" : ""}`}>
          <div className="dial-trow__time">{fmtHM(sp.playedAt, show.ianaTimezone)}</div>
          <div className="dial-trow__content">
            <div className="dial-trow__title">{sp.title}</div>
            <div className="dial-trow__artist">{sp.artist}</div>
          </div>
          <div className={`dial-trow__badge dial-trow__badge--${sp.isLibraryHit ? "own" : "new"}`}>
            {sp.isLibraryHit ? "◆ library" : "new"}
          </div>
        </div>
      ))}

      {show.spins.length === 0 && (
        <div className="dial-sec-lbl" style={{ opacity: 0.4 }}>No spins recorded</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DJ view
// ---------------------------------------------------------------------------
function DjView({
  djName,
  allStations,
  onShowClick,
}: {
  djName: string;
  allStations: DialStation[];
  onShowClick: (show: DialShow, station: DialStation) => void;
}) {
  const djSets = allStations
    .flatMap((ds) => ds.shows.map((sh) => ({ show: sh, station: ds })))
    .filter(({ show }) => show.djName === djName && show.state !== "future")
    .sort((a, b) => new Date(a.show.startedAt).getTime() - new Date(b.show.startedAt).getTime());

  const totalSpins = djSets.reduce((sum, { show }) => sum + show.spins.length, 0);
  const totalCross = djSets.reduce((sum, { show }) => sum + show.crossings, 0);
  const overlapPct = totalSpins > 0 ? Math.round((totalCross / totalSpins) * 100) : 0;
  const isPicker = djSets.some(({ show }) => show.isPickerShow);
  const stationNames = [...new Set(djSets.map(({ station }) => station.station.name))];

  return (
    <div>
      <div className="dial-djhd">
        <div className="dial-djhd__name">{djName}</div>
        <div className="dial-djhd__sub">{stationNames.join(" · ")}</div>
        <div className="dial-djhd__stats">
          <div className="dial-djhd__stat"><b>{djSets.length}</b>sets</div>
          <div className="dial-djhd__stat"><b>{totalSpins}</b>spins</div>
          <div className="dial-djhd__stat dial-djhd__stat--warm"><b>{totalCross}</b>yours</div>
          <div className="dial-djhd__stat"><b>{overlapPct}%</b>overlap</div>
        </div>
        {isPicker && (
          <div className="dial-pickerbadge">◆ Selector — consistently finds your music</div>
        )}
      </div>

      <div className="dial-sec-lbl">
        Every set in archive
        <span className="dial-sec-lbl__hint">oldest first</span>
      </div>

      <div className="dial-fat-list">
        {djSets.map(({ show, station }, i) => {
          const bars = show.spins.slice(0, 28).map((sp, j) => (
            <i key={j} className={sp.isLibraryHit ? "dial-fbar__hit" : ""} />
          ));
          return (
            <div
              key={show.runId ?? i}
              className={`dial-fatblk${show.state === "live" ? " dial-fatblk--live" : ""}${show.crossings > 0 ? " dial-fatblk--warm" : ""}`}
              onClick={() => onShowClick(show, station)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && onShowClick(show, station)}
            >
              <div className="dial-fatblk__top">
                <div className="dial-fatblk__show">{show.showName}</div>
                <div className="dial-fatblk__when">{station.station.name} · {agoLabel(show.endedAt)}</div>
              </div>
              <div className="dial-fatblk__dj">with <b>{show.djName}</b></div>
              <div className="dial-fbar">{bars}</div>
              <div className={`dial-fatblk__cross${show.crossings === 0 ? " dial-fatblk__cross--zero" : ""}`}>
                {show.crossings} of {show.spins.length} were yours
              </div>
            </div>
          );
        })}
        {djSets.length === 0 && (
          <div style={{ padding: "20px 15px", opacity: 0.4, fontFamily: "var(--app-font-display)", fontSize: 14 }}>
            No sets archived for today
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scan bar
// ---------------------------------------------------------------------------
interface ScanBarProps {
  stations: DialStation[];
  level: Level;
  currentStation: DialStation | null;
  currentShow: DialShow | null;
  currentDj: string | null;
  onPlay: (ds: DialStation) => void;
}

function useScanState(cands: Array<{ sp: DialSpin; show: DialShow; station: DialStation }>) {
  const [scanning, setScanning] = useState(false);
  const [sampling, setSampling] = useState<{ sp: DialSpin; show: DialShow; station: DialStation } | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const idxRef = useRef(0);

  const stopScan = useCallback(() => {
    setScanning(false);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  const startScan = useCallback(() => {
    if (!cands.length) return;
    setScanning(true);
    idxRef.current = 0;
    const hop = () => {
      setSampling(cands[idxRef.current % cands.length]);
      idxRef.current++;
    };
    hop();
    timerRef.current = setInterval(hop, 3000);
  }, [cands]);

  const land = useCallback((onLand?: (s: { sp: DialSpin; show: DialShow; station: DialStation }) => void) => {
    stopScan();
    // sampling is kept as-is after land; fire the callback with the frozen sample
    setSampling((current) => {
      if (current && onLand) onLand(current);
      return current;
    });
  }, [stopScan]);

  const toggle = useCallback(() => {
    if (scanning) stopScan();
    else startScan();
  }, [scanning, stopScan, startScan]);

  // Stop scan when candidates change (e.g. level changes)
  useEffect(() => { stopScan(); setSampling(null); }, [cands.length]); // eslint-disable-line

  return { scanning, sampling, toggle, land, stopScan };
}
export function ScanBar({
  stations,
  level,
  currentStation,
  currentShow,
  currentDj,
  onPlay,
}: ScanBarProps) {
  // Collect library-crossing candidates for the current scope.
  // Attribution-only stations (no stream, no relay) are excluded up front:
  // a scan can neither sample nor land on a station that can't play.
  const cands = useMemo(() => {
    const playable = (ds: DialStation) => resolvePlaybackSource(ds.station) != null;
    const hits: Array<{ sp: DialSpin; show: DialShow; station: DialStation }> = [];
    if (level === "show" && currentShow) {
      if (currentStation && playable(currentStation)) {
        for (const sp of currentShow.spins) {
          if (sp.isLibraryHit) {
            hits.push({ sp, show: currentShow, station: currentStation });
          }
        }
      }
    } else if (level === "station" && currentStation) {
      if (playable(currentStation)) {
        for (const show of currentStation.shows) {
          if (show.state === "future") continue;
          const sp = show.spins.find((s) => s.isLibraryHit);
          if (sp) hits.push({ sp, show, station: currentStation });
        }
      }
    } else if (level === "dj" && currentDj) {
      for (const ds of stations) {
        if (!playable(ds)) continue;
        for (const show of ds.shows) {
          if (show.djName !== currentDj || show.state === "future") continue;
          const sp = show.spins.find((s) => s.isLibraryHit);
          if (sp) hits.push({ sp, show, station: ds });
        }
      }
    } else {
      // all — crossings from every station
      for (const ds of stations) {
        if (!playable(ds)) continue;
        for (const show of ds.shows) {
          if (show.state === "future") continue;
          const sp = show.spins.find((s) => s.isLibraryHit);
          if (sp) hits.push({ sp, show, station: ds });
        }
      }
    }
    return hits;
  }, [stations, level, currentStation, currentShow, currentDj]);

  const { scanning, sampling, toggle, land } = useScanState(cands);

  const ctxLabel =
    level === "show" && currentShow ? currentShow.showName :
    level === "station" && currentStation ? currentStation.station.name :
    level === "dj" && currentDj ? currentDj :
    "All stations";

  return (
    <div className="dial-scanbar">
      <button
        type="button"
        className={`dial-scanbtn${scanning ? " dial-scanbtn--on" : ""}`}
        onClick={toggle}
      >
        {scanning ? "Stop" : "Scan"}
      </button>

      <div className="dial-scantrack">
        {sampling ? (
          <>
            <div className="dial-scantrack__name">{sampling.sp.title} · {sampling.sp.artist}</div>
            <div className="dial-scantrack__by">{sampling.show.djName} · {sampling.show.showName} · {sampling.station.station.name}</div>
          </>
        ) : (
          <div className="dial-scantrack__idle">
            <b>{ctxLabel}</b> — {cands.length} stop{cands.length !== 1 ? "s" : ""}
          </div>
        )}
      </div>

      <button
        type="button"
        className={`dial-landbtn${sampling ? " dial-landbtn--show" : ""}`}
        onClick={() => land((s) => onPlay(s.station))}
      >
        Land
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Schedule view (simple list of today's shows sorted by station/time)
// ---------------------------------------------------------------------------
function _ScheduleView({ stations }: { stations: DialStation[] }) {
  const allShows = stations
    .flatMap((ds) => ds.shows.map((sh) => ({ show: sh, station: ds })))
    .sort((a, b) => new Date(a.show.startedAt).getTime() - new Date(b.show.startedAt).getTime());

  const pastAndLive = allShows.filter(({ show }) => show.state !== "future");
  const upcoming = allShows.filter(({ show }) => show.state === "future");

  const SectionLabel = ({ label }: { label: string }) => (
    <div className="dial-sec-lbl" style={{ paddingTop: 16 }}>{label}</div>
  );

  const ShowRow = ({ show, station }: { show: import("../hooks/useDialData").DialShow; station: DialStation }) => {
    const isLive = show.state === "live";
    const isFuture = show.state === "future";
    const warm = show.crossings > 0 && !isFuture;
    return (
      <div className={`dial-sch-row${isLive ? " dial-sch-row--live" : ""}${warm ? " dial-sch-row--warm" : ""}${isFuture ? " dial-sch-row--future" : ""}`}>
        <div className="dial-sch-time">{fmtHM(show.startedAt, show.ianaTimezone)}</div>
        <div className="dial-sch-info">
          <div className="dial-sch-show">{show.showName}</div>
          {show.djName && <div className="dial-sch-dj"><b>{show.djName}</b></div>}
          <div className="dial-sch-stn">{station.station.name}</div>
        </div>
        <div className="dial-sch-badge">
          {isLive && <span className="dial-sch-badge--live">● Live</span>}
          {isFuture && <span style={{ color: "hsl(var(--faint))", fontSize: 9 }}>Soon</span>}
          {!isLive && !isFuture && warm && <span className="dial-sch-badge--cross">◆ {show.crossings}</span>}
          {show.isPickerShow && <span className="dial-sch-badge--sel">Selector</span>}
        </div>
      </div>
    );
  };

  return (
    <div>
      {pastAndLive.length === 0 && upcoming.length === 0 && (
        <div style={{ padding: "24px 15px", opacity: 0.4, fontFamily: "var(--app-font-display)", fontSize: 14 }}>
          No show data for today
        </div>
      )}
      {pastAndLive.length > 0 && (
        <>
          <SectionLabel label="Today so far" />
          {pastAndLive.map(({ show, station }, i) => <ShowRow key={i} show={show} station={station} />)}
        </>
      )}
      {upcoming.length > 0 && (
        <>
          <SectionLabel label="Coming up" />
          {upcoming.map(({ show, station }, i) => <ShowRow key={i} show={show} station={station} />)}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Offline station row — reason-first layout matching FrontDoorRow's three-tier
// reading order: reason / what was aired → DJ attribution → station label.
// ---------------------------------------------------------------------------
function _OfflineRow({
  dialStation,
  isActive,
  onStationClick,
  onPlay,
  displayMode = "personal",
}: {
  dialStation: DialStation;
  isActive: boolean;
  onStationClick: () => void;
  onPlay: () => void;
  displayMode?: DialDisplayMode;
}) {
  const { station, shows, crossings, artistCrossings, topArtistNames: stationTopArtistNames } = dialStation;
  // Most recent non-future show (shows are sorted oldest→newest)
  const lastShow = [...shows].reverse().find((sh) => sh.state !== "future") ?? null;
  // Most recent spin in that show
  const lastSpin = lastShow && lastShow.spins.length > 0
    ? lastShow.spins[lastShow.spins.length - 1]
    : null;

  // ── Attribution helpers ───────────────────────────────────────────────────
  const showCrossings = lastShow?.crossings ?? 0;
  const showArtistCrossings = lastShow?.artistCrossings ?? 0;

  // Resolve single eligible DJ name — null when unknown or multiple (ambiguous).
  const _djList = lastShow ? eligibleDjNames(dialShowAsAttribution(lastShow)) : [];
  const djName = _djList.length === 1 ? _djList[0] : null;
  // Sanitised show name — suppresses DJ-echo and placeholder values.
  const showName = usableShowName(lastShow);

  // Broadcast date + time for the row timing label.
  const timingSrc = lastShow?.startedAt ?? null;
  const timing = timingSrc
    ? `${runDate(timingSrc, lastShow?.ianaTimezone)} · ${clockTime(timingSrc, lastShow?.ianaTimezone)}`
    : "";

  // ── Tier 1: reason — via buildAttributedSentence ────────────────────────
  let t1Node: ReactNode;
  let t1Cls: string;
  if (showCrossings > 0) {
    const names = (displayMode === "blended" && stationTopArtistNames.length > 0)
      ? stationTopArtistNames
      : (lastShow?.topArtists ?? []);
    const nn = names.length > 0 ? nameNodes(names) : null;
    t1Node = buildAttributedSentence(nn, showCrossings, "of yours", djName, showName, timing);
    t1Cls = "w3";
  } else if (showArtistCrossings > 0) {
    const names = (displayMode === "blended" && stationTopArtistNames.length > 0)
      ? stationTopArtistNames
      : (lastShow?.topArtistNames ?? []);
    const nn = names.length > 0 ? nameNodes(names) : null;
    t1Node = buildAttributedSentence(nn, showArtistCrossings, "artist matches", djName, showName, timing);
    t1Cls = "w4";
  } else if (lastSpin) {
    t1Node = (
      <>
        {lastSpin.isFirstSpin && <span className="fdrow__first-spin">◈ </span>}
        {lastSpin.title}
      </>
    );
    t1Cls = "w5";
  } else {
    t1Node = "—";
    t1Cls = "w0";
  }

  // ── Tier 3: station destination label — always station name ──────────────
  const t3Text = station.name;

  const hasCrossings = crossings > 0 || artistCrossings > 0;
  const rowCls = [
    "fdrow",
    hasCrossings ? "fdrow--z1" : "fdrow--dim",
    isActive ? "fdrow--playing" : "",
  ].filter(Boolean).join(" ");

  return (
    <div
      className={rowCls}
      role="button"
      tabIndex={0}
      onClick={onStationClick}
      onKeyDown={(e) => e.key === "Enter" && onStationClick()}
    >
      <div className="fdrow__c">
        {/* Tier 1: reason sentence — leads at full display weight */}
        <div className={`fdrow__t1 ${t1Cls}`}>{t1Node}</div>

        {/* Tier 3: station identity label */}
        <div className="fdrow__t3">{t3Text}</div>
      </div>

      <button
        type="button"
        className={`dial-lane__play${isActive ? " dial-lane__play--on" : ""}`}
        onClick={(e) => { e.stopPropagation(); onPlay(); }}
        aria-label={isActive ? `Stop ${station.name}` : `Play ${station.name}`}
      >
        {isActive ? "■" : "▶"}
      </button>
    </div>
  );
}


export function DialView() {
  const [location] = useLocation();
  const [level, setLevel] = useState<Level>("all");
  const [currentStationSlug, setCurrentStationSlug] = useState<string | null>(null);
  const [currentShow, setCurrentShow] = useState<DialShow | null>(null);
  const [currentDjName, setCurrentDjName] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const { enabled: socialEnabled } = useSocialMode();
  const { enabled: sleepEnabled } = useSleepMode();
  const { enabled: eraGenreEnabled } = useEraGenreMode();
  // displayMode is derived directly from socialEnabled — one toggle drives both.
  const displayMode: DialDisplayMode = socialEnabled ? "blended" : "personal";

  // ── Dial filter menus — song-age tiers (left) + station categories (right).
  // Age tiers are additive; empty set = no age filtering. Station categories
  // are additive too but at least one must stay selected (toggle guard below).
  // The hidden gesture modes (sleep / era-genre) keep priority: while either is
  // active the filter bar is hidden and the legacy single-mode fetch applies.
  const [activeTiers, setActiveTiers] = useState<Set<AgeTier>>(() => new Set());
  const [activeCategories, setActiveCategories] = useState<Set<StationCategory>>(
    () => new Set<StationCategory>(["lore"]),
  );
  const toggleTier = useCallback((tier: AgeTier) => {
    setActiveTiers((prev) => toggleAgeTier(prev, tier));
  }, []);
  const toggleCategory = useCallback((cat: StationCategory) => {
    setActiveCategories((prev) => toggleStationCategory(prev, cat));
  }, []);
  const hiddenModeActive = sleepEnabled || eraGenreEnabled;

  const {
    stations,
    isLoading,
    isCoreLoading,
    liveLoading,
    crossingsLoading,
    hasLibrary,
    hasSeeds,
    liveArtistSuggestions,
    onboardingArtists: _onboardingArtists,
    onboardingArtistsLoading: _onboardingArtistsLoading,
    overlapByPickerId,
    pickerNameToId,
    crossingSourceMode,
    crossingError: _crossingError,
    crossingsPhase,
    stationsError,
    refetchStations,
  } = useDialData(displayMode, {
    sleepMode: sleepEnabled,
    eraGenreMode: eraGenreEnabled,
    // Category-driven fetching only applies outside the hidden gesture modes:
    // while sleep or era-genre is active the legacy single-mode flags win.
    categories: hiddenModeActive ? undefined : activeCategories,
  });
  // Defensive default keeps older mocks (which don't provide the phase) on the
  // legacy behavior; the real hook always supplies it.
  const cxPhase = crossingsPhase ?? "settled";

  useEffect(() => {
    const send = () => {
      if (document.visibilityState !== "visible") return;
      void Promise.resolve(fetch("/api/me/presence/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ socialEnabled }),
      })).catch(() => undefined);
    };
    send();
    const id = window.setInterval(send, 45_000);
    return () => window.clearInterval(id);
  }, [socialEnabled]);

  useEffect(() => {
    // Keep server-side participation aligned with the existing social switch.
    void import("../lib/meHooks").then(({ patchPreferences }) =>
      Promise.resolve(patchPreferences({ socialParticipation: socialEnabled })).catch(() => undefined),
    );
  }, [socialEnabled]);

  // ── Taste seeds — zero-friction artist onboarding ───────────────────────
  const { data: seedArtists = [] } = useMyTasteSeeds();
  const setSeedsMutation = useSetTasteSeeds();
  const { data: _mattStarter } = useMattStarterLibrary();
  const mattStarterMutation = useStartMattLibrary();
  const seedWriteRef = useRef<Promise<string[]> | null>(null);
  // Keep the cloud responsive while the serialized PUT queue is in flight.
  // The server query remains the source of truth; this optimistic mirror only
  // prevents a fast click from looking unselected until the round trip ends.
  const [optimisticSeeds, setOptimisticSeeds] = useState<string[] | null>(null);
  const visibleSeeds = optimisticSeeds ?? seedArtists;
  const _startMattLibrary = useCallback(() => {
    mattStarterMutation.mutate();
  }, [mattStarterMutation]);

  const addSeed = useCallback((artist: string) => {
    const trimmed = artist.trim();
    if (!trimmed) return;
    // Serialize rapid picker clicks. Without this, two clicks in the same
    // render both read the old query result and the later PUT can overwrite
    // the first selected artist.
    const pending = seedWriteRef.current;
    const base = pending ? pending.catch(() => seedArtists) : Promise.resolve(visibleSeeds);
    seedWriteRef.current = base.then(async (current) => {
      const lower = trimmed.toLowerCase();
      if (current.some((s) => s.toLowerCase() === lower) || current.length >= MAX_TASTE_SEEDS) return current;
      const next = [...current, trimmed];
      setOptimisticSeeds(next);
      try {
        const result = await setSeedsMutation.mutateAsync(next);
        setOptimisticSeeds(result.artists);
        return result.artists;
      } catch (error) {
        setOptimisticSeeds(null);
        throw error;
      }
    });
    void seedWriteRef.current.catch(() => undefined);
  }, [seedArtists, setSeedsMutation, visibleSeeds]);

  const removeSeed = useCallback((artist: string) => {
    const pending = seedWriteRef.current;
    const base = pending ? pending.catch(() => seedArtists) : Promise.resolve(visibleSeeds);
    seedWriteRef.current = base.then(async (current) => {
      const lower = artist.toLowerCase();
      const next = current.filter((s) => s.toLowerCase() !== lower);
      if (next.length === current.length) return current;
      setOptimisticSeeds(next);
      try {
        const result = await setSeedsMutation.mutateAsync(next);
        setOptimisticSeeds(result.artists);
        return result.artists;
      } catch (error) {
        setOptimisticSeeds(null);
        throw error;
      }
    });
    void seedWriteRef.current.catch(() => undefined);
  }, [seedArtists, setSeedsMutation, visibleSeeds]);

  // Popular crossings — Also-On-Air sentences + sort order.
  const { data: popCrossings = [] } = useMyPopularCrossings();
  const popMap = useMemo(
    () => new Map(popCrossings.map((i) => [i.stationSlug, i.artists])),
    [popCrossings],
  );
  const seedsLower = useMemo(
    () => new Set(visibleSeeds.map((s) => s.trim().toLowerCase())),
    [visibleSeeds],
  );
  /** Station sort weight: Lore-wide spins of its popular crossing artists. */
  const popScore = useCallback((slug: string) => {
    const artists = popMap.get(slug);
    if (!artists) return 0;
    // Library artists are excluded from the sentence, so they don't weigh
    // into the sort either — they already drive the ON AIR section.
    return artists.reduce((n, a) => n + (a.popular && !a.inLibrary ? a.spins : 0), 0);
  }, [popMap]);
  /**
   * Deep-cuts vector: the station's non-library spin counts sorted ascending.
   * The flipped sort reads each setlist from its rarest artist up — compare
   * lowest spin count first, then next-lowest, and so on. A set carrying a
   * one-spin-ever artist always surfaces, and between two such sets the one
   * with more rare depth wins. This is a transparent ledger stat (Lore-wide
   * spins), never a taste profile — nothing is hidden, only reordered.
   */
  const rareVector = useCallback((slug: string): number[] => {
    const artists = popMap.get(slug);
    if (!artists) return [];
    return artists
      .filter((a) => !a.inLibrary)
      .map((a) => a.spins)
      .sort((x, y) => x - y);
  }, [popMap]);
  // Triangle toggle: up (true) = popular-heavy sets first; down = deep-cuts
  // (rarest-artist-first) ordering. Pure client-side re-sort.
  const [popSortDesc, _setPopSortDesc] = useState(true);
  /** Signed comparison for the active sort mode; 0 when tied (fallbacks apply). */
  const popCompare = useCallback((aSlug: string, bSlug: string) => {
    if (popSortDesc) return popScore(bSlug) - popScore(aSlug);
    // Lexicographic rarest-first: stations without setlist data sort last.
    const av = rareVector(aSlug);
    const bv = rareVector(bSlug);
    if (av.length === 0 || bv.length === 0) return bv.length - av.length;
    const n = Math.min(av.length, bv.length);
    for (let i = 0; i < n; i++) {
      if (av[i] !== bv[i]) return av[i] - bv[i]; // rarer artist wins
    }
    return bv.length - av.length; // equal prefix: deeper rare set wins
  }, [popSortDesc, popScore, rareVector]);
  /** Whether the setlist line would actually render content for this station. */
  const popHasContent = useCallback((slug: string) => {
    const artists = popMap.get(slug);
    if (!artists) return false;
    return artists.some((a) => !a.inLibrary);
  }, [popMap]);

  // Bridge: player-ticker artist clicks → addSeed (ticker lives in PlayerBar)
  useEffect(() => {
    const handler = (e: Event) => addSeed((e as CustomEvent<string>).detail);
    window.addEventListener("lore:add-ticker-artist", handler);
    return () => window.removeEventListener("lore:add-ticker-artist", handler);
  }, [addSeed]);

  // Delay skeleton visibility so fast loads (< 150 ms) never flash shimmer rows.
  // The delayed flag only flips true after crossingsLoading has been true for
  // 150 ms; it resets to false immediately when crossingsLoading clears so that
  // real content replaces skeletons without any extra lag.
  const showSkeleton = useDelayedBoolean(crossingsLoading, 150);
  // The dial settles as soon as the station list arrives — crossings are
  // progressive enhancement. While crossings are still pending, Zone 1 shows
  // its skeleton in place of crossing rows (see the live-mode section), but
  // Zones 2/3 and the offline section render immediately so a slow or cold
  // crossings compute never blanks the whole front door.
  const zone1Settled = !isCoreLoading;
  const isSpotifyConnected = useSpotifyLibraryConnected();
  const { radio, ride } = usePlayer();
  const { data: weeklyRecapData } = useMyWeeklyRecap();
  // Artwork for the now-playing row indicator
  const activeSlug = radio.station?.slug ?? "";
  const { data: activeNpData } = useGetStationNowPlaying(activeSlug, {
    query: {
      queryKey: getGetStationNowPlayingQueryKey(activeSlug),
      enabled: !!radio.station,
      staleTime: 15_000,
      refetchInterval: 30_000,
    },
  });
  const activeArtworkUrl = activeNpData?.nowPlaying?.recording?.artworkUrl
    ?? activeNpData?.nowPlaying?.artworkUrl
    ?? null;
  const { data: avatarData } = useMyAlbumAvatar();
  // Rumours is the universal fallback — ensures the topbar gradient always renders
  // even for brand-new users who haven't connected a library yet.
  const avatarUrl = avatarData?.current?.artworkUrl ?? avatarData?.candidates?.[0]?.artworkUrl ?? RUMOURS;
  // Pre-verified hero art. The topbar wash is a CSS background (no onError),
  // so a dead avatar URL would silently render nothing. Start with the local
  // RUMOURS asset (always loads), then swap to the real avatar art only once
  // the browser has confirmed it actually loads. The fullscreen hero reuses
  // the same resolved URL, so it's always a cached, known-good image.
  // Dedicated hi-res pipeline for the hero cover: look the album up by
  // artist + title on sources that serve true 1200px masters (iTunes, then
  // Cover Art Archive by release-group), then fall back to the upscaled or
  // original library URL, then RUMOURS. Each candidate is probed offscreen,
  // so whichever wins is fully cached before it's ever displayed — the
  // moon-tap hero appears instantly at full quality.
  const avatarAlbum = avatarData?.current ?? avatarData?.candidates?.[0] ?? null;
  const [heroArt, setHeroArt] = useState<string>(RUMOURS);
  // When there is no usable avatar, the hero falls back to RUMOURS. Applied as
  // a render-time reset against the previous validity (rather than a
  // synchronous setState inside the probing effect); the effect below only
  // performs the async candidate probing when an avatar is actually present.
  const heroAvatarUsable = !!avatarAlbum && !!avatarUrl && avatarUrl !== RUMOURS;
  const [prevHeroAvatarUsable, setPrevHeroAvatarUsable] = useState(heroAvatarUsable);
  if (heroAvatarUsable !== prevHeroAvatarUsable) {
    setPrevHeroAvatarUsable(heroAvatarUsable);
    if (!heroAvatarUsable) setHeroArt(RUMOURS);
  }
  useEffect(() => {
    if (!avatarAlbum || !avatarUrl || avatarUrl === RUMOURS) return;
    let cancelled = false;
    void heroArtCandidates(avatarAlbum).then((urls) => {
      if (cancelled) return;
      const candidates = urls.map((u) => proxyArtUrl(u) ?? u);
      const tryLoad = (i: number) => {
        if (cancelled) return;
        if (i >= candidates.length) { setHeroArt(RUMOURS); return; }
        const probe = new Image();
        probe.onload = () => { if (!cancelled) setHeroArt(candidates[i]); };
        probe.onerror = () => tryLoad(i + 1);
        probe.src = candidates[i];
      };
      tryLoad(0);
    });
    return () => { cancelled = true; };
    // avatarUrl is derived from avatarAlbum; keying on it keeps deps simple.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avatarAlbum?.recordingMbid, avatarUrl]);
  // Fullscreen album-art overlay, opened by tapping the moon glyph in the topbar.
  const moonBtnRef = useRef<HTMLButtonElement>(null);
  const artCloseBtnRef = useRef<HTMLButtonElement>(null);
  // Whichever control opened the overlay (moon or hero art) gets focus back.
  const artOpenerRef = useRef<HTMLElement | null>(null);
  const [albumArtOpen, setAlbumArtOpen] = useState(false);
  useEffect(() => {
    if (!albumArtOpen) return;
    // Move focus into the overlay so keyboard users can reach the close button.
    artCloseBtnRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setAlbumArtOpen(false);
      }
      // Trap Tab/Shift+Tab — the only focusable element inside the overlay is
      // the close button, so both directions stay there.
      if (e.key === "Tab") {
        e.preventDefault();
        artCloseBtnRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      // Return focus to whichever control opened the overlay.
      (artOpenerRef.current ?? moonBtnRef.current)?.focus();
    };
  }, [albumArtOpen]);
  const _hasWeeklyRecap = weeklyRecapData != null && (
    weeklyRecapData.stationsAttended.stations.length > 0 ||
    weeklyRecapData.firstEverHeards.items.length > 0 ||
    weeklyRecapData.ripenedCrossings.items.length > 0
  );

  // Picker overlap lookup — pickerId-first, normalised-name bridge fallback.
  // Both maps come from useDialData (same fetch, no double network call).
  function pickerOv(pickerId: number | null, djName: string | null): number {
    if (pickerId != null) return overlapByPickerId.get(pickerId) ?? 0;
    if (djName != null) {
      const pid = pickerNameToId.get(normalizeDjName(djName));
      if (pid != null) return overlapByPickerId.get(pid) ?? 0;
    }
    return 0;
  }

  const currentStation = useMemo(
    () => stations.find((ds) => ds.station.slug === currentStationSlug) ?? null,
    [stations, currentStationSlug],
  );

  // --- navigation helpers ---
  const goAll = useCallback(() => { setLevel("all"); setCurrentShow(null); setCurrentDjName(null); }, []);
  const goStation = useCallback((slug: string) => { setCurrentStationSlug(slug); setLevel("station"); setCurrentShow(null); }, []);
  const goShow = useCallback((show: DialShow, station: DialStation) => {
    setCurrentStationSlug(station.station.slug);
    setCurrentShow(show);
    setLevel("show");
  }, []);
  const goDj = useCallback((name: string) => { setCurrentDjName(name); setLevel("dj"); }, []);

  // --- attribution-ladder sort (spec §4) ---
  // One live entry per stream (show and station are 1:1 at any instant — §5)
  const sortedRows = useMemo(() => {
    const pins = readPins();
    return [...stations]
      .filter((ds) => ds.isLive)
      .map((ds) => {
        const show = ds.shows.find((sh) => sh.state === "live") ?? null;
        // Only the current run may establish live attribution. A recently
        // ended DJ must not affect either the sentence or its ordering.
        const djNameList = eligibleDjNames(
          { name: show?.showName ?? "", djName: show?.djName ?? undefined, djNames: show?.djNames },
          { artist: show?.currentTrack?.artist, title: show?.currentTrack?.title, showTitle: show?.showName, stationName: ds.station.name },
        );
        const effectiveDjName = djNameList.length === 1 ? djNameList[0] : null;
        const attributionSafeShow = show && effectiveDjName !== show.djName
          ? { ...show, djName: effectiveDjName }
          : show;
        const rz = reason(attributionSafeShow, ds.crossings, ds.artistCrossings, crossingSourceMode);
        const isPinned = pins.has(ds.station.slug);
        return { ds, show: attributionSafeShow, rz, effectiveDjName, isPinned };
      })
      .sort((a, b) => {
        // 1. Live crossing (rung 1) floats to the very top
        const ac = a.rz.r === 1 ? 0 : 1;
        const bc = b.rz.r === 1 ? 0 : 1;
        if (ac !== bc) return ac - bc;
        // 2. Attribution band: DJ rows (effectiveDjName != null) always above
        //    stream rows regardless of overlap count. A DJ with 10 lifetime
        //    crossings outranks an automated stream with 500.
        const at = a.effectiveDjName != null ? 0 : 1;
        const bt = b.effectiveDjName != null ? 0 : 1;
        if (at !== bt) return at - bt;
        // 3. Within each band, overlap desc.
        //    DJ band: pickerId-first overlap (name bridge fallback).
        //    Stream band: lifetime station crossings (all-time, same scale).
        const aOv = a.effectiveDjName != null ? pickerOv(a.show?.pickerId ?? null, a.effectiveDjName) : a.ds.lifetimeCrossings;
        const bOv = b.effectiveDjName != null ? pickerOv(b.show?.pickerId ?? null, b.effectiveDjName) : b.ds.lifetimeCrossings;
        if (aOv !== bOv) return bOv - aOv;
        // 4. Rung asc as final tiebreaker; r=0 ("no data") sorts last of all.
        const sortR = (r: number) => r === 0 ? 99 : r;
        return sortR(a.rz.r) - sortR(b.rz.r);
      });
  }, [stations, overlapByPickerId, pickerNameToId, crossingSourceMode]);

  // Unified live feed — the zones are collapsed into ONE flat station list.
  // Ranking segments (internal only, no visual zones):
  //   withReason — r=1..4 (show-level evidence) + r=6/r=7 (24h station-level
  //                crossings): stations with a crossing reason lead the feed.
  //   djBand     — r=5 (attributed show on air, no crossing yet).
  //   restBand   — r=0 (no crossing, no attribution) — pinned float first.
  // With no taste data every live station simply lands in djBand/restBand and
  // the feed still shows all of them with their current plays.
  // The currently-playing station stays in its lane (highlighted via isActive).
  const withReason = useMemo(
    () => sortedRows.filter((row) => (row.rz.r >= 1 && row.rz.r <= 4) || row.rz.r === 6 || row.rz.r === 7),
    [sortedRows],
  );
  const alsoOnAir = useMemo(
    () => sortedRows.filter((row) => row.rz.r === 0 || row.rz.r === 5),
    [sortedRows],
  );
  // Display order for the crossing rows: default (▲) keeps the attribution-
  // ladder order; flipped (▼) is its exact inverse, so the least-crossed
  // stations lead and the strongest crossings sink to the bottom.
  const zone1Display = useMemo(
    () => popSortDesc ? withReason : [...withReason].reverse(),
    [withReason, popSortDesc],
  );

  // Community presence — poll all live station IDs every 60 s.
  // Only needed when Listening Party is active; still safe to call in personal
  // mode since the hook respects staleTime and the UI gates rendering on count.
  const liveStationIds = useMemo(
    () => sortedRows.map((row) => row.ds.station.id),
    [sortedRows],
  );
  const presenceMap = useStationPresence(liveStationIds);

  // Ranking bands within the unified feed (internal ordering only — the feed
  // renders as one uninterrupted list):
  //   djBand  — r=5 rows (attributed show on air, no crossing yet).
  //             Sorted by picker overlap desc.
  //   restBand — r=0 rows (unattributed / dark).
  //             Pinned stations float above non-pinned within restBand.
  const djBand = useMemo(() =>
    alsoOnAir
      .filter((row) => row.rz.r === 5)
      .sort((a, b) => {
        // Popular-crossing weight first (triangle up: popular-heavy first;
        // down: deep-cuts first), then picker overlap as the fallback.
        const cmp = popCompare(a.ds.station.slug, b.ds.station.slug);
        if (cmp !== 0) return cmp;
        const aOv = pickerOv(a.show?.pickerId ?? null, a.effectiveDjName);
        const bOv = pickerOv(b.show?.pickerId ?? null, b.effectiveDjName);
        return bOv - aOv;
      }),
  // pickerOv closure reads overlapByPickerId/pickerNameToId from outer scope
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [alsoOnAir, overlapByPickerId, pickerNameToId, popCompare]);

  const restBand = useMemo(() =>
    alsoOnAir
      .filter((row) => row.rz.r !== 5)
      .sort((a, b) => {
        // Pinned stations float above non-pinned regardless of crossing count.
        if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
        // Popular-crossing weight (triangle up/down) …
        const cmp = popCompare(a.ds.station.slug, b.ds.station.slug);
        if (cmp !== 0) return cmp;
        // … then lifetime station crossings as the fallback.
        return b.ds.lifetimeCrossings - a.ds.lifetimeCrossings;
      }),
  [alsoOnAir, popCompare]);

  // ── Merged-list scrubber ─────────────────────────────────────────────
  // One entry per on-air station in the current display order. Tick weight is
  // normalized per band (crossings for ON AIR rows, popScore for the rest) so
  // both gradients read at full width; hasNew mirrors the canary highlight.
  const scrubItems = useMemo<ScrubItem[]>(() => {
    const hasNew = (slug: string) =>
      (popMap.get(slug) ?? []).some((a) => !a.popular && !a.inLibrary && (a.debut || !a.heard));
    const zone1Max = Math.max(1, ...withReason.map((r) => r.ds.crossings + r.ds.artistCrossings));
    const alsoRows = popSortDesc ? [...djBand, ...restBand] : [...restBand, ...djBand];
    const popMax = Math.max(1, ...alsoRows.map((r) => popScore(r.ds.station.slug)));
    const z1 = zone1Display.map((row) => ({
      slug: row.ds.station.slug,
      name: cleanLiveValue(row.ds.station.name) ?? row.ds.station.name,
      score: Math.round(((row.ds.crossings + row.ds.artistCrossings) / zone1Max) * 100),
      hasNew: hasNew(row.ds.station.slug),
    }));
    const also = alsoRows.map((row) => ({
      slug: row.ds.station.slug,
      name: cleanLiveValue(row.ds.station.name) ?? row.ds.station.name,
      score: Math.round((popScore(row.ds.station.slug) / popMax) * 100),
      hasNew: hasNew(row.ds.station.slug),
    }));
    return popSortDesc ? [...z1, ...also] : [...also, ...z1];
  }, [withReason, zone1Display, djBand, restBand, popMap, popScore, popSortDesc]);
  const [scrubTarget, setScrubTarget] = useState<string | null>(null);
  // Ghost zone: stations that played library artists but user hasn't tuned into
  const { data: ghostStations = [] } = useMyGhostMissed();
  // Exclude any ghost station already appearing in Zone 1 or Zone 3 (live sets)
  const liveSlugSet = useMemo(
    () => new Set(sortedRows.map((r) => r.ds.station.slug)),
    [sortedRows],
  );
  const ghost = useMemo(
    () => ghostStations.filter((g) => !liveSlugSet.has(g.slug)),
    [ghostStations, liveSlugSet],
  );

  // Helper: does a station's most recent non-future show have a usable DJ or show name?
  const hasAttribution = (ds: DialStation): boolean => {
    const lastShow = [...ds.shows].reverse().find((sh) => sh.state !== "future") ?? null;
    if (!lastShow) return false;
    const djName = lastShow.djName ?? null;
    const showName = lastShow.showName && lastShow.showName.toLowerCase() !== "unknown show"
      ? lastShow.showName : null;
    return !!(djName || showName);
  };

  // Offline stations (recently aired): always sorted by all-time crossings.
  const offlineStations = useMemo(() => {
    const lifetimeScore = (ds: DialStation): number =>
      ds.lifetimeCrossings + ds.lifetimeArtistCrossings;
    return [...stations]
      .filter((ds) => !ds.isLive)
      .sort((a, b) => lifetimeScore(b) - lifetimeScore(a));
  }, [stations]);

  // Two-state visibility gate for the offline section:
  //   Default: only stations with any lifetime crossings or named attribution.
  //   Expanded: all offline stations (dark stations included).
  const [showAllOffline, _setShowAllOffline] = useState(false);
  const offlineWithProvenance = useMemo(() => {
    return offlineStations.filter(
      (ds) => ds.lifetimeCrossings + ds.lifetimeArtistCrossings > 0 || hasAttribution(ds),
    );
  }, [offlineStations]);
  const _visibleOffline = showAllOffline ? offlineStations : offlineWithProvenance;

  /** Scrub → the feed lane reveals the row (pagination) and scrolls to it. */
  const handleScrub = useCallback((item: ScrubItem) => {
    setScrubTarget(item.slug);
  }, []);


  // ── Time-travel mode (top sets toggle) ─────────────────────────────────────
  const [ttMode, setTtMode] = useState<TtMode>("live");

  // Fetch all-time top runs (only when top mode is active).
  const { data: ttTopRuns = [], isLoading: ttTopLoading } = useMyOverlapRunsFor(
    null,
    { enabled: ttMode === "top" },
  );

  // Dial range — how far back the coarse scan (and its density spine) reaches.
  // 2 = today + yesterday (default), 7 = a week, 30 = a month.
  const [ttRangeDays, _setTtRangeDays] = useState<number>(2);

  // Fetch the recent crossing runs (reverse-chrono) — coarse scan detents.
  // Always fetched so coarse navigation is immediately available on first ← tap.
  const { data: recentRuns = [] } = useMyOverlapRunsRecent({ days: ttRangeDays });
  const [setDay, setSetDay] = useState<string | null>(null);
  const [setDaypart, setSetDaypart] = useState<"all" | SetDaypart>("all");
  const availableSetDays = useMemo(
    () => [...new Set(recentRuns.map((run) => classifySetTimeContext({
      startedAt: new Date(run.startedAt),
      stationIanaTimezone: run.station.ianaTimezone,
    }).day).filter((day): day is string => day != null))],
    [recentRuns],
  );
  const slicedRuns = useMemo(() => {
    const targetDay = setDay ?? availableSetDays[0] ?? null;
    return recentRuns
      .filter((run) => {
        const context = classifySetTimeContext({
          startedAt: new Date(run.startedAt),
          stationIanaTimezone: run.station.ianaTimezone,
        });
        return (!targetDay || context.day === targetDay) &&
          (setDaypart === "all" || context.daypart === setDaypart);
      })
      .sort((a, b) => (b.owned + b.discover) - (a.owned + a.discover));
  }, [recentRuns, availableSetDays, setDay, setDaypart]);
  // Drop a selected set-day once it's no longer among the available days.
  // Corrected during render (it converges immediately) rather than via a
  // setState-in-effect.
  if (setDay != null && !availableSetDays.includes(setDay)) setSetDay(null);

  // Two-level past-scan state machine (coarse = runs, fine = crossing moments).
  const pastScan = usePastScanState(recentRuns);
  // Shorthand used by JSX and some callbacks.
  const currentRun = pastScan.currentRun;

  // Fine crossing moments for the currently-landed run.
  const { data: fineCrossings = [] } = useMyRunCrossings(
    pastScan.currentRun?.runId ?? null,
    { enabled: !pastScan.isAtLiveEdge },
  );

  // Start (or restart) ghost-radio replay at the given fine-crossing index.
  //
  // Seeds are built with `links: []` — the same established pattern used by
  // LibraryRow, StationScrubTimeline, and all other startReplay call-sites.
  // The PlayerProvider resolves preview URLs and link-outs on demand for each
  // seed via `getRecordingPreview(mbid)` + `getRecording(mbid)` (PlayerProvider
  // line ~1810 — triggered by `currentNeedsLinks && currentPreview === undefined`).
  // Passing empty links is intentional: pre-fetching them here would duplicate
  // work the player already does and add latency before playback starts.
  const startPastReplay = useCallback(
    (atIdx: number) => {
      if (fineCrossings.length === 0 || !pastScan.currentRun) return;
      const seeds: RideSeed[] = fineCrossings
        .filter((m): m is RunCrossingMoment & { mbid: string } => m.mbid !== null)
        .map((m) => ({
          mbid: m.mbid,
          title: m.trackTitle ?? "",
          artist: m.artistName ?? "",
          artworkUrl: null,
          links: [],
          // Propagate broadcast spin duration so the Tier-4 cue sheet can time
          // its "Next: {artist} — {title}" affordance correctly.  Null when
          // absent (42.3% of all-time spins) — cue sheet shows immediately.
          spinDurationSeconds: m.spinDurationSeconds ?? null,
        }));
      if (seeds.length === 0) return;

      // Translate source index (position in fineCrossings, which may contain
      // null-MBID entries the API schema permits) to seed index (position in the
      // filtered seeds[]).  Count non-null entries up to and including atIdx:
      //   non-null crossing  → seedIdx = nonNullCount - 1
      //   null-MBID crossing → clamp to preceding seed (play the last playable track)
      const nonNullUpTo = fineCrossings
        .slice(0, atIdx + 1)
        .filter((m) => m.mbid !== null).length;
      const selectedIsNull = (fineCrossings[atIdx]?.mbid ?? null) === null;
      const seedIdx = selectedIsNull
        ? Math.max(0, nonNullUpTo - 1) // clamp backward to preceding non-null seed
        : nonNullUpTo - 1;

      const run = pastScan.currentRun;
      const label = run.show?.djName
        ? `${run.show.djName} · ${run.station.name}`
        : run.station.name;
      ride.startReplay(seeds, label, {
        timeOrientation: "past",
        startIndex: Math.max(0, Math.min(seedIdx, seeds.length - 1)),
        context: "dial-past-scan",
      });
    },
    [fineCrossings, pastScan.currentRun, ride],
  );

  // Swipe handlers — attached to the past-scan card wrapper.
  // Each handler computes the landing fine-index before updating state so
  // startPastReplay receives the correct index without waiting for React to
  // flush the state update.
  const swipeHandlers = useSwipeHandler(
    useCallback(() => {
      if (fineCrossings.length === 0) return;
      const cur = pastScan.fineIdx ?? -1;
      const nextIdx = cur >= fineCrossings.length - 1 ? Math.max(cur, 0) : cur + 1;
      pastScan.nextCrossing(fineCrossings.length);
      startPastReplay(nextIdx);
    }, [pastScan, fineCrossings, startPastReplay]),
    useCallback(() => {
      if (fineCrossings.length === 0) return;
      const prevIdx = pastScan.fineIdx === null
        ? fineCrossings.length - 1
        : Math.max(pastScan.fineIdx - 1, 0);
      pastScan.prevCrossing(fineCrossings.length);
      startPastReplay(prevIdx);
    }, [pastScan, fineCrossings, startPastReplay]),
  );

  // Coarse landing playback: start ghost-radio replay at crossing index 0 whenever
  // the user lands on a new run via ← / → buttons or the density-spine.  Guards:
  //   • fineIdx must be null (fine landings are handled by crossing-row click/swipe)
  //   • fineCrossings must be loaded for the new run
  //   • only fires once per new run (coarseLandRunRef tracks the last started run)
  const coarseLandRunRef = useRef<number | null>(null);
  const currentRunIdForEffect = pastScan.currentRun?.runId ?? null;
  const fineIdxForEffect = pastScan.fineIdx;
  useEffect(() => {
    if (currentRunIdForEffect === null) {
      coarseLandRunRef.current = null; // reset when returning to live edge
      return;
    }
    if (fineIdxForEffect !== null) return; // fine navigation — handled separately
    if (fineCrossings.length === 0) return; // wait for the crossing fetch
    if (coarseLandRunRef.current === currentRunIdForEffect) return; // already started
    coarseLandRunRef.current = currentRunIdForEffect;
    startPastReplay(0);
  }, [currentRunIdForEffect, fineIdxForEffect, fineCrossings.length, startPastReplay]);

  // ── Two-mode surface state machine (dial ↔ context) ─────────────────────
  // The surface owns mode explicitly — no component may infer it from
  // playback state. Context is a serializable stack encoded in the URL.
  const surface = useDialSurface();

  // URL restore of a past temporal position: once the run list is available,
  // land the past-scan on the encoded run WITHOUT starting playback (the
  // coarse-land ref is pre-seeded so the replay auto-start effect skips it).
  const pendingRestoreRun = useRef<number | null>(
    surface.restored && surface.ctx?.temporal.kind === "past" ? surface.ctx.temporal.runId : null,
  );
  useEffect(() => {
    const runId = pendingRestoreRun.current;
    if (runId == null || recentRuns.length === 0) return;
    pendingRestoreRun.current = null;
    const idx = recentRuns.findIndex((run) => run.runId === runId);
    if (idx >= 0) {
      coarseLandRunRef.current = runId; // suppress replay auto-start on restore
      pastScan.jumpToRunByIndex(idx);
    }
  }, [recentRuns, pastScan]);

  // Keep the temporal modifier on the station frame in sync with the scrub
  // position. Scrub moves update the ctx URL via replace (never push) —
  // that's owned by useDialSurface. Guarded while a URL restore is pending
  // so the encoded past position isn't clobbered with "live".
  useEffect(() => {
    if (surface.mode !== "context") return;
    if (pendingRestoreRun.current != null) return;
    surface.temporal(
      pastScan.isAtLiveEdge || !pastScan.currentRun
        ? { kind: "live" }
        : { kind: "past", runId: pastScan.currentRun.runId },
    );
  }, [surface, pastScan.isAtLiveEdge, pastScan.currentRun]);

  // Deliberate tune commit — the ONLY entry into context mode from the list.
  // First click on a station row (or a scan landing) tunes and plays;
  // picking a different station is a deliberate reset of stack + temporal.
  const commitTune = useCallback((slug: string, label?: string) => {
    surface.tune(slug, label);
    pastScan.reset(); // tune / station change resets the temporal modifier
  }, [surface, pastScan]);

  // Zone-2 ghost stations arrive as GhostStation (a spin-evidence shape), not
  // a full Station record; adapt the playable fields so a ghost-row click can
  // tune through the same commit-and-play path as Zone 1/3 rows.
  const ghostToStation = useCallback((g: GhostStation): Station => ({
    id: g.stationId,
    slug: g.slug,
    name: g.name,
    streamUrl: g.streamUrl,
    streamFormat: g.streamFormat,
    mode: g.mode,
    attribution: g.attribution,
    mayHaveAds: false,
    votes: 0,
    clickcount: 0,
  } as Station), []);

  const _handleTtModeChange = useCallback((m: TtMode) => {
    setTtMode(m);
    pastScan.reset(); // clear past-scan on any mode change
  }, [pastScan]);

  // Effective mode: "past" when the user has stepped back at least one run,
  // "top" when top-sets mode is active, otherwise "live".
  const effectiveTtMode: TtMode = ttMode === "top" ? "top" : (pastScan.isAtLiveEdge ? "live" : "past");

  // ── Player queue panel ──────────────────────────────────────────────────
  // This is deliberately player-context state, not an expandable row. It lets
  // live broadcasts and fixed replays share the same set-list surface.
  const [setTabs, setSetTabs] = useState<SetPanelTab[]>([]);
  /** Minimal default front door: the set/queue panel only shows once the
   * listener engages the queue (opens a set tab). */
  const setPanelOpen = setTabs.length > 0;
  const [activeSetTabId, setActiveSetTabId] = useState<string | null>(null);
  // Sets opened explicitly (front-door click, replay updates). Kept separate
  // from the derived broadcast sets so listedArtists fallbacks and replay
  // synthetic sets survive live-data refreshes.
  const [openedSets, setOpenedSets] = useState<Record<string, SetPanelSet>>({});

  // Every complete broadcast run currently known to the dial — the corpus a
  // DJ/show/station drill scopes over, always in units of whole sets.
  const broadcastSets = useMemo<SetPanelSet[]>(() => {
    const sets: SetPanelSet[] = [];
    for (const ds of stations) {
      for (const show of ds.shows) {
        if (show.state === "future" || show.spins.length === 0) continue;
        const artists = show.spins
          .map((spin) => ({ name: spin.artist, inLibrary: spin.isLibraryHit || spin.isArtistHit, title: spin.title || null }))
          .filter((artist) => artist.name.trim());
        if (artists.length === 0) continue;
        const currentIndex = show.currentTrack
          ? Math.max(0, show.spins.findIndex((spin) => spin.playedAt === show.currentTrack?.playedAt))
          : show.spins.length - 1;
        const djNames = eligibleDjNames(dialShowAsAttribution(show));
        sets.push({
          id: `${ds.station.slug}:${show.startedAt}`,
          runId: show.runId ?? null,
          stationSlug: ds.station.slug,
          stationName: ds.station.name,
          startedAt: show.startedAt,
          ianaTimezone: show.ianaTimezone ?? ds.station.ianaTimezone ?? null,
          showName: usableShowName(show),
          djNames,
          artists,
          spins: show.spins,
          progress: show.state === "live" && artists.length > 0
            ? Math.min(1, (currentIndex + 1) / artists.length)
            : 1,
        });
      }
    }
    return sets;
  }, [stations]);

  // Merge order: openedSets first (holds the listedArtists fallback for sets
  // that had no spins at click time), then broadcastSets overwrites with live
  // station data so that progress and artist lists stay current as the now-
  // playing spin advances. Sets that exist only in openedSets (e.g. replay)
  // are unaffected because broadcastSets skips shows with zero spins.
  const allSets = useMemo<SetPanelSet[]>(() => {
    const merged = new Map<string, SetPanelSet>();
    for (const set of Object.values(openedSets)) merged.set(set.id, set);
    for (const set of broadcastSets) merged.set(set.id, set);
    return [...merged.values()];
  }, [broadcastSets, openedSets]);

  /** Append-or-focus a tab. `activate=false` lets background updates (replay
   * index ticks) refresh a tab without yanking focus from the one the
   * listener is reading. */
  const openSetTab = useCallback((scope: SetPanelScope, activate = true) => {
    const id = setPanelScopeId(scope);
    setSetTabs((current) => current.some((tab) => tab.id === id) ? current : [...current, { id, scope }]);
    if (activate) setActiveSetTabId(id);
  }, []);
  /** Open (or focus) the artist tab for a name/identifier pair. Stable id =
   * MBID when known, else name-keyed — repeated opens focus the same tab. */
  const openArtistTab = useCallback((name: string | null, mbid: string | null) => {
    if (!name && !mbid) return;
    openSetTab({
      kind: "artist",
      value: artistFrameId(name ?? "", mbid),
      ...(name ? { label: name } : {}),
    });
  }, [openSetTab]);

  // ── Sidebar layout gate for the context tab ─────────────────────────────
  // The station context relocates into the set-panel sidebar ONLY in the
  // landscape (sidebar) layout; portrait keeps the quiet tuned view with the
  // context region stacked in the scroll body (mobile shell unchanged).
  // (jsdom lacks matchMedia — treat it as portrait/stacked, the old layout.)
  const [sidebarLayout, setSidebarLayout] = useState<boolean>(() =>
    typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(orientation: landscape)").matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(orientation: landscape)");
    const onChange = () => setSidebarLayout(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (!ride.active || ride.queue.length === 0) return;
    const id = "replay";
    // Syncs the external player (`ride`) subscription state into the local
    // set-panel model and conditionally focuses the replay tab. This mirrors
    // an external store whose updates arrive via PlayerProvider, so the sync
    // belongs in an effect keyed on ride identity.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs external player (ride) subscription state into the set-panel model
    setOpenedSets((current) => ({
      ...current,
      [id]: {
        id,
        runId: null,
        stationSlug: "replay",
        stationName: ride.replayLabel ?? "Replay",
        startedAt: currentRun?.day ? `${currentRun.day}T00:00:00Z` : new Date().toISOString(),
        ianaTimezone: currentRun?.station.ianaTimezone ?? null,
        showName: null,
        djNames: [],
        artists: ride.queue.map((item) => ({ name: item.artist, inLibrary: false, title: item.title || null })),
        spins: ride.queue.map((item) => ({
          mbid: item.mbid,
          artistMbid: null,
          title: item.title,
          artist: item.artist,
          playedAt: "",
          isLibraryHit: false,
          isArtistHit: false,
          isFirstSpin: false,
          releaseYear: null,
          ageTier: null,
        })),
        progress: (ride.index + 1) / ride.queue.length,
      },
    }));
    // Replay synchronization is background-only whenever the listener already
    // has a tab in focus: playback started FROM the set panel (or anywhere
    // else) must never yank the selected set/scope out from under them. The
    // replay tab only takes focus when nothing is open at all.
    openSetTab({ kind: "set", setId: id }, shouldActivateReplayTab(activeSetTabId));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ride.active, ride.queue, ride.index, ride.replayLabel, currentRun?.day, currentRun?.station.ianaTimezone, openSetTab]);

  // ── Fine-landing effect — fire startPastReplay(fineIdx) on crossing step ──
  // Fires when the user steps to a specific crossing (swipe or row click).
  useEffect(() => {
    if (pastScan.fineIdx === null) return;
    startPastReplay(pastScan.fineIdx);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pastScan.fineIdx]);

  // --- front-door scan (spec §11) ---
  const scan = useFrontDoorScan(withReason.length);

  // Play each sample as scan advances — uses radio.preview() so no listen event
  // is written to the journal or server ledger (spec §11).
  // Attribution-only stations (no stream/relay) are skipped: previewing them
  // would only surface the "no live stream configured" safety-net error.
  const prevSamplingIdx = useRef<number | null>(null);
  useEffect(() => {
    if (scan.scanning && scan.samplingIdx != null && scan.samplingIdx !== prevSamplingIdx.current) {
      prevSamplingIdx.current = scan.samplingIdx;
      const row = withReason[scan.samplingIdx];
      if (row && resolvePlaybackSource(row.ds.station) != null) {
        void radio.preview(row.ds.station);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scan.scanning, scan.samplingIdx]);

  // Active row index: scan cursor → playing station → none (-1)
  const activeIdx = useMemo(() => {
    if (scan.samplingIdx != null) return scan.samplingIdx;
    if (radio.station) {
      const idx = withReason.findIndex((row) => row.ds.station.slug === radio.station!.slug);
      return idx >= 0 ? idx : -1;
    }
    return -1;
  }, [scan.samplingIdx, radio.station, withReason]);

  const _activeRow = activeIdx >= 0 ? (withReason[activeIdx] ?? null) : null;

  // Top row for Listen button label (spec §10) — kept for potential reuse
  const _topRow = sortedRows[0] ?? null;

  const _handleScanLand = useCallback(() => {
    const idx = scan.samplingIdx;
    if (idx != null && withReason[idx]) {
      scan.land();
      const station = withReason[idx].ds.station;
      // A scan landing counts as the committing click — enter context mode.
      commitTune(station.slug, station.name);
      void radio.toggle(station);
    } else {
      scan.land();
    }
  }, [scan, withReason, radio, commitTune]);

  // Shared tune handler for Zone-2 ghost rows (no qualifying replay run):
  // like any station row, the first click commits to context mode and plays.
  const tuneGhost = useCallback((g: GhostStation) => {
    scan.stop();
    commitTune(g.slug, g.name);
    if (radio.station?.slug !== g.slug || radio.status !== "playing") {
      void radio.toggle(ghostToStation(g));
    }
  }, [scan, commitTune, radio, ghostToStation]);

  // --- topbar helpers ---

  const _MATTS_LIBRARY: readonly string[] = [
    "Cocteau Twins", "Talk Talk", "Beach House", "Grouper",
    "Tim Hecker", "Mount Eerie", "Low", "Julianna Barwick",
    "William Basinski", "Stars of the Lid", "Broadcast",
    "Silver Apples", "Arthur Russell", "Harold Budd",
  ];

  // --- topbar ---
  function renderTopbar() {
    // The front door intentionally renders no topbar at all — the first thing
    // the listener sees is the album art, the crossing summary sentences, and
    // the two corner links. Drill-down levels show a breadcrumb topbar.
    if (level === "all") return null;
    if (level === "station" && currentStation) {
      return (
        <div className="dial-topbar">
          <button type="button" className="dial-topbar__crumb" onClick={goAll}>Radio</button>
          <span className="dial-topbar__sep">›</span>
          <span className="dial-topbar__title dial-topbar__title--active">{currentStation.station.name}</span>
          <button type="button" className="dial-topbar__back" onClick={goAll}>↑ Back</button>
        </div>
      );
    }
    if (level === "show" && currentShow && currentStation) {
      return (
        <div className="dial-topbar">
          <button type="button" className="dial-topbar__crumb" onClick={goAll}>Radio</button>
          <span className="dial-topbar__sep">›</span>
          <button type="button" className="dial-topbar__crumb" onClick={() => goStation(currentStation.station.slug)}>
            {currentStation.station.name}
          </button>
          <span className="dial-topbar__sep">›</span>
          <span className="dial-topbar__title dial-topbar__title--active" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
            {currentShow.showName}
          </span>
          <button type="button" className="dial-topbar__back" onClick={() => goStation(currentStation.station.slug)}>↑ Back</button>
        </div>
      );
    }
    if (level === "dj" && currentDjName) {
      return (
        <div className="dial-topbar">
          <button type="button" className="dial-topbar__crumb" onClick={goAll}>Radio</button>
          <span className="dial-topbar__sep">›</span>
          <span className="dial-topbar__title dial-topbar__title--active">{currentDjName}</span>
          <button type="button" className="dial-topbar__back" onClick={goAll}>↑ Back</button>
        </div>
      );
    }
    return null;
  }

  // determine if Radio tab is active
  const isRadioActive = location === "/" || location === "" || location.startsWith("/?");

  // ── Context mode: the former station-list area becomes the context region.
  // Mode comes from the surface state machine, never from playback state.
  const inContext = surface.mode === "context";
  const ctxSlug = contextStationSlug(surface.state);
  const ctxRow = ctxSlug ? withReason.find((row) => row.ds.station.slug === ctxSlug)
    ?? sortedRows.find((row) => row.ds.station.slug === ctxSlug)
    ?? null : null;
  const ctxStationName = ctxRow?.ds.station.name
    ?? stations.find((ds) => ds.station.slug === ctxSlug)?.station.name
    ?? null;
  // Quiet tuned front door: when the breadcrumb + summary sentence + rail
  // would all be placeholder filler, the region collapses to art + dial +
  // a minimal back affordance (railHasRealContent owns the rules).
  const ctxQuiet = inContext && !!surface.ctx && !railHasRealContent({
    ctx: surface.ctx,
    row: ctxRow,
    sets: allSets,
    displayMode: crossingSourceMode,
  });
  // Consolidated tuned view (portrait / stacked layout only): while a set
  // panel is open, the in-body context region drops its rail (station lens +
  // artist chips) — those duplicate what the queue already shows. The summary
  // row stays: it is the tuned identity and the re-tune affordance.
  // In the sidebar layout the context lives in its OWN tab, so when that tab
  // is focused the queue is not visible and the rail always renders.
  const contextConsolidated = inContext && setPanelOpen;
  const renderContextRegion = (withRail: boolean) => inContext && surface.ctx && (
    <DialContextRegion
      ctx={surface.ctx}
      quiet={ctxQuiet}
      frameLabel={(frame) =>
        frame.kind === "station" && frame.id === ctxSlug
          ? (ctxStationName ?? frame.label ?? frame.id)
          : undefined}
      onBack={surface.back}
      onDial={() => {
        // Return to station selection WITHOUT stopping audio — the player is
        // never touched here. Leaving context resets the temporal modifier.
        surface.dial();
        pastScan.reset();
      }}
      onReturnToLive={pastScan.reset}
      summary={ctxRow ? (
        <FrontDoorRow
          ds={ctxRow.ds}
          show={ctxRow.show}
          ov={ctxRow.ds.lifetimeCrossings}
          isActive={ctxRow.ds.station.slug === radio.station?.slug}
          isSampling={false}
          onTuneIn={() => { /* already tuned — navigation never retunes */ }}
          displayMode={crossingSourceMode}
          artworkUrl={activeArtworkUrl}
        />
      ) : ctxStationName ? (
        <p className="dial-context-region__offline">{ctxStationName}</p>
      ) : null}
    >
      {withRail ? (
        <ContextRail
          ctx={surface.ctx}
          row={ctxRow}
          sets={allSets}
          seedsLower={seedsLower}
          onAddSeed={addSeed}
          onPush={surface.push}
          onOpenArtist={openArtistTab}
          displayMode={crossingSourceMode}
        />
      ) : null}
    </DialContextRegion>
  );
  // Sidebar layout: the context relocates into the set-panel sidebar as a
  // tab; the scroll body renders no standalone context region.
  const contextInSidebar = sidebarLayout;
  const contextRegionJsx = contextInSidebar ? null : renderContextRegion(!contextConsolidated);

  // Entering context mode opens/focuses the context tab in the sidebar;
  // leaving context (↑ Back at root, Dial crumb, station change reset)
  // removes it. Portrait never manages a context tab. Reconciled as a
  // render-time adjustment against the previous (contextInSidebar, inContext,
  // ctxSlug) tuple rather than a setState-in-effect.
  const ctxTabKey = `${contextInSidebar ? 1 : 0}|${inContext ? 1 : 0}|${ctxSlug ?? ""}`;
  const [prevCtxTabKey, setPrevCtxTabKey] = useState(ctxTabKey);
  if (ctxTabKey !== prevCtxTabKey) {
    setPrevCtxTabKey(ctxTabKey);
    if (!(!contextInSidebar || (inContext && !ctxSlug))) {
    if (inContext && ctxSlug) {
      setSetTabs((current) => {
        const tab: SetPanelTab = { id: CONTEXT_TAB_ID, scope: { kind: "context", value: ctxSlug } };
        const existing = current.find((t) => t.id === CONTEXT_TAB_ID);
        if (existing) {
          return existing.scope.kind === "context" && existing.scope.value === ctxSlug
            ? current
            : current.map((t) => t.id === CONTEXT_TAB_ID ? tab : t);
        }
        return [tab, ...current];
      });
      setActiveSetTabId(CONTEXT_TAB_ID);
    } else {
      setSetTabs((current) => {
        const index = current.findIndex((t) => t.id === CONTEXT_TAB_ID);
        if (index < 0) return current;
        const next = current.filter((t) => t.id !== CONTEXT_TAB_ID);
        setActiveSetTabId((activeNow) => activeNow === CONTEXT_TAB_ID
          ? (next[Math.max(0, index - 1)]?.id ?? null)
          : activeNow);
        return next;
      });
    }
    }
  }

  // The artist lens is retired: any artist frame that still lands on the
  // context stack (old serialized ?lens=artist:… URLs, stale callers) is
  // mapped to an artist TAB and popped — no path may render an artist lens.
  useEffect(() => {
    if (surface.mode !== "context" || !surface.ctx) return;
    const top = surface.ctx.stack[surface.ctx.stack.length - 1];
    if (!top || top.kind !== "artist") return;
    const { name, mbid } = decodeArtistFrame(top);
    // Reconciles an external navigation surface (a legacy artist frame pushed
    // onto the context stack) into a tab, then imperatively pops the surface.
    // The surface.back() mutation must run in an effect, not during render, so
    // the paired openArtistTab setState legitimately lives here too.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- imperative reconciliation of external navigation surface paired with surface.back()
    openArtistTab(name, mbid);
    surface.back();
  }, [surface, openArtistTab]);

  // ── Unified live feed — one flat list for all live stations.
  // Shared tune handler for every feed row. Attribution-only stations
  // (no stream, no relay) never reach radio.toggle — their rows render a
  // "Listen on site" link instead of a tune-in click target.
  const tuneZoneRow = useCallback((row: DialLaneRow) => {
    scan.stop();
    if (resolvePlaybackSource(row.ds.station) == null) return;
    if (radio.station?.slug !== row.ds.station.slug || radio.status !== "playing") {
      void radio.toggle(row.ds.station);
    }
  }, [scan, radio]);
  const popLineFor = useCallback((slug: string) =>
    popHasContent(slug)
      ? <PopCrossingLine artists={popMap.get(slug)!} seedsLower={seedsLower} onAdd={addSeed} />
      : null,
  [popHasContent, popMap, seedsLower, addSeed]);
  // While crossing scores are pending the reason rows are withheld (the
  // skeleton takes their place) but the rest of the feed renders immediately,
  // so a slow crossings compute never blanks live stations.
  const feedSection = sortedRows.length > 0 && (
    <DialFeedLane
      reasonRows={crossingsLoading ? [] : zone1Display}
      djRows={djBand}
      restRows={restBand}
      popSortDesc={popSortDesc}
      activeSlug={radio.station?.slug ?? null}
      samplingSlug={scan.samplingIdx != null ? withReason[scan.samplingIdx]?.ds.station.slug ?? null : null}
      scrubTarget={scrubTarget}
      displayMode={crossingSourceMode}
      presenceMap={presenceMap}
      popMap={popMap}
      seedsLower={seedsLower}
      artworkUrl={activeArtworkUrl}
      popLineFor={popLineFor}
      ovFor={(row, band) => band === "reason"
        ? (row.show?.djName != null ? pickerOv(row.show?.pickerId ?? null, row.show.djName) : row.ds.lifetimeCrossings)
        : band === "dj"
          ? pickerOv(row.show?.pickerId ?? null, row.effectiveDjName)
          : row.ds.lifetimeCrossings}
      onAddArtist={addSeed}
      onTuneIn={tuneZoneRow}
      onSetExpand={(_row) => undefined}
      activeAgeTiers={activeTiers}
    />
  );

  return (
    <div className={`dial-root${albumArtOpen && avatarUrl ? " dial-root--art-open" : ""}${level === "all" ? " dial-root--front" : ""}`}>
      {/* Search overlay */}
      {searchOpen && (
        <SearchOverlay
          dialStations={stations}
          onClose={() => setSearchOpen(false)}
          onStationDrill={(slug) => { goStation(slug); setSearchOpen(false); }}
          onShowDrill={(show, station) => { goShow(show, station); setSearchOpen(false); }}
        />
      )}

      {/* Avatar album hero — the art IS the front-door content:
          full-width square in portrait, full-height left panel in landscape
          (see .dial-hero__art CSS). The front door has no branding strip:
          the sort and time-travel controls carry the interface. Tapping the
          art opens the fullscreen overlay. */}
      {level === "all" ? (
        <div className="dial-hero">
          {renderTopbar()}
          <div className="dial-hero__artwrap">
            <div
              className="dial-hero__art"
              style={{ backgroundImage: `url(${heroArt})` }}
              role="button"
              tabIndex={0}
              aria-label="Open album art fullscreen"
              onClick={(e) => { artOpenerRef.current = e.currentTarget; setAlbumArtOpen(true); }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  artOpenerRef.current = e.currentTarget;
                  setAlbumArtOpen(true);
                }
              }}
            />
          </div>
        </div>
      ) : (
        renderTopbar()
      )}

      {/* Fullscreen album-art overlay — toggled by the moon glyph.
          The rest of the page fades to opacity 0 (see .dial-root--art-open);
          the same image already loaded behind the LORE logo is shown scaled
          to the window width. The moon stays visible as the toggle. */}
      {albumArtOpen && avatarUrl && (
        <div
          className="dial-art-fullscreen"
          role="dialog"
          aria-modal="true"
          aria-label="Album art"
          onClick={() => setAlbumArtOpen(false)}
        >
          <button
            ref={artCloseBtnRef}
            type="button"
            className="dial-art-fullscreen__close"
            aria-label="Close album art"
            onClick={() => setAlbumArtOpen(false)}
          >✕</button>
          <img src={heroArt} alt="" onError={onArtError} />
        </div>
      )}


      {/* Scan bar — station / show / dj levels only */}
      {level !== "all" && isRadioActive && (
        <ScanBar
          stations={stations}
          level={level}
          currentStation={currentStation}
          currentShow={currentShow}
          currentDj={currentDjName}
          onPlay={(ds) => radio.toggle(ds.station)}
        />
      )}

      {/* Main scroll body */}
      <div className="dial-body">
        <AlbumAvatarPicker compact />
        {/* Time travel lives on the hero art sidebar (chevrons + swipe);
            the moon lives in the topbar. */}
        {/* DIAL view — three-zone front door (spec §6) */}
        {level === "all" && (
          <>
            {/* Tab strip now renders inside .dial-hero above the scroll body so
                the album-art hero can bleed behind it. */}

            {/* ── Primary tab: "On the Air × Your Music Library" ─────────────────
                Contains Zone 1 crossing rows + Zone 2 ghost stations as a
                subsection below. */}
            {/* Tuned context must never wait on the crossings query: the
                summary sentence and rail render as soon as the context is
                open (they degrade gracefully while data loads), so the gate
                opens early in context mode. */}
            {(zone1Settled || inContext) && (
              <>
                {/* Context mode: the former list space belongs to the context
                    region. Zone 2/3 discovery bands are hidden below. */}
                {contextRegionJsx}

                {/* PopScrubber only in live mode (day/top have no live sort). */}
                {!inContext && effectiveTtMode === "live" && scrubItems.length > 6 && (
                  <PopScrubber items={scrubItems} onScrub={handleScrub} />
                )}

                {/* ── Past mode: landed crossing run + fine crossing moments ── */}
                
                {effectiveTtMode === "past" && (
                  <>
                    <section className="dial-set-slice" aria-label="Filter sets by station-local time">
                      <label className="dial-set-slice__label">
                        Day
                        <select
                          value={setDay ?? availableSetDays[0] ?? ""}
                          onChange={(event) => setSetDay(event.target.value || null)}
                          aria-label="Set day"
                        >
                          {availableSetDays.map((day) => <option key={day} value={day}>{day}</option>)}
                        </select>
                      </label>
                      <div className="dial-set-slice__dayparts" role="group" aria-label="Set daypart">
                        {(["all", "day", "night"] as const).map((part) => (
                          <button
                            key={part}
                            type="button"
                            className={setDaypart === part ? "is-active" : ""}
                            aria-pressed={setDaypart === part}
                            onClick={() => setSetDaypart(part)}
                          >{part === "all" ? "All sets" : `${part[0]!.toUpperCase()}${part.slice(1)} sets`}</button>
                        ))}
                      </div>
                      <span className="dial-set-slice__count">{slicedRuns.length} ranked by crossings</span>
                    </section>
                    {slicedRuns.length > 0 && (
                      <div className="dial-set-slice__runs">
                        {slicedRuns.map((run) => <RunRow key={run.runId} run={run} />)}
                      </div>
                    )}
                    {currentRun ? (
                      <>
                        {/* Coarse detent: the run row (click → archive page) */}
                        <RunRow key={currentRun.runId} run={currentRun} />
                        {/* Fine detents: crossing moments within the run.
                            Swipe left/right to step ±1 crossing.
                            Click a row to jump directly to that crossing.
                            data-crossing-index allows tests to locate rows.
                            Note: the endpoint guarantees non-null mbid (only
                            library-hit spins are returned), so no disabled
                            guard is needed here. */}
                        {fineCrossings.length > 0 && (
                          <div
                            className="dial-past-crossings"
                            {...swipeHandlers}
                          >
                            {fineCrossings.map((m, i) => (
                              <button
                                key={m.spinId}
                                type="button"
                                className={`dial-past-crossing${pastScan.fineIdx === i ? " dial-past-crossing--active" : ""}`}
                                data-crossing-index={i}
                                onClick={() => {
                                  // jumpToFine sets fineIdx so the active highlight
                                  // moves to this row and subsequent swipes continue
                                  // from this position (not from the head of the run).
                                  pastScan.jumpToFine(i, fineCrossings.length);
                                }}
                              >
                                <span className="dial-past-crossing__title">{m.trackTitle ?? "Unknown track"}</span>
                                <span className="dial-past-crossing__artist">{m.artistName ?? "Unknown artist"}</span>
                              </button>
                            ))}
                          </div>
                        )}
                        {/* Density spine — coarse run navigation.
                            Drag to scan runs; tap a bin to jump to that run.
                            Suppressed in Top Sets mode (caller controls render). */}
                        <RunDensitySpine
                          runs={recentRuns}
                          activeIdx={pastScan.coarseIdx}
                          onRunSelect={pastScan.jumpToRunByIndex}
                        />
                      </>
                    ) : (
                      <div className="z1-placeholder z1-placeholder--no-cross">
                        <div className="z1-placeholder__body">
                          <p className="z1-placeholder__pitch">No sets found.</p>
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* ── Top sets mode: all-time crossing runs ranked by owned ── */}
                {ttMode === "top" && (
                  <>
                    {ttTopLoading && (
                      <>
                        <DialRowSkeleton delay={0} />
                        <DialRowSkeleton delay={1} />
                        <DialRowSkeleton delay={2} />
                      </>
                    )}
                    {!ttTopLoading && ttTopRuns.length === 0 && (
                      <div className="z1-placeholder z1-placeholder--no-cross">
                        <div className="z1-placeholder__body">
                          <p className="z1-placeholder__pitch">No sets found.</p>
                        </div>
                      </div>
                    )}
                    {ttTopRuns.map((run) => (
                      <RunRow key={run.runId} run={run} />
                    ))}
                  </>
                )}

                {/* ── Live mode: the unified live feed ────────────────────── */}
                {effectiveTtMode === "live" && (
                  <>
                    {/* While crossing scores are pending, the crossing rows'
                        slot shows a context-sensitive skeleton — strict mutual
                        exclusion with reason rows (the feed withholds them via
                        reasonRows=[] while crossingsLoading). The rest of the
                        feed and the offline section render regardless. */}
                    {!inContext && showSkeleton && (
                      <Zone1Placeholder
                        isSpotifyConnected={isSpotifyConnected}
                        hasLibrary={hasLibrary}
                        hasSeeds={hasSeeds || visibleSeeds.length > 0}
                        seeds={visibleSeeds}
                        liveLoading={liveLoading}
                        onAddSeed={addSeed}
                        onRemoveSeed={removeSeed}
                      />
                    )}

                    {/* Filter menus — song-age tiers (left) and station
                        categories (right). Live mode only; hidden while a
                        gesture mode (sleep / era-genre) owns the station list. */}
                    {!inContext && !hiddenModeActive && (
                      <DialFilterBar
                        activeTiers={activeTiers}
                        activeCategories={activeCategories}
                        onToggleTier={toggleTier}
                        onToggleCategory={toggleCategory}
                      />
                    )}

                    {/* The unified feed: every live station, crossing matches
                        ranked first (▲) or last (▼). Grows via infinite scroll. */}
                    {!inContext && feedSection}

                    {/* Skeleton deadline expired but the server is still computing —
                        honest in-progress copy; live rows keep rendering below.
                        The 4s repoll keeps running; rows replace this when they land. */}
                    {!inContext && !crossingsLoading && withReason.length === 0 && (hasLibrary || hasSeeds || visibleSeeds.length > 0) && !liveLoading && cxPhase === "computing" && (
                      <div className="z1-placeholder z1-placeholder--computing">
                        <div className="z1-placeholder__body">
                          <p className="z1-placeholder__pitch">
                            Still finding matches for your artists — this can take a moment on a fresh start.
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Compute failed or stalled far past reasonable bounds —
                        honest terminal copy; background retries continue. */}
                    {!inContext && !crossingsLoading && withReason.length === 0 && (hasLibrary || hasSeeds || visibleSeeds.length > 0) && !liveLoading && (cxPhase === "failed" || cxPhase === "stalled") && (
                      <div className="z1-placeholder z1-placeholder--cross-error">
                        <div className="z1-placeholder__body">
                          <p className="z1-placeholder__pitch">
                            We couldn't check your artist matches right now. We'll keep trying — check back in a moment.
                          </p>
                        </div>
                      </div>
                    )}

                    {/* No crossing rows, no library or seeds — onboarding placeholder.
                        The prominent CTA lives inside Zone1Placeholder for this state.
                        The live feed still renders below it. */}
                    {!inContext && !crossingsLoading && withReason.length === 0 &&
                      !hasLibrary &&
                      !hasSeeds &&
                      visibleSeeds.length === 0 &&
                      !isSpotifyConnected && (
                      <>
                        <Zone1Placeholder
                          isSpotifyConnected={isSpotifyConnected}
                          hasLibrary={hasLibrary}
                          hasSeeds={hasSeeds || visibleSeeds.length > 0}
                          seeds={visibleSeeds}
                          liveLoading={liveLoading}
                          onAddSeed={addSeed}
                          onRemoveSeed={removeSeed}
                          liveSuggestions={liveArtistSuggestions}
                          stations={stations}
                          onTune={(slug) => {
                            const ds = stations.find((s) => s.station.slug === slug);
                            if (ds && resolvePlaybackSource(ds.station) != null) {
                              void radio.toggle(ds.station);
                            }
                          }}
                        />
                      </>
                    )}

                    {/* Ghost stations — "Missed while you were away" subsection.
                        Offline/missed playback, so it stays separate from the
                        live feed. Hidden in context mode. */}
                    {!inContext && ghost.length > 0 && (
                      <Zone2Lane
                        ghost={ghost}
                        activeSlug={radio.station?.slug ?? null}
                        onTuneGhost={tuneGhost}
                      />
                    )}

                    {/* Live-feed skeleton — shown while the first live pulse is
                        still in-flight and no stations have appeared. */}
                    {liveLoading && sortedRows.length === 0 && (
                      <>
                        <DialRowSkeleton delay={0} />
                        <DialRowSkeleton delay={1} />
                        <DialRowSkeleton delay={2} />
                      </>
                    )}

                    {/* Library/seeds exist but nothing has crossed today — helpful
                        nudge, only when NO live stations render at all (otherwise
                        the feed itself is the answer: matched rows lead, everything
                        else still shows). Only the settled phase may claim "none
                        played" — see CrossingsPhase. */}
                    {!inContext && !crossingsLoading && withReason.length === 0 && sortedRows.length === 0 && (hasLibrary || hasSeeds || visibleSeeds.length > 0) && !liveLoading && cxPhase === "settled" && (
                      <div className="z1-placeholder z1-placeholder--no-cross z1-placeholder--compact">
                        <div className="z1-placeholder__body">
                          <p className="z1-placeholder__pitch">
                            None of your artists have played on a live station today. Tune into a station or check back later.
                          </p>
                          {visibleSeeds.length > 0 && (
                            <div className="z1-placeholder__seedchips">
                              {sortTasteSeeds(visibleSeeds).map((artist, index) => (
                                <button
                                  key={`${artist}-${index}`}
                                  type="button"
                                  className="z1-placeholder__seedchip"
                                  aria-label={`Remove ${artist}`}
                                  onClick={() => removeSeed(artist)}
                                >
                                  {artist} <span aria-hidden="true">×</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* ── Past mode: ghost rows (live feed suppressed) ────────── */}
                {!inContext && effectiveTtMode === "past" && ghost.length > 0 && (
                  <Zone2Lane
                    ghost={ghost}
                    activeSlug={radio.station?.slug ?? null}
                    onTuneGhost={tuneGhost}
                  />
                )}
              </>
            )}


            {/* Error state: station-list request failed */}
            {!isCoreLoading && stationsError && (
              <div className="dial-error">
                <span className="dial-error__msg">Station data unavailable</span>
                <button
                  type="button"
                  className="dial-error__retry"
                  onClick={refetchStations}
                  aria-label="Retry loading stations"
                >
                  Retry
                </button>
              </div>
            )}

            {/* Spinner while the live pulse hasn't arrived yet */}
            {isCoreLoading && (
              <div className="dial-loading">Loading stations…</div>
            )}

            {sortedRows.length === 0 && offlineStations.length === 0 && !isLoading && !stationsError && (
              <div className="dial-loading" style={{ opacity: 0.4 }}>No stations online</div>
            )}
          </>
        )}

        {/* STATION detail level */}
        {level === "station" && currentStation && (
          <>
            <StationDetailView
              dialStation={currentStation}
              onShowClick={(show) => goShow(show, currentStation)}
            />
          </>
        )}

        {/* SHOW tracklist level */}
        {level === "show" && currentShow && currentStation && (
          <>
            <ShowTracklistView
              show={currentShow}
              station={currentStation}
              allStationsData={stations}
              onDjClick={goDj}
            />
          </>
        )}

        {/* DJ level */}
        {level === "dj" && currentDjName && (
          <>
            <DjView
              djName={currentDjName}
              allStations={stations}
              onShowClick={(show, station) => goShow(show, station)}
            />
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Zone 1 loading placeholder
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// DialRowSkeleton — shimmer placeholder that mimics the shape of a FrontDoorRow
// ---------------------------------------------------------------------------

function DialRowSkeleton({ delay = 0 }: { delay?: 0 | 1 | 2 }) {
  return (
    <div className="fdrow-skeleton" style={{ "--delay": delay } as React.CSSProperties}>
      <div className="fdrow-skeleton__name" />
      <div className="fdrow-skeleton__sub" />
    </div>
  );
}

function Zone1Placeholder({
  isSpotifyConnected,
  hasLibrary,
  hasSeeds,
  seeds,
  liveLoading: _liveLoading,
  onAddSeed,
  onRemoveSeed: _onRemoveSeed,
  liveSuggestions: _liveSuggestions = [],
  stations = [],
  onTune,
}: {
  isSpotifyConnected: boolean;
  hasLibrary: boolean;
  hasSeeds: boolean;
  seeds: string[];
  liveLoading: boolean;
  onAddSeed: (artist: string) => void;
  onRemoveSeed: (artist: string) => void;
  liveSuggestions?: LiveArtistSuggestion[];
  stations?: DialStation[];
  onTune?: (slug: string) => void;
}) {
  if (hasLibrary || isSpotifyConnected) {
    // Library imported or Spotify connected — crossings are being computed.
    return (
      <div className="z1-placeholder z1-placeholder--loading">
        <div className="z1-placeholder__status">
          <span className="dial-live-skeleton__pip" />
          <span className="z1-placeholder__lbl">Finding which stations are playing your music…</span>
        </div>
        <DialRowSkeleton delay={0} />
        <DialRowSkeleton delay={1} />
      </div>
    );
  }

  if (hasSeeds) {
    return (
      <div className="z1-placeholder z1-placeholder--seeded">
        <div className="z1-placeholder__status">
          <span className="dial-live-skeleton__pip" />
          <span className="z1-placeholder__lbl">Finding live matches for your artists…</span>
        </div>
        <DialRowSkeleton delay={0} />
      </div>
    );
  }

  // New user — station sentences only, no inline add-artist entry point.
  return (
    <div className="z1-placeholder z1-placeholder--first-run">
      <FirstRunSidebar
        stations={stations}
        seeds={seeds}
        onAddSeed={onAddSeed}
        onTune={onTune ?? (() => undefined)}
      />
    </div>
  );
}

export function LiveArtistPicker({
  suggestions,
  artists,
  loading,
  seeds,
  onAddSeed,
  mattStarterAvailable = false,
  mattStarterCopying = false,
  mattStarterError = null,
  onStartMattLibrary,
}: {
  suggestions?: LiveArtistSuggestion[];
  /** Unified historical + live list. Optional for callers that only show live data. */
  artists?: OnboardingArtistSuggestion[];
  loading: boolean;
  seeds: string[];
  onAddSeed: (artist: string) => void;
  mattStarterAvailable?: boolean;
  mattStarterCopying?: boolean;
  mattStarterError?: string | null;
  onStartMattLibrary?: () => void;
}) {
  const liveSuggestions = suggestions ?? [];
  const selected = new Set(seeds.map((seed) => liveIdentityKey(seed)));
  const rows: OnboardingArtistSuggestion[] = artists?.length
    ? artists
    : liveSuggestions.map((suggestion) => ({
        ...suggestion,
        live: true,
        playCount: suggestion.playCount ?? null,
      }));
  return (
    <section className="live-artist-picker" aria-labelledby="live-artist-picker-label">
      <div className="live-artist-picker__heading">
        <span className="live-artist-picker__pip" aria-hidden="true" />
        <div>
          <h2 id="live-artist-picker-label">Artists to start with</h2>
          <p>Choose one of Lore’s most-played artists, or jump into what is live now.</p>
        </div>
      </div>
      {mattStarterAvailable && onStartMattLibrary && (
        <div className="live-artist-picker__starter">
          <button
            type="button"
            className="live-artist-picker__option live-artist-picker__option--starter"
            onClick={onStartMattLibrary}
            disabled={mattStarterCopying}
            aria-label="Start with Matt’s library"
          >
            <span className="live-artist-picker__artist">Start with Matt’s library</span>
            <span className="live-artist-picker__context">A resolved starter library, ready for Lore crossings</span>
            <span className="live-artist-picker__action">{mattStarterCopying ? "Adding…" : "Start here"}</span>
          </button>
          {mattStarterError && (
            <div className="live-artist-picker__state" role="alert">
              {mattStarterError.includes("not available")
                ? mattStarterError
                : "We couldn’t add Matt’s library. Try again or choose an artist below."}
            </div>
          )}
        </div>
      )}
      {loading && rows.length === 0 ? (
        <div className="live-artist-picker__state" role="status">Listening for artists on air…</div>
      ) : rows.length > 0 ? (
        <>
          <div className="live-artist-picker__options">
            {rows.map((suggestion) => {
            const isSelected = selected.has(liveIdentityKey(suggestion.artist));
            const isAtLimit = seeds.length >= MAX_TASTE_SEEDS && !isSelected;
            return (
              <button
                key={suggestion.artist.toLocaleLowerCase()}
                type="button"
                className={`live-artist-picker__option${isSelected ? " live-artist-picker__option--selected" : ""}${suggestion.live ? " live-artist-picker__option--live" : ""}`}
                aria-pressed={isSelected}
                aria-label={`${isSelected ? "Selected" : "Choose"} ${suggestion.artist}`}
                disabled={isAtLimit}
                onClick={() => onAddSeed(suggestion.artist)}
              >
                <span className="live-artist-picker__artist">{suggestion.artist}</span>
                <span className="live-artist-picker__context">
                  {suggestion.live
                    ? [
                        suggestion.djName,
                        suggestion.showName,
                        suggestion.stationName,
                        "live now",
                      ].filter(Boolean).join(" · ")
                    : suggestion.playCount != null
                      ? `${suggestion.playCount} plays in Lore`
                      : "Lore history"}
                </span>
                <span className="live-artist-picker__action">
                  {suggestion.live ? "live now · " : ""}
                  {isSelected ? "Selected" : "Choose"}
                </span>
              </button>
            );
            })}
          </div>
          {seeds.length >= MAX_TASTE_SEEDS && (
            <div className="live-artist-picker__limit" role="status">
              Seed limit reached — remove one below to choose another.
            </div>
          )}
        </>
      ) : (
        <div className="live-artist-picker__state">No artist names are available right now. You can add one below.</div>
      )}
    </section>
  );
}
