import { useEffect, useMemo, useRef, useState } from "react";
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
  startSpotifyLibraryConnect,
  startSpotifyLibraryReconnect,
  postStartImport,
  postStartSync,
  postImportLibraryFile,
  useMyPreferences,
  patchPreferences,
  ME_PREFERENCES_KEY,
  ME_LATEST_IMPORT_JOB_KEY,
  ME_LATEST_SYNC_JOB_KEY,
  ME_OVERLAP_PICKERS_KEY,
  ME_OVERLAP_STATIONS_KEY,
  ME_OVERLAP_RUNS_KEY,
  type FileImportSummary,
  type SyncJobStatus,
} from "../lib/meHooks";
import { ApiError, useGetPickersDial } from "@workspace/api-client-react";
import { useFollows } from "../lib/local";
import { KeepButton } from "../components/KeepButton";
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
// Ledger consent helpers
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
            fontSize: 9,
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
              fontSize: 9,
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
          <p style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, color: "hsl(var(--destructive))" }}>
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
            style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, color: "hsl(var(--destructive))" }}
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
                fontSize: 10,
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
              fontSize: 9,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              color: `hsl(${accent})`,
            }}
          >
            {label}
          </div>
          {isDone && (
            <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, color: "hsl(var(--dim))", marginTop: 2 }}>
              {job.resolved.toLocaleString()} track{job.resolved === 1 ? "" : "s"} matched
            </div>
          )}
          {!isDone && !isError && job.total > 0 && (
            <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, color: "hsl(var(--dim))", marginTop: 2 }}>
              {isBackoff
                ? "MusicBrainz is busy — resuming shortly"
                : isFetchingPhase
                  ? `Found ${job.total.toLocaleString()} tracks…`
                  : `${job.resolved.toLocaleString()} / ~${job.total.toLocaleString()}`}
            </div>
          )}
          {isError && job.error && (
            <div
              style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, color: "hsl(var(--destructive))", marginTop: 2 }}
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
            fontSize: 9,
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
  return `linear-gradient(150deg,hsl(${h},22%,20%),hsl(${(h + 42) % 360},28%,32%))`;
}

interface InflowItem {
  key: string;
  mbid: string;
  title: string;
  artist: string;
  artworkUrl: string | null;
  pickerHandle: string;
  pickerName: string;
}

