import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { SearchOverlay } from "../components/SearchOverlay";
import { useQueryClient } from "@tanstack/react-query";
import { usePlayer } from "../player/PlayerProvider";
import { useFollows, isFollowed, toggleFollow } from "../lib/local";
import {
  useMyLibraryInfinite,
  useMyConnections,
  useLatestImportJob,
  useLatestSyncJob,
  startSpotifyLibraryConnect,
  startSpotifyLibraryReconnect,
  postStartImport,
  postStartSync,
  postImportLibraryFile,
  useMyPreferences,
  useMyAlbumsCompleted,
  patchPreferences,
  ME_PREFERENCES_KEY,
  ME_ALBUMS_COMPLETED_KEY,
  type FileImportSummary,
  type SyncJobStatus,
  type AlbumCompletion,
  ME_LATEST_IMPORT_JOB_KEY,
  ME_LATEST_SYNC_JOB_KEY,
  ME_OVERLAP_PICKERS_KEY,
  ME_OVERLAP_STATIONS_KEY,
  ME_OVERLAP_RUNS_KEY,
  useMyOverlapStations,
  useMyOverlapPickers,
  useMyOverlapRuns,
  type OverlapStation,
  type OverlapPicker,
  type OverlapRun,
} from "../lib/meHooks";
import { ApiError } from "@workspace/api-client-react";
import { LibraryRow } from "../components/LibraryRow";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  Music2,
  Radio,
  Search,
  Upload,
  XCircle,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Consent-prompt dismissal
// ---------------------------------------------------------------------------
const LEDGER_PROMPT_DISMISSED_KEY = "lore:ledger_prompt_dismissed_until";
const LEDGER_PROMPT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function shouldShowLedgerPrompt(ledgerEnabled: boolean): boolean {
  if (ledgerEnabled) return false;
  try {
    const until = Number(localStorage.getItem(LEDGER_PROMPT_DISMISSED_KEY) ?? 0);
    return Date.now() >= until;
  } catch { return true; }
}

function dismissLedgerPrompt(): void {
  try {
    localStorage.setItem(LEDGER_PROMPT_DISMISSED_KEY, String(Date.now() + LEDGER_PROMPT_TTL_MS));
  } catch { /* storage unavailable */ }
}

