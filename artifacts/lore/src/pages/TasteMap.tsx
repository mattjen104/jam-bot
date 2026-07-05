import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { usePlayer } from "../player/PlayerProvider";
import {
  useMyOverlapPickers,
  useMyOverlapRuns,
  useImportJobStatus,
  postStartImport,
  startSpotifyLibraryConnect,
  useMyConnections,
  type OverlapPicker,
  type OverlapRun,
} from "../lib/meHooks";
import { toggleFollow, useFollows, isFollowed } from "../lib/local";
import {
  ArrowLeft,
  Loader2,
  Map,
  Music2,
  UserCheck,
  Users,
  Radio,
} from "lucide-react";

export default function TasteMap() {
  const { ride, radio } = usePlayer();
  const dockPadding = ride.active || radio.station ? "pb-32" : "pb-16";

  const [, setLocation] = useLocation();
  const [jobId, setJobId] = useState<number | null>(null);

  const { data: connections, isLoading: connLoading } = useMyConnections();
  const isAuthenticated = !connLoading && connections !== null;
  const hasSpotify =
    Array.isArray(connections) && connections.some((c) => c.service === "spotify");

  // Kick off an import if Spotify is connected but no jobId yet, and we just
  // landed here from the connect callback (via ?library=connected).
  const [importTriggered, setImportTriggered] = useState(false);
  useEffect(() => {
    if (!hasSpotify || importTriggered || jobId !== null) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("import") !== "1") return;
    setImportTriggered(true);
    postStartImport("spotify")
      .then((res) => setJobId(res.jobId))
      .catch(() => {});
  }, [hasSpotify, importTriggered, jobId]);

  const importJob = useImportJobStatus(jobId);
  const jobData = importJob.data;
  const importDone = jobData?.status === "done" || jobData?.status === "error";
  const showBanner = jobId !== null && !importDone;

  const { data: pickers = [], isLoading: pickersLoading } = useMyOverlapPickers();
  const { data: runs = [], isLoading: runsLoading } = useMyOverlapRuns();

  const [connectBusy, setConnectBusy] = useState(false);

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
          <h1 className="mt-3 font-serif text-4xl font-semibold leading-[1.05] text-foreground sm:text-5xl">
            Selectors who share your taste.
          </h1>
          <p className="mt-4 max-w-[52ch] text-base text-muted-foreground">
            Your Spotify library mapped to Lore's spine — every exact match
            surfaces a human whose picks overlap yours.
          </p>
        </header>

        {/* Import progress banner */}
        {showBanner && jobData && (
          <div
            className="mb-8 overflow-hidden rounded-xl border border-[#C6F53F]/30 bg-[#C6F53F]/10"
            data-testid="import-banner"
          >
            <div className="flex items-center justify-between gap-4 px-5 py-4">
              <div className="min-w-0">
                <p className="font-mono text-[11px] uppercase tracking-wide text-[#C6F53F]">
                  Reading your Spotify library
                </p>
                <p className="mt-1 font-serif text-xl font-semibold text-foreground">
                  {jobData.resolved.toLocaleString()} / ~{jobData.total.toLocaleString()}{" "}
                  <span className="text-base font-normal text-muted-foreground">
                    tracks resolved
                  </span>
                </p>
              </div>
              <Loader2 className="h-5 w-5 shrink-0 animate-spin text-[#C6F53F]" />
            </div>
            {jobData.total > 0 && (
              <div className="h-1 w-full bg-[#C6F53F]/10">
                <div
                  className="h-full bg-[#C6F53F]/60 transition-all duration-700"
                  style={{
                    width: `${Math.min(100, (jobData.resolved / jobData.total) * 100)}%`,
                  }}
                />
              </div>
            )}
          </div>
        )}

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
            <EmptyOverlap message="Your taste map fills as your library imports." />
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
            <EmptyOverlap message="Runs appear once library matching finds shared spins." />
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
