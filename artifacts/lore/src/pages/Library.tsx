import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { proxyArtUrl } from "../lib/proxyArt";
import { onArtError } from "../lib/rumours";
import { Link, useLocation, useSearch } from "wouter";
import { SearchOverlay } from "../components/SearchOverlay";
import { useQueryClient } from "@tanstack/react-query";
import { usePlayer } from "../player/PlayerProvider";
import {
  useMyLibraryInfinite,
  useMyImportStats,
  useMyConnections,
  useLatestImportJob,
  useLatestSyncJob,
  startSpotifyLibraryReconnect,
  postStartImport,
  postStartSync,
  postStartSpotifyUrlImport,
  postImportLibraryFile,
  useMyPreferences,
  patchPreferences,
  useMyTasteSeedCatalogue,
  useAppConfig,
  ME_PREFERENCES_KEY,
  ME_LATEST_IMPORT_JOB_KEY,
  ME_LATEST_SYNC_JOB_KEY,
  ME_OVERLAP_PICKERS_KEY,
  ME_OVERLAP_STATIONS_KEY,
  ME_OVERLAP_RUNS_KEY,
  useMyLibraryCoverage,
  useMyAlbumAvatar,
  useMyLibraryAlbums,
  ME_LIBRARY_COVERAGE_KEY,
  useMyInvestigationCoverage,
  type LibraryCoverageList,
  type FileImportSummary,
  type LibraryAlbumItem,
  type LibraryItem,
  type SyncJobStatus,
  type TasteSeedCatalogue,
} from "../lib/meHooks";
import {
  ApiError,
  getSearchArtistStationsQueryKey,
  getSuggestArchiveArtistsQueryKey,
  useSearchArtistStations,
  useSuggestArchiveArtists,
} from "@workspace/api-client-react";
import { LibraryRow } from "../components/LibraryRow";
import { StackRow } from "../components/StackRow";
import { useStackSkipped } from "../lib/dialFilterState";
import { AlbumAvatarPicker } from "../components/AlbumAvatarPicker";
import {
  ArrowUpDown,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Grid2X2,
  List,
  Loader2,
  Radio,
  Search,
  Upload,
  XCircle,
} from "lucide-react";
import { YourWeekCard } from "../components/YourWeekCard";
import { writeLibraryFallbackIfAbsent } from "../player/sectionMemory";
import { LibraryCrate } from "../components/LibraryCrate";
import {
  removeLibraryMatchFilter,
  type LibraryMatchEvidence as MatchEvidence,
} from "../lib/libraryMatchEvidence";
import { useSeedManager } from "../hooks/useSeedManager";
import {
  crossingCountForScope,
  firstPlayCountForScope,
  type CrossingScope,
} from "../lib/crossingScope";
import { ArtistDocument } from "../components/ArtistDocument";
import { RadioSurface } from "../components/RadioSurface";
import { StationSetSidebar } from "../components/dial/StationSetSidebar";
import {
  DemoSongRemote,
  DemoStationRemote,
} from "../components/DemoLibraryRemote";
import { WorkflowAlbums } from "../components/WorkflowAlbums";
import { DemoMerchView } from "../components/DemoMerchView";
import { HomePress } from "../components/HomePress";
import { useDialData } from "../hooks/useDialData";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { MoonPhaseGlyph } from "../components/MoonPhaseGlyph";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandItem } from "@/components/ui/command";
import {
  LibraryStationFilters,
  deriveLibraryFocus,
  hasLegacyLibraryMetadata,
  writeLibraryFocus,
  type LibraryFocus,
} from "../components/LibraryMetadataFilters";
import {
  STATION_CATEGORY_DEFINITIONS,
  type StationCategory,
} from "../lib/dialCategories";
import {
  countBroZones,
  filterBroZoneCollection,
  parseBroZoneState,
  stationBroZones,
  writeBroZoneState,
} from "../lib/broZones";
import {
  sortBroZoneStationsByDistance,
  type BroZoneOrigin,
} from "../lib/broZoneProximity";
import {
  buildFocusedLibraryUrl,
  buildLibraryEntityUrl,
  getArtistFromLibraryAlbumKey,
} from "../lib/libraryFocusedNavigation";
import {
  SPECIALIST_SUBCATEGORY_DEFINITIONS,
  specialistSubcategoryForStation,
  type SpecialistSubcategory,
} from "../lib/specialistCategories";

// ---------------------------------------------------------------------------
// Ledger consent helpers
// ---------------------------------------------------------------------------
const LEDGER_PROMPT_DISMISSED_KEY = "lore:ledger_prompt_dismissed_until";
const LEDGER_PROMPT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DEMO_STATION_CATEGORY_KEYS = new Set<StationCategory>(
  STATION_CATEGORY_DEFINITIONS.map(({ cat }) => cat),
);

/**
 * Whether the ledger prompt's dismissal TTL has elapsed. Reads localStorage and
 * Date.now (both impure), so callers must snapshot the result (e.g. in a
 * useState initializer) rather than call it during render.
 */
function ledgerPromptDismissGatePassed(): boolean {
  try {
    const until = Number(localStorage.getItem(LEDGER_PROMPT_DISMISSED_KEY) ?? 0);
    return Date.now() >= until;
  } catch { return true; }
}
function dismissLedgerPrompt(): void {
  try {
    localStorage.setItem(
      LEDGER_PROMPT_DISMISSED_KEY,
      String(Date.now() + LEDGER_PROMPT_TTL_MS),
    );
  } catch { /* storage unavailable */ }
}

