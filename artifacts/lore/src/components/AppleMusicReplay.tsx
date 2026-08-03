import type { AppleMusicReplayMaterialization } from "@workspace/api-client-react";
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Music2,
  Pause,
  Play,
  RotateCw,
  Square,
  XCircle,
} from "lucide-react";
import { useAppleMusicReplay } from "../player/useAppleMusicReplay";

function coverageLabel(status: string): string {
  if (status === "available") return "available";
  if (status === "dead") return "dead link";
  if (status === "unresolved") return "never resolved";
  return "not found";
}

export function AppleMusicReplay({
  materialization,
}: {
  materialization: AppleMusicReplayMaterialization | undefined;
}) {
  const apple = useAppleMusicReplay(materialization);
  const loading =
    apple.status === "authorizing" || apple.status === "loading";
  const active =
    apple.status === "playing" ||
    apple.status === "paused" ||
    apple.status === "authorizing" ||
    apple.status === "loading";

  return (
    <section
      className="mb-6 rounded-xl border border-card-border bg-card p-4"
      data-testid="apple-music-replay"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-primary">
            <Music2 className="h-3.5 w-3.5" />
            Apple Music reconstruction
          </div>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Apple Music plays the identified tracks in the broadcast order.
            Lore does not host, copy, or recreate the original broadcast audio.
          </p>
        </div>
        {!active ? (
          <button
            type="button"
            onClick={apple.status === "error" ? apple.retry : apple.start}
            disabled={!materialization?.configured || apple.availableCount === 0}
            className="hover-elevate inline-flex items-center gap-2 rounded-full border border-primary-border bg-primary px-4 py-2 font-mono text-xs uppercase tracking-wide text-primary-foreground disabled:opacity-40"
            data-testid="apple-music-start"
          >
            {apple.status === "error" ? (
              <RotateCw className="h-3.5 w-3.5" />
            ) : (
              <Play className="h-3.5 w-3.5 fill-current" />
            )}
            {apple.status === "error" ? "Try Apple Music again" : "Play with Apple Music"}
          </button>
        ) : (
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={apple.previous} aria-label="Previous Apple Music track" className="rounded-full border border-border p-2 text-muted-foreground hover:text-foreground">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button type="button" onClick={apple.togglePause} aria-label={apple.status === "playing" ? "Pause Apple Music replay" : "Resume Apple Music replay"} className="rounded-full border border-primary-border bg-primary p-2 text-primary-foreground">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : apple.status === "playing" ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current" />}
            </button>
            <button type="button" onClick={apple.next} aria-label="Next Apple Music track" className="rounded-full border border-border p-2 text-muted-foreground hover:text-foreground">
              <ChevronRight className="h-4 w-4" />
            </button>
            <button type="button" onClick={apple.stop} aria-label="Stop Apple Music replay" className="rounded-full border border-border p-2 text-muted-foreground hover:text-foreground">
              <Square className="h-3.5 w-3.5 fill-current" />
            </button>
          </div>
        )}
      </div>

      {apple.message ? (
        <p
          className="mt-3 flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground"
          data-testid="apple-music-status"
        >
          {apple.status === "error" ? <AlertTriangle className="h-3.5 w-3.5 text-destructive" /> : null}
          {apple.message}
        </p>
      ) : materialization?.configured ? (
        <p className="mt-3 font-mono text-[11px] text-muted-foreground" data-testid="apple-music-status">
          {apple.status === "completed"
            ? "Apple Music replay complete."
            : apple.currentEntry
              ? `Playing ${apple.currentEntry.position + 1} of ${materialization.entries.length} · ${apple.currentEntry.title}`
              : `${apple.availableCount} of ${materialization.entries.length} entries available · Apple Music authorization starts playback`}
        </p>
      ) : (
        <p className="mt-3 font-mono text-[11px] text-muted-foreground" data-testid="apple-music-status">
          Apple Music playback is not configured on this Lore server.
        </p>
      )}

      <div className="mt-4 border-t border-border/60 pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Coverage receipt · {materialization?.coverage.available ?? 0} available
          </p>
          <p className="font-mono text-[10px] text-muted-foreground">
            {materialization?.coverage.unavailable ?? 0} unavailable ·{" "}
            {materialization?.coverage.unresolved ?? 0} unresolved ·{" "}
            {materialization?.coverage.dead ?? 0} dead
          </p>
        </div>
        <ol className="mt-2 grid gap-1 sm:grid-cols-2" data-testid="apple-music-coverage">
          {(materialization?.entries ?? []).map((entry) => {
            const available = entry.status === "available";
            return (
              <li
                key={`${entry.position}-${entry.spinId}`}
                className="flex items-center gap-2 rounded-md border border-border/50 px-2 py-1.5"
              >
                {available ? (
                  <Check className="h-3 w-3 shrink-0 text-primary" />
                ) : entry.status === "dead" ? (
                  <XCircle className="h-3 w-3 shrink-0 text-muted-foreground" />
                ) : (
                  <AlertTriangle className="h-3 w-3 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground">
                  {entry.position + 1}. {entry.artist} — {entry.title}
                </span>
                <span className="shrink-0 font-mono text-[9px] uppercase tracking-wide text-muted-foreground/70">
                  {coverageLabel(entry.status)}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}