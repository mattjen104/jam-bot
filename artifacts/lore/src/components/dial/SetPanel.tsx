/**
 * SetPanel — set-panel types, helpers, and the TabbedSetPanel component.
 *
 * Extracted from DialView.tsx. All exports are re-exported from DialView so
 * existing test imports continue to resolve through that module.
 */
import { useState, useMemo, useEffect, useRef, type ReactNode } from "react";
import { Download, Play, X } from "lucide-react";
import { artistFrameId } from "../ContextRail";
import { SetQueueList, type QueueArtist } from "./FrontDoorRow";
import type { DialStation, DialShow, DialSpin } from "../../hooks/useDialData";

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/** Format an ISO timestamp as "h:mm[am|pm]" in the given timezone. */
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

// ---------------------------------------------------------------------------
// computeLivePanel
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// useLivePanelSync
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// SetPanelSet
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// TabbedSetPanel
// ---------------------------------------------------------------------------

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
