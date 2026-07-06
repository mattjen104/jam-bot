import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { usePlayer } from "../player/PlayerProvider";
import {
  useMyOverlapPickers,
  useMyOverlapStations,
  useMyOverlapRuns,
  useLatestImportJob,
  postStartImport,
  startSpotifyLibraryConnect,
  useMyConnections,
  type OverlapPicker,
  type OverlapStation,
  type OverlapRun,
} from "../lib/meHooks";
import { toggleFollow, useFollows, isFollowed } from "../lib/local";
import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Map,
  Music2,
  RefreshCw,
  UserCheck,
  Users,
  Radio,
  Antenna,
  XCircle,
} from "lucide-react";

export default function TasteMap() {
  const { ride, radio } = usePlayer();
  const dockPadding = ride.active || radio.station ? "pb-32" : "pb-16";

  const [, setLocation] = useLocation();

  const { data: connections, isLoading: connLoading } = useMyConnections();
  const isAuthenticated = !connLoading && connections !== null;
  const hasSpotify =
    Array.isArray(connections) && connections.some((c) => c.service === "spotify");

  // Kick off an import when we land here from the connect callback (?import=1).
  const [importTriggered, setImportTriggered] = useState(false);
  useEffect(() => {
    if (!hasSpotify || importTriggered) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("import") !== "1") return;
    setImportTriggered(true);
    postStartImport("spotify").catch(() => {});
  }, [hasSpotify, importTriggered]);

  // Always poll the latest import job — works across tabs so the user sees
  // status even when OAuth completed in a different tab.
  const { data: jobData } = useLatestImportJob();
  const [bannerDismissed, setBannerDismissed] = useState(false);

  // Reset dismissed state when a new active job appears.
  useEffect(() => {
    if (jobData?.status === "pending" || jobData?.status === "running") {
      setBannerDismissed(false);
    }
  }, [jobData?.status]);

  // For terminal states, auto-hide the "done" banner after 8 s.
  useEffect(() => {
    if (jobData?.status !== "done") return;
    const t = setTimeout(() => setBannerDismissed(true), 8_000);
    return () => clearTimeout(t);
  }, [jobData?.status]);

  const isActive = jobData?.status === "pending" || jobData?.status === "running";
  // Only show terminal banners for jobs that finished in the last 10 minutes.
  const isRecentlyFinished = (() => {
    if (!jobData?.finishedAt) return false;
    return Date.now() - new Date(jobData.finishedAt).getTime() < 10 * 60_000;
  })();
  const showBanner = !bannerDismissed && (isActive || isRecentlyFinished);

  const { data: pickers = [], isLoading: pickersLoading } = useMyOverlapPickers();
  const { data: stations = [], isLoading: stationsLoading } = useMyOverlapStations();
  const { data: runs = [], isLoading: runsLoading } = useMyOverlapRuns();

  const [connectBusy, setConnectBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);

  // Can trigger / retry an import when connected and no job is currently active.
  const lastJobErrored = jobData?.status === "error";
  const neverImported = hasSpotify && jobData === null;
  const canTriggerImport = hasSpotify && !isActive && !importBusy;

  // Human-readable explanation for empty overlap sections.
  const importEmptyMessage = isActive
    ? "Reading your library now — matches will appear here shortly."
    : lastJobErrored
      ? "Last import failed — hit Retry import above to try again."
      : neverImported
        ? "Hit Import Spotify library above to find your matches."
        : "None of your library tracks have been spun on the dial yet. As stations play your music, matches appear here.";

  const handleImport = async () => {
    setImportBusy(true);
    try {
      await postStartImport("spotify");
      // The useLatestImportJob hook will start polling automatically once
      // the new job appears (staleTime: 0).
    } catch {
      // error will surface in the banner via the next poll
    } finally {
      setImportBusy(false);
    }
  };

  const handleConnect = async () => {
    setConnectBusy(true);
    try {
      // After connect we come back to taste-map?import=1 to auto-kick the import
      const base = (import.meta.env.BASE_URL ?? "/lore/").replace(/\/$/, "");
      const returnPath = `${window.location.origin}${base}/taste-map?import=1`;
      sessionStorage.setItem("lore_taste_map_return", returnPath);
      await startSpotifyLibraryConnect();
    } finally {
      setConnectBusy(false);
    }
  };

  if (!connLoading && !isAuthenticated) {
    return (
      <div className="lore-grain relative min-h-screen">
        <div className="lore-glow pointer-events-none absolute inset-0" />
        <div className="relative z-10 mx-auto max-w-4xl px-4 pt-8 sm:px-6">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wide text-muted-foreground hover:text-primary"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to the dial
          </Link>
          <header className="mb-8 mt-6">
            <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.3em] text-primary">
              <Map className="h-4 w-4" />
              Taste map
            </div>
            <h1 className="mt-3 font-serif text-4xl font-semibold text-foreground">
              Connect to see your taste map.
            </h1>
            <p className="mt-4 max-w-[48ch] text-base text-muted-foreground">
              Connect your Spotify library to discover selectors and stations that
              match your taste.
            </p>
            <button
              type="button"
              onClick={() => void handleConnect()}
              disabled={connectBusy}
              className="hover-elevate mt-5 inline-flex items-center gap-2 rounded-full border border-[#C6F53F]/50 bg-[#C6F53F]/15 px-4 py-2 font-mono text-[11px] uppercase tracking-wide text-[#C6F53F] disabled:opacity-60"
            >
              {connectBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Music2 className="h-3.5 w-3.5" />
              )}
              Connect Spotify
            </button>
          </header>
        </div>
      </div>
    );
  }

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
            <Map className="h-4 w-4" />
            Taste map
          </div>
          <div className="mt-3 flex flex-wrap items-start gap-3">
            <h1 className="font-serif text-4xl font-semibold leading-[1.05] text-foreground sm:text-5xl">
              Your library vs. the dial.
            </h1>
            {hasSpotify && (
              <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-full border border-[#1DB954]/40 bg-[#1DB954]/10 px-3 py-1 font-mono text-[10px] uppercase tracking-wide text-[#1DB954]">
                <CheckCircle2 className="h-3 w-3" />
                Spotify connected
              </span>
            )}
          </div>
          <p className="mt-4 max-w-[52ch] text-base text-muted-foreground">
            Your Spotify library mapped to every spin on the dial — see which
            stations already play your music, and which shows to ride first.
          </p>

          {/* Import / retry CTA — shown when connected but no active job */}
          {canTriggerImport && (neverImported || lastJobErrored) && (
            <div className="mt-5 flex items-center gap-3">
              <button
                type="button"
                onClick={() => void handleImport()}
                disabled={importBusy}
                className="hover-elevate inline-flex items-center gap-2 rounded-full border border-[#C6F53F]/50 bg-[#C6F53F]/15 px-4 py-2 font-mono text-[11px] uppercase tracking-wide text-[#C6F53F] disabled:opacity-60"
              >
                {importBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : lastJobErrored ? (
                  <RefreshCw className="h-3.5 w-3.5" />
                ) : (
                  <Music2 className="h-3.5 w-3.5" />
                )}
                {lastJobErrored ? "Retry import" : "Import Spotify library"}
              </button>
              {lastJobErrored && (
                <p className="font-mono text-[11px] text-muted-foreground">
                  Last import failed — retry to try again
                </p>
              )}
            </div>
          )}
        </header>

        {/* Import status banner */}
        {showBanner && jobData && (
          <ImportStatusBanner
            job={jobData}
            onDismiss={() => setBannerDismissed(true)}
          />
        )}

        {/* Stations section */}
        <section className="mb-10" data-testid="overlap-stations">
          <div className="mb-4 flex items-baseline gap-3">
            <h2 className="font-serif text-xl font-semibold text-foreground">
              Stations that play your music
            </h2>
            {!stationsLoading && stations.length > 0 && (
              <span className="font-mono text-xs text-muted-foreground">
                {stations.length} station{stations.length === 1 ? "" : "s"}
              </span>
            )}
          </div>

          {stationsLoading || connLoading ? (
            <ul className="flex flex-col gap-2">
              {[0, 1, 2].map((i) => (
                <li
                  key={i}
                  className="h-[58px] animate-pulse rounded-xl border border-card-border bg-card"
                />
              ))}
            </ul>
          ) : stations.length === 0 ? (
            <EmptyOverlap message={importEmptyMessage} />
          ) : (
            <ul className="flex flex-col gap-2">
              {stations.map((s) => (
                <StationOverlapCard key={s.station.slug} item={s} />
              ))}
            </ul>
          )}
        </section>

        {/* Selectors section */}
        <section className="mb-10" data-testid="overlap-selectors">
          <div className="mb-4 flex items-baseline gap-3">
            <h2 className="font-serif text-xl font-semibold text-foreground">
              Selectors who share your taste
            </h2>
            {!pickersLoading && pickers.length > 0 && (
              <span className="font-mono text-xs text-muted-foreground">
                {pickers.length} found
              </span>
            )}
          </div>

          {pickersLoading || connLoading ? (
            <SkeletonCards />
          ) : pickers.length === 0 ? (
            <EmptyOverlap message={importEmptyMessage} />
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {pickers.map((p) => (
                <PickerOverlapCard key={p.picker.handle} item={p} />
              ))}
            </ul>
          )}
        </section>

        {/* Runs section */}
        <section data-testid="overlap-runs">
          <div className="mb-4 flex items-baseline gap-3">
            <h2 className="font-serif text-xl font-semibold text-foreground">
              Runs to ride
            </h2>
            {!runsLoading && runs.length > 0 && (
              <span className="font-mono text-xs text-muted-foreground">
                {runs.length} suggested
              </span>
            )}
          </div>

          {runsLoading || connLoading ? (
            <ul className="flex flex-col gap-2">
              {[0, 1, 2].map((i) => (
                <li
                  key={i}
                  className="h-[74px] animate-pulse rounded-xl border border-card-border bg-card"
                />
              ))}
            </ul>
          ) : runs.length === 0 ? (
            <EmptyOverlap message={importEmptyMessage} />
          ) : (
            <ul className="flex flex-col gap-2">
              {runs.map((r) => (
                <RunSuggestionCard key={`${r.runId}`} run={r} />
              ))}
            </ul>
          )}
        </section>

        <footer className="mt-16 border-t border-border pt-6 font-mono text-[11px] text-muted-foreground">
          Overlap is exact-MBID only — no similarity guessing. Lore never
          fabricates matches.
        </footer>
      </div>
    </div>
  );
}

