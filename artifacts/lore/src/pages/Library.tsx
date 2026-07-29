import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { usePlayer } from "../player/PlayerProvider";
import {
  useMyLibraryInfinite,
  useMyConnections,
  useLatestImportJob,
  useLatestSyncJob,
  startSpotifyLibraryConnect,
  postStartImport,
  postStartSync,
  postImportLibraryFile,
  type FileImportSummary,
  type SyncJobStatus,
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

export default function Library() {
  const queryClient = useQueryClient();
  const { ride, radio } = usePlayer();
  const dockPadding = ride.active || radio.station ? "pb-32" : "pb-16";

  const { data: connections, isLoading: connLoading } = useMyConnections();
  const isAuthenticated = !connLoading && connections !== null;
  const hasSpotify = Array.isArray(connections) && connections.some((c) => c.service === "spotify");

  // Infinite kept list — scrolls as user reaches the bottom
  const {
    data: keptData,
    isLoading: keptLoading,
    isFetchingNextPage,
    fetchNextPage,
    hasNextPage,
  } = useMyLibraryInfinite({ source: "keep" }, 50);

  const keptItems = keptData?.pages.flatMap((p) => p.items) ?? [];

  // Inflow row — first-page import items only (horizontal scroll, capped at 20)
  const { data: inflowData } = useMyLibraryInfinite({ source: "import" }, 20);
  const inflowItems = inflowData?.pages[0]?.items?.slice(0, 20) ?? [];

  // Sentinel ref for IntersectionObserver — triggers next page when visible
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
  const showImportBanner = !bannerDismissed && jobData != null && (isActive || isRecentlyFinished);

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
  const [syncReceiptOpen, setSyncReceiptOpen] = useState(false);

  const isSyncActive = syncJobData?.status === "pending" || syncJobData?.status === "running";

  const handleSync = async () => {
    setSyncBusy(true);
    setSyncError(null);
    try {
      await postStartSync("spotify");
      void queryClient.invalidateQueries({ queryKey: ME_LATEST_SYNC_JOB_KEY });
    } catch (err) {
      const msg =
        err instanceof ApiError && err.data && typeof err.data === "object" && "error" in err.data
          ? ((err.data as { error: string }).error === "canWrite:false"
            ? "Reconnect Spotify to grant write access, then try again."
            : String((err.data as { error: unknown }).error))
          : "Sync failed. Try again.";
      setSyncError(msg);
    } finally {
      setSyncBusy(false);
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
        err instanceof ApiError && err.data && typeof err.data === "object" && "error" in err.data
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
      window.location.href = window.location.origin + (import.meta.env.BASE_URL ?? "/lore/") + "taste-map";
    } catch {
      // 409 (already running) or transient failure — refetch below re-syncs.
    } finally {
      void queryClient.invalidateQueries({ queryKey: ME_LATEST_IMPORT_JOB_KEY });
      setImportBusy(false);
    }
  };

  const libLoading = keptLoading;
  const isEmpty = !libLoading && keptItems.length === 0;

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

        <header className="mb-8 mt-6">
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.3em] text-primary">
            <BookMarked className="h-4 w-4" />
            Your library
          </div>
          <h1 className="mt-3 max-w-[22ch] font-serif text-4xl font-semibold leading-[1.05] text-foreground sm:text-5xl">
            Songs worth keeping.
          </h1>
          <p className="mt-4 max-w-[52ch] text-base text-muted-foreground">
            Keep tracks from the radio and they land here. Connect Spotify to
            import your existing library and discover pickers who share your taste.
          </p>

          {/* Connect / Import CTAs */}
          {!connLoading && !isAuthenticated && (
            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleConnect()}
                disabled={connectBusy}
                data-testid="library-connect-spotify"
                className="hover-elevate inline-flex items-center gap-2 rounded-full border border-[#C6F53F]/50 bg-[#C6F53F]/15 px-4 py-2 font-mono text-[11px] uppercase tracking-wide text-[#C6F53F] disabled:opacity-60"
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
            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleConnect()}
                disabled={connectBusy}
                data-testid="library-connect-spotify"
                className="hover-elevate inline-flex items-center gap-2 rounded-full border border-[#C6F53F]/50 bg-[#C6F53F]/15 px-4 py-2 font-mono text-[11px] uppercase tracking-wide text-[#C6F53F] disabled:opacity-60"
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
            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleImport()}
                disabled={importBusy}
                data-testid="library-import-spotify"
                className="hover-elevate inline-flex items-center gap-2 rounded-full border border-[#C6F53F]/50 bg-[#C6F53F]/15 px-4 py-2 font-mono text-[11px] uppercase tracking-wide text-[#C6F53F] disabled:opacity-60"
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

        {/* Import status banner */}
        {showImportBanner && jobData && (
          <LibraryImportBanner
            job={jobData}
            onDismiss={() => setBannerDismissed(true)}
          />
        )}

        {/* New from your pickers — inflow scroll row */}
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

        {/* Kept list — infinite scroll */}
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
            <div className="rounded-xl border border-card-border bg-card p-8 text-center">
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

              {/* Fetch-next-page spinner */}
              {isFetchingNextPage && (
                <div className="flex justify-center py-6" data-testid="library-loading-more">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              )}

              {/* End-of-list message */}
              {!hasNextPage && keptItems.length > 0 && (
                <p
                  className="py-6 text-center font-mono text-[11px] uppercase tracking-wide text-muted-foreground"
                  data-testid="library-end"
                >
                  You've reached the end · {keptItems.length} track{keptItems.length === 1 ? "" : "s"}
                </p>
              )}
            </>
          )}
        </section>

        {/* Sync to Spotify */}
        {isAuthenticated && hasSpotify && (
          <section className="mt-8 rounded-xl border border-card-border bg-card p-5" data-testid="library-sync">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="font-serif text-lg font-semibold text-foreground">Sync to Spotify</h2>
                <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                  Push your kept tracks to Spotify's saved songs. Already-saved tracks are skipped.
                  Anything not on Spotify gets a Bandcamp link.
                </p>
              </div>
              <button
                type="button"
                disabled={syncBusy || isSyncActive}
                onClick={() => void handleSync()}
                className="hover-elevate inline-flex shrink-0 items-center gap-2 rounded-full border border-[#C6F53F]/50 bg-[#C6F53F]/15 px-4 py-2 font-mono text-[11px] uppercase tracking-wide text-[#C6F53F] disabled:opacity-50"
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

            {syncError && (
              <p className="mt-2 font-mono text-[11px] text-destructive" data-testid="library-sync-error">
                {syncError}
              </p>
            )}

            {/* Active job progress */}
            {isSyncActive && syncJobData && (
              <div className="mt-4" data-testid="library-sync-progress">
                <p className="font-mono text-[11px] text-muted-foreground">
                  {syncJobData.phase === "matching" && "Matching your tracks on Spotify…"}
                  {syncJobData.phase === "checking" && "Checking which tracks are already saved…"}
                  {syncJobData.phase === "saving" && "Saving to your Spotify library…"}
                  {!syncJobData.phase && "Preparing…"}
                  {syncJobData.total > 0 && ` (${syncJobData.processed} / ${syncJobData.total})`}
                </p>
                {syncJobData.total > 0 && (
                  <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-[#C6F53F] transition-all"
                      style={{ width: `${Math.min(100, (syncJobData.processed / syncJobData.total) * 100)}%` }}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Completed receipt */}
            {syncJobData?.status === "done" && syncJobData.results && (
              <div className="mt-4" data-testid="library-sync-receipt">
                <div className="flex flex-wrap gap-4 font-mono text-[11px] text-muted-foreground">
                  <span><span className="text-foreground">{syncJobData.results.synced}</span> synced</span>
                  {syncJobData.results.searchMatched > 0 && (
                    <span><span className="text-foreground">{syncJobData.results.searchMatched}</span> matched by search</span>
                  )}
                  {syncJobData.results.alreadySaved > 0 && (
                    <span><span className="text-muted-foreground">{syncJobData.results.alreadySaved}</span> already saved</span>
                  )}
                  {syncJobData.results.unavailable > 0 && (
                    <span><span className="text-foreground">{syncJobData.results.unavailable}</span> not on Spotify</span>
                  )}
                </div>

                {(syncJobData.results.unavailableItems.length > 0 || syncJobData.results.searchMatchedItems.length > 0) && (
                  <button
                    type="button"
                    onClick={() => setSyncReceiptOpen((v) => !v)}
                    className="mt-3 inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground hover:text-foreground"
                    data-testid="library-sync-receipt-toggle"
                  >
                    {syncReceiptOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    {syncReceiptOpen ? "Hide details" : "Show details"}
                  </button>
                )}

                {syncReceiptOpen && (
                  <div className="mt-3 space-y-4">
                    {syncJobData.results.unavailableItems.length > 0 && (
                      <div>
                        <p className="mb-2 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
                          Not on Spotify — buy them properly
                        </p>
                        <ul className="space-y-1">
                          {syncJobData.results.unavailableItems.map((item) => (
                            <li key={item.mbid} className="flex items-center justify-between gap-2 text-sm">
                              <span className="truncate text-foreground">{item.artist} — {item.title}</span>
                              <a
                                href={item.bandcampUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-primary hover:underline"
                              >
                                Bandcamp ↗
                              </a>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {syncJobData.results.searchMatchedItems.length > 0 && (
                      <div>
                        <p className="mb-2 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
                          Matched by search (lower confidence)
                        </p>
                        <ul className="space-y-1">
                          {syncJobData.results.searchMatchedItems.map((item) => (
                            <li key={item.mbid} className="flex items-center justify-between gap-2 text-sm">
                              <span className="truncate text-foreground">{item.artist} — {item.title}</span>
                              <a
                                href={item.spotifyUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-primary hover:underline"
                              >
                                Spotify ↗
                              </a>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {syncJobData?.status === "error" && (
              <p className="mt-3 font-mono text-[11px] text-destructive" data-testid="library-sync-job-error">
                {syncJobData.error ?? "Sync failed — please try again."}
              </p>
            )}
          </section>
        )}

        {/* Export — take your library with you */}
        <section className="mt-12 rounded-xl border border-card-border bg-card p-5" data-testid="library-export">
          <h2 className="font-serif text-lg font-semibold text-foreground">Take it with you</h2>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">
            Download your kept and imported tracks. Fields we don't have yet export
            empty — never guessed.
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
              Import a Lore JSON export. Already-kept tracks are skipped; anything
              we can't read is reported, never silently dropped.
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
              <p className="mt-2 font-mono text-[11px] text-destructive" data-testid="library-import-file-error">
                {fileImportError}
              </p>
            )}
            {fileImportSummary && (
              <p className="mt-2 font-mono text-[11px] text-muted-foreground" data-testid="library-import-file-summary">
                Imported {fileImportSummary.imported} · skipped {fileImportSummary.skipped} · rejected{" "}
                {fileImportSummary.rejected}
                {fileImportSummary.errors.length > 0 &&
                  ` — first issue: item ${fileImportSummary.errors[0].index + 1}: ${fileImportSummary.errors[0].reason}`}
              </p>
            )}
          </div>
          <p className="mt-3 font-mono text-[11px] text-muted-foreground">
            To move tracks into another streaming service, feed the CSV to a
            transfer tool like{" "}
            <a href="https://soundiiz.com" target="_blank" rel="noreferrer" className="underline">
              Soundiiz
            </a>{" "}
            or{" "}
            <a href="https://www.tunemymusic.com" target="_blank" rel="noreferrer" className="underline">
              TuneMyMusic
            </a>
            .
          </p>
        </section>

        <footer className="mt-16 border-t border-border pt-6 font-mono text-[11px] text-muted-foreground">
          Your library is stored on the Lore server and tied to your session.
          Spotify mirroring applies when you've granted write access.
        </footer>
      </div>
    </div>
  );
}

/** Human-readable label for each worker phase. */
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
  job: { status: string; phase?: string | null; total: number; resolved: number; error: string | null };
  onDismiss: () => void;
}) {
  const isError = job.status === "error";
  const isDone = job.status === "done";

  if (isError) {
    return (
      <div
        className="mb-8 flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-5 py-4"
        data-testid="library-import-banner"
      >
        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[11px] uppercase tracking-wide text-red-400">
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
        className="mb-8 flex items-center gap-3 rounded-xl border border-[#C6F53F]/30 bg-[#C6F53F]/10 px-5 py-4"
        data-testid="library-import-banner"
      >
        <CheckCircle2 className="h-4 w-4 shrink-0 text-[#C6F53F]" />
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[11px] uppercase tracking-wide text-[#C6F53F]">
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

  // pending / running — show phase label + progress bar
  const label = phaseLabel(job.phase);
  const isFetchingPhase = job.phase === "fetching";
  const isResolvingPhase = job.phase === "resolve";
  const progressPct = job.total > 0 ? Math.min(100, (job.resolved / job.total) * 100) : 0;

  return (
    <div
      className="mb-8 overflow-hidden rounded-xl border border-[#C6F53F]/30 bg-[#C6F53F]/10"
      data-testid="library-import-banner"
    >
      <div className="flex items-center justify-between gap-4 px-5 py-4">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[11px] uppercase tracking-wide text-[#C6F53F]">
            {label}
          </p>
          {isFetchingPhase && job.total > 0 ? (
            <p className="mt-1 font-serif text-xl font-semibold text-foreground">
              Found {job.total.toLocaleString()}{" "}
              <span className="text-base font-normal text-muted-foreground">tracks…</span>
            </p>
          ) : !isFetchingPhase && job.total > 0 ? (
            <p className="mt-1 font-serif text-xl font-semibold text-foreground">
              {job.resolved.toLocaleString()}{" "}
              <span className="text-base font-normal text-muted-foreground">
                / ~{job.total.toLocaleString()} tracks{isResolvingPhase ? " resolved" : " found"}
              </span>
            </p>
          ) : (
            <p className="mt-1 font-serif text-base text-muted-foreground">
              {isFetchingPhase ? "Scanning your library…" : "Starting…"}
            </p>
          )}
        </div>
        <Loader2 className="h-5 w-5 shrink-0 animate-spin text-[#C6F53F]" />
      </div>
      {job.total > 0 && (
        <div className="h-1 w-full bg-[#C6F53F]/10">
          <div
            className="h-full bg-[#C6F53F]/60 transition-all duration-700"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      )}
    </div>
  );
}
