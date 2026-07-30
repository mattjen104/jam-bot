import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { usePlayer } from "../player/PlayerProvider";
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
} from "../lib/meHooks";
import { ApiError } from "@workspace/api-client-react";
import { InflowCard } from "../components/InflowCard";
import { LibraryRow } from "../components/LibraryRow";
import {
  ArrowLeft,
  BookMarked,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Disc3,
  Radio,
  Loader2,
  Music2,
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
  } catch {
    return true;
  }
}

function dismissLedgerPrompt(): void {
  try {
    localStorage.setItem(LEDGER_PROMPT_DISMISSED_KEY, String(Date.now() + LEDGER_PROMPT_TTL_MS));
  } catch {
    // storage unavailable
  }
}

// ---------------------------------------------------------------------------
// Stat block
// ---------------------------------------------------------------------------

function HeroStat({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="flex flex-col">
      <span className="font-serif text-3xl font-semibold tabular-nums text-foreground">
        {typeof value === "number" ? value.toLocaleString() : value}
      </span>
      <span className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
        {label}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sync bar
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
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <div
      className="mb-8 overflow-hidden rounded-2xl border border-primary/20 bg-primary/5"
      data-testid="library-sync"
    >
      {/* Main row */}
      <div className="flex items-center justify-between gap-4 px-5 py-4">
        <div className="min-w-0">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary">
            Sync to Spotify
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Push your kept tracks to Spotify's saved songs.
          </p>
          {/* Counts from last sync */}
          {syncJobData?.status === "done" && syncJobData.results && (
            <div className="mt-2 flex flex-wrap gap-4">
              {syncJobData.results.synced > 0 && (
                <span className="font-mono text-[11px] text-foreground">
                  <span className="text-primary">{syncJobData.results.synced}</span>{" "}
                  saved
                </span>
              )}
              {syncJobData.results.searchMatched > 0 && (
                <span className="font-mono text-[11px] text-foreground">
                  <span className="text-primary">{syncJobData.results.searchMatched}</span>{" "}
                  matched
                </span>
              )}
              {syncJobData.results.alreadySaved > 0 && (
                <span className="font-mono text-[11px] text-muted-foreground">
                  {syncJobData.results.alreadySaved} already there
                </span>
              )}
              {syncJobData.results.unavailable > 0 && (
                <span className="font-mono text-[11px] text-muted-foreground">
                  {syncJobData.results.unavailable} not on Spotify
                </span>
              )}
            </div>
          )}
          {lastSync && syncJobData?.status === "done" && (
            <p className="mt-1 font-mono text-[10px] text-muted-foreground/60">
              Last synced {lastSync}
            </p>
          )}
        </div>

        <button
          type="button"
          disabled={syncBusy || isSyncActive}
          onClick={onSync}
          className="hover-elevate inline-flex shrink-0 items-center gap-2 rounded-full border border-primary/50 bg-primary/15 px-5 py-2.5 font-mono text-[11px] uppercase tracking-wide text-primary disabled:opacity-50"
          data-testid="library-sync-button"
        >
          {isSyncActive ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Upload className="h-3.5 w-3.5" />
          )}
          {isSyncActive ? "Syncing…" : "Sync now"}
        </button>
      </div>

      {/* Progress bar when active */}
      {isSyncActive && syncJobData && syncJobData.total > 0 && (
        <div className="h-0.5 w-full bg-primary/10">
          <div
            className="h-full bg-primary/50 transition-all duration-700"
            style={{
              width: `${Math.min(100, (syncJobData.processed / syncJobData.total) * 100)}%`,
            }}
          />
        </div>
      )}

      {/* Phase text */}
      {isSyncActive && syncJobData && (
        <div className="px-5 pb-3 pt-1">
          <p className="font-mono text-[11px] text-muted-foreground">
            {syncJobData.phase === "matching" && "Matching your tracks on Spotify…"}
            {syncJobData.phase === "checking" && "Checking which tracks are already saved…"}
            {syncJobData.phase === "saving" && "Saving to your Spotify library…"}
            {!syncJobData.phase && "Preparing…"}
            {syncJobData.total > 0 &&
              ` (${syncJobData.processed} / ${syncJobData.total})`}
          </p>
        </div>
      )}

      {/* Error */}
      {syncError && (
        <div className="border-t border-primary/10 px-5 py-3" data-testid="library-sync-error">
          <p className="font-mono text-[11px] text-destructive">{syncError}</p>
          {syncNeedsReconnect && (
            <button
              type="button"
              onClick={onReconnect}
              disabled={reconnectBusy}
              data-testid="library-reconnect-spotify"
              className="hover-elevate mt-2 inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-4 py-2 font-mono text-[11px] uppercase tracking-wide text-primary disabled:opacity-60"
            >
              {reconnectBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Music2 className="h-3.5 w-3.5" />
              )}
              Reconnect Spotify
            </button>
          )}
        </div>
      )}

      {/* Sync error from job */}
      {syncJobData?.status === "error" && (
        <div className="border-t border-primary/10 px-5 py-3">
          <p className="font-mono text-[11px] text-destructive" data-testid="library-sync-job-error">
            {syncJobData.error ?? "Sync failed — please try again."}
          </p>
        </div>
      )}

      {/* Details toggle */}
      {syncJobData?.status === "done" &&
        syncJobData.results &&
        (syncJobData.results.unavailableItems.length > 0 ||
          syncJobData.results.searchMatchedItems.length > 0) && (
          <div className="border-t border-primary/10 px-5 py-3">
            <button
              type="button"
              onClick={onToggleReceipt}
              className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground hover:text-foreground"
              data-testid="library-sync-receipt-toggle"
            >
              {syncReceiptOpen ? (
                <ChevronUp className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
              {syncReceiptOpen ? "Hide details" : "Show details"}
            </button>
          </div>
        )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Unavailable (Bandcamp) section
// ---------------------------------------------------------------------------

function UnavailableSection({
  jobId,
  items,
  total,
}: {
  jobId: number;
  items: { mbid: string; title: string; artist: string; bandcampUrl: string }[];
  total: number;
}) {
  return (
    <section className="mt-10" data-testid="library-unavailable">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <div>
          <h2 className="font-serif text-xl font-semibold text-foreground">
            Not on Spotify
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            These tracks aren't in Spotify's catalogue — find them on Bandcamp.
          </p>
        </div>
        {total > 200 && (
          <a
            href={`/api/me/library/sync/${jobId}/unavailable?format=csv`}
            download
            className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-primary hover:underline"
            data-testid="library-sync-unavailable-download"
          >
            Download all ({total}) ↓
          </a>
        )}
      </div>
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li
            key={item.mbid}
            className="flex items-center justify-between gap-4 rounded-xl border border-card-border bg-card px-4 py-3"
          >
            <div className="min-w-0">
              <p className="truncate font-serif text-base font-semibold text-foreground">
                {item.title}
              </p>
              <p className="truncate text-sm text-muted-foreground">{item.artist}</p>
            </div>
            <a
              href={item.bandcampUrl}
              target="_blank"
              rel="noreferrer"
              className="hover-elevate shrink-0 inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-primary"
            >
              Bandcamp ↗
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function Library() {
  const queryClient = useQueryClient();
  const { ride, radio } = usePlayer();
  const dockPadding = ride.active || radio.station ? "pb-32" : "pb-16";

  const { data: connections, isLoading: connLoading } = useMyConnections();
  const isAuthenticated = !connLoading && connections !== null;
  const hasSpotify =
    Array.isArray(connections) && connections.some((c) => c.service === "spotify");

  // Ledger consent + preferences
  const { data: prefs } = useMyPreferences();
  const ledgerEnabled = prefs?.ledgerEnabled ?? false;
  const [ledgerPromptVisible, setLedgerPromptVisible] = useState<boolean>(false);
  const [ledgerBusy, setLedgerBusy] = useState(false);

  useEffect(() => {
    if (prefs !== undefined) {
      setLedgerPromptVisible(shouldShowLedgerPrompt(prefs.ledgerEnabled));
    }
  }, [prefs]);

  const handleEnableLedger = async () => {
    setLedgerBusy(true);
    try {
      await patchPreferences({ ledgerEnabled: true });
      void queryClient.invalidateQueries({ queryKey: ME_PREFERENCES_KEY });
      void queryClient.invalidateQueries({ queryKey: ME_ALBUMS_COMPLETED_KEY });
      setLedgerPromptVisible(false);
    } catch {
      // silent — try again next visit
    } finally {
      setLedgerBusy(false);
    }
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

  // Hero stats derived from kept items
  const radioHeardCount = useMemo(
    () => keptItems.filter((item) => item.provenance.stationSlug != null).length,
    [keptItems],
  );

  // Sentinel for IntersectionObserver
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          void fetchNextPage();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Import job banner
  const { data: jobData } = useLatestImportJob();
  const [bannerDismissed, setBannerDismissed] = useState(false);

  useEffect(() => {
    if (jobData?.status === "pending" || jobData?.status === "running") {
      setBannerDismissed(false);
    }
  }, [jobData?.status]);

  useEffect(() => {
    if (jobData?.status !== "done") return;
    const t = setTimeout(() => setBannerDismissed(true), 8_000);
    return () => clearTimeout(t);
  }, [jobData?.status]);

  const isActive = jobData?.status === "pending" || jobData?.status === "running";
  const isRecentlyFinished = (() => {
    if (!jobData?.finishedAt) return false;
    return Date.now() - new Date(jobData.finishedAt).getTime() < 10 * 60_000;
  })();
  const showImportBanner =
    !bannerDismissed && jobData != null && (isActive || isRecentlyFinished);

  const [connectBusy, setConnectBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);

  const handleConnect = async () => {
    setConnectBusy(true);
    try {
      await startSpotifyLibraryConnect();
    } finally {
      setConnectBusy(false);
    }
  };

  // Sync job state
  const { data: syncJobData } = useLatestSyncJob();
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncNeedsReconnect, setSyncNeedsReconnect] = useState(false);
  const [syncReceiptOpen, setSyncReceiptOpen] = useState(false);
  const [reconnectBusy, setReconnectBusy] = useState(false);

  const isSyncActive =
    syncJobData?.status === "pending" || syncJobData?.status === "running";

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
          err instanceof ApiError &&
          err.data &&
          typeof err.data === "object" &&
          "error" in err.data
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
        err instanceof ApiError &&
        err.data &&
        typeof err.data === "object" &&
        "error" in err.data
          ? String((err.data as { error: unknown }).error)
          : "Import failed. Try again.";
      setFileImportError(msg);
    } finally {
      setImportingFile(false);
    }
  };

  const handleImport = async () => {
    setImportBusy(true);
    try {
      await postStartImport("spotify");
      window.location.href =
        window.location.origin +
        (import.meta.env.BASE_URL ?? "/lore/") +
        "taste-map";
    } catch {
      // 409 or transient failure — refetch syncs state
    } finally {
      void queryClient.invalidateQueries({ queryKey: ME_LATEST_IMPORT_JOB_KEY });
      setImportBusy(false);
    }
  };

  const libLoading = keptLoading;
  const isEmpty = !libLoading && keptItems.length === 0;

  // Unavailable items from last sync
  const unavailableItems =
    syncJobData?.status === "done" ? syncJobData.results?.unavailableItems ?? [] : [];
  const searchMatchedItems =
    syncJobData?.status === "done" ? syncJobData.results?.searchMatchedItems ?? [] : [];

  return (
    <div className="lore-grain relative min-h-screen">
      <div className="lore-glow pointer-events-none absolute inset-0" />
      <div className={`relative z-10 mx-auto max-w-4xl px-4 pt-8 sm:px-6 ${dockPadding}`}>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wide text-muted-foreground hover:text-primary"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to the dial
        </Link>

        {/* ── Hero ─────────────────────────────────────────────── */}
        <header className="mb-10 mt-6">
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.3em] text-primary">
            <BookMarked className="h-4 w-4" />
            Your library
          </div>
          <h1 className="mt-3 max-w-[22ch] font-serif text-4xl font-semibold leading-[1.05] text-foreground sm:text-5xl">
            Songs worth keeping.
          </h1>
          <p className="mt-4 max-w-[52ch] text-base text-muted-foreground">
            Keep tracks from the radio and they land here. Connect Spotify to
            import your existing library and discover selectors who share your taste.
          </p>

          {/* Hero stats */}
          {keptItems.length > 0 && (
            <div className="mt-8 flex flex-wrap gap-8">
              <div className="flex flex-col">
                <span className="font-serif text-3xl font-semibold tabular-nums text-foreground">
                  {keptItems.length.toLocaleString()}
                  {hasNextPage && "+"}
                </span>
                <span className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                  Kept tracks
                </span>
              </div>
              {radioHeardCount > 0 && (
                <HeroStat
                  value={radioHeardCount}
                  label="Heard on radio"
                />
              )}
            </div>
          )}

          {/* Connect / Import CTAs */}
          {!connLoading && !isAuthenticated && (
            <div className="mt-6 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleConnect()}
                disabled={connectBusy}
                data-testid="library-connect-spotify"
                className="hover-elevate inline-flex items-center gap-2 rounded-full border border-keep/50 bg-keep/10 px-4 py-2 font-mono text-[11px] uppercase tracking-wide text-keep disabled:opacity-60"
              >
                {connectBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Music2 className="h-3.5 w-3.5" />
                )}
                Connect Spotify
              </button>
            </div>
          )}

          {isAuthenticated && !hasSpotify && (
            <div className="mt-6 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleConnect()}
                disabled={connectBusy}
                data-testid="library-connect-spotify"
                className="hover-elevate inline-flex items-center gap-2 rounded-full border border-keep/50 bg-keep/10 px-4 py-2 font-mono text-[11px] uppercase tracking-wide text-keep disabled:opacity-60"
              >
                {connectBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Music2 className="h-3.5 w-3.5" />
                )}
                Connect Spotify to import
              </button>
            </div>
          )}

          {isAuthenticated && hasSpotify && isEmpty && !libLoading && (
            <div className="mt-6 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleImport()}
                disabled={importBusy}
                data-testid="library-import-spotify"
                className="hover-elevate inline-flex items-center gap-2 rounded-full border border-keep/50 bg-keep/10 px-4 py-2 font-mono text-[11px] uppercase tracking-wide text-keep disabled:opacity-60"
              >
                {importBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Music2 className="h-3.5 w-3.5" />
                )}
                Import Spotify library
              </button>
            </div>
          )}
        </header>

        {/* ── Ledger consent prompt ─────────────────────────────── */}
        {ledgerPromptVisible && (
          <div
            className="mb-8 rounded-2xl border border-primary/20 bg-primary/5 px-5 py-5"
            data-testid="ledger-consent-prompt"
          >
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary">
              Listening history
            </p>
            <p className="mt-2 max-w-[56ch] font-serif text-base text-foreground">
              Keep a record of what you hear? It powers album progress and lets
              Lore route support to the stations you actually listen to. It's
              yours, exportable, and deletable.
            </p>
            <div className="mt-4 flex gap-3">
              <button
                type="button"
                disabled={ledgerBusy}
                onClick={() => void handleEnableLedger()}
                data-testid="ledger-enable-button"
                className="hover-elevate inline-flex items-center gap-2 rounded-full border border-primary/50 bg-primary/15 px-4 py-2 font-mono text-[11px] uppercase tracking-wide text-primary disabled:opacity-60"
              >
                {ledgerBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                )}
                Start recording
              </button>
              <button
                type="button"
                onClick={handleDismissLedgerPrompt}
                data-testid="ledger-dismiss-button"
                className="inline-flex items-center px-4 py-2 font-mono text-[11px] uppercase tracking-wide text-muted-foreground hover:text-foreground"
              >
                Not now
              </button>
            </div>
          </div>
        )}

        {/* ── Import status banner ─────────────────────────────── */}
        {showImportBanner && jobData && (
          <LibraryImportBanner job={jobData} onDismiss={() => setBannerDismissed(true)} />
        )}

        {/* ── Sync bar (Spotify connected) ─────────────────────── */}
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

        {/* ── New from your pickers — inflow scroll row ─────────── */}
        {inflowItems.length > 0 && (
          <section className="mb-10" data-testid="library-inflow">
            <div className="mb-4 flex items-baseline justify-between">
              <h2 className="font-serif text-xl font-semibold text-foreground">
                New from your pickers
              </h2>
              <span className="font-mono text-xs text-muted-foreground">
                {inflowItems.length} track{inflowItems.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="flex gap-3 overflow-x-auto pb-2" data-testid="inflow-scroll">
              {inflowItems.map((item) => (
                <InflowCard
                  key={item.mbid}
                  item={item}
                  pickerName={item.provenance.pickerHandle}
                  pickerHandle={item.provenance.pickerHandle}
                />
              ))}
            </div>
          </section>
        )}

        {/* ── Kept track list ──────────────────────────────────── */}
        <section>
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="font-serif text-xl font-semibold text-foreground">Kept</h2>
            <span className="font-mono text-xs text-muted-foreground">
              {keptItems.length} track{keptItems.length === 1 ? "" : "s"}
              {hasNextPage ? "+" : ""}
            </span>
          </div>

          {libLoading ? (
            <ul className="flex flex-col gap-2">
              {[0, 1, 2, 3].map((i) => (
                <li
                  key={i}
                  className="h-[66px] animate-pulse rounded-xl border border-card-border bg-card"
                />
              ))}
            </ul>
          ) : keptItems.length === 0 ? (
            <div className="rounded-2xl border border-card-border bg-card p-8 text-center">
              <Disc3 className="mx-auto h-10 w-10 text-muted-foreground/40" />
              <p className="mx-auto mt-4 max-w-[36ch] font-serif text-lg text-muted-foreground">
                Keep songs from the radio to build your library.
              </p>
              <Link
                href="/"
                className="hover-elevate mt-5 inline-flex items-center gap-2 rounded-full border border-primary-border bg-primary/10 px-4 py-2 font-mono text-[11px] uppercase tracking-wide text-primary"
              >
                <Radio className="h-3.5 w-3.5" />
                Open the dial
              </Link>
            </div>
          ) : (
            <>
              <ul className="flex flex-col gap-2" data-testid="library-kept">
                {keptItems.map((item) => (
                  <LibraryRow key={item.mbid} item={item} />
                ))}
              </ul>

              {/* Sentinel — triggers next page fetch when scrolled into view */}
              <div ref={sentinelRef} className="h-1" aria-hidden />

              {isFetchingNextPage && (
                <div
                  className="flex justify-center py-6"
                  data-testid="library-loading-more"
                >
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              )}

              {!hasNextPage && keptItems.length > 0 && (
                <p
                  className="py-6 text-center font-mono text-[11px] uppercase tracking-wide text-muted-foreground"
                  data-testid="library-end"
                >
                  {keptItems.length} track{keptItems.length === 1 ? "" : "s"} total
                </p>
              )}
            </>
          )}
        </section>

        {/* ── Unavailable / Bandcamp section ───────────────────── */}
        {syncReceiptOpen && unavailableItems.length > 0 && syncJobData && (
          <UnavailableSection
            jobId={syncJobData.jobId}
            items={unavailableItems}
            total={syncJobData.results?.unavailable ?? unavailableItems.length}
          />
        )}

        {/* ── Search-matched section ───────────────────────────── */}
        {syncReceiptOpen && searchMatchedItems.length > 0 && syncJobData && (
          <section className="mt-8" data-testid="library-search-matched">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <div>
                <h2 className="font-serif text-lg font-semibold text-foreground">
                  Matched by search
                </h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Lower confidence — verify these on Spotify.
                </p>
              </div>
              {(syncJobData.results?.searchMatched ?? 0) > 200 && (
                <a
                  href={`/api/me/library/sync/${syncJobData.jobId}/search-matched?format=csv`}
                  download
                  className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-primary hover:underline"
                  data-testid="library-sync-search-matched-download"
                >
                  Download all ({syncJobData.results?.searchMatched}) ↓
                </a>
              )}
            </div>
            <ul className="flex flex-col gap-2">
              {searchMatchedItems.map((item) => (
                <li
                  key={item.mbid}
                  className="flex items-center justify-between gap-4 rounded-xl border border-card-border bg-card px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate font-serif text-base font-semibold text-foreground">
                      {item.title}
                    </p>
                    <p className="truncate text-sm text-muted-foreground">{item.artist}</p>
                  </div>
                  <a
                    href={item.spotifyUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="hover-elevate shrink-0 inline-flex items-center gap-1.5 rounded-full border border-keep/40 bg-keep/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-keep"
                  >
                    Spotify ↗
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ── Album completion ─────────────────────────────────── */}
        {ledgerEnabled && albumsData && albumsData.length > 0 && (
          <section className="mt-10" data-testid="library-albums-completed">
            <div className="mb-4 flex items-baseline justify-between">
              <h2 className="font-serif text-xl font-semibold text-foreground">
                Albums heard
              </h2>
              <span className="font-mono text-xs text-muted-foreground">
                {albumsData.length} album{albumsData.length === 1 ? "" : "s"}
              </span>
            </div>
            <ul className="flex flex-col gap-2">
              {albumsData.map((album) => (
                <AlbumCompletionRow key={album.releaseGroupMbid} album={album} />
              ))}
            </ul>
          </section>
        )}

        {/* ── Export ───────────────────────────────────────────── */}
        <section
          className="mt-12 rounded-2xl border border-card-border bg-card p-5"
          data-testid="library-export"
        >
          <h2 className="font-serif text-lg font-semibold text-foreground">Take it with you</h2>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">
            Download your kept and imported tracks. Fields we don't have yet export empty —
            never guessed.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {(["csv", "json", "m3u8", "txt"] as const).map((fmt) => (
              <a
                key={fmt}
                href={`/api/me/library/export?format=${fmt}`}
                download
                className="hover-elevate rounded-full border border-border px-4 py-2 font-mono text-[11px] uppercase tracking-wide text-foreground"
                data-testid={`library-export-${fmt}`}
              >
                {fmt === "m3u8" ? "M3U8 playlist" : fmt.toUpperCase()}
              </a>
            ))}
          </div>
          <div className="mt-5 border-t border-border pt-4" data-testid="library-import-file">
            <h3 className="font-serif text-base font-semibold text-foreground">Bring it back</h3>
            <p className="mt-1 font-mono text-[11px] text-muted-foreground">
              Import a Lore JSON export. Already-kept tracks are skipped; anything we can't
              read is reported, never silently dropped.
            </p>
            <div className="mt-3 flex items-center gap-3">
              <input
                ref={importFileRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
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
                className="hover-elevate rounded-full border border-border px-4 py-2 font-mono text-[11px] uppercase tracking-wide text-foreground disabled:opacity-50"
                data-testid="library-import-file-button"
              >
                {importingFile ? "Importing…" : "Import JSON file"}
              </button>
            </div>
            {fileImportError && (
              <p
                className="mt-2 font-mono text-[11px] text-destructive"
                data-testid="library-import-file-error"
              >
                {fileImportError}
              </p>
            )}
            {fileImportSummary && (
              <p
                className="mt-2 font-mono text-[11px] text-muted-foreground"
                data-testid="library-import-file-summary"
              >
                Imported {fileImportSummary.imported} · skipped {fileImportSummary.skipped} ·
                rejected {fileImportSummary.rejected}
                {fileImportSummary.errors.length > 0 &&
                  ` — first issue: item ${fileImportSummary.errors[0].index + 1}: ${fileImportSummary.errors[0].reason}`}
              </p>
            )}
          </div>
          <p className="mt-3 font-mono text-[11px] text-muted-foreground">
            To move tracks into another streaming service, feed the CSV to a transfer tool
            like{" "}
            <a
              href="https://soundiiz.com"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              Soundiiz
            </a>{" "}
            or{" "}
            <a
              href="https://www.tunemymusic.com"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              TuneMyMusic
            </a>
            .
          </p>
        </section>

        <footer className="mt-16 border-t border-border pt-6 font-mono text-[11px] text-muted-foreground">
          Your library is stored on the Lore server and tied to your session. Spotify
          mirroring applies when you've granted write access.
        </footer>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function AlbumCompletionRow({ album }: { album: AlbumCompletion }) {
  const { title, artistName, totalTracks, heardTracks } = album;
  return (
    <li className="flex items-center justify-between gap-3 rounded-xl border border-card-border bg-card px-4 py-3">
      <div className="min-w-0">
        <p className="truncate font-serif text-sm font-medium text-foreground">
          {title ?? "Unknown album"}
        </p>
        {artistName && (
          <p className="truncate font-mono text-[11px] text-muted-foreground">{artistName}</p>
        )}
      </div>
      <p className="shrink-0 font-mono text-[11px] text-muted-foreground">
        {heardTracks} of {totalTracks} tracks
      </p>
    </li>
  );
}

function phaseLabel(phase: string | null | undefined): string {
  switch (phase) {
    case "fetching": return "Reading your Spotify library…";
    case "spine":    return "Checking spine…";
    case "cache":    return "Checking spine…";
    case "resolve":  return "Resolving new tracks…";
    default:         return "Connecting to Spotify…";
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

  if (isError) {
    return (
      <div
        className="mb-8 flex items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/10 px-5 py-4"
        data-testid="library-import-banner"
      >
        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[11px] uppercase tracking-wide text-destructive">
            Import failed
          </p>
          <p className="mt-0.5 font-serif text-base text-foreground">
            {job.error ?? "Something went wrong — try importing again."}
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-muted-foreground hover:text-foreground"
        >
          dismiss
        </button>
      </div>
    );
  }

  if (isDone) {
    return (
      <div
        className="mb-8 flex items-center gap-3 rounded-2xl border border-keep/30 bg-keep/10 px-5 py-4"
        data-testid="library-import-banner"
      >
        <CheckCircle2 className="h-4 w-4 shrink-0 text-keep" />
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[11px] uppercase tracking-wide text-keep">
            Library imported
          </p>
          <p className="mt-0.5 font-serif text-base text-foreground">
            {job.resolved.toLocaleString()} track{job.resolved === 1 ? "" : "s"} matched.
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-muted-foreground hover:text-foreground"
        >
          dismiss
        </button>
      </div>
    );
  }

  const label = phaseLabel(job.phase);
  const isFetchingPhase = job.phase === "fetching";
  const isResolvingPhase = job.phase === "resolve";
  const progressPct = job.total > 0 ? Math.min(100, (job.resolved / job.total) * 100) : 0;

  return (
    <div
      className="mb-8 overflow-hidden rounded-2xl border border-keep/30 bg-keep/10"
      data-testid="library-import-banner"
    >
      <div className="flex items-center justify-between gap-4 px-5 py-4">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[11px] uppercase tracking-wide text-keep">{label}</p>
          {isFetchingPhase && job.total > 0 ? (
            <p className="mt-1 font-serif text-xl font-semibold text-foreground">
              Found {job.total.toLocaleString()}{" "}
              <span className="text-base font-normal text-muted-foreground">tracks…</span>
            </p>
          ) : !isFetchingPhase && job.total > 0 ? (
            <p className="mt-1 font-serif text-xl font-semibold text-foreground">
              {job.resolved.toLocaleString()}{" "}
              <span className="text-base font-normal text-muted-foreground">
                / ~{job.total.toLocaleString()} tracks
                {isResolvingPhase ? " resolved" : " found"}
              </span>
            </p>
          ) : (
            <p className="mt-1 font-serif text-base text-muted-foreground">
              {isFetchingPhase ? "Scanning your library…" : "Starting…"}
            </p>
          )}
        </div>
        <Loader2 className="h-5 w-5 shrink-0 animate-spin text-keep" />
      </div>
      {job.total > 0 && (
        <div className="h-1 w-full bg-keep/10">
          <div
            className="h-full bg-keep/60 transition-all duration-700"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      )}
    </div>
  );
}