function StationOverlapCard({ item }: { item: OverlapStation }) {
  const { station, sharedCount } = item;
  const classLabel =
    station.stationClass === "college"
      ? "College"
      : station.stationClass === "public"
        ? "Public"
        : station.stationClass === "curated"
          ? "Curated"
          : station.stationClass;

  return (
    <li data-testid={`station-overlap-${station.slug}`}>
      <div className="hover-elevate flex items-center gap-3 rounded-xl border border-card-border bg-card px-4 py-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#C6F53F]/20 bg-[#C6F53F]/5">
          <Antenna className="h-4 w-4 text-[#C6F53F]/70" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-serif text-base font-semibold text-foreground">
            {station.name}
          </p>
          <p className="truncate font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            {classLabel}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="font-mono text-sm">
            <span className="font-semibold text-[#C6F53F]">{sharedCount}</span>
            <span className="ml-1 text-xs text-muted-foreground">
              track{sharedCount === 1 ? "" : "s"}
            </span>
          </span>
          <Link
            href={`/archive/${station.slug}`}
            data-testid={`archive-${station.slug}`}
            className="hover-elevate inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground hover:border-primary-border hover:text-primary"
          >
            <Radio className="h-3 w-3" />
            archive
          </Link>
        </div>
      </div>
    </li>
  );
}