// ---------------------------------------------------------------------------
// Section header
// ---------------------------------------------------------------------------
function TierHd({
  label,
  count,
  hint,
  live,
}: {
  label: string;
  count?: number | string;
  hint?: string;
  live?: boolean;
}) {
  return (
    <div className="dial-tier-hd">
      <span className={`dial-tier-hd__label${live ? " dial-tier-hd__label--live" : ""}`}>
        {live && "● "}
        {label}
        {count != null && <span style={{ fontFamily: "var(--app-font-mono)", fontWeight: 400 }}> · {count}</span>}
      </span>
      {hint && (
        <span
          style={{
            fontFamily: "var(--app-font-mono)",
            fontSize: 10,
            color: "hsl(var(--faint))",
            margin: "0 8px",
            whiteSpace: "nowrap",
          }}
        >
          {hint}
        </span>
      )}
      <div className="dial-tier-hd__rule" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sync bar
// ---------------------------------------------------------------------------
export function SyncBar({
  syncJobData,
  syncBusy,
  isSyncActive,
  syncError,
  syncNeedsReconnect,
  syncReceiptOpen,
  reconnectBusy,
  onSync,
  onReconnect,
  onToggleReceipt,
}: {
  syncJobData: SyncJobStatus | null | undefined;
  syncBusy: boolean;
  isSyncActive: boolean;
  syncError: string | null;
  syncNeedsReconnect: boolean;
  syncReceiptOpen: boolean;
  reconnectBusy: boolean;
  onSync: () => void;
  onReconnect: () => void;
  onToggleReceipt: () => void;
}) {
  const lastSync = syncJobData?.finishedAt
    ? new Date(syncJobData.finishedAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <div data-testid="library-sync">
      <div className="dial-ctabar">
        <span className="dial-ctabar__label">
          {isSyncActive
            ? syncJobData?.resumedFrom != null && syncJobData?.phase === "matching"
              ? "Resuming…"
              : syncJobData?.phase === "matching"
              ? "Matching on Spotify…"
              : syncJobData?.phase === "checking"
              ? "Checking saved…"
              : syncJobData?.phase === "saving"
              ? "Saving to Spotify…"
              : "Syncing…"
            : syncJobData?.status === "done"
            ? `Synced ${lastSync ?? "recently"}`
            : "Export keeps → Spotify"}
        </span>
        {syncJobData?.status === "done" && syncJobData.results && syncJobData.results.synced > 0 && (
          <span
            style={{
              fontFamily: "var(--app-font-mono)",
              fontSize: 10,
              color: "hsl(var(--library))",
              marginRight: 6,
            }}
          >
            {syncJobData.results.synced} saved
          </span>
        )}
        <button
          type="button"
          disabled={syncBusy || isSyncActive}
          onClick={onSync}
          className="dial-ctabtn"
          data-testid="library-sync-button"
        >
          {isSyncActive ? (
            <Loader2
              style={{ display: "inline", width: 10, height: 10, animation: "lore-eq 1s linear infinite" }}
            />
          ) : (
            <Upload style={{ display: "inline", width: 10, height: 10, marginRight: 4, verticalAlign: "middle" }} />
          )}
          {isSyncActive ? "Syncing…" : "Sync now"}
        </button>
      </div>
      {isSyncActive && syncJobData && syncJobData.total > 0 && (
        <div style={{ height: 2, background: "hsl(var(--border))" }}>
          <div
            style={{
              height: "100%",
              background: "hsl(var(--library))",
              width: `${Math.min(100, (syncJobData.processed / syncJobData.total) * 100)}%`,
              transition: "width 0.7s",
            }}
          />
        </div>
      )}
      {syncError && (
        <div
          style={{ padding: "8px 15px", borderBottom: "1px solid hsl(var(--border) / 0.5)" }}
          data-testid="library-sync-error"
        >
          <p style={{ fontFamily: "var(--app-font-mono)", fontSize: 12, color: "hsl(var(--destructive))" }}>
            {syncError}
          </p>
          {syncNeedsReconnect && (
            <button
              type="button"
              onClick={onReconnect}
              disabled={reconnectBusy}
              className="dial-ctabtn"
              style={{ marginTop: 6 }}
              data-testid="library-reconnect-spotify"
            >
              {reconnectBusy ? "…" : "Reconnect Spotify"}
            </button>
          )}
        </div>
      )}
      {syncJobData?.status === "error" && (
        <div style={{ padding: "8px 15px", borderBottom: "1px solid hsl(var(--border) / 0.5)" }}>
          <p
            style={{ fontFamily: "var(--app-font-mono)", fontSize: 12, color: "hsl(var(--destructive))" }}
            data-testid="library-sync-job-error"
          >
            {syncJobData.error ?? "Sync failed — try again."}
          </p>
          {syncJobData.error?.toLowerCase().includes("reconnect spotify") ? (
            <button
              type="button"
              onClick={onReconnect}
              disabled={reconnectBusy}
              className="dial-ctabtn"
              style={{ marginTop: 6 }}
              data-testid="library-reconnect-spotify"
            >
              {reconnectBusy ? "…" : "Reconnect Spotify"}
            </button>
          ) : (
            <button
              type="button"
              onClick={onSync}
              disabled={syncBusy || isSyncActive}
              className="dial-ctabtn"
              style={{ marginTop: 6 }}
              data-testid="library-sync-again"
            >
              Sync again
            </button>
          )}
        </div>
      )}
      {syncJobData?.status === "done" &&
        syncJobData.results &&
        (syncJobData.results.unavailableItems.length > 0 ||
          syncJobData.results.searchMatchedItems.length > 0) && (
          <div style={{ padding: "7px 15px", borderBottom: "1px solid hsl(var(--border) / 0.5)" }}>
            <button
              type="button"
              onClick={onToggleReceipt}
              style={{
                fontFamily: "var(--app-font-mono)",
                fontSize: 12,
                color: "hsl(var(--dim))",
                background: "none",
                border: "none",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
              data-testid="library-sync-receipt-toggle"
            >
              {syncReceiptOpen ? (
                <ChevronUp style={{ width: 10, height: 10 }} />
              ) : (
                <ChevronDown style={{ width: 10, height: 10 }} />
              )}
              {syncReceiptOpen ? "Hide details" : "Show match details"}
            </button>
          </div>
        )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Unavailable / search-matched rows (sync receipts)
// ---------------------------------------------------------------------------
function UnavailableRow({
  item,
}: {
  item: { mbid: string; title: string; artist: string; bandcampUrl: string };
}) {
  return (
    <div className="lib-ol-row" style={{ cursor: "default" }} data-testid="library-unavailable-row">
      <span className="lib-ol-row__dot" style={{ background: "hsl(var(--faint))" }} />
      <div className="lib-ol-row__body">
        <div className="lib-ol-row__name">{item.title}</div>
        <div className="lib-ol-row__sub">{item.artist}</div>
      </div>
      <a
        href={item.bandcampUrl}
        target="_blank"
        rel="noreferrer"
        className="dial-ctabtn"
        style={{ textDecoration: "none" }}
        onClick={(e) => e.stopPropagation()}
      >
        Bandcamp ↗
      </a>
    </div>
  );
}

function SearchMatchedRow({
  item,
}: {
  item: { mbid: string; title: string; artist: string; spotifyUrl: string };
}) {
  return (
    <div className="lib-ol-row" style={{ cursor: "default" }}>
      <span className="lib-ol-row__dot" style={{ background: "hsl(var(--keep))" }} />
      <div className="lib-ol-row__body">
        <div className="lib-ol-row__name">{item.title}</div>
        <div className="lib-ol-row__sub">{item.artist}</div>
      </div>
      <a
        href={item.spotifyUrl}
        target="_blank"
        rel="noreferrer"
        className="dial-ctabtn"
        style={{ textDecoration: "none" }}
        onClick={(e) => e.stopPropagation()}
      >
        Spotify ↗
      </a>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Import banner
// ---------------------------------------------------------------------------
function phaseLabel(phase: string | null | undefined): string {
  switch (phase) {
    case "fetching":    return "Reading your Spotify library…";
    case "spine":
    case "cache":       return "Checking spine…";
    case "resolve":     return "Resolving new tracks…";
    default:            return "Connecting to Spotify…";
  }
}

export function LibraryImportBanner({
  job,
  onDismiss,
}: {
  job: {
    status: string;
    phase?: string | null;
    total: number;
    resolved: number;
    error: string | null;
  };
  onDismiss: () => void;
}) {
  const isError = job.status === "error";
  const isDone = job.status === "done";
  const isFetchingPhase = job.phase === "fetching";
  /** True while Phase 3 is paused waiting for MusicBrainz to recover. */
  const isBackoff = !isError && !isDone && job.error === "resolve:backoff";
  const label = isError ? "Import failed" : isDone ? "Library imported" : isBackoff ? "Resolving new tracks…" : phaseLabel(job.phase);
  const accent = isError ? "var(--destructive)" : "var(--keep)";
  const progressPct = job.total > 0 ? Math.min(100, (job.resolved / job.total) * 100) : 0;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        borderBottom: "1px solid hsl(var(--border))",
        background: "hsl(var(--card))",
        flexShrink: 0,
        overflow: "hidden",
      }}
      data-testid="library-import-banner"
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 15px" }}>
        {isError ? (
          <XCircle style={{ width: 12, height: 12, flexShrink: 0, color: `hsl(${accent})` }} />
        ) : isDone ? (
          <CheckCircle2 style={{ width: 12, height: 12, flexShrink: 0, color: `hsl(${accent})` }} />
        ) : (
          <Loader2
            style={{ width: 12, height: 12, flexShrink: 0, color: `hsl(${accent})`, animation: "lore-eq 1s linear infinite" }}
          />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: "var(--app-font-display)",
              fontSize: 10,
              fontWeight: 400,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              color: `hsl(${accent})`,
            }}
          >
            {label}
          </div>
          {isDone && (() => {
            const unresolved = Math.max(0, job.total - job.resolved);
            return (
              <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 12, color: "hsl(var(--dim))", marginTop: 2 }}>
                {job.resolved.toLocaleString()} of {job.total.toLocaleString()} track{job.total === 1 ? "" : "s"} matched
                {unresolved > 0 && (
                  <span style={{ color: "hsl(var(--faint))" }}>
                    {" · "}{unresolved.toLocaleString()} resolving overnight
                  </span>
                )}
              </div>
            );
          })()}
          {!isDone && !isError && job.total > 0 && (
            <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 12, color: "hsl(var(--dim))", marginTop: 2 }}>
              {isBackoff
                ? "MusicBrainz is busy — resuming shortly"
                : isFetchingPhase
                  ? `Found ${job.total.toLocaleString()} tracks…`
                  : `${job.resolved.toLocaleString()} / ~${job.total.toLocaleString()}`}
            </div>
          )}
          {isError && job.error && (
            <div
              style={{ fontFamily: "var(--app-font-mono)", fontSize: 12, color: "hsl(var(--destructive))", marginTop: 2 }}
            >
              {job.error}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          style={{
            fontFamily: "var(--app-font-display)",
            fontSize: 10,
            textTransform: "uppercase",
            letterSpacing: "0.07em",
            color: "hsl(var(--faint))",
            background: "none",
            border: "none",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          dismiss
        </button>
      </div>
      {!isDone && !isError && job.total > 0 && (
        <div style={{ height: 2, background: "hsl(var(--border))" }}>
          <div
            style={{
              height: "100%",
              background: `hsl(${accent})`,
              width: `${progressPct}%`,
              transition: "width 0.7s",
            }}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inflow card (new-from-selectors grid item)
// ---------------------------------------------------------------------------
function artGradient(a: string, b: string): string {
  let x = 0;
  for (const c of a + b) x = ((x * 31 + c.charCodeAt(0)) >>> 0);
  const h = x % 360;
  // Three-tone rule: album art is the only saturated element — the fallback
  // gradient stays grayscale, varying only in lightness per title/artist hash.
  return `linear-gradient(150deg,hsl(0,0%,${14 + (h % 8)}%),hsl(0,0%,${24 + ((h >> 3) % 10)}%))`;
}

// ---------------------------------------------------------------------------
// FocusState model — the Library is one chronological timeline (imports at import
// date, keeps at keep date) with lenses layered on top instead of source tabs.
// ---------------------------------------------------------------------------

/** "" = the default mixed chronological timeline. */
export type FocusState = "" | "recent" | "albums" | "artists" | "lore" | "matching" | "critic";

/** Parse the ?focusMode= URL param; unrecognised values fall back to the timeline. */
export function parseFocusState(search: string): FocusState {
  const v = new URLSearchParams(search).get("focusMode");
  if (v === "recent" || v === "albums" || v === "artists" || v === "lore" || v === "matching" || v === "critic") {
    return v;
  }
  return "";
}

/** Server-side source scope per focusMode (undefined = full mixed feed). */
export const FOCUS_SOURCE: Record<FocusState, "keep" | "soft" | "critic" | "lore" | undefined> = {
  "": undefined,
  recent: "keep",
  albums: undefined,
  artists: undefined,
  // Scoped server-side (all explicit keeps: radio provenance or direct) so
  // pagination and the page-1 total reflect exactly the From Lore feed —
  // client filtering over the generic keep feed can strand matching rows
  // behind an empty page 1.
  lore: "lore",
  matching: "soft",
  critic: "critic",
};

/** True when a keep row carries radio provenance (picker or station). */
export function hasRadioProvenance(item: LibraryItem): boolean {
  return (
    item.provenance.kind === "keep" &&
    (item.provenance.pickerHandle != null ||
      item.provenance.pickerName != null ||
      item.provenance.stationSlug != null ||
      item.provenance.stationName != null)
  );
}

// Note: the mixed timeline needs no client-side merge — the server already
// stores at most one resolved row per track (unique user+mbid) and derives
// the dual-source "kept + also imported" flag from import traces, so rows
// arrive deduplicated with `dualSource` set where applicable.

// ---------------------------------------------------------------------------
// Grouped-view helpers
// ---------------------------------------------------------------------------

export interface AlbumGroup {
  key: string;
  albumTitle: string;
  artist: string;
  artworkUrl: string | null;
  /** First non-null release year carried by any item in the group. */
  releaseYear: number | null;
  releaseGroupMbid?: string | null;
  items: LibraryItem[];
}

export interface ArtistGroup {
  key: string;
  artist: string;
  artistMbid?: string | null;
  items: LibraryItem[];
  /** Albums nested inside this artist, in encountered order */
  albums: AlbumGroup[];
}

export type DemoSongSort = "added" | "artist" | "album" | "title" | "count";

export function parseDemoSongSort(value: string | null): DemoSongSort {
  return value === "artist"
    || value === "album"
    || value === "title"
    || value === "count"
    ? value
    : "added";
}

export function effectiveDemoSongSort(focusMode: LibraryFocus, sort: DemoSongSort): DemoSongSort {
  if (focusMode === "artist") {
    return sort === "artist" || sort === "title" || sort === "album" ? sort : "added";
  }
  if (focusMode === "genre" || focusMode === "era") return sort === "title" ? sort : "added";
  return sort;
}

export function buildAlbumGroups(items: LibraryItem[]): AlbumGroup[] {
  const map = new Map<string, AlbumGroup>();
  for (const item of items) {
    const albumTitle = item.recording?.albumTitle ?? "";
    const artist = item.recording?.artist ?? "";
    const key = `${albumTitle}\x1f${artist}`;
    let group = map.get(key);
    if (!group) {
      group = {
        key,
        albumTitle: albumTitle || artist || "Unknown album",
        artist,
        artworkUrl: null,
        releaseYear: null,
        releaseGroupMbid: null,
        items: [],
      };
      map.set(key, group);
    }
    if (!group.artworkUrl && item.recording?.artworkUrl) {
      group.artworkUrl = item.recording.artworkUrl;
    }
    if (group.releaseYear == null && item.recording?.releaseYear != null) {
      group.releaseYear = item.recording.releaseYear;
    }
    if (group.releaseGroupMbid == null && item.recording?.releaseGroupMbid != null) {
      group.releaseGroupMbid = item.recording.releaseGroupMbid;
    }
    group.items.push(item);
  }
  return [...map.values()];
}

export function buildArtistGroups(items: LibraryItem[], seedArtists: string[] = []): ArtistGroup[] {
  const artistMap = new Map<string, ArtistGroup>();
  for (const item of items) {
    const artist = item.recording?.artist ?? "Unknown artist";
    const key = artist.trim().toLocaleLowerCase();
    let ag = artistMap.get(key);
    if (!ag) {
      ag = {
        key,
        artist,
        artistMbid: item.recording?.artistMbid ?? null,
        items: [],
        albums: [],
      };
      artistMap.set(key, ag);
    }
    if (!ag.artistMbid && item.recording?.artistMbid) {
      ag.artistMbid = item.recording.artistMbid;
    }
    ag.items.push(item);
  }
  for (const seedArtist of seedArtists) {
    const artist = seedArtist.trim();
    if (!artist) continue;
    const key = artist.toLocaleLowerCase();
    if (!artistMap.has(key)) {
      artistMap.set(key, {
        key,
        artist,
        artistMbid: null,
        items: [],
        albums: [],
      });
    }
  }
  // Build per-artist album sub-groups (preserving track order within each artist)
  for (const ag of artistMap.values()) {
    ag.albums = buildAlbumGroups(ag.items).sort((a, b) =>
      a.albumTitle.localeCompare(b.albumTitle, undefined, { sensitivity: "base" }),
    );
  }
  return [...artistMap.values()].sort((a, b) =>
    a.artist.localeCompare(b.artist, undefined, { sensitivity: "base" }),
  );
}

// ---------------------------------------------------------------------------
// AlbumGroupRow — collapsible album bucket
// ---------------------------------------------------------------------------
export function AlbumGroupRow({
  group,
  openDoorMbid,
  setOpenDoorMbid,
  openShelfMbid,
  setOpenShelfMbid,
  forceOpen,
  onMakeAvatar,
  avatarRecordingMbid,
  onInvestigate,
}: {
  group: AlbumGroup;
  openDoorMbid: string | null;
  setOpenDoorMbid: (v: string | null) => void;
  openShelfMbid: string | null;
  setOpenShelfMbid: (v: string | null) => void;
  forceOpen?: boolean;
  onMakeAvatar?: (recordingMbid: string) => void;
  avatarRecordingMbid?: string | null;
  onInvestigate?: (group: AlbumGroup) => void;
}) {
  const [open, setOpen] = useState(false);
  const isOpen = forceOpen || open;
  return (
    <div data-testid="library-album-group">
      {/* Group header */}
      <div
        role="button"
        tabIndex={0}
        className="lib-album-group__header"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setOpen((v) => !v); }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 15px",
          cursor: "pointer",
          borderBottom: "1px solid hsl(var(--border) / 0.5)",
          background: isOpen ? "hsl(var(--secondary) / 0.6)" : "transparent",
          transition: "background 0.15s",
        }}
        aria-expanded={isOpen}
      >
        {group.artworkUrl && (
          <>
            <img
              className="lib-album-group__bg-art"
              src={proxyArtUrl(group.artworkUrl) ?? group.artworkUrl}
              alt=""
              aria-hidden="true"
              loading="lazy"
              onError={onArtError}
            />
            <span className="lib-album-group__bg-overlay" aria-hidden="true" />
          </>
        )}
        {/* Artwork swatch */}
        <span
          style={{
            width: 38,
            height: 38,
            flexShrink: 0,
            borderRadius: 3,
            overflow: "hidden",
            display: "block",
          }}
          aria-hidden="true"
        >
          {group.artworkUrl ? (
            <img
              src={proxyArtUrl(group.artworkUrl) ?? group.artworkUrl}
              alt=""
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
              loading="lazy"
              onError={onArtError}
            />
          ) : (
            <span
              style={{
                display: "block",
                width: "100%",
                height: "100%",
                background: artGradient(group.albumTitle, group.artist),
              }}
            />
          )}
        </span>

        {/* Text */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: "var(--app-font-display)",
              fontSize: 15,
              fontWeight: 400,
              color: "hsl(var(--foreground))",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {group.albumTitle}
          </div>
          {group.artist && (
            <div
              style={{
                fontFamily: "var(--app-font-reading)",
                fontSize: 13,
                color: "hsl(var(--dim))",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                marginTop: 1,
              }}
            >
              {group.artist}
            </div>
          )}
        </div>

        {/* Count + chevron */}
        {group.items.some((item) => item.mbid === avatarRecordingMbid) && (
          <span style={{ color: "hsl(var(--library))", fontSize: 13 }} title="Current anonymous listener cover">●</span>
        )}
        {group.items.find((item) => item.mbid)?.mbid && onInvestigate && (
          <button
            type="button"
            className="album-inv__marker"
            title={`Investigate ${group.albumTitle}`}
            aria-label={`Investigate ${group.albumTitle}`}
            onClick={(event) => {
              event.stopPropagation();
              onInvestigate(group);
            }}
          >
            ✳
          </button>
        )}
        {group.items.find((item) => item.mbid)?.mbid && (
          <button
            type="button"
            title="Make this album my avatar"
            aria-label={`Make ${group.albumTitle} my avatar`}
            onClick={(event) => {
              event.stopPropagation();
              const mbid = group.items.find((item) => item.mbid)?.mbid;
              if (mbid) onMakeAvatar?.(mbid);
            }}
            style={{ border: "none", background: "none", color: "hsl(var(--faint))", cursor: "pointer", padding: 3 }}
          >
            ◎
          </button>
        )}
        <span
          style={{
            fontFamily: "var(--app-font-mono)",
            fontSize: 10,
            color: "hsl(var(--faint))",
            flexShrink: 0,
            marginRight: 4,
          }}
        >
          {group.items.length}
        </span>
        {isOpen ? (
          <ChevronUp style={{ width: 10, height: 10, color: "hsl(var(--faint))", flexShrink: 0 }} />
        ) : (
          <ChevronDown style={{ width: 10, height: 10, color: "hsl(var(--faint))", flexShrink: 0 }} />
        )}
      </div>

      {/* Expanded tracks */}
      {isOpen && (
        <ul style={{ margin: 0, padding: 0, listStyle: "none" }} data-testid="library-album-tracks">
          {group.items.map((item) => {
            const rowKey = item.mbid ?? `soft:${item.spotifyId ?? item.addedAt}`;
            return (
              <LibraryRow
                key={rowKey}
                item={item}
                isOpen={item.mbid != null && openDoorMbid === item.mbid}
                onToggle={item.mbid != null
                  ? () => setOpenDoorMbid(openDoorMbid === item.mbid ? null : item.mbid)
                  : undefined}
                isShelfOpen={item.mbid != null && openShelfMbid === item.mbid}
                onShelfToggle={item.mbid != null
                  ? () => setOpenShelfMbid(openShelfMbid === item.mbid ? null : item.mbid)
                  : undefined}
              />
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ArtistGroupRow — compact, non-expanding kept-artist index row
// ---------------------------------------------------------------------------
export function ArtistGroupRow({
  group,
  onArtistFocus,
  returnContext,
}: {
  group: ArtistGroup;
  onArtistFocus?: (artist: string) => void;
  returnContext?: string;
}) {
  const counts = `${group.albums.length} album${group.albums.length === 1 ? "" : "s"} · ${group.items.length} song${group.items.length === 1 ? "" : "s"}`;
  return (
    <div
      data-testid="library-artist-group"
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 10,
        minWidth: 0,
        padding: "9px 15px",
        borderBottom: "1px solid hsl(var(--border) / 0.5)",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        {onArtistFocus ? (
          <button
            type="button"
            onClick={() => onArtistFocus(group.artist)}
            aria-label={`${group.artist}, ${counts}`}
            className="library-demo-artist-group__focus"
            data-testid="link-library-artist"
          >
            {group.artist}
          </button>
        ) : group.artistMbid ? (
          <Link
            href={buildLibraryEntityUrl(`/artist/${encodeURIComponent(group.artistMbid)}`, returnContext, { demoSurface: Boolean(returnContext) })}
            aria-label={`${group.artist}, ${counts}`}
            className="library-demo-artist-group__focus"
            data-testid="link-library-artist"
          >
            {group.artist}
          </Link>
        ) : (
          <span className="library-demo-artist-group__focus">{group.artist}</span>
        )}
      </div>
      <span style={{ flexShrink: 0, whiteSpace: "nowrap", fontFamily: "var(--app-font-mono)", fontSize: 10, color: "hsl(var(--faint))" }}>
        {counts}
      </span>
    </div>
  );
}

function DemoArtistSongGroup({
  group,
  onArtistFocus,
  onAlbumFocus,
  returnContext,
}: {
  group: ArtistGroup;
  onArtistFocus: (artist: string) => void;
  onAlbumFocus: (albumKey: string) => void;
  returnContext?: string;
}) {
  return (
    <section className="library-demo-artist-group">
      <ArtistGroupRow group={group} onArtistFocus={onArtistFocus} returnContext={returnContext} />
      <ul className="library-demo-artist-group__songs">
        {group.items.map((item) => (
          <LibraryRow
            key={item.mbid ?? `soft:${item.spotifyId ?? item.addedAt}`}
            item={item}
            onArtistFocus={onArtistFocus}
            onAlbumFocus={onAlbumFocus}
            returnContext={returnContext}
          />
        ))}
      </ul>
    </section>
  );
}


// ---------------------------------------------------------------------------
// Artist FocusState Control (Combobox + Focus Panel)
// ---------------------------------------------------------------------------
function ArtistFocusControl({
  allArtists,
  artistCrossingCounts,
  visibleSeeds,
  focusedArtist,
  onFocus,
  onClear,
  onAddSeed,
  onRemoveSeed,
}: {
  allArtists: string[];
  artistCrossingCounts: ReadonlyMap<string, number>;
  visibleSeeds: string[];
  focusedArtist: string | null;
  onFocus: (artist: string, artistMbid?: string | null) => void;
  onClear: () => void;
  onAddSeed: (artist: string) => void;
  onRemoveSeed: (artist: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const isSeed = focusedArtist ? visibleSeeds.some(s => s.toLocaleLowerCase() === focusedArtist.toLocaleLowerCase()) : false;
  const isAddedArtist = focusedArtist
    ? allArtists.some(a => a.toLocaleLowerCase() === focusedArtist.toLocaleLowerCase())
    : false;
  const isLibraryArtist = isAddedArtist && !isSeed;

  const normalizedSearch = search.trim().toLocaleLowerCase();
  const debouncedSearch = useDebouncedValue(search.trim(), 150);
  const suggestionsEnabled = open && debouncedSearch.length >= 2;
  const artistSuggestions = useSuggestArchiveArtists(
    { q: debouncedSearch },
    {
      query: {
        queryKey: getSuggestArchiveArtistsQueryKey({ q: debouncedSearch }),
        enabled: suggestionsEnabled,
        staleTime: 5 * 60_000,
      },
    },
  );
  const matches = useMemo(() => {
    if (!normalizedSearch) return allArtists.slice(0, 50);
    const merged = [
      ...(artistSuggestions.data?.suggestions.map(suggestion => suggestion.name) ?? []),
      ...allArtists.filter(a => a.toLocaleLowerCase().includes(normalizedSearch)),
    ];
    return Array.from(
      new Map(merged.map(artist => [artist.toLocaleLowerCase(), artist])).values(),
    ).slice(0, 50);
  }, [allArtists, artistSuggestions.data, normalizedSearch]);
  const suggestedArtistMbids = useMemo(() => {
    const result = new Map<string, string | null>();
    for (const suggestion of artistSuggestions.data?.suggestions ?? []) {
      const key = suggestion.name.toLocaleLowerCase();
      if (!result.has(key) || suggestion.artistMbid) {
        result.set(key, suggestion.artistMbid);
      }
    }
    return result;
  }, [artistSuggestions.data]);
  const exactMatch = matches.some(a => a.toLocaleLowerCase() === normalizedSearch);
  const rankedMatches = useMemo(
    () => [...matches].sort((a, b) => {
      const countDifference = (artistCrossingCounts.get(b.toLocaleLowerCase()) ?? 0)
        - (artistCrossingCounts.get(a.toLocaleLowerCase()) ?? 0);
      return countDifference || a.localeCompare(b, undefined, { sensitivity: "base" });
    }),
    [artistCrossingCounts, matches],
  );

  const selectStyle: React.CSSProperties = {
    appearance: "none",
    background: "hsl(var(--secondary) / .55)",
    border: 0,
    borderRadius: 999,
    padding: "4px 24px 4px 10px",
    fontFamily: "var(--app-font-mono)",
    fontSize: 11,
    color: "hsl(var(--foreground))",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    height: 28,
    position: "relative",
    whiteSpace: "nowrap",
  };

  return (
    <div className="library-artist-lens">
      <span className="library-artist-lens__prefix">Crossings for</span>
      <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="demo-merged-library__artist-control"
          style={selectStyle}
          aria-label={focusedArtist ? `Crossings for ${focusedArtist}` : `Crossings for all ${allArtists.length} artists`}
          aria-pressed={Boolean(focusedArtist)}
        >
          {focusedArtist ? (
            <span style={{ color: "hsl(var(--foreground))" }}>{focusedArtist}</span>
          ) : (
            <span><strong>All my artists</strong> <span className="library-artist-lens__total">{allArtists.length}</span></span>
          )}
          <ChevronDown className={open ? "is-open" : undefined} style={{ width: 12, height: 12, opacity: 0.5 }} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="library-artist-lens__panel p-0 w-80" align="start">
        <Command shouldFilter={false} style={{ background: "transparent" }}>
          <CommandInput
            placeholder={`Filter your ${allArtists.length} artists…`}
            value={search}
            onValueChange={setSearch}
            onKeyDown={(event) => {
              if (event.key === "Enter" && normalizedSearch && matches[0]) {
                event.preventDefault();
                onFocus(
                  matches[0],
                  suggestedArtistMbids.get(matches[0].toLocaleLowerCase()),
                );
                setSearch("");
              }
            }}
            style={{ fontSize: 13 }}
          />
          <CommandList style={{ maxHeight: 240, overflowY: "auto" }}>
            {!normalizedSearch && (
              <CommandItem
                value="all-my-artists"
                onSelect={() => {
                  onClear();
                  setSearch("");
                  setOpen(false);
                }}
                className="library-artist-lens__all"
              >
                <strong>All my artists</strong>
                <span>every crossing {focusedArtist ? null : "✓"}</span>
              </CommandItem>
            )}
            {!normalizedSearch && (
              <div className="library-artist-lens__narrowing">
                Or narrow to one · by crossings this week
              </div>
            )}
            {matches.length === 0 && !normalizedSearch && !focusedArtist && (
              <div style={{ padding: "16px", textAlign: "center", fontFamily: "var(--app-font-sans)", fontSize: 13, color: "hsl(var(--faint))" }}>
                Type an artist name
              </div>
            )}
            {rankedMatches.map(a => {
              const isAdded = allArtists.some(saved => saved.toLocaleLowerCase() === a.toLocaleLowerCase());
              const crossingCount = artistCrossingCounts.get(a.toLocaleLowerCase()) ?? 0;
              return (
                <CommandItem
                  key={a}
                  value={a}
                  onSelect={() => {
                    onFocus(a, suggestedArtistMbids.get(a.toLocaleLowerCase()));
                    setSearch("");
                  }}
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontFamily: "var(--app-font-sans)", fontSize: 13 }}
                >
                  <span>{a}</span>
                  {isAdded ? <span className="library-artist-lens__crossing-count">
                    {crossingCount > 0
                      ? `${crossingCount} ${crossingCount === 1 ? "crossing" : "crossings"}`
                      : "none this week"}
                    {focusedArtist?.toLocaleLowerCase() === a.toLocaleLowerCase() ? " ✓" : ""}
                  </span> : (
                    <button
                      type="button"
                      className="library-artist-lens__result-action library-artist-lens__result-action--add"
                      aria-label={`Add ${a} to my artists`}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onAddSeed(a);
                      }}
                    >
                      <span aria-hidden="true">+</span> Add
                    </button>
                  )}
                </CommandItem>
              );
            })}
            {normalizedSearch && !exactMatch && (
              <CommandItem
                value={search}
                onSelect={() => {
                  onAddSeed(search.trim());
                  onFocus(search.trim());
                  setSearch("");
                }}
                style={{ fontFamily: "var(--app-font-sans)", fontSize: 13, color: "hsl(var(--primary))" }}
              >
                <span aria-hidden="true">＋</span> Try “{search.trim()}” outside your library
              </CommandItem>
            )}
          </CommandList>
        </Command>
        {!normalizedSearch && (
          <div className="library-artist-lens__outside">
            <span aria-hidden="true">＋</span>
            <span><strong>Try an artist outside your library</strong><small>Search above to preview their crossings, then add if you like</small></span>
          </div>
        )}
        {focusedArtist ? (
          <button
            type="button"
            aria-pressed={isAddedArtist}
            disabled={isLibraryArtist}
            title={isLibraryArtist ? "Already in your Library" : undefined}
            onClick={() => {
              if (isSeed) onRemoveSeed(focusedArtist);
              else if (!isAddedArtist) onAddSeed(focusedArtist);
            }}
            className="library-artist-lens__seed-toggle"
          >
            <span aria-hidden="true">{isAddedArtist ? "✓" : "+"}</span>
            {isAddedArtist ? "Added to my artists" : "Add to my artists"}
          </button>
        ) : null}
      </PopoverContent>
      </Popover>
    </div>
  );
}

type ArtistRelease = TasteSeedCatalogue["releases"][number];

// ---------------------------------------------------------------------------
// Artist Discography View
// ---------------------------------------------------------------------------
function ArtistDiscographyView({
  artist,
  savedGroups,
  investigationCoveredMbids,
  openAlbumKey,
  setOpenAlbumKey,
  catalogueReleases,
  returnContext,
}: {
  artist: string;
  savedGroups: AlbumGroup[];
  investigationCoveredMbids: Set<string>;
  openAlbumKey: string | null;
  setOpenAlbumKey: (key: string | null) => void;
  catalogueReleases: ArtistRelease[];
  returnContext?: string;
}) {
  // Find a valid recording MBID to fetch discography
  const recordingMbid = useMemo(() => {
    for (const group of savedGroups) {
      for (const item of group.items) {
        if (item.mbid && item.recording?.artist.toLocaleLowerCase() === artist.toLocaleLowerCase()) {
          return item.mbid;
        }
      }
    }
    return null;
  }, [artist, savedGroups]);

  const [fetchedReleases, setFetchedReleases] = useState<ArtistRelease[] | null>(null);
  const [loading, setLoading] = useState(recordingMbid != null);
  const [previousRecordingMbid, setPreviousRecordingMbid] = useState(recordingMbid);
  if (recordingMbid !== previousRecordingMbid) {
    setPreviousRecordingMbid(recordingMbid);
    setFetchedReleases(null);
    setLoading(recordingMbid != null);
  }

  useEffect(() => {
    if (!recordingMbid) return;
    let cancelled = false;
    fetch(`/api/recordings/${recordingMbid}/artist-releases`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("fetch failed"))))
      .then((data: { releases?: ArtistRelease[] }) => {
        if (!cancelled) {
          setFetchedReleases(data.releases ?? []);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFetchedReleases(null);
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [recordingMbid]);

  const releases = useMemo(() => {
    const byId = new Map<string, ArtistRelease>();
    for (const release of catalogueReleases) byId.set(release.releaseGroupMbid, release);
    for (const release of fetchedReleases ?? []) byId.set(release.releaseGroupMbid, release);
    return [...byId.values()];
  }, [catalogueReleases, fetchedReleases]);

  const { savedRows, otherRows } = useMemo(() => {
    const savedRgMbids = new Set<string>();
    for (const group of savedGroups) {
      const rgMbid = group.items.find((item) => item.recording?.releaseGroupMbid)
        ?.recording?.releaseGroupMbid;
      if (rgMbid) savedRgMbids.add(rgMbid);
    }
    return {
      savedRows: savedGroups,
      otherRows: releases
        .filter((release) => !savedRgMbids.has(release.releaseGroupMbid))
        .sort((a, b) => (b.releaseYear ?? -Infinity) - (a.releaseYear ?? -Infinity)),
    };
  }, [savedGroups, releases]);

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "32px 0" }}>
        <Loader2 style={{ width: 16, height: 16, animation: "lore-eq 1s linear infinite", color: "hsl(var(--muted-foreground))" }} />
      </div>
    );
  }

  return (
    <div data-testid="library-artist-discography">
      {savedRows.length > 0 ? (
        <section aria-labelledby="library-saved-albums-heading">
          <div className="library-discography__heading" id="library-saved-albums-heading">
            Saved from radio
          </div>
          {savedRows.map((group) => (
            <div key={group.key} data-album-key={group.key} style={{ position: "relative" }}>
              <div style={{ position: "absolute", top: 8, right: 15, zIndex: 10, pointerEvents: "none" }}>
                <span className="library-discography__saved-count">
                  {group.items.length} saved
                </span>
              </div>
              <StackRow
                group={group}
                hasInvestigation={group.items.some(
                  (item) => item.mbid != null && investigationCoveredMbids.has(item.mbid)
                )}
                isOpen={openAlbumKey === group.key}
                onToggle={() => setOpenAlbumKey(openAlbumKey === group.key ? null : group.key)}
              />
            </div>
          ))}
        </section>
      ) : null}

      {otherRows.length > 0 ? (
        <section aria-labelledby="library-other-albums-heading">
          <div className="library-discography__heading" id="library-other-albums-heading">
            Other albums
          </div>
          {otherRows.map((release) => (
            <Link
              key={release.releaseGroupMbid}
              href={buildLibraryEntityUrl(`/album/${encodeURIComponent(release.releaseGroupMbid)}`, returnContext, { demoSurface: Boolean(returnContext) })}
              className="library-discography__other-row"
              aria-label={`Explore ${release.title ?? "this album"}`}
            >
              <div style={{ width: 44, height: 44, borderRadius: 4, background: "hsl(var(--secondary))", overflow: "hidden", flexShrink: 0 }}>
                {release.artworkUrl ? (
                  <img src={proxyArtUrl(release.artworkUrl) ?? release.artworkUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={onArtError} />
                ) : null}
              </div>
              <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", minWidth: 0 }}>
                <div style={{ fontFamily: "var(--app-font-display)", fontSize: 15, color: "hsl(var(--foreground))", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {release.title || "Unknown Release"}
                </div>
                <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 11, color: "hsl(var(--dim))", marginTop: 2 }}>
                  {release.releaseYear ?? "Unknown year"}
                </div>
              </div>
            </Link>
          ))}
        </section>
      ) : null}

      {releases.length === 0 && savedGroups.length > 0 && (
        <div style={{ padding: "24px 15px", textAlign: "center", fontFamily: "var(--app-font-sans)", fontSize: 13, color: "hsl(var(--faint))" }}>
          Discography unavailable. Showing saved albums only.
        </div>
      )}
      {savedRows.length === 0 && otherRows.length === 0 && (
        <div style={{ padding: "40px 15px", textAlign: "center", fontFamily: "var(--app-font-sans)", fontSize: 13, color: "hsl(var(--faint))" }}>
          No album information is available yet.
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
interface CanonicalLibraryAlbum {
  releaseGroupMbid: string;
  title: string;
  artist: string;
  artworkUrl: string | null;
  releaseYear: number | null;
  keptTrackCount: number;
  filed: boolean;
}

export function buildCanonicalLibraryAlbums(
  keptItems: LibraryItem[],
  shelfItems: LibraryAlbumItem[],
): CanonicalLibraryAlbum[] {
  const albums = new Map<string, CanonicalLibraryAlbum>();

  for (const item of keptItems) {
    const recording = item.recording;
    const releaseGroupMbid = recording?.releaseGroupMbid?.trim();
    if (!recording || !releaseGroupMbid) continue;
    const current = albums.get(releaseGroupMbid);
    if (current) {
      current.keptTrackCount += 1;
      if (!current.artworkUrl && recording.artworkUrl) current.artworkUrl = recording.artworkUrl;
      if (current.releaseYear == null && recording.releaseYear != null) current.releaseYear = recording.releaseYear;
      continue;
    }
    albums.set(releaseGroupMbid, {
      releaseGroupMbid,
      title: recording.albumTitle?.trim() || recording.title,
      artist: recording.artist,
      artworkUrl: recording.artworkUrl,
      releaseYear: recording.releaseYear ?? null,
      keptTrackCount: 1,
      filed: false,
    });
  }

  for (const item of shelfItems) {
    const current = albums.get(item.releaseGroupMbid);
    if (current) {
      current.filed = true;
      current.title = item.title || current.title;
      current.artist = item.artist || current.artist;
      current.artworkUrl = item.artworkUrl || current.artworkUrl;
      current.releaseYear = item.releaseYear ?? current.releaseYear;
      continue;
    }
    albums.set(item.releaseGroupMbid, {
      releaseGroupMbid: item.releaseGroupMbid,
      title: item.title,
      artist: item.artist,
      artworkUrl: item.artworkUrl,
      releaseYear: item.releaseYear,
      keptTrackCount: 0,
      filed: true,
    });
  }

  return [...albums.values()].sort((a, b) =>
    a.artist.localeCompare(b.artist, undefined, { sensitivity: "base" })
    || a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
  );
}

function CanonicalLibraryAlbums({
  keptItems,
  shelfItems,
  focusedArtist,
  returnContext,
}: {
  keptItems: LibraryItem[];
  shelfItems: LibraryAlbumItem[];
  focusedArtist: string | null;
  returnContext: string;
}) {
  const normalizedFocus = focusedArtist?.trim().toLocaleLowerCase() ?? "";
  const albums = useMemo(
    () => buildCanonicalLibraryAlbums(keptItems, shelfItems).filter((album) =>
      !normalizedFocus || album.artist.trim().toLocaleLowerCase() === normalizedFocus),
    [keptItems, normalizedFocus, shelfItems],
  );

  if (albums.length === 0) {
    return (
      <div className="demo-merged-library__empty" style={{ margin: "48px auto", textAlign: "center" }}>
        <p style={{ color: "hsl(var(--dim))", fontFamily: "var(--app-font-reading)", fontSize: 17 }}>
          {focusedArtist ? `No Library albums by ${focusedArtist}.` : "Nothing in your album Library yet."}
        </p>
      </div>
    );
  }

  return (
    <div
      data-testid="canonical-library-albums"
      style={{
        maxWidth: 960,
        margin: "0 auto",
        padding: "18px 14px max(120px, calc(var(--shell-h, 0px) + 20px))",
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
        gap: "24px 16px",
      }}
    >
      {albums.map((album) => {
        const artworkUrl = album.artworkUrl
          ?? `https://coverartarchive.org/release-group/${album.releaseGroupMbid}/front-1200`;
        const href = buildLibraryEntityUrl(
          `/album/${album.releaseGroupMbid}`,
          returnContext,
          { demoSurface: true },
        );
        return (
          <article key={album.releaseGroupMbid} className="demo-album-card">
            <Link
              href={href}
              aria-label={`Open ${album.title} by ${album.artist}`}
              style={{ color: "inherit", textDecoration: "none", display: "block" }}
            >
              <span
                style={{
                  display: "block",
                  width: "100%",
                  aspectRatio: "1 / 1",
                  overflow: "hidden",
                  borderRadius: 6,
                  background: artGradient(album.title, album.artist),
                }}
              >
                <img
                  src={proxyArtUrl(artworkUrl) ?? artworkUrl}
                  alt=""
                  loading="lazy"
                  onError={onArtError}
                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                />
              </span>
              <strong
                style={{
                  display: "block",
                  marginTop: 8,
                  fontFamily: "var(--app-font-display)",
                  fontSize: 15,
                  fontWeight: 400,
                  lineHeight: 1.2,
                }}
              >
                {album.title}
              </strong>
              <span style={{ display: "block", marginTop: 2, color: "hsl(var(--dim))", fontFamily: "var(--app-font-reading)", fontSize: 12 }}>
                {album.artist}
              </span>
              <span style={{ display: "block", marginTop: 5, color: "hsl(var(--faint))", fontFamily: "var(--app-font-mono)", fontSize: 10 }}>
                {[
                  album.releaseYear,
                  album.filed ? "Filed album" : null,
                  album.keptTrackCount > 0
                    ? `${album.keptTrackCount} kept ${album.keptTrackCount === 1 ? "track" : "tracks"}`
                    : null,
                ].filter(Boolean).join(" · ")}
              </span>
            </Link>
          </article>
        );
      })}
    </div>
  );
}

export default function Library({ embedded = false }: { embedded?: boolean }) {
  const search = useSearch();
  const { isLoading } = useAppConfig();
  const params = new URLSearchParams(search);
  const viewParam = params.get("view");
  const demoView: "library" | "radio" | "press" | "merch" =
    viewParam === "radio" || viewParam === "stations"
      ? "radio"
      : viewParam === "press" || viewParam === "merch"
        ? viewParam
      : "library";

  if (isLoading) {
    return <main className="demo-merged-library" aria-busy="true" />;
  }

  return <FocusShell view={demoView} embedded={embedded} />;
}

function FirstRunLibraryOnboarding({
  onAddArtists,
}: {
  onAddArtists: (artists: string[]) => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const [spotifyPaste, setSpotifyPaste] = useState("");
  const [artistDraft, setArtistDraft] = useState("");
  const [artists, setArtists] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const spotifyUrls = useMemo(
    () => Array.from(new Set(
      spotifyPaste
        .split(/\s+/)
        .map((value) => value.trim())
        .filter((value) => /^https:\/\/open\.spotify\.com\/(?:intl-[^/]+\/)?track\/[A-Za-z0-9]{22}(?:\?.*)?$/.test(value)
          || /^spotify:track:[A-Za-z0-9]{22}$/.test(value)),
    )),
    [spotifyPaste],
  );
  const addArtist = () => {
    const value = artistDraft.trim();
    if (!value || artists.some((artist) => artist.toLocaleLowerCase() === value.toLocaleLowerCase())) return;
    setArtists((current) => [...current, value].slice(0, 3));
    setArtistDraft("");
  };
  return (
    <section className="library-first-run" data-testid="library-first-run">
      <p className="library-first-run__eyebrow">Welcome to Lore</p>
      <h2>Find the stations already playing your music.</h2>
      <p className="library-first-run__intro">
        Lore listens to live radio and flags every crossing—the moment a station plays an artist you love.
        Give it a little of your library to start.
      </p>
      <div className="library-first-run__choices">
        <article>
          <h3>Paste your Spotify library</h3>
          <p>In Spotify Desktop, select your Liked Songs, copy the song links, and paste them here.</p>
          <textarea
            value={spotifyPaste}
            onChange={(event) => setSpotifyPaste(event.target.value)}
            placeholder={"https://open.spotify.com/track/…\nhttps://open.spotify.com/track/…"}
            aria-label="Spotify track URLs"
            data-testid="input-spotify-library-urls"
          />
          <div className="library-first-run__status">{spotifyUrls.length.toLocaleString()} unique track {spotifyUrls.length === 1 ? "URL" : "URLs"} found</div>
          <button
            type="button"
            disabled={busy || spotifyUrls.length === 0}
            data-testid="button-import-spotify-urls"
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await postStartSpotifyUrlImport(spotifyUrls);
                await queryClient.invalidateQueries({ queryKey: ME_LATEST_IMPORT_JOB_KEY });
              } catch (caught) {
                setError(caught instanceof Error ? caught.message : "The import could not start.");
                setBusy(false);
              }
            }}
          >
            {busy ? "Starting import…" : `Import ${spotifyUrls.length > 0 ? spotifyUrls.length.toLocaleString() : ""} tracks`}
          </button>
        </article>
        <article>
          <h3>Or add three artists</h3>
          <p>Three is enough to start scanning. You can change them later.</p>
          <div className="library-first-run__artist-entry">
            <input
              value={artistDraft}
              onChange={(event) => setArtistDraft(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addArtist(); } }}
              placeholder="Artist name"
              aria-label="Artist name"
              data-testid="input-first-run-artist"
            />
            <button type="button" onClick={addArtist} disabled={!artistDraft.trim() || artists.length >= 3} data-testid="button-add-first-run-artist">Add</button>
          </div>
          <div className="library-first-run__chips">
            {artists.map((artist) => (
              <button key={artist} type="button" aria-label={`Remove ${artist}`} onClick={() => setArtists((current) => current.filter((item) => item !== artist))}>
                {artist} <span aria-hidden="true">×</span>
              </button>
            ))}
          </div>
          <div className="library-first-run__status">{artists.length} of 3</div>
          <button
            type="button"
            disabled={busy || artists.length < 3}
            data-testid="button-start-artist-scanning"
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onAddArtists(artists);
              } catch {
                setError("Those artists could not be saved. Try again.");
                setBusy(false);
              }
            }}
          >
            {artists.length < 3 ? `Add ${3 - artists.length} more to start scanning` : "Start scanning"}
          </button>
        </article>
      </div>
      {error ? <p className="library-first-run__error" role="alert">{error}</p> : null}
      <div className="library-first-run__next" aria-label="What happens next">
        <article><b>1</b><strong>Find crossings</strong><span>Stations playing your artists, ranked by how often.</span></article>
        <article><b>2</b><strong>Keep from radio</strong><span>Hear something new? Keep it—it lands in your Inbox.</span></article>
        <article><b>3</b><strong>Evaluate albums</strong><span>Move keepers through Rotation onto your Shelf.</span></article>
      </div>
    </section>
  );
}

function FocusShell({
  view,
  embedded,
}: {
  view: "library" | "radio" | "press" | "merch";
  embedded: boolean;
}) {
  const [, setLocation] = useLocation();
  const { radio } = usePlayer();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const returnContext = `/library${search ? `?${search.replace(/^\?/, "")}` : ""}`;
  const workflowParam = params.get("workflow");
  const workflow: "inbox" | "rotation" | "shelf" | "passed" | "unresolved" =
    workflowParam === "rotation" || workflowParam === "shelf" || workflowParam === "passed" || workflowParam === "unresolved" ? workflowParam : "inbox";
  const wholeLibrary = view === "library" && params.get("section") === "library";

  const { data: albumCountsData } = useMyLibraryAlbums(
    view === "library" && workflow && !wholeLibrary ? workflow : "inbox",
    "",
    true
  );
  const counts = albumCountsData?.counts ?? { inbox: 0, rotation: 0, shelf: 0, passed: 0, unresolved: 0 };

  const groupingParam = params.get("grouping");
  const grouping: "albums" | "songs" | "artists" =
    groupingParam === "songs" || groupingParam === "artists" ? groupingParam : "albums";
  const libraryFocus = deriveLibraryFocus(search);
  const selectedStationSlug =
    params.get("stationCrossings")
    ?? (params.get("focusMode") === "crossings" ? params.get("station") : null);
  const remoteLayout = params.get("layout") === "grid";
  const focusedArtist = params.get("focus");
  const focusedArtistMbid = params.get("focusId");
  const hasActiveFilters = params.has("categories") || params.has("specialistCategories") || params.has("broZones") || params.has("stationSort");
  const stationMode = params.get("stationMode") === "highlights" ? "highlights"
    : params.get("stationMode") === "all" || hasActiveFilters || !remoteLayout ? "all"
    : "highlights";
  const stationSortParam = params.get("stationSort");
  const stationSort: "overlap" | "live" | "discovery" | "editorial" | "name" | "newest" =
    stationSortParam === "live" || stationSortParam === "discovery" || stationSortParam === "editorial" || stationSortParam === "name" || stationSortParam === "newest"
      ? stationSortParam
      : "overlap";
  const radioWindowParam = params.get("radioWindow");
  const radioWindow: CrossingScope =
    radioWindowParam === "now"
      || radioWindowParam === "set"
      || radioWindowParam === "24h"
      || radioWindowParam === "7d"
      || radioWindowParam === "30d"
      || radioWindowParam === "lifetime"
      ? radioWindowParam
      : "lifetime";
  const radioRankParam = params.get("radioRank");
  const radioRank: "crossings" | "keeps" | "albums" | "premieres" =
    radioRankParam === "keeps" || radioRankParam === "albums" || radioRankParam === "premieres"
      ? radioRankParam
      : "crossings";
  const songQuery = params.get("songQuery") ?? "";
  const sortParam = params.get("sort");
  const songSort = effectiveDemoSongSort(libraryFocus, parseDemoSongSort(sortParam));
  const matchFilters = undefined;
  const specialistSubcategoryIds = useMemo(
    () => new Set(SPECIALIST_SUBCATEGORY_DEFINITIONS.map(({ id }) => id)),
    [],
  );
  const specialistSubcategories = useMemo(() => new Set<SpecialistSubcategory>(
    (new URLSearchParams(search).get("specialistCategories") ?? "")
      .split(",")
      .filter((value): value is SpecialistSubcategory =>
        specialistSubcategoryIds.has(value as SpecialistSubcategory)),
  ), [search, specialistSubcategoryIds]);
  const activeCategories = useMemo(() => {
    const selected = new Set<StationCategory>();
    for (const value of new URLSearchParams(search).get("categories")?.split(",") ?? []) {
      if (DEMO_STATION_CATEGORY_KEYS.has(value as StationCategory)) {
        selected.add(value as StationCategory);
      }
    }
    return selected;
  }, [search]);
  const broZoneState = useMemo(() => parseBroZoneState(search), [search]);
  const activeBroZones = broZoneState.regions;
  const [broZoneOrigin, setBroZoneOrigin] = useState<BroZoneOrigin | null>(null);
  const [broZoneLocationLabel, setBroZoneLocationLabel] = useState<string | null>(null);
  const [broZipOpen, setBroZipOpen] = useState(false);
  const [broZip, setBroZip] = useState("");
  const [broZipError, setBroZipError] = useState<string | null>(null);
  const [broZipLoading, setBroZipLoading] = useState(false);

  useEffect(() => {
    const raw = params.get("scroll");
    const scrollY = raw == null ? NaN : Number(raw);
    if (!Number.isFinite(scrollY) || scrollY < 0 || scrollY > 10_000_000) return;
    const frame = requestAnimationFrame(() => window.scrollTo({ top: scrollY, behavior: "auto" }));
    return () => cancelAnimationFrame(frame);
  }, [search]);

  useEffect(() => {
    if (!hasLegacyLibraryMetadata(search)) return;
    const migrated = new URLSearchParams(search);
    writeLibraryFocus(migrated, "artist");
    const query = migrated.toString();
    setLocation(query ? `/library?${query}` : "/library", { replace: true });
  }, [search, setLocation]);

  useEffect(() => {
    if (view !== "library") return;
    if (wholeLibrary) {
      if (params.get("view") !== "songs") return;
      const canonical = new URLSearchParams(search);
      canonical.delete("view");
      canonical.set("section", "library");
      canonical.set("grouping", "songs");
      const query = canonical.toString();
      setLocation(`/library?${query}`, { replace: true });
      return;
    }
    const staleKeys = ["grouping", "songQuery", "focus", "focusId", "openAlbum"];
    const hasLegacySongsView = params.get("view") === "songs";
    if (!hasLegacySongsView && !staleKeys.some((key) => params.has(key))) return;
    const canonical = new URLSearchParams(search);
    if (hasLegacySongsView) canonical.delete("view");
    for (const key of staleKeys) canonical.delete(key);
    const query = canonical.toString();
    setLocation(query ? `/library?${query}` : "/library", { replace: true });
  }, [search, setLocation, view, wholeLibrary]);

  const { visibleSeeds, addSeed, removeSeed } = useSeedManager();
  const { stations, hasSeeds } = useDialData("personal", {
    categories: focusedArtist ? undefined : activeCategories,
    includeAllStations: true,
    crossingsEnabled: true,
    deferEnrichment: false,
  });
  const {
    data: demoLibraryData,
    hasNextPage: demoLibraryHasNextPage,
    isFetchingNextPage: demoLibraryFetchingNextPage,
    fetchNextPage: fetchNextDemoLibraryPage,
  } = useMyLibraryInfinite({
    sort: songSort === "artist" || songSort === "title" ? songSort : "added",
  }, 100);
  const { data: shelfAlbumData } = useMyLibraryAlbums("shelf", "", true);
  const shelfArtists = useMemo(
    () => Array.from(new Set(
      (shelfAlbumData?.items ?? [])
        .filter((item) => !item.unresolved)
        .map((item) => item.artist.trim())
        .filter(Boolean),
    )),
    [shelfAlbumData],
  );
  const shelfAlbums = useMemo(
    () => (shelfAlbumData?.items ?? []).filter((item): item is LibraryAlbumItem => !item.unresolved),
    [shelfAlbumData],
  );
  const artistStationQuery = useSearchArtistStations(
    { q: focusedArtist ?? "" },
    {
      query: {
        queryKey: getSearchArtistStationsQueryKey({ q: focusedArtist ?? "" }),
        enabled: Boolean(focusedArtist?.trim()),
        staleTime: 5 * 60_000,
        retry: 1,
      },
    },
  );
  const demoLibraryItems = useMemo(
    () => demoLibraryData?.pages.flatMap((page) => page.items) ?? [],
    [demoLibraryData],
  );
  const broZoneCounts = useMemo(() => countBroZones(stations), [stations]);
  const broZoneStations = useMemo(
    () => sortBroZoneStationsByDistance(
      stations.filter((station) => stationBroZones(station).size > 0),
      broZoneOrigin,
    ),
    [broZoneOrigin, stations],
  );
  useEffect(() => {
    if (
      !(view === "library" && grouping === "songs")
      || !remoteLayout
      || !demoLibraryHasNextPage
      || demoLibraryFetchingNextPage
    ) return;
    void fetchNextDemoLibraryPage();
  }, [
    demoLibraryFetchingNextPage,
    demoLibraryHasNextPage,
    fetchNextDemoLibraryPage,
    remoteLayout,
    view,
  ]);

  const filteredStations = useMemo(() => {
    let list = focusedArtist
      ? stations
      : filterBroZoneCollection(stations, broZoneState.active, activeBroZones);
    if (!focusedArtist && activeCategories.has("specialist") && specialistSubcategories.size > 0) {
      list = list.filter(ds => specialistSubcategories.has(specialistSubcategoryForStation(ds.station)));
    }
    const normalizedFocus = focusedArtist?.trim().toLocaleLowerCase();
    if (normalizedFocus) {
      if (artistStationQuery.data) {
        const matchingSlugs = new Set(
          artistStationQuery.data.stations.map((station) => station.slug),
        );
        list = list.filter((ds) => matchingSlugs.has(ds.station.slug));
      } else {
        list = list.filter(ds => {
          const matches = (artist: string | null | undefined) =>
            artist?.trim().toLocaleLowerCase() === normalizedFocus;
          if (matches(ds.liveTrack?.artist)) return true;
          if (ds.shows.some(s => matches(s.currentTrack?.artist))) return true;
          if (ds.topArtistNames.some(matches)) return true;
          if (ds.topArtistNames24h.some(matches)) return true;
          if (ds.topArtistNames7d.some(matches)) return true;
          if (ds.topArtistNamesLifetime.some(matches)) return true;
          if (ds.albumCrossings.some(ac => matches(ac.artist))) return true;
          return false;
        });
      }
    }
    return list;
  }, [
    stations,
    broZoneState.active,
    activeBroZones,
    focusedArtist,
    artistStationQuery.data,
    activeCategories,
    specialistSubcategories,
  ]);
  const scopedStations = useMemo(() => filteredStations.map((station) => {
    const albumCrossings = station.albumCrossings;
    const broadWindowCount = crossingCountForScope(station, radioWindow);
    const crossingCount = broadWindowCount;
    const keepsCount = new Set(albumCrossings.map((crossing) => crossing.recordingMbid)).size;
    const albumsCount = new Set(albumCrossings.map((crossing) =>
      crossing.releaseGroupMbid ?? crossing.recordingMbid)).size;
    const premiereCount = Math.min(firstPlayCountForScope(station, radioWindow), crossingCount);
    const rankScore = radioRank === "keeps"
      ? keepsCount
      : radioRank === "albums"
        ? albumsCount
        : radioRank === "premieres"
          ? premiereCount
          : crossingCount;
    const topArtists = Array.from(new Set(albumCrossings.map((crossing) => crossing.artist))).slice(0, 3);
    return {
      ...station,
      crossings: crossingCount,
      artistCrossings: 0,
      weekCrossings: crossingCount,
      weekArtistCrossings: 0,
      monthCrossings: crossingCount,
      monthArtistCrossings: 0,
      lifetimeCrossings: crossingCount,
      lifetimeArtistCrossings: 0,
      score7d: rankScore,
      topArtistNames: topArtists,
      topArtistNames24h: topArtists,
      topArtistNames7d: topArtists,
      topArtistNames30d: topArtists,
      topArtistNamesLifetime: topArtists,
      albumCrossings,
    };
  }), [
    filteredStations,
    radioRank,
    radioWindow,
  ]);

  const filteredDemoItems = useMemo(() => {
    const normalizedFocus = focusedArtist?.trim().toLocaleLowerCase();
    const normalizedQuery = songQuery.trim().toLocaleLowerCase();
    return demoLibraryItems.filter((item) => {
      if (normalizedFocus && item.recording?.artist.trim().toLocaleLowerCase() !== normalizedFocus) return false;
      if (normalizedQuery) {
        const haystack = [
          item.recording?.title,
          item.recording?.artist,
          item.recording?.albumTitle,
        ].filter(Boolean).join(" ").toLocaleLowerCase();
        if (!haystack.includes(normalizedQuery)) return false;
      }
      return true;
    });
  }, [demoLibraryItems, focusedArtist, songQuery]);
  const allArtists = useMemo(() => {
    const set = new Set<string>();
    for (const item of demoLibraryItems) {
      if (item.recording?.artist) set.add(item.recording.artist);
    }
    for (const artist of shelfArtists) set.add(artist);
    for (const s of visibleSeeds) set.add(s);
    return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [demoLibraryItems, shelfArtists, visibleSeeds]);
  const artistCrossingCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const station of stations) {
      for (const sample of station.topArtistSamples7d ?? []) {
        const key = sample.artist.trim().toLocaleLowerCase();
        if (!key) continue;
        counts.set(key, (counts.get(key) ?? 0) + sample.weight);
      }
    }
    return counts;
  }, [stations]);
  const radioSidebarSlug = selectedStationSlug
    ?? radio.station?.slug
    ?? scopedStations.find((station) => station.liveTrack)?.station.slug
    ?? scopedStations[0]?.station.slug
    ?? stations.find((station) => station.liveTrack)?.station.slug
    ?? stations[0]?.station.slug
    ?? null;
  const radioLayout = (content: React.ReactNode) => (
    <div className="demo-radio-layout">
      <div className="demo-radio-layout__main">{content}</div>
      {radioSidebarSlug ? (
        <StationSetSidebar key={radioSidebarSlug} stationSlug={radioSidebarSlug} />
      ) : null}
    </div>
  );
  const artistMbidByName = useMemo(() => {
    const result = new Map<string, string>();
    for (const item of demoLibraryItems) {
      const artist = item.recording?.artist.trim();
      const artistMbid = item.recording?.artistMbid?.trim();
      if (!artist || !artistMbid) continue;
      const key = artist.toLocaleLowerCase();
      if (!result.has(key)) result.set(key, artistMbid);
    }
    return result;
  }, [demoLibraryItems]);

  const updateSearch = (mutate: (next: URLSearchParams) => void) => {
    const next = new URLSearchParams(search);
    mutate(next);
    const query = next.toString();
    setLocation(query ? `/library?${query}` : "/library");
  };

  const submitBroZoneZip = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBroZipLoading(true);
    setBroZipError(null);
    try {
      const response = await fetch(`/api/stations/zip-origin?zip=${encodeURIComponent(broZip.trim())}`);
      const body = await response.json().catch(() => null) as {
        origin?: BroZoneOrigin & { city?: string; region?: string };
        error?: string;
      } | null;
      if (!response.ok || !body?.origin) {
        throw new Error(body?.error ?? "That ZIP could not be checked.");
      }
      setBroZoneOrigin(body.origin);
      setBroZoneLocationLabel(
        [body.origin.city, body.origin.region].filter(Boolean).join(", ") || broZip.trim(),
      );
      setBroZipOpen(false);
    } catch (error) {
      setBroZipError(error instanceof Error ? error.message : "That ZIP could not be checked.");
    } finally {
      setBroZipLoading(false);
    }
  };
  const removeMatchFilter = (fact: MatchEvidence) => updateSearch(
    (next) => removeLibraryMatchFilter(next, fact),
  );
  const buildTabHref = (targetView: "library" | "radio" | "press" | "merch") => {
    const p = new URLSearchParams(search);
    if (targetView === "library") {
      p.delete("view");
    } else {
      p.set("view", targetView);
      p.delete("section");
      p.delete("grouping");
    }
    const qs = p.toString();
    return `/library${qs ? `?${qs}` : ""}`;
  };

  const buildWorkflowHref = (targetWorkflow: "inbox" | "rotation" | "shelf" | "passed" | "unresolved") => {
    const p = new URLSearchParams(search);
    p.set("view", "library");
    p.delete("section");
    p.delete("grouping");
    p.delete("songQuery");
    p.delete("focus");
    p.delete("focusId");
    p.delete("openAlbum");
    if (targetWorkflow === "inbox") p.delete("workflow");
    else p.set("workflow", targetWorkflow);
    const qs = p.toString();
    return `/library${qs ? `?${qs}` : ""}`;
  };
  const buildWholeLibraryHref = (targetGrouping: "albums" | "songs" | "artists" = "albums") => {
    const p = new URLSearchParams(search);
    p.delete("view");
    p.delete("workflow");
    p.set("section", "library");
    if (targetGrouping === "albums") p.delete("grouping");
    else p.set("grouping", targetGrouping);
    const qs = p.toString();
    return `/library${qs ? `?${qs}` : ""}`;
  };

  const selectStyle: React.CSSProperties = {
    appearance: "none",
    background: "hsl(var(--secondary) / .55)",
    border: 0,
    borderRadius: 999,
    padding: "4px 20px 4px 8px",
    fontFamily: "var(--app-font-mono)",
    fontSize: 11,
    color: "hsl(var(--foreground))",
    cursor: "pointer",
    backgroundImage: `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>')`,
    backgroundRepeat: "no-repeat",
    backgroundPosition: "right 4px center",
    backgroundSize: "10px",
  };
  const radioRefineCount = Number(Boolean(focusedArtist))
    + Number(activeCategories.size > 0 || specialistSubcategories.size > 0 || broZoneState.active);
  return (
    <main className="demo-merged-library demo-merged-library--light" data-view={view}>
      <header className="demo-merged-library__header">
        <h1 className="sr-only">Library</h1>
        {view === "library" && grouping === "songs" && (
          <div className="demo-merged-library__primary">
            <button
              type="button"
              className="demo-merged-library__layout-toggle"
              aria-label={remoteLayout ? "Show detailed list" : "Show visual grid"}
              aria-pressed={remoteLayout}
              title={remoteLayout ? "Show detailed list" : "Show visual grid"}
              onClick={() => updateSearch((next) => {
                if (remoteLayout) next.delete("layout");
                else next.set("layout", "grid");
              })}
            >
              {remoteLayout ? <List aria-hidden="true" /> : <Grid2X2 aria-hidden="true" />}
            </button>
          </div>
        )}
        <nav
          aria-label="Library sections"
          className="demo-merged-library__workflow-tabs demo-merged-library__mode-tabs"
          style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}
        >
          <Link
            href={buildWholeLibraryHref()}
            aria-label="Your library"
            aria-current={wholeLibrary ? "page" : undefined}
            title="Your library"
          >
            Your library
          </Link>
          <Link
            href={buildTabHref("radio")}
            aria-current={view === "radio" ? "page" : undefined}
            data-testid="library-view-radio"
          >
            Radio
          </Link>
          <Link
            href={buildWorkflowHref("inbox")}
            aria-current={view === "library" && !wholeLibrary && workflow === "inbox" ? "page" : undefined}
          >
            Inbox{counts.inbox > 0 && <span style={{ opacity: 0.5, marginLeft: 4 }}>{counts.inbox}</span>}
          </Link>
          {counts.rotation > 0 && (
            <Link href={buildWorkflowHref("rotation")} aria-current={view === "library" && !wholeLibrary && workflow === "rotation" ? "page" : undefined}>
              Rotation<span style={{ opacity: 0.5, marginLeft: 4 }}>{counts.rotation}</span>
            </Link>
          )}
          {counts.shelf > 0 && (
            <Link href={buildWorkflowHref("shelf")} aria-current={view === "library" && !wholeLibrary && workflow === "shelf" ? "page" : undefined}>
              Shelf<span style={{ opacity: 0.5, marginLeft: 4 }}>{counts.shelf}</span>
            </Link>
          )}

          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                style={{
                  background: "transparent",
                  border: "none",
                  color: "hsl(var(--faint))",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  padding: "4px 8px",
                  borderRadius: 999
                }}
                aria-label="More library workflows"
              >
                 <ChevronDown size={14} />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" style={{ width: 160, padding: 6, display: "flex", flexDirection: "column", gap: 2, background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}>
               <Link href={buildWorkflowHref("passed")} style={{ padding: "6px 10px", textDecoration: "none", color: "hsl(var(--foreground))", fontSize: 11, fontFamily: "var(--app-font-mono)", textTransform: "uppercase", display: "flex", justifyContent: "space-between", borderRadius: 4 }}>
                 Passed <span style={{ color: "hsl(var(--faint))" }}>{counts.passed}</span>
               </Link>
               <Link href={buildWorkflowHref("unresolved")} style={{ padding: "6px 10px", textDecoration: "none", color: "hsl(var(--foreground))", fontSize: 11, fontFamily: "var(--app-font-mono)", textTransform: "uppercase", display: "flex", justifyContent: "space-between", borderRadius: 4 }}>
                 Unresolved <span style={{ color: "hsl(var(--faint))" }}>{counts.unresolved}</span>
               </Link>
            </PopoverContent>
          </Popover>

          <div style={{ pointerEvents: "none", opacity: 0.3, paddingLeft: 4, display: "flex", alignItems: "center" }} aria-hidden="true">
            <MoonPhaseGlyph size={20} />
          </div>
        </nav>
        {focusedArtist && view !== "radio" ? (
          <div className="demo-merged-library__focus-row">
            <span>Artist Focus</span>
            <button
              type="button"
              className="demo-merged-library__focus-clear"
              aria-label={`Clear artist focus: ${focusedArtist}`}
              onClick={() => updateSearch(next => {
                next.delete("focus");
                next.delete("focusId");
                next.delete("openAlbum");
              })}
            >
              <span>{focusedArtist}</span>
              <span aria-hidden="true" className="demo-merged-library__focus-clear-mark">×</span>
            </button>
          </div>
        ) : null}
        <div className="demo-merged-library__filters">
          {wholeLibrary && (
            <div className="demo-merged-library__station-tools is-all" aria-label="Refine Library">
              <div className="demo-merged-library__refine demo-merged-library__refine--visible">
                <div className="demo-merged-library__refine-panel">
                  <div className="demo-merged-library__radio-mode" role="group" aria-label="Group Library by">
                    {(["albums", "songs", "artists"] as const).map((value) => (
                      <Link
                        key={value}
                        href={buildWholeLibraryHref(value)}
                        aria-current={grouping === value ? "page" : undefined}
                      >
                        {value[0]!.toUpperCase()}{value.slice(1)}
                      </Link>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
          {view === "radio" && allArtists.length > 0 && (
            <div className={`demo-merged-library__station-tools is-${stationMode}`}>
              {focusedArtist ? (
                <button
                  type="button"
                  className="demo-merged-library__radio-focus-chip"
                  aria-label={`Clear artist focus: ${focusedArtist}`}
                  onClick={() => updateSearch((next) => {
                    next.delete("focus");
                    next.delete("focusId");
                    next.delete("openAlbum");
                  })}
                >
                  Artist: {focusedArtist} <span aria-hidden="true">×</span>
                </button>
              ) : null}
              <div
                className="demo-merged-library__refine demo-merged-library__refine--visible"
                aria-label={`Refine Radio${radioRefineCount > 0 ? `, ${radioRefineCount} active` : ""}`}
              >
                <div className="demo-merged-library__refine-panel">
                  <ArtistFocusControl
                      allArtists={allArtists}
                      artistCrossingCounts={artistCrossingCounts}
                      visibleSeeds={visibleSeeds}
                      focusedArtist={focusedArtist}
                      onFocus={(artist, suggestedArtistMbid) => updateSearch((next) => {
                        writeLibraryFocus(next, "artist");
                        next.set("focus", artist);
                        const artistMbid = suggestedArtistMbid
                          ?? artistMbidByName.get(artist.trim().toLocaleLowerCase());
                        if (artistMbid) next.set("focusId", artistMbid);
                        else next.delete("focusId");
                        next.delete("openAlbum");
                      })}
                      onClear={() => updateSearch((next) => {
                        next.delete("focus");
                        next.delete("focusId");
                        next.delete("openAlbum");
                      })}
                      onAddSeed={(artist) => {
                        void addSeed(artist);
                      }}
                      onRemoveSeed={(artist) => {
                        void removeSeed(artist);
                      }}
                  />
                  <span className="demo-merged-library__filter-tool">
                  <LibraryStationFilters
                    categories={activeCategories}
                    broZonesActive={broZoneState.active}
                    broZones={activeBroZones}
                    broZoneCounts={broZoneCounts}
                    onToggleCategory={(category) => updateSearch((next) => {
                      next.set("stationMode", "all");
                      const selected = new Set(activeCategories);
                      if (selected.has(category)) selected.delete(category);
                      else selected.add(category);
                      const ordered = STATION_CATEGORY_DEFINITIONS
                        .map(({ cat }) => cat)
                        .filter(cat => selected.has(cat));
                      if (ordered.length > 0) next.set("categories", ordered.join(","));
                      else next.delete("categories");
                      if (!selected.has("specialist")) next.delete("specialistCategories");
                    })}
                    specialistSubcategories={specialistSubcategories}
                    onToggleSpecialistSubcategory={(subcategory) => updateSearch((next) => {
                      next.set("stationMode", "all");
                      const selected = new Set(specialistSubcategories);
                      if (selected.has(subcategory)) selected.delete(subcategory);
                      else selected.add(subcategory);
                      const ordered = SPECIALIST_SUBCATEGORY_DEFINITIONS
                        .map(({ id }) => id)
                        .filter((id) => selected.has(id));
                      if (ordered.length) next.set("specialistCategories", ordered.join(","));
                      else next.delete("specialistCategories");
                    })}
                    onToggleBroZonesCollection={() => updateSearch((next) => {
                      next.set("stationMode", "all");
                      writeBroZoneState(next, !broZoneState.active || activeBroZones.size > 0, new Set());
                    })}
                    onToggleBroZone={(zone) => updateSearch((next) => {
                      next.set("stationMode", "all");
                      const selected = new Set(activeBroZones);
                      if (selected.has(zone)) selected.delete(zone);
                      else selected.add(zone);
                      writeBroZoneState(next, selected.size > 0, selected);
                    })}
                    onClear={() => updateSearch(next => {
                      next.delete("categories");
                      next.delete("specialistCategories");
                      writeBroZoneState(next, false, new Set());
                    })}
                  />
                  </span>
                  <details className="demo-merged-library__floating-menu demo-merged-library__sort-menu">
                    <summary
                      aria-label={`Sort Radio by ${
                        radioRank === "keeps"
                          ? "Your keeps"
                          : radioRank === "albums"
                            ? "Albums filed"
                            : radioRank === "premieres"
                              ? "Premieres"
                              : "Crossings"
                      }`}
                      title="Sort Radio"
                    >
                      <ArrowUpDown aria-hidden="true" />
                    </summary>
                    <div className="demo-merged-library__floating-menu-panel" role="group" aria-label="Sort Radio">
                      {([
                        ["crossings", "Crossings"],
                        ["keeps", "Your keeps"],
                        ["albums", "Albums filed"],
                        ["premieres", "Premieres"],
                      ] as const).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          aria-pressed={radioRank === value}
                          onClick={(event) => {
                            updateSearch((next) => {
                              if (value === "crossings") next.delete("radioRank");
                              else next.set("radioRank", value);
                            });
                            event.currentTarget.closest("details")?.removeAttribute("open");
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </details>
                </div>
              </div>
              <div className="demo-merged-library__radio-mode" role="group" aria-label="Radio mode">
                <button
                  type="button"
                  aria-pressed={!remoteLayout}
                  onClick={() => updateSearch((next) => next.delete("layout"))}
                >
                  Ranked
                </button>
                <button
                  type="button"
                  aria-pressed={remoteLayout}
                  onClick={() => updateSearch((next) => {
                    next.set("layout", "grid");
                    next.delete("stationMode");
                    next.delete("stationSort");
                  })}
                >
                  Presets
                </button>
              </div>
            </div>
          )}

          {wholeLibrary && grouping === "songs" && (
            <>
              <select
                style={selectStyle}
                aria-label="Sort songs"
                value={songSort}
                onChange={e => {
                  updateSearch((next) => {
                    if (e.target.value !== "added") next.set("sort", e.target.value);
                    else next.delete("sort");
                  });
                }}
              >
                <option value="added">Recently kept</option>
                <option value="artist">Artist name</option>
                <option value="title">Title</option>
                {(songSort === "album" || songSort === "count") && (
                  <optgroup label="Presentation">
                    <option value="album">Album grouping</option>
                    <option value="count">Most kept grouping</option>
                  </optgroup>
                )}
              </select>
            </>
          )}
        </div>
        {view === "radio" && broZipOpen ? (
          <form className="demo-merged-library__zip-form" onSubmit={submitBroZoneZip}>
            <label htmlFor="demo-bro-zone-zip">Put one nearby station first using a US ZIP</label>
            <div>
              <input
                id="demo-bro-zone-zip"
                inputMode="numeric"
                autoComplete="postal-code"
                maxLength={5}
                pattern="[0-9]{5}"
                placeholder="ZIP"
                value={broZip}
                onChange={(event) => setBroZip(event.target.value.replace(/\D/g, "").slice(0, 5))}
              />
              <button type="submit" disabled={broZip.length !== 5 || broZipLoading}>
                {broZipLoading ? "Checking…" : "Use ZIP"}
              </button>
              <button type="button" onClick={() => {
                setBroZipOpen(false);
                setBroZipError(null);
              }}>
                Cancel
              </button>
              {broZoneOrigin ? (
                <button type="button" onClick={() => {
                  setBroZoneOrigin(null);
                  setBroZoneLocationLabel(null);
                  setBroZip("");
                  setBroZipOpen(false);
                }}>
                  Remove nearby station
                </button>
              ) : null}
            </div>
            {broZipError ? <p role="alert">{broZipError}</p> : null}
            <small>ZIP stays on this page. Only stations with verified locations within 50 miles qualify.</small>
          </form>
        ) : null}
      </header>
            {view === "radio" && remoteLayout && !selectedStationSlug ? radioLayout(
        <DemoStationRemote
          mode="highlights"
          localOrigin={broZoneOrigin}
          broZoneStations={broZoneStations}
          broZoneLocationLabel={broZoneLocationLabel}
          onRequestBroZoneZip={() => setBroZipOpen(true)}
          stations={scopedStations}
          hasData={hasSeeds || stations.some((station) =>
            station.albumCrossings.length > 0 || station.lifetimeCrossings + station.lifetimeArtistCrossings > 0)}
          focusedArtist={focusedArtist}
          focusedArtistMbid={focusedArtistMbid}
          focusedMembershipSettled={artistStationQuery.data !== undefined}
          focusedMembershipFailed={artistStationQuery.isError}
          onRetryFocusedMembership={() => { void artistStationQuery.refetch(); }}
          sort="overlap"
          forceAllStations={activeCategories.size > 0 || broZoneState.active}
           returnContext={returnContext}
          onOpenStationCrossings={(stationSlug) => updateSearch((next) => {
            next.set("stationCrossings", stationSlug);
          })}
          onFocusArtist={(artist, artistMbid) => updateSearch((next) => {
            writeLibraryFocus(next, "artist");
            next.set("focus", artist);
            if (artistMbid) next.set("focusId", artistMbid);
            else next.delete("focusId");
            next.delete("openAlbum");
          })}
        />,
      ) : view === "radio" && allArtists.length === 0 ? (
        radioLayout(<FirstRunLibraryOnboarding
          onAddArtists={async (artists) => {
            for (const artist of artists) await addSeed(artist);
          }}
        />)
      ) : view === "radio" ? (
        radioLayout(<RadioSurface
          mode={stationMode}
          onEnterAllStations={(sort) => updateSearch(next => { next.set("stationMode", "all"); next.set("stationSort", sort); })}
          broZoneStations={broZoneStations}
          localOrigin={broZoneOrigin}
          broZoneLocationLabel={broZoneLocationLabel}
          onRequestBroZoneZip={() => setBroZipOpen(true)}
          stations={scopedStations}
          hasSeeds={hasSeeds}
          hasLibrary={stations.some((station) =>
            station.albumCrossings.length > 0 || station.lifetimeCrossings + station.lifetimeArtistCrossings > 0)}
          showHeader={false}
          sort={stationSort}
          forceAllStations={activeCategories.size > 0 || broZoneState.active}
          matchFilters={matchFilters}
          onRemoveMatchFilter={removeMatchFilter}
          focusedArtist={focusedArtist}
          focusedArtistMbid={focusedArtistMbid}
          focusedMembershipSettled={artistStationQuery.data !== undefined}
          focusedMembershipFailed={artistStationQuery.isError}
          onRetryFocusedMembership={() => { void artistStationQuery.refetch(); }}
          selectedStationSlug={selectedStationSlug}
          onFocusArtist={(artist, artistMbid) => updateSearch((next) => {
            writeLibraryFocus(next, "artist");
            next.set("focus", artist);
            if (artistMbid) next.set("focusId", artistMbid);
            else next.delete("focusId");
            next.delete("openAlbum");
          })}
          onOpenStationCrossings={(stationSlug) => updateSearch((next) => {
            next.set("stationCrossings", stationSlug);
          })}
          onCloseStationCrossings={() => updateSearch((next) => {
            next.delete("stationCrossings");
            next.delete("focusMode");
            next.delete("station");
          })}
        />)
      ) : view === "library" && !wholeLibrary ? (
        <WorkflowAlbums workflow={workflow} returnContext={returnContext} />
      ) : view === "press" ? (
        <div style={{ maxWidth: 840, margin: "0 auto", padding: "12px 14px", paddingBottom: "max(120px, calc(var(--shell-h, 0px) + 20px))" }}>
          <HomePress focusedArtist={focusedArtist} />
        </div>
      ) : view === "merch" ? (
        <DemoMerchView focusedArtist={focusedArtist} focusedArtistMbid={focusedArtistMbid} />
      ) : wholeLibrary && grouping === "songs" && remoteLayout ? (
        <DemoSongRemote
          items={filteredDemoItems}
          sort={songSort}
          returnContext={returnContext}
          matchFilters={matchFilters}
          onArtistFocus={(artist, artistMbid) => updateSearch((next) => {
            writeLibraryFocus(next, "artist");
            next.set("focus", artist);
            if (artistMbid) next.set("focusId", artistMbid);
            else next.delete("focusId");
            next.delete("openAlbum");
          })}
          onAlbumFocus={(album) => updateSearch((next) => {
            next.set("openAlbum", album);
          })}
        />
      ) : wholeLibrary && grouping === "artists" ? (
         <LibraryContent
          embedded={embedded}
          showArtistEditor={false}
          focusedState={{
            artist: focusedArtist,
            genres: [],
            ages: [],
            decade: undefined,
            sort: "artist",
          }}
          forceFocus="artists"
           additionalArtists={shelfArtists}
        />
      ) : wholeLibrary && grouping === "albums" ? (
        <CanonicalLibraryAlbums
          keptItems={demoLibraryItems}
          shelfItems={shelfAlbums}
          focusedArtist={focusedArtist}
          returnContext={returnContext}
        />
      ) : wholeLibrary ? (
        <LibraryContent
          embedded={embedded}
          showArtistEditor={false}
          focusedState={{
            artist: focusedArtist,
            genres: [],
            ages: [],
            decade: undefined,
            sort: songSort,
          }}
        />
      ) : null}
    </main>
  );
}

function LibraryContent({
  embedded = false,
  showArtistEditor = true,
  focusedState,
  forceFocus,
  additionalArtists = [],
}: {
  embedded?: boolean;
  showArtistEditor?: boolean;
  forceFocus?: "albums" | "artists";
  additionalArtists?: string[];
  focusedState?: {
    artist: string | null;
    genres: string[];
    ages: Array<"current" | "catalog" | "deep">;
    decade?: number;
    sort: DemoSongSort;
  };
}) {
  const [location, setLocation] = useLocation();
  const search = useSearch();
  const { data: appConfig } = useAppConfig();
  const demoSurface = appConfig?.demoSurface === true;
  const entityReturnContext = demoSurface
    ? `${location.split("?")[0]}${search ? `?${search.replace(/^\?/, "")}` : ""}`
    : undefined;
  const [searchOpen, setSearchOpen] = useState(false);
  const [stackFilter, setStackFilter] = useState("");
  const queryClient = useQueryClient();
  const { radio } = usePlayer();
  const { data: albumAvatar } = useMyAlbumAvatar();

  // FocusState — persisted in URL as ?focusMode=recent|albums|artists|lore|matching|critic
  // (absent = the mixed chronological timeline).
  const focusMode = useMemo((): FocusState => {
    const requested = forceFocus ?? parseFocusState(search);
    if (!demoSurface || forceFocus) return requested;
    return requested === "artists" ? "artists" : "";
  }, [demoSurface, forceFocus, search]);

  const setFocusMode = (next: FocusState) => {
    const p = new URLSearchParams(search);
    if (next) p.set("focusMode", next);
    else p.delete("focusMode");
    const qs = p.toString();
    // strip the path portion (e.g. /library) and just update search
    setLocation(qs ? `${location.split("?")[0]}?${qs}` : location.split("?")[0]!);
  };

  // Server-side source scope for the active focusMode. The timeline and the
  // grouped lenses read the full mixed feed; keep-lenses scope to keeps and
  // Needs-matching scopes to unresolved soft rows.
  const sourceFilter = FOCUS_SOURCE[focusMode];

  // Sort — persisted in URL as ?sort=artist|title|album|count (default = "added", omitted from URL)
  const sortFilter = useMemo((): DemoSongSort => {
    if (demoSurface && focusedState) return focusedState.sort;
    const v = new URLSearchParams(search).get("sort");
    return parseDemoSongSort(v);
  }, [demoSurface, focusedState, search]);

  const setSortFilter = (sort: DemoSongSort) => {
    const p = new URLSearchParams(search);
    if (sort !== "added") p.set("sort", sort);
    else p.delete("sort");
    const qs = p.toString();
    setLocation(qs ? `${location.split("?")[0]}?${qs}` : location.split("?")[0]!);
  };

  // View mode is derived from the focusMode, or sortFilter in demo mode.
  const viewMode: "track" | "album" | "artist" = demoSurface
    ? (sortFilter === "artist" || sortFilter === "count" ? "artist" : sortFilter === "album" ? "album" : "track")
    : focusMode === "artists" ? "artist" :
      (focusMode === "recent" || focusMode === "lore" || focusMode === "matching" || focusMode === "critic") ? "track" :
      "album";

  // In demo mode, track lists (added/title) use the Crate. Otherwise, only track/album mode does.
  const isStackView = forceFocus === "albums"
    ? false
    : demoSurface ? (viewMode === "track") : viewMode !== "artist";
  // Every current Library route uses the compact crate/index shell. Legacy
  // track lenses still render the Songs crate and must not revive dashboard
  // chrome; Artists uses the same surrounding shell.
  const isLibraryMode = demoSurface || isStackView || viewMode === "artist";

  const { data: connections, isLoading: connLoading } = useMyConnections();
  const isAuthenticated = !connLoading && connections !== null;
  const hasSpotify =
    Array.isArray(connections) && connections.some((c) => c.service === "spotify");

  // Ledger consent
  const { data: prefs } = useMyPreferences();
  const ledgerEnabled = prefs?.ledgerEnabled ?? false;
  // Snapshot the dismissal-TTL gate (localStorage + Date.now, both impure) once
  // at mount so the prompt's visibility can be derived purely during render
  // rather than synced into state from an effect.
  const [ledgerDismissGatePassed] = useState(() => ledgerPromptDismissGatePassed());
  // Session-level manual hide (Not now / Start recording), applied immediately.
  const [ledgerPromptHidden, setLedgerPromptHidden] = useState(false);
  const [ledgerBusy, setLedgerBusy] = useState(false);
  const ledgerPromptVisible =
    prefs !== undefined && !ledgerEnabled && ledgerDismissGatePassed && !ledgerPromptHidden;
  const handleEnableLedger = async () => {
    setLedgerBusy(true);
    try {
      await patchPreferences({ ledgerEnabled: true });
      void queryClient.invalidateQueries({ queryKey: ME_PREFERENCES_KEY });
      setLedgerPromptHidden(true);
    } catch { /* silent */ } finally { setLedgerBusy(false); }
  };
  const handleDismissLedgerPrompt = () => { dismissLedgerPrompt(); setLedgerPromptHidden(true); };

  const focusedMusicGenres = demoSurface ? (focusedState?.genres ?? []) : [];
  const focusedMusicAges = demoSurface ? (focusedState?.ages ?? []) : [];
  const focusedDecade = demoSurface ? focusedState?.decade : undefined;
  // Kept list (infinite scroll)
  const {
    data: keptData,
    isLoading: keptLoading,
    isFetchingNextPage,
    fetchNextPage,
    // libraryTotal is populated from the first-page COUNT query (no cursor).
    // Subsequent pages omit it; we keep the first-page value for display.
    hasNextPage,
  } = useMyLibraryInfinite({
    source: sourceFilter || undefined,
    sort: (sortFilter === "count" || sortFilter === "album") ? "added" : sortFilter,
    genre: focusedMusicGenres.join(",") || undefined,
    age: focusedMusicAges.join(",") || undefined,
    decade: focusedDecade,
  }, 100);
  // Every focusMode is fully server-scoped (including From Lore via source=lore),
  // so rows arrive deduplicated, dual-source-labeled, and pre-filtered —
  // pagination and totals always describe exactly the visible feed.
  const rawKeptItems = useMemo(
    () => keptData?.pages.flatMap((p) => p.items) ?? [],
    [keptData],
  );
  const focusedArtist = demoSurface ? (focusedState?.artist ?? null) : null;
  const keptItems = useMemo(() => {
    if (!focusedArtist) return rawKeptItems;
    const normalizedFocus = focusedArtist.trim().toLocaleLowerCase();
    return rawKeptItems.filter(
      i => i.recording?.artist.trim().toLocaleLowerCase() === normalizedFocus,
    );
  }, [rawKeptItems, focusedArtist]);

  useEffect(() => {
    const latest = keptItems.find((item) => item.mbid && item.recording);
    if (!latest?.mbid || !latest.recording) return;
    writeLibraryFallbackIfAbsent(
      {
        mbid: latest.mbid,
        title: latest.recording.title,
        artist: latest.recording.artist,
        artworkUrl: latest.recording.artworkUrl,
        links: [],
      },
      {
        mbid: latest.mbid,
        title: latest.recording.albumTitle ?? latest.recording.title,
        artworkUrl: latest.recording.artworkUrl,
      },
      latest.mbid,
    );
  }, [keptItems]);
  // Total count from the server's first-page COUNT query — reflects the real
  // library size even before all pages are loaded.
  const libraryTotal: number | undefined = keptData?.pages[0]?.total;
  const effectiveLibraryTotal = focusedArtist ? keptItems.length : (libraryTotal ?? keptItems.length);

  // Stable import-scoped counts for the "X of Y matched" stat.
  // Always scoped to source=import so numbers are unaffected by sourceFilter.
  const { data: importStats } = useMyImportStats();

  // Single-open door strip: tracks which row has its door strip expanded
  const [openDoorMbid, setOpenDoorMbid] = useState<string | null>(null);
  // Single-open album shelf: tracks which row has its album shelf expanded
  const [openShelfMbid, setOpenShelfMbid] = useState<string | null>(null);
  // Single-open Stack album row (album key from buildAlbumGroups).
  // Seeded from the ?openAlbum= URL param so CompactStack rows can deep-link
  // straight to a specific album without a separate routing layer.
  const openAlbumKey = useMemo(
    () => new URLSearchParams(search).get("openAlbum"),
    [search],
  );
  const setOpenAlbum = (albumKey: string | null) => {
    const params = new URLSearchParams(search);
    if (albumKey) params.set("openAlbum", albumKey);
    else params.delete("openAlbum");
    const query = params.toString();
    setLocation(query ? `${location.split("?")[0]}?${query}` : location.split("?")[0]!);
  };
  const focusLibraryArtist = (artist: string) => {
    const url = new URL(buildFocusedLibraryUrl(search, { artist }), "https://lore.local");
    writeLibraryFocus(url.searchParams, "artist");
    setLocation(`${url.pathname}?${url.searchParams.toString()}`);
  };
  const focusLibraryAlbum = (albumKey: string) => {
    const artist = getArtistFromLibraryAlbumKey(albumKey);
    if (!artist) return;
    const url = new URL(buildFocusedLibraryUrl(search, { artist, albumKey }), "https://lore.local");
    writeLibraryFocus(url.searchParams, "artist");
    setLocation(`${url.pathname}?${url.searchParams.toString()}`);
  };


  // The crate is the only Library surface now, so every focusMode must receive the
  // complete bounded library before it groups releases. This also prevents a
  // deep-linked track focusMode from quietly stopping at the first page.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (isLibraryMode && hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [isLibraryMode, hasNextPage, isFetchingNextPage, fetchNextPage]);
  useEffect(() => {
    // The legacy track/artist list no longer renders, so its scroll sentinel
    // must not start a second pagination loop.
    if (isLibraryMode) return;
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) void fetchNextPage();
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [viewMode, isLibraryMode, hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Import job
  const { data: jobData } = useLatestImportJob();
  /** Stores the jobId the user dismissed the unresolved-review section for. */
  const [reviewDismissedJobId, setReviewDismissedJobId] = useState<number | null>(null);
  const [reviewExpanded, setReviewExpanded] = useState(false);
  /** Controls visibility of the import banner; dismissed manually or auto after 60s. */
  const [bannerDismissed, setBannerDismissed] = useState(false);
  useEffect(() => {
    if (jobData?.status !== "done") return;
    // Refresh overlap data after import
    void queryClient.invalidateQueries({ queryKey: ME_OVERLAP_PICKERS_KEY });
    void queryClient.invalidateQueries({ queryKey: ME_OVERLAP_STATIONS_KEY });
    void queryClient.invalidateQueries({ queryKey: ME_OVERLAP_RUNS_KEY });
    void queryClient.invalidateQueries({ queryKey: ME_LIBRARY_COVERAGE_KEY });
    // Bust crossings so the Dial reflects the new library immediately
    void queryClient.invalidateQueries({ queryKey: ["me", "crossings"] });
    // Auto-dismiss banner after 60s. Defer the reveal into a microtask so
    // setState happens asynchronously (in response to the async job status
    // change) rather than synchronously in the effect body.
    void Promise.resolve().then(() => setBannerDismissed(false));
    const t = setTimeout(() => setBannerDismissed(true), 60_000);
    return () => clearTimeout(t);
  }, [jobData?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  // Clear banner dismissed state when a new job starts
  useEffect(() => {
    if (jobData?.status === "pending" || jobData?.status === "running") {
      // Defer so setState happens asynchronously (in response to the async job
      // status change) rather than synchronously in the effect body.
      void Promise.resolve().then(() => setBannerDismissed(false));
    }
  }, [jobData?.status]);
  const showImportBanner =
    !bannerDismissed &&
    jobData != null &&
    (jobData.status === "pending" || jobData.status === "running" || jobData.status === "done");
  const isImportActive = jobData?.status === "pending" || jobData?.status === "running";
  const showReviewSection =
    jobData?.status === "done" &&
    (jobData.unresolvedCount ?? 0) > 0 &&
    reviewDismissedJobId !== jobData.jobId;

  // Sync
  const { data: syncJobData } = useLatestSyncJob();
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncNeedsReconnect, setSyncNeedsReconnect] = useState(false);
  const [syncReceiptOpen, setSyncReceiptOpen] = useState(false);
  const [reconnectBusy, setReconnectBusy] = useState(false);
  const isSyncActive = syncJobData?.status === "pending" || syncJobData?.status === "running";

  // Critics' lists coverage
  const { data: criticsCovData } = useMyLibraryCoverage();
  const criticsCovItems: LibraryCoverageList[] = criticsCovData ?? [];
  const [criticsCovOpen, setCriticsCovOpen] = useState(false);
  const handleSync = async () => {
    setSyncBusy(true); setSyncError(null); setSyncNeedsReconnect(false);
    try {
      await postStartSync("spotify");
      void queryClient.invalidateQueries({ queryKey: ME_LATEST_SYNC_JOB_KEY });
    } catch (err) {
      const isCanWriteError =
        err instanceof ApiError && err.data && typeof err.data === "object" &&
        "error" in err.data && (err.data as { error: string }).error === "canWrite:false";
      if (isCanWriteError) {
        setSyncNeedsReconnect(true); setSyncError("Spotify connection lacks write access.");
      } else {
        const msg =
          err instanceof ApiError && err.data && typeof err.data === "object" && "error" in err.data
            ? String((err.data as { error: unknown }).error)
            : "Sync failed. Try again.";
        setSyncError(msg);
      }
    } finally { setSyncBusy(false); }
  };
  const handleReconnect = async () => {
    setReconnectBusy(true);
    try { await startSpotifyLibraryReconnect(); } finally { setReconnectBusy(false); }
  };

  // File import
  const importFileRef = useRef<HTMLInputElement | null>(null);
  const [importingFile, setImportingFile] = useState(false);
  const [fileImportSummary, setFileImportSummary] = useState<FileImportSummary | null>(null);
  const [fileImportError, setFileImportError] = useState<string | null>(null);
  const handleImportFile = async (file: File) => {
    setImportingFile(true); setFileImportError(null); setFileImportSummary(null);
    try {
      let body: unknown;
      try { body = JSON.parse(await file.text()); } catch {
        setFileImportError("That file isn't valid JSON."); return;
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
    } finally { setImportingFile(false); }
  };

  /** Dispatch the global open-import-modal event so AppLayout shows the modal. */
  const openImportModal = () => window.dispatchEvent(new CustomEvent("lore:open-import-modal"));

  // Detect a new Spotify connection after OAuth redirect and auto-fire
  // postStartImport("spotify") immediately — no button click required.
  // The ImportStrip banner surfaces progress automatically once the job is
  // polling.  Only fires on a false→true transition (not on initial page load).
  const prevHasSpotifyRef = useRef<boolean | null>(null);
  useEffect(() => {
    // Wait until connections have resolved (skip while loading)
    if (connLoading) return;
    const prev = prevHasSpotifyRef.current;
    prevHasSpotifyRef.current = hasSpotify;
    // First resolution — record state without triggering
    if (prev === null) return;
    // Transition: Spotify was not connected, now is — kick off import
    if (!prev && hasSpotify) {
      // Skip if a job is already active (e.g. the page remounted after OAuth
      // while the previous import was still running; the ref resets on unmount
      // but the server job continues, so we must not fire a duplicate request).
      if (isImportActive) return;
      void (async () => {
        try {
          await postStartImport("spotify");
        } catch {
          // 409 = already running; any other error is surfaced by the banner
        } finally {
          void queryClient.invalidateQueries({ queryKey: ME_LATEST_IMPORT_JOB_KEY });
        }
      })();
    }
  }, [connLoading, hasSpotify, isImportActive]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Taste seeds — one shared source for CLI, document, Radio, and Library. ──
  const { visibleSeeds, replaceSeeds } = useSeedManager();
  const [artistDocumentOpen, setArtistDocumentOpen] = useState(false);
  const { data: seedCatalogue = {} } = useMyTasteSeedCatalogue(visibleSeeds);

  const libLoading = keptLoading;
  const isEmpty = !libLoading && keptItems.length === 0;
  void radio; // suppress unused lint

  // Investigation coverage — recording MBIDs with published track-knowledge claims
  // (powers the ✳ marker on Stack rows; empty when unauthenticated)
  const investigationCoveredMbids = useMyInvestigationCoverage();

  // Grouped views — computed only when the relevant view is active
  const albumGroups = useMemo(
    () => (viewMode === "album" ? buildAlbumGroups(keptItems) : []),
    [viewMode, keptItems],
  );
  const artistGroups = useMemo(() => {
    const groups = buildArtistGroups(keptItems, additionalArtists);
    if (sortFilter === "count") {
      groups.sort((a, b) => b.items.length - a.items.length || a.artist.localeCompare(b.artist));
    }
    return groups;
  }, [additionalArtists, keptItems, sortFilter]);

  // Per-album hide preference — shared with the compact Stack on the front door
  // so a homepage skip is honoured here too.
  const { skipped: stackSkipped, toggleSkip: toggleStackSkip } = useStackSkipped();
  const activeAlbumGroups = useMemo(
    () => albumGroups.filter((g) => !stackSkipped.has(g.key)),
    [albumGroups, stackSkipped],
  );
  const skippedAlbumGroups = useMemo(
    () => albumGroups.filter((g) => stackSkipped.has(g.key)),
    [albumGroups, stackSkipped],
  );
  // Collapsed/expanded state for the "Hidden" section at the bottom of the Stack.
  const [hiddenSectionOpen, setHiddenSectionOpen] = useState(false);

  // Scroll to the album row targeted by the ?openAlbum= URL param once
  // albumGroups have been built (data loads asynchronously after mount).
  useEffect(() => {
    if (!openAlbumKey || albumGroups.length === 0) return;
    const t = setTimeout(() => {
      const el = [...document.querySelectorAll<HTMLElement>("[data-album-key]")]
        .find((candidate) => candidate.dataset.albumKey === openAlbumKey);
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
    return () => clearTimeout(t);

  }, [openAlbumKey, albumGroups.length]);

  // Hero stats
  // keepCount comes from the server's page-1 COUNT — accurate across the full
  // library regardless of how many items are loaded client-side.  Falls back to
  // a client-side count from loaded items so the stat is available immediately
  // before the first fetch resolves (typically 0, updates once data arrives).
  const keepCount: number = focusedArtist
    ? keptItems.filter((i) => i.provenance.kind === "keep").length
    : keptData?.pages[0]?.keepCount ?? 0;
  const criticCount: number = focusedArtist
    ? keptItems.filter((i) => i.provenance.kind === "critic").length
    : keptData?.pages[0]?.criticCount ?? 0;

  // First-run auto-open: prompt new users to seed their taste via the import
  // modal, but only when they have no library, no seeds, and haven't already
  // chosen an avatar.  Fires once per browser session via sessionStorage.
  useEffect(() => {
    if (demoSurface) return;
    if (isStackView) return;
    // Wait for library + avatar data to resolve before deciding
    if (keptData === undefined || albumAvatar === undefined) return;
    // User already has music or seeds — returning user, skip auto-open
    if (keepCount > 0 || visibleSeeds.length > 0) return;
    // User already has an avatar (needsChoice===false && current set) — skip
    if (albumAvatar.needsChoice === false && albumAvatar.current != null) return;
    // Only fire once per browser session
    try {
      if (sessionStorage.getItem("lore:first-run-prompted")) return;
      sessionStorage.setItem("lore:first-run-prompted", "1");
    } catch { return; }
    openImportModal();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoSurface, keptData, albumAvatar, keepCount, visibleSeeds.length]);
  const selectorCount = useMemo(() => {
    const handles = new Set<string>();
    for (const item of keptItems) {
      if (item.provenance.pickerHandle) handles.add(item.provenance.pickerHandle);
    }
    return handles.size;
  }, [keptItems]);

  const unavailableItems =
    syncJobData?.status === "done" ? syncJobData.results?.unavailableItems ?? [] : [];
  const searchMatchedItems =
    syncJobData?.status === "done" ? syncJobData.results?.searchMatchedItems ?? [] : [];

  // Reconnect prompt: authenticated, no Spotify, but has kept items
  return (
    <div className={`dial-root${embedded ? " dial-root--embedded" : ""}${demoSurface ? " demo-library" : ""}`}>
      {!isLibraryMode && searchOpen && (
        <SearchOverlay
          dialStations={[]}
          libraryItems={keptItems}
          onClose={() => setSearchOpen(false)}
          onStationDrill={(slug) => { setLocation(`/archive/stations/${slug}`); setSearchOpen(false); }}
          onShowDrill={(_show, station) => {
            setLocation(`/archive/stations/${station.station.slug}`);
            setSearchOpen(false);
          }}
        />
      )}

      {/* The Library Stack is intentionally chrome-free. */}
      {!isLibraryMode && (
        <div className="dial-topbar">
          <span className="dial-topbar__wordmark">Lore</span>
          <span className="dial-topbar__title dial-topbar__title--active">Library</span>
          {effectiveLibraryTotal > 0 ? (
            <span className="dial-topbar__sort-chip">
              {sourceFilter === "keep" ? "📻" : sourceFilter === "soft" ? "✦" : sourceFilter === "critic" ? "★" : "◆"}{" "}
              {effectiveLibraryTotal.toLocaleString()}
            </span>
          ) : null}
          <button
            type="button"
            className="dial-topbar__search"
            onClick={() => setSearchOpen(true)}
            aria-label="Search"
          >
            <Search size={14} />
          </button>
        </div>
      )}
      {!isLibraryMode && <AlbumAvatarPicker showCurrent />}
      {!embedded && showArtistEditor ? (
        <div className="library-artist-editor" data-testid="library-artist-editor">
          <div className="front-door-artist-onboarding">
            <button
              type="button"
              onClick={() => setArtistDocumentOpen((open) => !open)}
              aria-expanded={artistDocumentOpen}
              aria-controls="library-artist-document"
            >
              Add artists
            </button>
          </div>
          {artistDocumentOpen ? (
            <div id="library-artist-document">
              <ArtistDocument
                artists={visibleSeeds}
                onSave={replaceSeeds}
                onClose={() => setArtistDocumentOpen(false)}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Import banner — shown while import is running and for 60s after done */}
      {!isLibraryMode && showImportBanner && jobData && (
        <LibraryImportBanner
          job={jobData}
          onDismiss={() => setBannerDismissed(true)}
        />
      )}

      {/* Unresolved review section — shown after import when some tracks couldn't be matched */}
      {!isLibraryMode && showReviewSection && jobData && (
        <div
          style={{
            borderBottom: "1px solid hsl(var(--border))",
            background: "hsl(var(--card))",
            flexShrink: 0,
          }}
          data-testid="library-unresolved-review"
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 15px" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <span
                style={{
                  fontFamily: "var(--app-font-mono)",
                  fontSize: 12,
                  color: "hsl(var(--faint))",
                }}
              >
                {(jobData.unresolvedCount ?? 0).toLocaleString()} track
                {(jobData.unresolvedCount ?? 0) === 1 ? "" : "s"} couldn't be matched — retrying overnight
              </span>
            </div>
            <button
              type="button"
              onClick={() => setReviewExpanded((v) => !v)}
              aria-expanded={reviewExpanded}
              style={{
                fontFamily: "var(--app-font-mono)",
                fontSize: 10,
                color: "hsl(var(--dim))",
                background: "none",
                border: "none",
                cursor: "pointer",
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                gap: 3,
              }}
            >
              {reviewExpanded
                ? <ChevronUp style={{ width: 9, height: 9 }} />
                : <ChevronDown style={{ width: 9, height: 9 }} />}
              {reviewExpanded ? "hide" : "show"}
            </button>
            <button
              type="button"
              onClick={() => setReviewDismissedJobId(jobData.jobId)}
              style={{
                fontFamily: "var(--app-font-display)",
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: "0.07em",
                color: "hsl(var(--faint))",
                background: "none",
                border: "none",
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              dismiss
            </button>
          </div>
          {reviewExpanded && (jobData.unresolvedSample?.length ?? 0) > 0 && (
            <div
              style={{
                borderTop: "1px solid hsl(var(--border) / 0.5)",
                maxHeight: 220,
                overflowY: "auto",
              }}
              data-testid="library-unresolved-list"
            >
              {jobData.unresolvedSample!.map((item, idx) => (
                <div
                  key={idx}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    padding: "5px 15px",
                    borderBottom: "1px solid hsl(var(--border) / 0.3)",
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--app-font-display)",
                      fontSize: 12,
                      color: "hsl(var(--dim))",
                    }}
                  >
                    {item.rawArtist}
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--app-font-mono)",
                      fontSize: 12,
                      color: "hsl(var(--faint))",
                    }}
                  >
                    {item.rawTitle}
                  </span>
                </div>
              ))}
              {(jobData.unresolvedCount ?? 0) > (jobData.unresolvedSample?.length ?? 0) && (
                <div
                  style={{
                    padding: "5px 15px",
                    fontFamily: "var(--app-font-mono)",
                    fontSize: 10,
                    color: "hsl(var(--faint))",
                  }}
                >
                  …and{" "}
                  {(
                    (jobData.unresolvedCount ?? 0) - (jobData.unresolvedSample?.length ?? 0)
                  ).toLocaleString()}{" "}
                  more
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Body */}
      <div className="dial-body">

        {/* ── Hero ── (non-Stack lenses only) */}
        {!isLibraryMode && (
          <div className="lib-hero">
            <div className="lib-hero__kicker">◆ Your library</div>
            <div className="lib-hero__headline">
              <b>{effectiveLibraryTotal.toLocaleString()} tracks</b>
              {keepCount > 0 && `, ${keepCount} of them found on air`}
            </div>
            <div className="lib-hero__stats">
              {keepCount > 0 && (
                <button
                  type="button"
                  className={`lib-hero__stat${focusMode === "recent" ? " lib-hero__stat--warm" : " lib-hero__stat--dim"}`}
                  style={{ cursor: "pointer", border: "none" }}
                  onClick={() => setFocusMode(focusMode === "recent" ? "" : "recent")}
                  title="Filter to tracks saved from radio"
                >
                  <b>{keepCount}</b> kept from radio
                </button>
              )}
              {jobData?.status === "done" && sourceFilter !== "keep" && importStats != null && importStats.total > 0 && (
                // importStats is always scoped to source=import, so these numbers
                // are stable regardless of the active sourceFilter.  jobData is
                // only used to gate visibility (an import has run); the counts
                // come from the live library so retry-pass resolutions show up.
                <span className="lib-hero__stat">
                  <b>{(importStats.total - importStats.softCount).toLocaleString()}</b> of {importStats.total.toLocaleString()} from Spotify matched
                </span>
              )}
              {(() => {
                // Use the live soft-row count from the library response (page 1).
                // The import-job totals are frozen at import time; retry passes
                // resolve more tracks later and would leave the button showing a
                // stale non-zero number while the list is actually empty.
                const liveSoftCount = keptData?.pages[0]?.softCount;
                const showSoftBtn = liveSoftCount != null
                  ? liveSoftCount > 0
                  : (jobData?.status === "done" && jobData.total > jobData.resolved);
                const softLabel = liveSoftCount != null
                  ? liveSoftCount.toLocaleString()
                  : (jobData ? jobData.total - jobData.resolved : 0).toLocaleString();
                return showSoftBtn && sourceFilter !== "keep" ? (
                  <button
                    type="button"
                    className={`lib-hero__stat${focusMode === "matching" ? " lib-hero__stat--warm" : " lib-hero__stat--dim"}`}
                    style={{ cursor: "pointer", border: "none" }}
                    onClick={() => setFocusMode(focusMode === "matching" ? "" : "matching")}
                    title="Filter to tracks Spotify has but MusicBrainz doesn't"
                  >
                    {softLabel} not in MusicBrainz
                  </button>
                ) : null;
              })()}
              {criticCount > 0 && (
                <button
                  type="button"
                  className={`lib-hero__stat${focusMode === "critic" ? " lib-hero__stat--warm" : " lib-hero__stat--dim"}`}
                  style={{ cursor: "pointer", border: "none" }}
                  onClick={() => setFocusMode(focusMode === "critic" ? "" : "critic")}
                  title="Filter to tracks from critically listed albums"
                >
                  <b>{criticCount}</b> critics' pick{criticCount === 1 ? "" : "s"}
                </button>
              )}
              {selectorCount > 0 && (
                <Link href="/selectors" className="lib-hero__stat lib-hero__stat--warm">
                  <b>{selectorCount}</b> selector{selectorCount === 1 ? "" : "s"} fed it
                </Link>
              )}
            </div>
          </div>
        )}

        {/* ── Your Week ── (non-Stack lenses only) */}
        {!isLibraryMode && <YourWeekCard />}

        {/* ── Live strip (stub — wired when /me/library/live endpoint ships) ── */}
        {/* TODO: replace false with liveItems.length > 0 */}
        {/* eslint-disable-next-line no-constant-binary-expression */}
        {false && (
          <a href="/library?live=1" className="lib-live" data-testid="library-live-strip">
            <span className="lib-live__dot" />
            <span className="lib-live__text"><b>N of yours</b> are on air right now</span>
            <span className="lib-live__go">See ›</span>
          </a>
        )}

        {/* ── Ledger consent ── (transient consent prompt; kept in Stack too) */}
        {!isLibraryMode && ledgerPromptVisible && !ledgerEnabled && (
          <div
            style={{ borderBottom: "1px solid hsl(var(--border))", padding: "12px 15px", background: "hsl(var(--card))" }}
            data-testid="ledger-consent-prompt"
          >
            <div
              style={{
                fontFamily: "var(--app-font-display)",
                fontSize: 10,
                fontWeight: 400,
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                color: "hsl(var(--library))",
                marginBottom: 5,
              }}
            >
              Listening history
            </div>
            <div
              style={{
                fontFamily: "var(--app-font-reading)",
                fontSize: 15,
                color: "hsl(var(--foreground))",
                marginBottom: 8,
                maxWidth: "52ch",
              }}
            >
              Keep a record of what you hear? Lets Lore route support to stations you actually
              listen to. Yours, exportable, deletable.
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                disabled={ledgerBusy}
                onClick={() => void handleEnableLedger()}
                className="dial-ctabtn dial-ctabtn--keep"
                data-testid="ledger-enable-button"
              >
                {ledgerBusy ? "…" : "Start recording"}
              </button>
              <button
                type="button"
                onClick={handleDismissLedgerPrompt}
                className="dial-ctabtn"
                data-testid="ledger-dismiss-button"
              >
                Not now
              </button>
            </div>
          </div>
        )}

        {/* ── FocusState controls remain available above the crate on deep links. ── */}
        {!isLibraryMode && focusMode !== "" && (
          <>
            <div
              style={{
                display: "flex",
                gap: 6,
                padding: "10px 15px",
                borderBottom: "1px solid hsl(var(--border) / 0.5)",
                flexWrap: "wrap",
              }}
              data-testid="library-lenses"
            >
              {(
                [
                  { value: "" as const, label: "Library" },
                  { value: "artists" as const, label: "Artists" },
                  { value: "recent" as const, label: "Recent keeps" },
                  { value: "lore" as const, label: "From Lore" },
                  { value: "matching" as const, label: "Needs matching" },
                  ...(criticsCovItems.length > 0
                    ? [{ value: "critic" as const, label: "Critics' picks" }]
                    : []),
                ] as const
              ).map(({ value, label }) => (
                <button
                  key={value || "timeline"}
                  type="button"
                  onClick={() => setFocusMode(value)}
                  style={{
                    fontFamily: "var(--app-font-display)",
                    fontSize: 10,
                    fontWeight: 400,
                    textTransform: "uppercase",
                    letterSpacing: "0.07em",
                    padding: "4px 10px",
                    borderRadius: 3,
                    border: focusMode === value
                      ? "1px solid hsl(var(--library))"
                      : "1px solid hsl(var(--border))",
                    background: focusMode === value
                      ? "hsl(var(--library) / 0.12)"
                      : "transparent",
                    color: focusMode === value
                      ? "hsl(var(--library))"
                      : "hsl(var(--dim))",
                    cursor: "pointer",
                    transition: "color 0.15s, border-color 0.15s, background 0.15s",
                  }}
                  data-testid={`library-focusMode-${value || "timeline"}`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* ── Sort + View controls ── */}
            <div
              style={{
                display: "flex",
                gap: 6,
                padding: "8px 15px",
                borderBottom: "1px solid hsl(var(--border) / 0.5)",
                alignItems: "center",
                flexWrap: "wrap",
              }}
              data-testid="library-sort-controls"
            >
              {/* Sort buttons — hidden in grouped views (grouping implies its own order) */}
              {(viewMode as string) === "track" && (
                <>
                  <span
                    style={{
                      fontFamily: "var(--app-font-display)",
                      fontSize: 10,
                      fontWeight: 400,
                      textTransform: "uppercase",
                      letterSpacing: "0.07em",
                      color: "hsl(var(--dim))",
                      marginRight: 2,
                    }}
                  >
                    Sort
                  </span>
                  {(
                    [
                      { value: "added" as const, label: "Added" },
                      { value: "artist" as const, label: "Artist" },
                      { value: "title" as const, label: "Title" },
                    ] as const
                  ).map(({ value, label }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setSortFilter(value)}
                      style={{
                        fontFamily: "var(--app-font-display)",
                        fontSize: 10,
                        fontWeight: 400,
                        textTransform: "uppercase",
                        letterSpacing: "0.07em",
                        padding: "4px 10px",
                        borderRadius: 3,
                        border: sortFilter === value
                          ? "1px solid hsl(var(--library))"
                          : "1px solid hsl(var(--border))",
                        background: sortFilter === value
                          ? "hsl(var(--library) / 0.12)"
                          : "transparent",
                        color: sortFilter === value
                          ? "hsl(var(--library))"
                          : "hsl(var(--dim))",
                        cursor: "pointer",
                        transition: "color 0.15s, border-color 0.15s, background 0.15s",
                      }}
                      data-testid={`library-sort-${value}`}
                    >
                      {label}
                    </button>
                  ))}
                </>
              )}
            </div>

            {/* ── Kept tracks section header ── */}
            <TierHd
              label={
                focusMode === "recent"
                  ? "Recent keeps"
                  : focusMode === "lore"
                  ? "From Lore"
                  : focusMode === "matching"
                  ? "Needs matching"
                  : focusMode === "critic"
                  ? "Critics' picks"
                  : focusMode === "artists"
                  ? "Artists"
                  : "Library"
              }
              count={keptItems.length > 0 ? `${keptItems.length.toLocaleString()}${hasNextPage ? "+" : ""}` : undefined}
              hint={
                sortFilter === "artist"
                  ? "A → Z by artist"
                  : sortFilter === "title"
                  ? "A → Z by title"
                  : "most recent first"
              }
            />

          </>
        )}

        {!demoSurface && isAuthenticated && hasSpotify && (
          <div data-testid="library-sync-stack">
            <SyncBar
              syncJobData={syncJobData}
              syncBusy={syncBusy}
              isSyncActive={isSyncActive}
              syncError={syncError}
              syncNeedsReconnect={syncNeedsReconnect}
              syncReceiptOpen={syncReceiptOpen}
              reconnectBusy={reconnectBusy}
              onSync={() => void handleSync()}
              onReconnect={() => void handleReconnect()}
              onToggleReceipt={() => setSyncReceiptOpen((value) => !value)}
            />
          </div>
        )}

        {!demoSurface && !libLoading && keptItems.length > 0 && (
          <div
            data-testid="library-view-toggle"
            role="group"
            aria-label="Library view"
            className="library-crate__section-heading"
            style={{
              display: "flex",
              alignItems: "baseline",
            }}
          >
            <h2>{demoSurface ? "Library" : "Kept"}</h2>
            {([
              { value: "" as const, label: "Songs", count: effectiveLibraryTotal },
              { value: "artists" as const, label: "Artists", count: artistGroups.length },
            ]).map(({ value, label, count }) => {
              const active = value === "artists" ? viewMode === "artist" : viewMode !== "artist";
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => setFocusMode(value)}
                  aria-pressed={active}
                  style={{
                    border: 0,
                    padding: 0,
                    background: "transparent",
                    color: active ? "hsl(var(--library))" : "hsl(var(--faint))",
                    font: "inherit",
                    cursor: "pointer",
                    textDecoration: active ? "underline" : "none",
                    textUnderlineOffset: 3,
                  }}
                  data-testid={`library-view-${label.toLowerCase()}`}
                >
                  {count.toLocaleString()} {label}
                </button>
              );
            })}
          </div>
        )}

        {!isLibraryMode &&
          jobData?.status === "done" &&
          sourceFilter !== "keep" &&
          importStats != null &&
          importStats.total > 0 && (
            <div
              className="library-crate__import-stat"
              data-testid="library-import-match-stat"
            >
              <b>{(importStats.total - importStats.softCount).toLocaleString()}</b>{" "}
              of {importStats.total.toLocaleString()} from Spotify matched
            </div>
          )}

        {libLoading ? (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {[0, 1, 2, 3, 4].map((i) => (
              <div
                key={i}
                style={{
                  height: 62,
                  borderBottom: "1px solid hsl(var(--border) / 0.4)",
                  background: "hsl(var(--secondary))",
                  opacity: 0.4 + i * 0.06,
                }}
              />
            ))}
          </div>
        ) : isStackView ? (
          <>
            {viewMode === "album" && !demoSurface ? (
              <div className="library-stack-filter" role="search">
                <Search size={14} aria-hidden="true" />
                <input
                  type="search"
                  value={stackFilter}
                  onChange={(event) => setStackFilter(event.target.value)}
                  placeholder="Find an album, artist, or song"
                  aria-label="Filter Stack albums"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  data-testid="library-stack-filter"
                />
                {stackFilter ? (
                  <button
                    type="button"
                    onClick={() => setStackFilter("")}
                    aria-label="Clear Stack filter"
                  >
                    Clear
                  </button>
                ) : null}
              </div>
            ) : null}
            <LibraryCrate
              items={keptItems}
              seedArtists={visibleSeeds}
              catalogue={seedCatalogue}
              sort={(sortFilter === "count" || sortFilter === "album") ? "added" : sortFilter}
              showKeptHeading={false}
              hideAddedRail={demoSurface}
              demoSurface={demoSurface}
              filterQuery={viewMode === "album" && !demoSurface ? stackFilter : ""}
              matchFilters={demoSurface ? {
                genres: focusedMusicGenres,
                ages: focusedMusicAges,
                decade: focusedDecade,
              } : undefined}
              onRemoveMatchFilter={demoSurface ? (fact) => {
                const next = new URLSearchParams(search);
                removeLibraryMatchFilter(next, fact);
                const qs = next.toString();
                setLocation(qs ? `${location.split("?")[0]}?${qs}` : location.split("?")[0]!);
              } : undefined}
              onArtistFocus={demoSurface ? focusLibraryArtist : undefined}
              onAlbumFocus={demoSurface ? focusLibraryAlbum : undefined}
              returnContext={entityReturnContext}
            />
          </>
        ) : (viewMode === "album" && (albumGroups.length > 0 || focusedArtist)) ? (
          /* ── Full-screen Stack: one scrollable album-row list, no dashboard chrome ── */
          <>
            <div data-testid="library-album-view">
              {focusedArtist ? (
                <ArtistDiscographyView
                  artist={focusedArtist}
                  savedGroups={activeAlbumGroups}
                  investigationCoveredMbids={investigationCoveredMbids}
                  openAlbumKey={openAlbumKey}
                  setOpenAlbumKey={setOpenAlbum}
                  catalogueReleases={
                    Object.entries(seedCatalogue).find(
                      ([name]) => name.toLocaleLowerCase() === focusedArtist.toLocaleLowerCase(),
                    )?.[1].releases ?? []
                  }
                   returnContext={entityReturnContext}
                />
              ) : (
                activeAlbumGroups.map((group) => (
                  <div key={group.key} data-album-key={group.key}>
                    <StackRow
                      group={group}
                      hasInvestigation={group.items.some(
                        (item) => item.mbid != null && investigationCoveredMbids.has(item.mbid),
                      )}
                      isOpen={openAlbumKey === group.key}
                      onToggle={() =>
                        setOpenAlbum(openAlbumKey === group.key ? null : group.key)
                      }
                      onToggleSkip={toggleStackSkip}
                    />
                  </div>
                ))
              )}

            {/* Hidden section — collapsed by default, expands to show skipped albums */}
              {skippedAlbumGroups.length > 0 && (
                <div data-testid="library-stack-hidden-section">
                  {/* Section toggle header */}
                  <div
                    role="button"
                    tabIndex={0}
                    data-testid="library-stack-hidden-toggle"
                    onClick={() => setHiddenSectionOpen((v) => !v)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setHiddenSectionOpen((v) => !v);
                      }
                    }}
                    aria-expanded={hiddenSectionOpen}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "8px 15px",
                      cursor: "pointer",
                      borderTop: "1px solid hsl(var(--border) / 0.4)",
                      borderBottom: hiddenSectionOpen ? "1px solid hsl(var(--border) / 0.3)" : undefined,
                      background: "hsl(var(--secondary) / 0.3)",
                      userSelect: "none",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "var(--app-font-mono)",
                        fontSize: 11,
                        color: "hsl(var(--faint))",
                        textTransform: "uppercase",
                        letterSpacing: "0.07em",
                        flex: 1,
                      }}
                    >
                      Hidden · {skippedAlbumGroups.length}
                    </span>
                    <span
                      aria-hidden="true"
                      style={{
                        fontFamily: "var(--app-font-mono)",
                        fontSize: 10,
                        color: "hsl(var(--faint))",
                        flexShrink: 0,
                      }}
                    >
                      {hiddenSectionOpen ? "▴" : "▾"}
                    </span>
                  </div>

                  {/* Skipped album rows */}
                  {hiddenSectionOpen && skippedAlbumGroups.map((group) => (
                    <div key={group.key} data-album-key={group.key} style={{ opacity: 0.55 }}>
                      <StackRow
                        group={group}
                        hasInvestigation={group.items.some(
                          (item) => item.mbid != null && investigationCoveredMbids.has(item.mbid),
                        )}
                        isOpen={openAlbumKey === group.key}
                        onToggle={() =>
                          setOpenAlbum(openAlbumKey === group.key ? null : group.key)
                        }
                        isSkipped
                        onToggleSkip={toggleStackSkip}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div ref={sentinelRef} style={{ height: 1 }} aria-hidden />
            {isFetchingNextPage && (
              <div style={{ display: "flex", justifyContent: "center", padding: "16px 0" }}>
                <Loader2
                  style={{ width: 16, height: 16, animation: "lore-eq 1s linear infinite", color: "hsl(var(--muted-foreground))" }}
                />
              </div>
            )}
          </>
        ) : (viewMode === "artist" && artistGroups.length > 0) ? (
          <>
            <div data-testid="library-artist-view">
              {artistGroups.map((group) => (
                demoSurface ? (
                  <DemoArtistSongGroup
                    key={group.key}
                    group={group}
                    onArtistFocus={focusLibraryArtist}
                    onAlbumFocus={focusLibraryAlbum}
                    returnContext={entityReturnContext}
                  />
                ) : (
                  <ArtistGroupRow key={group.key} group={group} />
                )
              ))}
            </div>
            <div ref={sentinelRef} style={{ height: 1 }} aria-hidden />
            {isFetchingNextPage && (
              <div style={{ display: "flex", justifyContent: "center", padding: "16px 0" }}>
                <Loader2
                  style={{ width: 16, height: 16, animation: "lore-eq 1s linear infinite", color: "hsl(var(--muted-foreground))" }}
                />
              </div>
            )}
            {!hasNextPage && keptItems.length > 0 && (
              <div
                style={{
                  padding: "14px 0",
                  textAlign: "center",
                  fontFamily: "var(--app-font-mono)",
                  fontSize: 12,
                  textTransform: "uppercase",
                  letterSpacing: "0.07em",
                  color: "hsl(var(--faint))",
                }}
              >
                {`${artistGroups.length} artist${artistGroups.length === 1 ? "" : "s"} · ${keptItems.length} song${keptItems.length === 1 ? "" : "s"}`}
              </div>
            )}
          </>
        ) : isEmpty ? (
          <div style={{ padding: "28px 15px", textAlign: "center" }}>
            {focusMode ? (
              <>
                <div
                  style={{
                    fontFamily: "var(--app-font-reading)",
                    fontSize: 18,
                    color: "hsl(var(--muted-foreground))",
                    marginBottom: 12,
                  }}
                >
                  {focusMode === "recent" || focusMode === "lore"
                    ? "Nothing kept from Lore yet."
                    : focusMode === "matching"
                    ? "No unresolved tracks — everything matched MusicBrainz."
                    : focusMode === "albums" || focusMode === "artists"
                    ? "Nothing in your library yet."
                    : "None of your kept tracks are from critically listed albums yet."}
                </div>
                <button
                  type="button"
                  onClick={() => setFocusMode("")}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    fontFamily: "var(--app-font-display)",
                    fontSize: 12,
                    fontWeight: 400,
                    textTransform: "uppercase",
                    letterSpacing: "0.07em",
                    color: "hsl(var(--library))",
                    background: "none",
                    border: "1px solid rgba(131, 131, 131,.35)",
                    borderRadius: 3,
                    padding: "6px 12px",
                    cursor: "pointer",
                  }}
                >
                  Show all
                </button>
              </>
            ) : (
              <div
                style={{
                  maxWidth: 320,
                  margin: "0 auto",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 16,
                  paddingTop: 8,
                }}
                data-testid="library-onboarding"
              >
                {/* Headline */}
                <div>
                  <div
                    style={{
                      fontFamily: "var(--app-font-display)",
                      fontSize: 21,
                      fontWeight: 400,
                      color: "hsl(var(--foreground))",
                      marginBottom: 8,
                    }}
                  >
                    Your music, on the radio
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--app-font-reading)",
                      fontSize: 15,
                      lineHeight: 1.55,
                      color: "hsl(var(--muted-foreground))",
                    }}
                  >
                    Import your saved tracks and Lore will light up every time a
                    song from your library hits the air — across all the stations
                    it follows.
                  </div>
                </div>

                {/* Radio link */}
                <Link
                  href="/"
                  style={{
                    fontFamily: "var(--app-font-mono)",
                    fontSize: 12,
                    color: "hsl(var(--faint))",
                    textDecoration: "none",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  <Radio style={{ width: 10, height: 10 }} /> Or just open the dial
                </Link>
              </div>
            )}
          </div>
        ) : (
          <>
            <ul style={{ margin: 0, padding: 0, listStyle: "none" }} data-testid="library-kept">
              {keptItems.map((item) => {
                // Soft rows (item.mbid === null) use spotifyId as their identity.
                // Resolved rows use mbid.  A stable non-null key prevents React
                // reconciliation issues when mbid is null for multiple soft rows.
                const rowKey = item.mbid ?? `soft:${item.spotifyId ?? item.addedAt}`;
                return (
                  <LibraryRow
                    key={rowKey}
                    item={item}
                    // Soft rows have no DoorStrip — they can never be "open".
                    isOpen={item.mbid != null && openDoorMbid === item.mbid}
                    onToggle={item.mbid != null
                      ? () => setOpenDoorMbid((prev) => prev === item.mbid ? null : item.mbid)
                      : undefined}
                    isShelfOpen={item.mbid != null && openShelfMbid === item.mbid}
                    onShelfToggle={item.mbid != null
                      ? () => setOpenShelfMbid((prev) => prev === item.mbid ? null : item.mbid)
                      : undefined}
                    returnContext={entityReturnContext}
                  />
                );
              })}
            </ul>
            <div ref={sentinelRef} style={{ height: 1 }} aria-hidden />
            {isFetchingNextPage && (
              <div
                style={{ display: "flex", justifyContent: "center", padding: "16px 0" }}
                data-testid="library-loading-more"
              >
                <Loader2
                  style={{ width: 16, height: 16, animation: "lore-eq 1s linear infinite", color: "hsl(var(--muted-foreground))" }}
                />
              </div>
            )}
            {!hasNextPage && keptItems.length > 0 && (
              <div
                style={{
                  padding: "14px 0",
                  textAlign: "center",
                  fontFamily: "var(--app-font-mono)",
                  fontSize: 12,
                  textTransform: "uppercase",
                  letterSpacing: "0.07em",
                  color: "hsl(var(--faint))",
                }}
                data-testid="library-end"
              >
                {keptItems.length} track{keptItems.length === 1 ? "" : "s"} total
              </div>
            )}
          </>
        )}


        {/* ── In critics' lists (non-Stack only) ── */}
        {!isLibraryMode && criticsCovItems.length > 0 && (
          <>
            <div
              role="button"
              tabIndex={0}
              onClick={() => setCriticsCovOpen((v) => !v)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") setCriticsCovOpen((v) => !v);
              }}
              className="dial-tier-hd"
              style={{ cursor: "pointer" }}
              data-testid="library-critics-lists-toggle"
            >
              <span className="dial-tier-hd__label">
                In critics' lists
                <span style={{ fontFamily: "var(--app-font-mono)", fontWeight: 400 }}>
                  {" "}· {criticsCovItems.length}
                </span>
              </span>
              {criticsCovOpen ? (
                <ChevronUp style={{ width: 10, height: 10, color: "hsl(var(--faint))", flexShrink: 0, marginLeft: 6 }} />
              ) : (
                <ChevronDown style={{ width: 10, height: 10, color: "hsl(var(--faint))", flexShrink: 0, marginLeft: 6 }} />
              )}
              <div className="dial-tier-hd__rule" />
            </div>
            {criticsCovOpen && (
              <div data-testid="library-critics-lists">
                {criticsCovItems.map((listEntry) => (
                  <div
                    key={listEntry.listId}
                    style={{ borderBottom: "1px solid hsl(var(--border) / 0.5)", padding: "10px 15px" }}
                  >
                    {/* List header with external link */}
                    <a
                      href={listEntry.listUrl}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        fontFamily: "var(--app-font-display)",
                        fontSize: 12,
                        fontWeight: 400,
                        textTransform: "uppercase",
                        letterSpacing: "0.07em",
                        color: "hsl(var(--library))",
                        textDecoration: "none",
                        marginBottom: 8,
                      }}
                    >
                      {listEntry.sourceName}
                      {listEntry.listYear ? ` ${listEntry.listYear}` : ""}
                      <ExternalLink style={{ width: 9, height: 9 }} />
                    </a>
                    {/* Album rows */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      {listEntry.albums.map((album) => (
                        <div
                          key={album.releaseGroupMbid}
                          style={{
                            display: "flex",
                            alignItems: "baseline",
                            gap: 8,
                          }}
                        >
                          {listEntry.isRanked && album.rank != null && (
                            <span
                              style={{
                                fontFamily: "var(--app-font-mono)",
                                fontSize: 12,
                                color: "hsl(var(--library))",
                                minWidth: 28,
                                textAlign: "right",
                                flexShrink: 0,
                              }}
                            >
                              #{album.rank}
                            </span>
                          )}
                          <span
                            style={{
                              fontFamily: "var(--app-font-reading)",
                              fontSize: 15,
                              color: "hsl(var(--foreground))",
                            }}
                          >
                            {album.albumTitle ?? album.releaseGroupMbid.slice(0, 8)}
                            {album.releaseYear != null && (
                              <span
                                style={{
                                  fontFamily: "var(--app-font-mono)",
                                  fontSize: 12,
                                  color: "hsl(var(--dim))",
                                  marginLeft: 5,
                                }}
                              >
                                {album.releaseYear}
                              </span>
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ── Sync & export receipts (legacy focusMode-only shell) ── */}
        {!isLibraryMode && (
          <>
            <TierHd label="Sync & export" hint="receipts, not content" />

            {/* Sync receipt rows (unavailable / search-matched) */}
            {syncReceiptOpen && unavailableItems.length > 0 && syncJobData && (
              <>
                <TierHd
                  label="Not on Spotify"
                  count={syncJobData.results?.unavailable ?? unavailableItems.length}
                />
                {unavailableItems.map((item) => (
                  <UnavailableRow key={item.mbid} item={item} />
                ))}
                {(syncJobData.results?.unavailable ?? 0) > 200 && (
                  <div style={{ padding: "8px 15px" }}>
                    <a
                      href={`/api/me/library/sync/${syncJobData.jobId}/unavailable?format=csv`}
                      download
                      style={{
                        fontFamily: "var(--app-font-mono)",
                        fontSize: 10,
                        color: "hsl(var(--library))",
                        textDecoration: "none",
                        textTransform: "uppercase",
                        letterSpacing: "0.07em",
                      }}
                      data-testid="library-sync-unavailable-download"
                    >
                      Download all ({syncJobData.results?.unavailable}) ↓
                    </a>
                  </div>
                )}
              </>
            )}
            {syncReceiptOpen && searchMatchedItems.length > 0 && syncJobData && (
              <>
                <TierHd
                  label="Matched by search"
                  count={syncJobData.results?.searchMatched ?? searchMatchedItems.length}
                />
                {searchMatchedItems.map((item) => (
                  <SearchMatchedRow key={item.mbid} item={item} />
                ))}
              </>
            )}

            {/* Sync to Spotify */}
            {isAuthenticated && hasSpotify && (
              <SyncBar
                syncJobData={syncJobData}
                syncBusy={syncBusy}
                isSyncActive={isSyncActive}
                syncError={syncError}
                syncNeedsReconnect={syncNeedsReconnect}
                syncReceiptOpen={syncReceiptOpen}
                reconnectBusy={reconnectBusy}
                onSync={() => void handleSync()}
                onReconnect={() => void handleReconnect()}
                onToggleReceipt={() => setSyncReceiptOpen((v) => !v)}
              />
            )}

            {/* Export */}
            <div style={{ padding: "10px 15px" }} data-testid="library-export">
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {(["csv", "json", "m3u8", "txt"] as const).map((fmt) => (
                  <a
                    key={fmt}
                    href={`/api/me/library/export?format=${fmt}`}
                    download
                    className="dial-ctabtn"
                    style={{ textDecoration: "none" }}
                    data-testid={`library-export-${fmt}`}
                  >
                    {fmt === "m3u8" ? "M3U8" : fmt.toUpperCase()}
                  </a>
                ))}
                <Link
                  href="/sets"
                  className="dial-ctabtn"
                  style={{ textDecoration: "none" }}
                  data-testid="library-imported-sets-link"
                >
                  Imported Sets
                </Link>
              </div>
              <div
                style={{ marginTop: 12, borderTop: "1px solid hsl(var(--border) / 0.5)", paddingTop: 10 }}
                data-testid="library-import-file"
              >
                <div
                  style={{
                    fontFamily: "var(--app-font-display)",
                    fontSize: 10,
                    fontWeight: 400,
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                    color: "hsl(var(--dim))",
                    marginBottom: 6,
                  }}
                >
                  Bring it back
                </div>
                <input
                  ref={importFileRef}
                  type="file"
                  accept="application/json,.json"
                  style={{ display: "none" }}
                  data-testid="library-import-file-input"
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
                  className="dial-ctabtn"
                  data-testid="library-import-file-button"
                >
                  {importingFile ? "Importing…" : "Import JSON file"}
                </button>
                {fileImportError && (
                  <p
                    style={{
                      marginTop: 6,
                      fontFamily: "var(--app-font-mono)",
                      fontSize: 12,
                      color: "hsl(var(--destructive))",
                    }}
                    data-testid="library-import-file-error"
                  >
                    {fileImportError}
                  </p>
                )}
                {fileImportSummary && (
                  <p
                    style={{ marginTop: 6, fontFamily: "var(--app-font-mono)", fontSize: 12, color: "hsl(var(--dim))" }}
                    data-testid="library-import-file-summary"
                  >
                    Imported {fileImportSummary.imported} · skipped {fileImportSummary.skipped} · rejected {fileImportSummary.rejected}
                  </p>
                )}
                <p style={{ marginTop: 8, fontFamily: "var(--app-font-mono)", fontSize: 10, color: "hsl(var(--faint))" }}>
                  To move to another streaming service, use{" "}
                  <a href="https://soundiiz.com" target="_blank" rel="noreferrer" style={{ color: "inherit", textDecoration: "underline" }}>
                    Soundiiz
                  </a>{" "}
                  or{" "}
                  <a href="https://www.tunemymusic.com" target="_blank" rel="noreferrer" style={{ color: "inherit", textDecoration: "underline" }}>
                    TuneMyMusic
                  </a>
                  .
                </p>
              </div>
            </div>

            {/* Footer note */}
            <div
              style={{
                padding: "14px 15px",
                borderTop: "1px solid hsl(var(--border) / 0.4)",
                marginTop: 8,
              }}
            >
              <p style={{ fontFamily: "var(--app-font-reading)", fontStyle: "normal", fontSize: 14, color: "hsl(var(--faint))", lineHeight: 1.6 }}>
                <b style={{ fontStyle: "normal", fontWeight: 400, color: "hsl(var(--muted-foreground))" }}>One song is enough.</b>{" "}
                A keep is an entry point, not a collectible. Where Lore doesn't know who picked
                something, it says less rather than guessing.
              </p>
            </div>
          </>
        )}

        {/* The crate's SyncBar lives above the content; keep its receipt rows
            available there too, without bringing back the legacy export shell. */}
        {isStackView && syncReceiptOpen && (
          <>
            {unavailableItems.length > 0 && syncJobData && (
              <>
                <TierHd
                  label="Not on Spotify"
                  count={syncJobData.results?.unavailable ?? unavailableItems.length}
                />
                {unavailableItems.map((item) => (
                  <UnavailableRow key={item.mbid} item={item} />
                ))}
                {(syncJobData.results?.unavailable ?? 0) > 200 && (
                  <div style={{ padding: "8px 15px" }}>
                    <a
                      href={`/api/me/library/sync/${syncJobData.jobId}/unavailable?format=csv`}
                      download
                      style={{
                        fontFamily: "var(--app-font-mono)",
                        fontSize: 10,
                        color: "hsl(var(--library))",
                        textDecoration: "none",
                        textTransform: "uppercase",
                        letterSpacing: "0.07em",
                      }}
                      data-testid="library-sync-unavailable-download"
                    >
                      Download all ({syncJobData.results?.unavailable}) ↓
                    </a>
                  </div>
                )}
              </>
            )}
            {searchMatchedItems.length > 0 && syncJobData && (
              <>
                <TierHd
                  label="Matched by search"
                  count={syncJobData.results?.searchMatched ?? searchMatchedItems.length}
                />
                {searchMatchedItems.map((item) => (
                  <SearchMatchedRow key={item.mbid} item={item} />
                ))}
              </>
            )}
          </>
        )}

        <div style={{ height: 60 }} />
      </div>
    </div>
  );
}
