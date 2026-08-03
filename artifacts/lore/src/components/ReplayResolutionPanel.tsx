import { useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Search } from "lucide-react";
import {
  postStartReplayResolution,
  useReplayResolutionJob,
  type ReplayResolutionMissBreakdown,
} from "../lib/meHooks";

function missBreakdownSummary(breakdown: ReplayResolutionMissBreakdown): string | null {
  const parts: string[] = [];
  if (breakdown.noLinks > 0) {
    parts.push(
      `${breakdown.noLinks} track${breakdown.noLinks === 1 ? " isn't" : "s aren't"} on any streaming service`,
    );
  }
  if (breakdown.noRecording > 0) {
    parts.push(
      `${breakdown.noRecording} haven't been identified yet`,
    );
  }
  if (breakdown.noVector > 0) {
    parts.push(
      `${breakdown.noVector} couldn't be looked up`,
    );
  }
  return parts.length ? parts.join(" · ") : null;
}

/**
 * User-triggered Odesli resolution panel. Lets listeners kick off the
 * background service-link lookup and see a plain-language breakdown of why
 * some tracks couldn't be added to a streaming playlist.
 */
export function ReplayResolutionPanel({ replayId }: { replayId: number }) {
  const [jobId, setJobId] = useState<number | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const { data: job } = useReplayResolutionJob(jobId);

  async function start() {
    setStartError(null);
    setStarting(true);
    try {
      const created = await postStartReplayResolution(replayId);
      setJobId(created.id);
    } catch (err) {
      setStartError(err instanceof Error ? err.message : "Could not start resolution");
    } finally {
      setStarting(false);
    }
  }

  const isRunning =
    job && (job.status === "pending" || job.status === "running");
  const isDone = job?.status === "done";
  const isError = job?.status === "error";

  const breakdownSummary =
    isDone && job.missBreakdown ? missBreakdownSummary(job.missBreakdown) : null;

  return (
    <section
      aria-label="Resolve streaming links"
      className="mb-6 rounded-xl border border-card-border bg-card p-4"
      data-testid="replay-resolution"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Streaming availability
          </p>
          {!job ? (
            <p className="mt-1 text-sm text-muted-foreground">
              Look up which tracks are available on streaming services to build
              a playlist.
            </p>
          ) : isRunning ? (
            <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
              Checking{" "}
              {job.total > 0
                ? `${job.processed} of ${job.total} tracks…`
                : "tracks…"}
            </p>
          ) : isDone ? (
            <div className="mt-1">
              <p className="flex items-center gap-2 text-sm text-foreground">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary" />
                {job.resolved} of {job.total} tracks found on a streaming
                service
              </p>
              {breakdownSummary ? (
                <p
                  className="mt-1 text-xs text-muted-foreground"
                  data-testid="resolution-miss-breakdown"
                >
                  {breakdownSummary}
                </p>
              ) : null}
            </div>
          ) : isError ? (
            <p className="mt-1 flex items-center gap-2 text-sm text-destructive-foreground">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {job.error ?? "Resolution failed"}
            </p>
          ) : null}
          {startError ? (
            <p
              className="mt-2 text-xs text-destructive-foreground"
              role="alert"
            >
              {startError}
            </p>
          ) : null}
        </div>
        {!job || isError ? (
          <button
            type="button"
            disabled={starting}
            onClick={() => void start()}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-card-border px-3 py-2 font-mono text-[10px] uppercase tracking-wide text-foreground hover:border-primary hover:text-primary disabled:opacity-50"
            data-testid="resolve-tracks-button"
          >
            {starting ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Search className="h-3 w-3" />
            )}
            {isError ? "Retry" : "Check availability"}
          </button>
        ) : null}
      </div>
    </section>
  );
}