function SkeletonCards() {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <li
          key={i}
          className="h-32 animate-pulse rounded-xl border border-card-border bg-card"
        />
      ))}
    </ul>
  );
}

function ImportStatusBanner({
  job,
  onDismiss,
}: {
  job: { status: string; total: number; resolved: number; error: string | null };
  onDismiss: () => void;
}) {
  const isActive = job.status === "pending" || job.status === "running";
  const isDone = job.status === "done";
  const isError = job.status === "error";

  if (isError) {
    return (
      <div
        className="mb-8 flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-5 py-4"
        data-testid="import-banner"
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
        data-testid="import-banner"
      >
        <CheckCircle2 className="h-4 w-4 shrink-0 text-[#C6F53F]" />
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[11px] uppercase tracking-wide text-[#C6F53F]">
            Library imported
          </p>
          <p className="mt-0.5 font-serif text-base text-foreground">
            {job.resolved.toLocaleString()} track{job.resolved === 1 ? "" : "s"} matched —
            your taste map is ready below.
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
      data-testid="import-banner"
    >
      <div className="flex items-center justify-between gap-4 px-5 py-4">
        <div className="min-w-0">
          <p className="font-mono text-[11px] uppercase tracking-wide text-[#C6F53F]">
            {isActive ? "Reading your Spotify library…" : "Starting import…"}
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

function EmptyOverlap({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-card-border bg-card p-6 text-center">
      <Users className="mx-auto h-8 w-8 text-muted-foreground/40" />
      <p className="mx-auto mt-3 max-w-[40ch] font-mono text-xs text-muted-foreground">
        {message}
      </p>
    </div>
  );
}

function PickerOverlapCard({ item }: { item: OverlapPicker }) {
  const follows = useFollows();
  const followed = isFollowed(follows, "picker", item.picker.handle);

  const initials = item.picker.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <li
      className="flex flex-col gap-3 rounded-xl border border-card-border bg-card p-4"
      data-testid={`picker-overlap-${item.picker.handle}`}
    >
      <div className="flex items-start gap-3">
        {/* avatar initials */}
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#a78bfa]/30 bg-[#a78bfa]/10 font-serif text-base font-semibold text-[#a78bfa]">
          {initials || <Users className="h-4 w-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <Link
            href={`/archive/pickers/${item.picker.handle}`}
            className="truncate font-serif text-base font-semibold text-foreground hover:text-primary"
          >
            {item.picker.name}
          </Link>
          <p className="truncate font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            {item.picker.pickerType}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] text-muted-foreground">
          <span className="font-semibold text-[#C6F53F]">
            {item.sharedCount}
          </span>{" "}
          shared record{item.sharedCount === 1 ? "" : "s"}
        </span>
        <button
          type="button"
          onClick={() => toggleFollow("picker", item.picker.handle, item.picker.name)}
          data-testid={`follow-picker-${item.picker.handle}`}
          className={`hover-elevate inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wide transition-colors ${
            followed
              ? "border-primary-border bg-primary/10 text-primary"
              : "border-border bg-card text-muted-foreground"
          }`}
        >
          <UserCheck className="h-3 w-3" />
          {followed ? "Following" : "Follow"}
        </button>
      </div>
    </li>
  );
}

function RunSuggestionCard({ run }: { run: OverlapRun }) {
  const title = run.show?.name ?? "Station stream";
  const byline = run.show?.djName
    ? `${run.station.name} · ${run.show.djName}`
    : run.station.name;

  return (
    <li data-testid={`run-suggestion-${run.runId}`}>
      <div className="hover-elevate flex items-center gap-3 rounded-xl border border-card-border bg-card p-4">
        <div className="min-w-0 flex-1">
          <p className="truncate font-serif text-base font-semibold text-foreground">
            {title}
          </p>
          <p className="truncate font-mono text-[10px] uppercase tracking-wide text-[#a78bfa]">
            {byline}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <span className="inline-flex items-center rounded-full border border-[#C6F53F]/30 bg-[#C6F53F]/10 px-2 py-0.5 font-mono text-[10px] text-[#C6F53F]">
              {run.owned} you own
            </span>
            <span className="inline-flex items-center rounded-full border border-[#a78bfa]/30 bg-[#a78bfa]/10 px-2 py-0.5 font-mono text-[10px] text-[#a78bfa]">
              {run.discover} to discover
            </span>
          </div>
        </div>
        <Link
          href={`/archive/station-runs/${run.runId}?play=1`}
          data-testid={`ride-run-${run.runId}`}
          className="hover-elevate inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-primary-foreground hover:opacity-90"
        >
          <Radio className="h-3 w-3" />
          ride →
        </Link>
      </div>
    </li>
  );
}
