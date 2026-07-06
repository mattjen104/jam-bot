import { useEffect, useState } from "react";
import { Link } from "wouter";
import { usePlayer } from "../player/PlayerProvider";
import {
  useMyLibrary,
  useMyConnections,
  useLatestImportJob,
  startSpotifyLibraryConnect,
  postStartImport,
} from "../lib/meHooks";
import { InflowCard } from "../components/InflowCard";
import { LibraryRow } from "../components/LibraryRow";
import {
  ArrowLeft,
  BookMarked,
  CheckCircle2,
  Disc3,
  Radio,
  Loader2,
  Music2,
  XCircle,
} from "lucide-react";

export default function Library() {
  const { ride, radio } = usePlayer();
  const dockPadding = ride.active || radio.station ? "pb-32" : "pb-16";

  const { data: connections, isLoading: connLoading } = useMyConnections();
  const isAuthenticated = !connLoading && connections !== null;
  const hasSpotify = Array.isArray(connections) && connections.some((c) => c.service === "spotify");

  const { data: libraryData, isLoading: libLoading } = useMyLibrary();
  const items = libraryData?.items ?? [];

  // Split: kept (provenance.kind === 'keep') vs imported
  const kept = items.filter((i) => i.provenance.kind === "keep");
  const inflow = items.filter((i) => i.provenance.kind !== "keep").slice(0, 20);

  // Poll latest import job so Library shows progress without needing ?import=1
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

  const handleImport = async () => {
    setImportBusy(true);
    try {
      await postStartImport("spotify");
      window.location.href = window.location.origin + (import.meta.env.BASE_URL ?? "/lore/") + "taste-map";
    } finally {
      setImportBusy(false);
    }
  };

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

          {isAuthenticated && hasSpotify && items.length === 0 && !libLoading && (
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
        {inflow.length > 0 && (
          <section className="mb-10" data-testid="library-inflow">
            <div className="mb-4 flex items-baseline justify-between">
              <h2 className="font-serif text-xl font-semibold text-foreground">
                New from your pickers
              </h2>
              <span className="font-mono text-xs text-muted-foreground">
                {inflow.length} track{inflow.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="flex gap-3 overflow-x-auto pb-2" data-testid="inflow-scroll">
              {inflow.map((item) => (
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

        {/* Kept list */}
        <section>
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="font-serif text-xl font-semibold text-foreground">Kept</h2>
            <span className="font-mono text-xs text-muted-foreground">
              {kept.length} track{kept.length === 1 ? "" : "s"}
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
          ) : kept.length === 0 ? (
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
            <ul className="flex flex-col gap-2" data-testid="library-kept">
              {kept.map((item) => (
                <LibraryRow key={item.mbid} item={item} />
              ))}
            </ul>
          )}
        </section>

        <footer className="mt-16 border-t border-border pt-6 font-mono text-[11px] text-muted-foreground">
          Your library is stored on the Lore server and tied to your session.
          Spotify mirroring applies when you've granted write access.
        </footer>
      </div>
    </div>
  );
}

function LibraryImportBanner({
  job,
  onDismiss,
}: {
  job: { status: string; total: number; resolved: number; error: string | null };
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

  // pending / running
  return (
    <div
      className="mb-8 overflow-hidden rounded-xl border border-[#C6F53F]/30 bg-[#C6F53F]/10"
      data-testid="library-import-banner"
    >
      <div className="flex items-center justify-between gap-4 px-5 py-4">
        <div className="min-w-0">
          <p className="font-mono text-[11px] uppercase tracking-wide text-[#C6F53F]">
            Reading your Spotify library…
          </p>
          {job.total > 0 ? (
            <p className="mt-1 font-serif text-xl font-semibold text-foreground">
              {job.resolved.toLocaleString()}{" "}
              <span className="text-base font-normal text-muted-foreground">
                / ~{job.total.toLocaleString()} tracks resolved
              </span>
            </p>
          ) : (
            <p className="mt-1 font-serif text-base text-muted-foreground">
              Connecting to Spotify…
            </p>
          )}
        </div>
        <Loader2 className="h-5 w-5 shrink-0 animate-spin text-[#C6F53F]" />
      </div>
      {job.total > 0 && (
        <div className="h-1 w-full bg-[#C6F53F]/10">
          <div
            className="h-full bg-[#C6F53F]/60 transition-all duration-700"
            style={{ width: `${Math.min(100, (job.resolved / job.total) * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}