function InflowCard({ item }: { item: InflowItem }) {
  const [, navigate] = useLocation();
  return (
    <div
      className="icard"
      data-testid="inflow-card"
      role="link"
      tabIndex={0}
      style={{ cursor: "pointer" }}
      onClick={() => navigate(`/song/${item.mbid}`)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") navigate(`/song/${item.mbid}`); }}
    >
      <div
        className="icard__art"
        style={item.artworkUrl ? undefined : { background: artGradient(item.title, item.artist) }}
      >
        {item.artworkUrl && <img src={item.artworkUrl} alt="" loading="lazy" />}
      </div>
      <p className="icard__tr">{item.title}</p>
      {item.artist && <p className="icard__ar">{item.artist}</p>}
      <p className="icard__by">
        picked by{" "}
        <b>
          <a
            href={`/archive/selectors/${item.pickerHandle}`}
            onClick={(e) => e.stopPropagation()}
          >
            {item.pickerName}
          </a>
        </b>
      </p>
      <div onClick={(e) => e.stopPropagation()}>
        <KeepButton mbid={item.mbid} compact />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function Library() {
  const [location, setLocation] = useLocation();
  const search = useSearch();
  const [searchOpen, setSearchOpen] = useState(false);
  const queryClient = useQueryClient();
  const { radio } = usePlayer();

  // Source filter — persisted in URL as ?source=keep|import|soft
  const sourceFilter = useMemo((): "" | "keep" | "import" | "soft" => {
    const v = new URLSearchParams(search).get("source");
    if (v === "keep" || v === "import" || v === "soft") return v;
    return "";
  }, [search]);

  const setSourceFilter = (src: "" | "keep" | "import" | "soft") => {
    const p = new URLSearchParams(search);
    if (src) p.set("source", src);
    else p.delete("source");
    const qs = p.toString();
    // strip the path portion (e.g. /library) and just update search
    setLocation(qs ? `${location.split("?")[0]}?${qs}` : location.split("?")[0]!);
  };

  // Sort — persisted in URL as ?sort=artist|title (default = "added", omitted from URL)
  const sortFilter = useMemo((): "added" | "artist" | "title" => {
    const v = new URLSearchParams(search).get("sort");
    if (v === "artist" || v === "title") return v;
    return "added";
  }, [search]);

  const setSortFilter = (sort: "added" | "artist" | "title") => {
    const p = new URLSearchParams(search);
    if (sort !== "added") p.set("sort", sort);
    else p.delete("sort");
    const qs = p.toString();
    setLocation(qs ? `${location.split("?")[0]}?${qs}` : location.split("?")[0]!);
  };

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
      setLedgerPromptVisible(false);
    } catch { /* silent */ } finally { setLedgerBusy(false); }
  };
  const handleDismissLedgerPrompt = () => { dismissLedgerPrompt(); setLedgerPromptVisible(false); };

  // Kept list (infinite scroll)
  const {
    data: keptData,
    isLoading: keptLoading,
    isFetchingNextPage,
    fetchNextPage,
    // libraryTotal is populated from the first-page COUNT query (no cursor).
    // Subsequent pages omit it; we keep the first-page value for display.
    hasNextPage,
  } = useMyLibraryInfinite({ source: sourceFilter || undefined, sort: sortFilter }, 50);
  const keptItems = keptData?.pages.flatMap((p) => p.items) ?? [];
  // Total count from the server's first-page COUNT query — reflects the real
  // library size even before all pages are loaded.
  const libraryTotal: number | undefined = keptData?.pages[0]?.total;

  // Stable import-scoped counts for the "X of Y matched" stat.
  // Always scoped to source=import so numbers are unaffected by sourceFilter.
  const { data: importStats } = useMyImportStats();

  // Single-open door strip: tracks which row has its door strip expanded
  const [openDoorMbid, setOpenDoorMbid] = useState<string | null>(null);

  // New from followed pickers (inflow row)
  const { data: dialData } = useGetPickersDial();
  const follows = useFollows();
  const pickerInflow = useMemo((): InflowItem[] => {
    if (!dialData?.items) return [];
    const followedHandles = new Set(
      follows.filter((f) => f.kind === "picker" || f.kind === "selector").map((f) => f.id)
    );
    if (followedHandles.size === 0) return [];
    const result: InflowItem[] = [];
    for (const item of dialData.items) {
      if (!followedHandles.has(item.picker.handle)) continue;
      for (const track of item.previewTracks) {
        if (!track.mbid) continue;
        result.push({
          key: `${item.picker.handle}-${track.mbid}`,
          mbid: track.mbid,
          title: track.title,
          artist: track.artist,
          artworkUrl: track.artworkUrl,
          pickerHandle: item.picker.handle,
          pickerName: item.picker.name,
        });
      }
    }
    return result.slice(0, 20);
  }, [dialData, follows]);

  // Sentinel for IntersectionObserver
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
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
    // Refresh overlap data after import
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
  const handleImport = async () => {
    setImportBusy(true);
    try { await postStartImport("spotify"); } catch { /* 409 or transient */ } finally {
      void queryClient.invalidateQueries({ queryKey: ME_LATEST_IMPORT_JOB_KEY });
      setImportBusy(false);
    }
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

  const libLoading = keptLoading;
  const isEmpty = !libLoading && keptItems.length === 0;
  void radio; // suppress unused lint

  // Hero stats
  // keepCount comes from the server's page-1 COUNT — accurate across the full
  // library regardless of how many items are loaded client-side.  Falls back to
  // a client-side count from loaded items so the stat is available immediately
  // before the first fetch resolves (typically 0, updates once data arrives).
  const keepCount: number = keptData?.pages[0]?.keepCount ?? 0;
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
  const showReconnectPrompt = isAuthenticated && !hasSpotify && !isEmpty;

  return (
    <div className="dial-root">
      {searchOpen && (
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

      {/* Topbar */}
      <div className="dial-topbar">
        <span className="dial-topbar__wordmark">Lore</span>
        <span className="dial-topbar__title dial-topbar__title--active">Library</span>
        {(libraryTotal ?? keptItems.length) > 0 && (
          <span className="dial-topbar__sort-chip">
            {sourceFilter === "keep" ? "📻" : sourceFilter === "import" ? "🎵" : sourceFilter === "soft" ? "✦" : "◆"}{" "}
            {(libraryTotal ?? keptItems.length).toLocaleString()}
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

      {/* Import banner (sticky — only while active/recent) */}
      {showImportBanner && jobData && (
        <LibraryImportBanner job={jobData} onDismiss={() => setBannerDismissed(true)} />
      )}

      {/* Body */}
      <div className="dial-body">

        {/* ── Hero ── */}
        <div className="lib-hero">
          <div className="lib-hero__kicker">◆ Your library</div>
          <div className="lib-hero__headline">
            <b>{(libraryTotal ?? keptItems.length).toLocaleString()} tracks</b>
            {keepCount > 0 && `, ${keepCount} of them found on air`}
          </div>
          <div className="lib-hero__stats">
            {keepCount > 0 && (
              <button
                type="button"
                className={`lib-hero__stat${sourceFilter === "keep" ? " lib-hero__stat--warm" : " lib-hero__stat--dim"}`}
                style={{ cursor: "pointer", border: "none" }}
                onClick={() => setSourceFilter(sourceFilter === "keep" ? "" : "keep")}
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
                  className={`lib-hero__stat${sourceFilter === "soft" ? " lib-hero__stat--warm" : " lib-hero__stat--dim"}`}
                  style={{ cursor: "pointer", border: "none" }}
                  onClick={() => setSourceFilter(sourceFilter === "soft" ? "" : "soft")}
                  title="Filter to tracks Spotify has but MusicBrainz doesn't"
                >
                  {softLabel} not in MusicBrainz
                </button>
              ) : null;
            })()}
            {selectorCount > 0 && (
              <Link href="/selectors" className="lib-hero__stat lib-hero__stat--warm">
                <b>{selectorCount}</b> selector{selectorCount === 1 ? "" : "s"} fed it
              </Link>
            )}
            {/* Connect / Import action */}
            {!connLoading && !isAuthenticated && (
              <button
                type="button"
                disabled={connectBusy}
                onClick={() => void handleConnect()}
                className="lib-hero__stat lib-hero__stat--warm"
                style={{ cursor: "pointer", border: "none" }}
                data-testid="library-connect-spotify"
              >
                <Music2 style={{ width: 10, height: 10 }} />
                {connectBusy ? "Connecting…" : "Connect Spotify"}
              </button>
            )}
            {isAuthenticated && !hasSpotify && isEmpty && (
              <button
                type="button"
                disabled={connectBusy}
                onClick={() => void handleConnect()}
                className="lib-hero__stat lib-hero__stat--warm"
                style={{ cursor: "pointer", border: "none" }}
                data-testid="library-connect-spotify"
              >
                <Music2 style={{ width: 10, height: 10 }} />
                {connectBusy ? "Connecting…" : "Connect Spotify"}
              </button>
            )}
            {isAuthenticated && hasSpotify && !isImportActive && (
              <button
                type="button"
                disabled={importBusy}
                onClick={() => void handleImport()}
                className="lib-hero__stat"
                style={{ cursor: "pointer", border: "none" }}
                data-testid="library-import-spotify"
              >
                <Music2 style={{ width: 10, height: 10 }} />
                {importBusy ? "Importing…" : isEmpty ? "Import from Spotify" : "Re-import"}
              </button>
            )}
          </div>
        </div>

        {/* ── Live strip (stub — wired when /me/library/live endpoint ships) ── */}
        {/* TODO: replace false with liveItems.length > 0 */}
        {false && (
          <a href="/library?live=1" className="lib-live" data-testid="library-live-strip">
            <span className="lib-live__dot" />
            <span className="lib-live__text"><b>N of yours</b> are on air right now</span>
            <span className="lib-live__go">See ›</span>
          </a>
        )}

        {/* ── Reconnect prompt (has library, lost Spotify) ── */}
        {showReconnectPrompt && (
          <div
            style={{ padding: "14px 15px", borderBottom: "1px solid hsl(var(--border))" }}
            data-testid="library-reconnect-prompt"
          >
            <div
              style={{
                fontFamily: "var(--app-font-reading)",
                fontSize: 13,
                color: "hsl(var(--muted-foreground))",
                marginBottom: 10,
              }}
            >
              Had a library here before? Reconnecting Spotify restores your keeps instantly.
            </div>
            <button
              type="button"
              disabled={connectBusy}
              onClick={() => void handleConnect()}
              className="dial-ctabtn dial-ctabtn--keep"
              data-testid="library-connect-spotify"
              style={{ fontSize: 11, padding: "8px 14px" }}
            >
              {connectBusy ? "…" : <><Music2 style={{ display: "inline", width: 11, height: 11, marginRight: 5, verticalAlign: "middle" }} />Reconnect Spotify</>}
            </button>
          </div>
        )}

        {/* ── Ledger consent ── */}
        {ledgerPromptVisible && !ledgerEnabled && (
          <div
            style={{ borderBottom: "1px solid hsl(var(--border))", padding: "12px 15px", background: "hsl(var(--card))" }}
            data-testid="ledger-consent-prompt"
          >
            <div
              style={{
                fontFamily: "var(--app-font-display)",
                fontSize: 9,
                fontWeight: 700,
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
                fontSize: 13,
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

        {/* ── New from your pickers (inflow) ── */}
        {pickerInflow.length > 0 && (
          <>
            <TierHd
              label="New from your selectors"
              count={pickerInflow.length}
              hint="recent picks from people you follow"
            />
            <div className="inflow-grid" data-testid="library-inflow">
              {pickerInflow.map((item) => (
                <InflowCard key={item.key} item={item} />
              ))}
            </div>
          </>
        )}

        {/* ── Source filter pills ── */}
        <div
          style={{
            display: "flex",
            gap: 6,
            padding: "10px 15px",
            borderBottom: "1px solid hsl(var(--border) / 0.5)",
          }}
          data-testid="library-source-filter"
        >
          {(
            [
              { value: "" as const, label: "All" },
              { value: "keep" as const, label: "Saved from radio" },
              { value: "import" as const, label: "Imported" },
              { value: "soft" as const, label: "Not in MusicBrainz" },
            ] as const
          ).map(({ value, label }) => (
            <button
              key={value || "all"}
              type="button"
              onClick={() => setSourceFilter(value)}
              style={{
                fontFamily: "var(--app-font-display)",
                fontSize: 9,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.07em",
                padding: "4px 10px",
                borderRadius: 3,
                border: sourceFilter === value
                  ? "1px solid hsl(var(--library))"
                  : "1px solid hsl(var(--border))",
                background: sourceFilter === value
                  ? "hsl(var(--library) / 0.12)"
                  : "transparent",
                color: sourceFilter === value
                  ? "hsl(var(--library))"
                  : "hsl(var(--dim))",
                cursor: "pointer",
                transition: "color 0.15s, border-color 0.15s, background 0.15s",
              }}
              data-testid={`library-filter-${value || "all"}`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ── Sort controls ── */}
        <div
          style={{
            display: "flex",
            gap: 6,
            padding: "8px 15px",
            borderBottom: "1px solid hsl(var(--border) / 0.5)",
            alignItems: "center",
          }}
          data-testid="library-sort-controls"
        >
          <span
            style={{
              fontFamily: "var(--app-font-display)",
              fontSize: 9,
              fontWeight: 700,
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
                fontSize: 9,
                fontWeight: 700,
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
        </div>

        {/* ── Kept tracks ── */}
        <TierHd
          label={
            sourceFilter === "keep"
              ? "Saved from radio"
              : sourceFilter === "import"
              ? "Imported"
              : sourceFilter === "soft"
              ? "Not in MusicBrainz"
              : "Kept"
          }
          count={keptItems.length > 0 ? `${keptItems.length.toLocaleString()}${hasNextPage ? "+" : ""}` : undefined}
          hint={sortFilter === "artist" ? "A → Z by artist" : sortFilter === "title" ? "A → Z by title" : "most recent first"}
        />

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
        ) : isEmpty ? (
          <div style={{ padding: "28px 15px", textAlign: "center" }}>
            <div
              style={{
                fontFamily: "var(--app-font-reading)",
                fontSize: 16,
                color: "hsl(var(--muted-foreground))",
                marginBottom: 12,
              }}
            >
              {sourceFilter === "keep"
                ? "Nothing saved from radio yet."
                : sourceFilter === "import"
                ? "No imported tracks yet."
                : sourceFilter === "soft"
                ? "No unresolved tracks — everything matched MusicBrainz."
                : "Keep songs from the radio to build your library."}
            </div>
            {sourceFilter ? (
              <button
                type="button"
                onClick={() => setSourceFilter("")}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontFamily: "var(--app-font-display)",
                  fontSize: 10,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.07em",
                  color: "hsl(var(--library))",
                  background: "none",
                  border: "1px solid rgba(232,106,78,.35)",
                  borderRadius: 3,
                  padding: "6px 12px",
                  cursor: "pointer",
                }}
              >
                Show all
              </button>
            ) : (
              <Link
                href="/"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontFamily: "var(--app-font-display)",
                  fontSize: 10,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.07em",
                  color: "hsl(var(--library))",
                  textDecoration: "none",
                  border: "1px solid rgba(232,106,78,.35)",
                  borderRadius: 3,
                  padding: "6px 12px",
                }}
              >
                <Radio style={{ width: 10, height: 10 }} /> Open the dial
              </Link>
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
                  fontSize: 10,
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


        {/* ── Sync & export receipts ── */}
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
                    fontSize: 9,
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
          </div>
          <div
            style={{ marginTop: 12, borderTop: "1px solid hsl(var(--border) / 0.5)", paddingTop: 10 }}
            data-testid="library-import-file"
          >
            <div
              style={{
                fontFamily: "var(--app-font-display)",
                fontSize: 9,
                fontWeight: 700,
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
                  fontSize: 10,
                  color: "hsl(var(--destructive))",
                }}
                data-testid="library-import-file-error"
              >
                {fileImportError}
              </p>
            )}
            {fileImportSummary && (
              <p
                style={{ marginTop: 6, fontFamily: "var(--app-font-mono)", fontSize: 10, color: "hsl(var(--dim))" }}
                data-testid="library-import-file-summary"
              >
                Imported {fileImportSummary.imported} · skipped {fileImportSummary.skipped} · rejected {fileImportSummary.rejected}
              </p>
            )}
            <p style={{ marginTop: 8, fontFamily: "var(--app-font-mono)", fontSize: 9, color: "hsl(var(--faint))" }}>
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
          <p style={{ fontFamily: "var(--app-font-reading)", fontStyle: "italic", fontSize: 12.5, color: "hsl(var(--faint))", lineHeight: 1.6 }}>
            <b style={{ fontStyle: "normal", fontWeight: 600, color: "hsl(var(--muted-foreground))" }}>One song is enough.</b>{" "}
            A keep is an entry point, not a collectible. Where Lore doesn't know who picked
            something, it says less rather than guessing.
          </p>
        </div>

        <div style={{ height: 60 }} />
      </div>
    </div>
  );
}