// ---------------------------------------------------------------------------
// Section header
// ---------------------------------------------------------------------------
function TierHd({ label, count, live }: { label: string; count?: number | string; live?: boolean }) {
  return (
    <div className="dial-tier-hd">
      <span className={`dial-tier-hd__label${live ? " dial-tier-hd__label--live" : ""}`}>
        {live && "● "}{label}
        {count != null && ` · ${count}`}
      </span>
      <div className="dial-tier-hd__rule" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compact sync bar (dial style)
// ---------------------------------------------------------------------------
function SyncBar({
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
        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
      })
    : null;

  return (
    <div data-testid="library-sync">
      {/* Main action row */}
      <div className="dial-ctabar">
        <span className="dial-ctabar__label">
          {isSyncActive
            ? (syncJobData?.phase === "matching" ? "Matching on Spotify…"
              : syncJobData?.phase === "checking" ? "Checking saved…"
              : syncJobData?.phase === "saving" ? "Saving to Spotify…"
              : "Syncing…")
            : syncJobData?.status === "done"
            ? `Synced ${lastSync ?? "recently"}`
            : "Export keeps → Spotify"}
        </span>
        {syncJobData?.status === "done" && syncJobData.results && (
          <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, color: "hsl(var(--library))", marginRight: 6 }}>
            {syncJobData.results.synced > 0 && `${syncJobData.results.synced} saved`}
          </span>
        )}
        <button
          type="button"
          disabled={syncBusy || isSyncActive}
          onClick={onSync}
          className="dial-ctabtn"
          data-testid="library-sync-button"
        >
          {isSyncActive ? <Loader2 style={{ display: "inline", width: 10, height: 10, animation: "lore-eq 1s linear infinite" }} /> : <Upload style={{ display: "inline", width: 10, height: 10, marginRight: 4, verticalAlign: "middle" }} />}
          {isSyncActive ? "Syncing…" : "Sync now"}
        </button>
      </div>

      {/* Progress bar */}
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

      {/* Error */}
      {syncError && (
        <div style={{ padding: "8px 15px", borderBottom: "1px solid hsl(var(--border) / 0.5)" }} data-testid="library-sync-error">
          <p style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, color: "hsl(var(--destructive))" }}>{syncError}</p>
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
          <p style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, color: "hsl(var(--destructive))" }} data-testid="library-sync-job-error">
            {syncJobData.error ?? "Sync failed — try again."}
          </p>
        </div>
      )}

      {/* Receipt toggle */}
      {syncJobData?.status === "done" &&
        syncJobData.results &&
        (syncJobData.results.unavailableItems.length > 0 || syncJobData.results.searchMatchedItems.length > 0) && (
          <div style={{ padding: "7px 15px", borderBottom: "1px solid hsl(var(--border) / 0.5)" }}>
            <button
              type="button"
              onClick={onToggleReceipt}
              style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, color: "hsl(var(--dim))", background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
              data-testid="library-sync-receipt-toggle"
            >
              {syncReceiptOpen ? <ChevronUp style={{ width: 10, height: 10 }} /> : <ChevronDown style={{ width: 10, height: 10 }} />}
              {syncReceiptOpen ? "Hide details" : "Show match details"}
            </button>
          </div>
        )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overlap row — station
// ---------------------------------------------------------------------------
function OverlapStationRow({ item }: { item: OverlapStation }) {
  const { station, sharedCount } = item;
  return (
    <Link
      href={`/archive/stations/${station.slug}`}
      className="lib-ol-row"
      data-testid="overlap-station-card"
    >
      <span className="lib-ol-row__dot lib-ol-row__dot--stn" />
      <div className="lib-ol-row__body">
        <div className="lib-ol-row__name">{station.name}</div>
        <div className="lib-ol-row__sub">{station.stationClass}</div>
      </div>
      <span className="lib-ol-row__count lib-ol-row__count--stn">
        ◆ {sharedCount.toLocaleString()}
      </span>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Overlap row — selector/picker
// ---------------------------------------------------------------------------
function OverlapPickerRow({ item }: { item: OverlapPicker }) {
  const { picker, sharedCount } = item;
  const follows = useFollows();
  const following = isFollowed(follows, "picker", picker.handle);
  return (
    <Link
      href={`/archive/selectors/${picker.handle}`}
      className="lib-ol-row"
      data-testid="overlap-picker-card"
    >
      <span className="lib-ol-row__dot lib-ol-row__dot--sel" />
      <div className="lib-ol-row__body">
        <div className="lib-ol-row__name">{picker.name}</div>
        <div className="lib-ol-row__sub">
          {picker.pickerType === "dj" ? "Radio DJ" : "Selector"} · @{picker.handle}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <span className="lib-ol-row__count lib-ol-row__count--sel">
          ◆ {sharedCount.toLocaleString()}
        </span>
        <button
          type="button"
          className={`sel-row__follow${following ? " sel-row__follow--on" : ""}`}
          onClick={(e) => { e.preventDefault(); toggleFollow("picker", picker.handle, picker.name); }}
          data-testid={`follow-picker-${picker.handle}`}
        >
          {following ? "✓" : "+ Follow"}
        </button>
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Overlap row — run
// ---------------------------------------------------------------------------
function OverlapRunRow({ item }: { item: OverlapRun }) {
  const { station, show, day, owned, discover } = item;
  const dateLabel = (() => {
    try {
      return new Date(day).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    } catch { return day; }
  })();
  return (
    <Link
      href={`/archive/stations/${station.slug}`}
      className="lib-ol-row"
      data-testid="overlap-run-card"
    >
      <span className="lib-ol-row__dot lib-ol-row__dot--run" />
      <div className="lib-ol-row__body">
        <div className="lib-ol-row__name">{show?.name ?? station.name}</div>
        <div className="lib-ol-row__sub">
          {show?.djName ? `${show.djName} · ` : ""}{station.name} · {dateLabel}
        </div>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div className="lib-ol-row__count lib-ol-row__count--run">
          {owned.toLocaleString()} you know
        </div>
        {discover > 0 && (
          <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, color: "hsl(var(--dim))", marginTop: 1 }}>
            +{discover.toLocaleString()} new
          </div>
        )}
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Album row
// ---------------------------------------------------------------------------
function AlbumRow({ album }: { album: AlbumCompletion }) {
  const { title, artistName, totalTracks, heardTracks } = album;
  const pct = Math.round((heardTracks / totalTracks) * 100);
  return (
    <div className="lib-ol-row" style={{ cursor: "default" }}>
      <span className="lib-ol-row__dot" style={{ background: "hsl(var(--keep))" }} />
      <div className="lib-ol-row__body">
        <div className="lib-ol-row__name">{title ?? "Unknown album"}</div>
        {artistName && <div className="lib-ol-row__sub">{artistName}</div>}
      </div>
      <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 9.5, color: "hsl(var(--dim))", flexShrink: 0 }}>
        {heardTracks}/{totalTracks} · {pct}%
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Unavailable items (flat rows)
// ---------------------------------------------------------------------------
function UnavailableRow({ item }: { item: { mbid: string; title: string; artist: string; bandcampUrl: string } }) {
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

// ---------------------------------------------------------------------------
// Search-matched items (flat rows)
// ---------------------------------------------------------------------------
function SearchMatchedRow({ item }: { item: { mbid: string; title: string; artist: string; spotifyUrl: string } }) {
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
// Inflow row (flat)
// ---------------------------------------------------------------------------
function InflowRow({ item }: {
  item: {
    mbid: string;
    recording?: { title?: string; artist?: string } | null;
    provenance: { pickerHandle?: string | null; stationSlug?: string | null };
  };
}) {
  const title = item.recording?.title ?? item.mbid.slice(0, 8);
  const artist = item.recording?.artist ?? "";
  const attribution = item.provenance.pickerHandle ?? item.provenance.stationSlug ?? "";
  return (
    <div className="lib-ol-row" style={{ cursor: "default" }} data-testid="inflow-card">
      <span className="lib-ol-row__dot lib-ol-row__dot--sel" />
      <div className="lib-ol-row__body">
        <div className="lib-ol-row__name">{title}</div>
        <div className="lib-ol-row__sub">{artist}{attribution ? ` · via ${attribution}` : ""}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function Library() {
  const [, setLocation] = useLocation();
  const [searchOpen, setSearchOpen] = useState(false);
  const queryClient = useQueryClient();
  const { ride, radio } = usePlayer();

  const { data: connections, isLoading: connLoading } = useMyConnections();
  const isAuthenticated = !connLoading && connections !== null;
  const hasSpotify =
    Array.isArray(connections) && connections.some((c) => c.service === "spotify");

  // Ledger consent
  const { data: prefs } = useMyPreferences();
  const ledgerEnabled = prefs?.ledgerEnabled ?? false;
  const [ledgerPromptVisible, setLedgerPromptVisible] = useState<boolean>(false);
  const [ledgerBusy, setLedgerBusy] = useState(false);

  useEffect(() => {
    if (prefs !== undefined) setLedgerPromptVisible(shouldShowLedgerPrompt(prefs.ledgerEnabled));
  }, [prefs]);

  const handleEnableLedger = async () => {
    setLedgerBusy(true);
    try {
      await patchPreferences({ ledgerEnabled: true });
      void queryClient.invalidateQueries({ queryKey: ME_PREFERENCES_KEY });
      void queryClient.invalidateQueries({ queryKey: ME_ALBUMS_COMPLETED_KEY });
      setLedgerPromptVisible(false);
    } catch { /* silent */ } finally { setLedgerBusy(false); }
  };

  const handleDismissLedgerPrompt = () => {
    dismissLedgerPrompt();
    setLedgerPromptVisible(false);
  };

  // Album completion
  const { data: albumsData } = useMyAlbumsCompleted();

  // Infinite kept list
  const {
    data: keptData,
    isLoading: keptLoading,
    isFetchingNextPage,
    fetchNextPage,
    hasNextPage,
  } = useMyLibraryInfinite({ source: "keep" }, 50);
  const keptItems = keptData?.pages.flatMap((p) => p.items) ?? [];

  // Inflow row
  const { data: inflowData } = useMyLibraryInfinite({ source: "import" }, 20);
  const inflowItems = inflowData?.pages[0]?.items?.slice(0, 20) ?? [];

  // Sentinel for IntersectionObserver
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) void fetchNextPage(); },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Import job
  const { data: jobData } = useLatestImportJob();
  const [bannerDismissed, setBannerDismissed] = useState(false);

  useEffect(() => {
    if (jobData?.status === "pending" || jobData?.status === "running") setBannerDismissed(false);
  }, [jobData?.status]);

  useEffect(() => {
    if (jobData?.status !== "done") return;
    const t = setTimeout(() => setBannerDismissed(true), 8_000);
    void queryClient.invalidateQueries({ queryKey: ME_OVERLAP_PICKERS_KEY });
    void queryClient.invalidateQueries({ queryKey: ME_OVERLAP_STATIONS_KEY });
    void queryClient.invalidateQueries({ queryKey: ME_OVERLAP_RUNS_KEY });
    return () => clearTimeout(t);
  }, [jobData?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const isImportActive = jobData?.status === "pending" || jobData?.status === "running";
  const isRecentlyFinished = (() => {
    if (!jobData?.finishedAt) return false;
    return Date.now() - new Date(jobData.finishedAt).getTime() < 10 * 60_000;
  })();
  const showImportBanner = !bannerDismissed && jobData != null && (isImportActive || isRecentlyFinished);

  const [connectBusy, setConnectBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);

  const handleConnect = async () => {
    setConnectBusy(true);
    try { await startSpotifyLibraryConnect(); } finally { setConnectBusy(false); }
  };

  // Sync
  const { data: syncJobData } = useLatestSyncJob();
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncNeedsReconnect, setSyncNeedsReconnect] = useState(false);
  const [syncReceiptOpen, setSyncReceiptOpen] = useState(false);
  const [reconnectBusy, setReconnectBusy] = useState(false);
  const isSyncActive = syncJobData?.status === "pending" || syncJobData?.status === "running";

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
        const msg = err instanceof ApiError && err.data && typeof err.data === "object" && "error" in err.data
          ? String((err.data as { error: unknown }).error) : "Sync failed. Try again.";
        setSyncError(msg);
      }
    } finally { setSyncBusy(false); }
  };

  const handleReconnect = async () => {
    setReconnectBusy(true);
    try { await startSpotifyLibraryReconnect(); } finally { setReconnectBusy(false); }
  };

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
      const msg = err instanceof ApiError && err.data && typeof err.data === "object" && "error" in err.data
        ? String((err.data as { error: unknown }).error) : "Import failed. Try again.";
      setFileImportError(msg);
    } finally { setImportingFile(false); }
  };

  const handleImport = async () => {
    setImportBusy(true);
    try { await postStartImport("spotify"); } catch { /* 409 or transient */ } finally {
      void queryClient.invalidateQueries({ queryKey: ME_LATEST_IMPORT_JOB_KEY });
      setImportBusy(false);
    }
  };

  const libLoading = keptLoading;
  const isEmpty = !libLoading && keptItems.length === 0;

  // Overlap data
  const { data: overlapStations } = useMyOverlapStations();
  const { data: overlapPickers } = useMyOverlapPickers();
  const { data: overlapRuns } = useMyOverlapRuns();

  const hasOverlapData =
    (overlapStations ?? []).length > 0 ||
    (overlapPickers ?? []).length > 0 ||
    (overlapRuns ?? []).length > 0;

  const overlapLoaded =
    overlapStations !== undefined && overlapPickers !== undefined && overlapRuns !== undefined;

  const showOverlapSpotifyTeaser =
    isAuthenticated && !hasSpotify && keptItems.length > 0 && overlapLoaded && !hasOverlapData;

  const unavailableItems =
    syncJobData?.status === "done" ? syncJobData.results?.unavailableItems ?? [] : [];
  const searchMatchedItems =
    syncJobData?.status === "done" ? syncJobData.results?.searchMatchedItems ?? [] : [];

  // suppress unused lint
  void radio;

  // Radio stat
  const radioHeardCount = useMemo(
    () => keptItems.filter((item) => item.provenance.stationSlug != null).length,
    [keptItems],
  );

  return (
    <div className="dial-root">
      {searchOpen && (
        <SearchOverlay
          dialStations={[]}
          libraryItems={keptItems}
          onClose={() => setSearchOpen(false)}
          onStationDrill={(slug) => { setLocation(`/archive/stations/${slug}`); setSearchOpen(false); }}
          onShowDrill={(_show, station) => { setLocation(`/archive/stations/${station.station.slug}`); setSearchOpen(false); }}
        />
      )}

      {/* Topbar */}
      <div className="dial-topbar">
        <span className="dial-topbar__wordmark">Lore</span>
        <span className="dial-topbar__title dial-topbar__title--active">Library</span>
        {keptItems.length > 0 && (
          <span className="dial-topbar__sort-chip">
            {keptItems.length.toLocaleString()}{hasNextPage ? "+" : ""} kept
            {radioHeardCount > 0 && ` · ${radioHeardCount} from radio`}
          </span>
        )}
        <button
          type="button"
          className="dial-topbar__search"
          onClick={() => setSearchOpen(true)}
          aria-label="Search"
        >
          <Search size={14} />
        </button>
      </div>

      {/* CTA bar — connect / import */}
      {!connLoading && !isAuthenticated && (
        <div className="dial-ctabar">
          <span className="dial-ctabar__label">Connect Spotify to import your library</span>
          <button
            type="button"
            disabled={connectBusy}
            onClick={() => void handleConnect()}
            className="dial-ctabtn dial-ctabtn--keep"
            data-testid="library-connect-spotify"
          >
            {connectBusy ? "…" : <><Music2 style={{ display: "inline", width: 10, height: 10, marginRight: 4, verticalAlign: "middle" }} />Connect</>}
          </button>
        </div>
      )}
      {isAuthenticated && !hasSpotify && (
        <div className="dial-ctabar">
          <span className="dial-ctabar__label">Connect Spotify to import your library</span>
          <button
            type="button"
            disabled={connectBusy}
            onClick={() => void handleConnect()}
            className="dial-ctabtn dial-ctabtn--keep"
            data-testid="library-connect-spotify"
          >
            {connectBusy ? "…" : <><Music2 style={{ display: "inline", width: 10, height: 10, marginRight: 4, verticalAlign: "middle" }} />Connect</>}
          </button>
        </div>
      )}
      {isAuthenticated && hasSpotify && !isImportActive && (
        <div className="dial-ctabar">
          <span className="dial-ctabar__label">
            {isEmpty ? "Import your Spotify library" : "Re-import from Spotify"}
          </span>
          <button
            type="button"
            disabled={importBusy}
            onClick={() => void handleImport()}
            className="dial-ctabtn"
            data-testid="library-import-spotify"
          >
            {importBusy ? "…" : <><Music2 style={{ display: "inline", width: 10, height: 10, marginRight: 4, verticalAlign: "middle" }} />{isEmpty ? "Import" : "Re-import"}</>}
          </button>
        </div>
      )}

      {/* Import progress banner */}
      {showImportBanner && jobData && (
        <LibraryImportBanner job={jobData} onDismiss={() => setBannerDismissed(true)} />
      )}

      {/* Body */}
      <div className="dial-body">

        {/* Ledger consent */}
        {ledgerPromptVisible && (
          <div style={{ borderBottom: "1px solid hsl(var(--border))", padding: "12px 15px", background: "hsl(var(--card))" }} data-testid="ledger-consent-prompt">
            <div style={{ fontFamily: "var(--app-font-display)", fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "hsl(var(--library))", marginBottom: 5 }}>
              Listening history
            </div>
            <div style={{ fontFamily: "var(--app-font-serif)", fontSize: 13, color: "hsl(var(--foreground))", marginBottom: 8, maxWidth: "52ch" }}>
              Keep a record of what you hear? Powers album progress and lets Lore route support to
              stations you actually listen to. Yours, exportable, deletable.
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

        {/* ── Kept tracks ── */}
        <TierHd
          label="Kept"
          count={keptItems.length > 0 ? `${keptItems.length.toLocaleString()}${hasNextPage ? "+" : ""} tracks` : undefined}
        />

        {libLoading ? (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {[0, 1, 2, 3, 4].map((i) => (
              <div
                key={i}
                style={{
                  height: 58,
                  borderBottom: "1px solid hsl(var(--border) / 0.4)",
                  background: "hsl(var(--secondary))",
                  opacity: 0.4 + i * 0.06,
                }}
              />
            ))}
          </div>
        ) : keptItems.length === 0 ? (
          <div style={{ padding: "28px 15px", textAlign: "center" }}>
            <div style={{ fontFamily: "var(--app-font-serif)", fontSize: 16, color: "hsl(var(--muted-foreground))", marginBottom: 12 }}>
              Keep songs from the radio to build your library.
            </div>
            <Link
              href="/"
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                fontFamily: "var(--app-font-display)", fontSize: 10, fontWeight: 700,
                textTransform: "uppercase", letterSpacing: "0.07em",
                color: "hsl(var(--library))", textDecoration: "none",
                border: "1px solid rgba(232,106,78,.35)", borderRadius: 3,
                padding: "6px 12px",
              }}
            >
              <Radio style={{ width: 10, height: 10 }} /> Open the dial
            </Link>
          </div>
        ) : (
          <>
            <ul style={{ margin: 0, padding: 0, listStyle: "none" }} data-testid="library-kept">
              {keptItems.map((item) => (
                <LibraryRow key={item.mbid} item={item} />
              ))}
            </ul>
            <div ref={sentinelRef} style={{ height: 1 }} aria-hidden />
            {isFetchingNextPage && (
              <div style={{ display: "flex", justifyContent: "center", padding: "16px 0" }} data-testid="library-loading-more">
                <Loader2 style={{ width: 16, height: 16, animation: "lore-eq 1s linear infinite", color: "hsl(var(--muted-foreground))" }} />
              </div>
            )}
            {!hasNextPage && keptItems.length > 0 && (
              <div
                style={{ padding: "16px 0", textAlign: "center", fontFamily: "var(--app-font-mono)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.07em", color: "hsl(var(--faint))" }}
                data-testid="library-end"
              >
                {keptItems.length} track{keptItems.length === 1 ? "" : "s"} total
              </div>
            )}
          </>
        )}

        {/* ── Unavailable / Bandcamp ── */}
        {syncReceiptOpen && unavailableItems.length > 0 && syncJobData && (
          <>
            <TierHd label="Not on Spotify" count={syncJobData.results?.unavailable ?? unavailableItems.length} />
            {unavailableItems.map((item) => (
              <UnavailableRow key={item.mbid} item={item} />
            ))}
            {(syncJobData.results?.unavailable ?? 0) > 200 && (
              <div style={{ padding: "8px 15px" }}>
                <a
                  href={`/api/me/library/sync/${syncJobData.jobId}/unavailable?format=csv`}
                  download
                  style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, color: "hsl(var(--library))", textDecoration: "none", textTransform: "uppercase", letterSpacing: "0.07em" }}
                  data-testid="library-sync-unavailable-download"
                >
                  Download all ({syncJobData.results?.unavailable}) ↓
                </a>
              </div>
            )}
          </>
        )}

        {/* ── Search matched ── */}
        {syncReceiptOpen && searchMatchedItems.length > 0 && syncJobData && (
          <>
            <TierHd label="Matched by search" count={syncJobData.results?.searchMatched ?? searchMatchedItems.length} />
            {searchMatchedItems.map((item) => (
              <SearchMatchedRow key={item.mbid} item={item} />
            ))}
          </>
        )}

        {/* ── Inflow from selectors ── */}
        {inflowItems.length > 0 && (
          <>
            <TierHd label="New from your selectors" count={inflowItems.length} />
            <div data-testid="library-inflow">
              {inflowItems.map((item) => (
                <InflowRow key={item.mbid} item={item as Parameters<typeof InflowRow>[0]["item"]} />
              ))}
            </div>
          </>
        )}

        {/* ── Albums heard ── */}
        {ledgerEnabled && albumsData && albumsData.length > 0 && (
          <>
            <TierHd label="Albums heard" count={albumsData.length} />
            <div data-testid="library-albums-completed">
              {albumsData.map((album) => (
                <AlbumRow key={album.releaseGroupMbid} album={album} />
              ))}
            </div>
          </>
        )}

        {/* ── Overlap stations ── */}
        {hasOverlapData && (overlapStations ?? []).length > 0 && (
          <>
            <TierHd label="Stations playing your tracks" count={(overlapStations ?? []).length} />
            <div data-testid="library-overlap-stations">
              {(overlapStations ?? []).map((item) => (
                <OverlapStationRow key={item.station.slug} item={item} />
              ))}
            </div>
          </>
        )}

        {/* ── Overlap selectors ── */}
        {hasOverlapData && (overlapPickers ?? []).length > 0 && (
          <>
            <TierHd label="Selectors matching your taste" count={(overlapPickers ?? []).length} />
            <div data-testid="library-overlap-pickers">
              {(overlapPickers ?? []).map((item) => (
                <OverlapPickerRow key={item.picker.handle} item={item} />
              ))}
            </div>
          </>
        )}

        {/* ── Overlap runs ── */}
        {hasOverlapData && (overlapRuns ?? []).length > 0 && (
          <>
            <TierHd label="Sets to ride" count={(overlapRuns ?? []).length} />
            <div data-testid="library-overlap-runs">
              {(overlapRuns ?? []).slice(0, 5).map((item) => (
                <OverlapRunRow key={item.runId} item={item} />
              ))}
            </div>
          </>
        )}

        {/* ── Spotify teaser ── */}
        {showOverlapSpotifyTeaser && (
          <div style={{ margin: "0 15px 0", padding: "14px 0", borderBottom: "1px solid hsl(var(--border) / 0.5)" }} data-testid="library-overlap-teaser">
            <div style={{ fontFamily: "var(--app-font-display)", fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "hsl(var(--library))", marginBottom: 5 }}>
              Discover your stations
            </div>
            <div style={{ fontFamily: "var(--app-font-serif)", fontSize: 13, color: "hsl(var(--foreground))", marginBottom: 8 }}>
              Connect Spotify to see which stations and selectors share your taste.
            </div>
            <button
              type="button"
              onClick={() => void handleConnect()}
              disabled={connectBusy}
              className="dial-ctabtn dial-ctabtn--keep"
              data-testid="library-overlap-teaser-connect"
            >
              {connectBusy ? "…" : "Connect Spotify"}
            </button>
          </div>
        )}

        {/* ── Sync to Spotify ── */}
        {isAuthenticated && hasSpotify && (
          <>
            <TierHd label="Sync to Spotify" />
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
          </>
        )}

        {/* ── Export ── */}
        <TierHd label="Export" />
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
          </div>
          <div style={{ marginTop: 12, borderTop: "1px solid hsl(var(--border) / 0.5)", paddingTop: 10 }} data-testid="library-import-file">
            <div style={{ fontFamily: "var(--app-font-display)", fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "hsl(var(--dim))", marginBottom: 6 }}>
              Bring it back
            </div>
            <input
              ref={importFileRef}
              type="file"
              accept="application/json,.json"
              style={{ display: "none" }}
              data-testid="library-import-file-input"
              onChange={(e) => { const file = e.target.files?.[0]; if (file) void handleImportFile(file); e.target.value = ""; }}
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
              <p style={{ marginTop: 6, fontFamily: "var(--app-font-mono)", fontSize: 10, color: "hsl(var(--destructive))" }} data-testid="library-import-file-error">
                {fileImportError}
              </p>
            )}
            {fileImportSummary && (
              <p style={{ marginTop: 6, fontFamily: "var(--app-font-mono)", fontSize: 10, color: "hsl(var(--dim))" }} data-testid="library-import-file-summary">
                Imported {fileImportSummary.imported} · skipped {fileImportSummary.skipped} · rejected {fileImportSummary.rejected}
              </p>
            )}
            <p style={{ marginTop: 8, fontFamily: "var(--app-font-mono)", fontSize: 9, color: "hsl(var(--faint))" }}>
              To move to another streaming service, use <a href="https://soundiiz.com" target="_blank" rel="noreferrer" style={{ color: "inherit", textDecoration: "underline" }}>Soundiiz</a> or <a href="https://www.tunemymusic.com" target="_blank" rel="noreferrer" style={{ color: "inherit", textDecoration: "underline" }}>TuneMyMusic</a>.
            </p>
          </div>
        </div>

        <div style={{ height: 60, borderTop: "1px solid hsl(var(--border) / 0.4)", padding: "14px 15px", marginTop: 8 }}>
          <p style={{ fontFamily: "var(--app-font-mono)", fontSize: 9.5, color: "hsl(var(--faint))" }}>
            Your library is stored on the Lore server and tied to your session.
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Import banner (in-page, dial style)
// ---------------------------------------------------------------------------

function phaseLabel(phase: string | null | undefined): string {
  switch (phase) {
    case "fetching": return "Reading your Spotify library…";
    case "spine":
    case "cache": return "Checking spine…";
    case "resolve": return "Resolving new tracks…";
    default: return "Connecting to Spotify…";
  }
}

export function LibraryImportBanner({
  job,
  onDismiss,
}: {
  job: { status: string; phase?: string | null; total: number; resolved: number; error: string | null };
  onDismiss: () => void;
}) {
  const isError = job.status === "error";
  const isDone = job.status === "done";
  const isFetchingPhase = job.phase === "fetching";

  const label = isError
    ? "Import failed"
    : isDone
    ? "Library imported"
    : phaseLabel(job.phase);

  const accent = isError ? "var(--destructive)" : "var(--keep)";

  const progressPct = job.total > 0 ? Math.min(100, (job.resolved / job.total) * 100) : 0;

  return (
    <div
      style={{
        display: "flex", flexDirection: "column",
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
          <Loader2 style={{ width: 12, height: 12, flexShrink: 0, color: `hsl(${accent})`, animation: "lore-eq 1s linear infinite" }} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: "var(--app-font-display)", fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: `hsl(${accent})` }}>
            {label}
          </div>
          {isDone && (
            <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, color: "hsl(var(--dim))", marginTop: 2 }}>
              {job.resolved.toLocaleString()} track{job.resolved === 1 ? "" : "s"} matched
            </div>
          )}
          {!isDone && !isError && job.total > 0 && (
            <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, color: "hsl(var(--dim))", marginTop: 2 }}>
              {isFetchingPhase ? `Found ${job.total.toLocaleString()} tracks…` : `${job.resolved.toLocaleString()} / ~${job.total.toLocaleString()}`}
            </div>
          )}
          {isError && job.error && (
            <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, color: "hsl(var(--destructive))", marginTop: 2 }}>
              {job.error}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          style={{ fontFamily: "var(--app-font-display)", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.07em", color: "hsl(var(--faint))", background: "none", border: "none", cursor: "pointer", flexShrink: 0 }}
        >
          dismiss
        </button>
      </div>
      {!isDone && !isError && job.total > 0 && (
        <div style={{ height: 2, background: "hsl(var(--border))" }}>
          <div style={{ height: "100%", background: `hsl(${accent})`, width: `${progressPct}%`, transition: "width 0.7s" }} />
        </div>
      )}
    </div>
  );
}
