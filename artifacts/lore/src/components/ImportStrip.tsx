import type { ImportJobStatus } from "../lib/meHooks";
import { useLatestImportJob } from "../lib/meHooks";

/** Animated EQ bars — music-indexed loading indicator.
 *  Uses the lore-eq-bar CSS animation defined in index.css so the
 *  import strip feels distinct from the generic skeleton pulse. */
function ImportEqBars() {
  const bars = [
    { delay: "0ms",    height: 10 },
    { delay: "160ms",  height: 14 },
    { delay: "320ms",  height: 8  },
    { delay: "80ms",   height: 12 },
  ];
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-end gap-px"
      style={{ height: 14, width: 16 }}
    >
      {bars.map((b, i) => (
        <span
          key={i}
          className="lore-eq-bar inline-block rounded-sm"
          style={{
            width: 3,
            height: b.height,
            background: "hsl(var(--primary))",
            animationDelay: b.delay,
          }}
        />
      ))}
    </span>
  );
}

function phaseLabel(job: ImportJobStatus): string {
  const isManual = job.service === "manual";
  const isLB = job.service === "listenbrainz";
  switch (job.phase) {
    case "fetching":
      if (isManual) return "Preparing track list…";
      if (isLB) return "Importing from ListenBrainz…";
      return "Importing your library…";
    case "spine":
      return isManual ? "Preparing track list…" : "Building track index…";
    case "cache":    return "Loading cached matches…";
    case "resolve":  return "Matching tracks…";
    default:
      if (isManual) return "Preparing track list…";
      if (isLB) return "Importing from ListenBrainz…";
      return "Importing your library…";
  }
}

/** True when this job is a continuation of a previous run (e.g. after a server reboot). */
function isResumed(job: ImportJobStatus): boolean {
  return job.resumedFrom != null;
}

/**
 * Site-wide import progress strip — visible while an import is running or
 * pending. Completion is deliberately silent: the dial gets that room back.
 * Renders nothing otherwise.
 */
export function ImportStrip({ onAddMore: _onAddMore }: { onAddMore?: () => void }) {
  const { data: job } = useLatestImportJob();

  if (!job) return null;

  const isActive = job.status === "running" || job.status === "pending";

  if (!isActive) return null;

  const pct = job.total > 0 ? Math.round((100 * job.resolved) / job.total) : 0;

  return (
    <div
      className="flex items-center gap-3 border-b border-border px-4 py-2.5"
      style={{ background: "hsl(var(--card))" }}
      data-testid="import-strip"
    >
      <ImportEqBars />
      <div className="flex flex-1 flex-col gap-0.5 min-w-0">
        <div className="flex items-center gap-2">
          {isResumed(job) && (
            <span
              className="shrink-0 rounded-sm px-1 font-mono text-[12px] font-normal leading-[1.6]"
              style={{
                background: "hsl(var(--primary) / 0.12)",
                color: "hsl(var(--primary))",
              }}
              data-testid="import-resuming-badge"
            >
              Resuming
            </span>
          )}
          <p className="font-mono text-[13px] text-muted-foreground truncate">
            {phaseLabel(job)} · {job.resolved.toLocaleString()} /{" "}
            {job.total.toLocaleString()} tracks resolved — matches update as we go
          </p>
        </div>
        {isResumed(job) && (
          <p className="font-mono text-[12px]" style={{ color: "hsl(var(--faint))" }}>
            Picked up where it left off — no tracks lost
          </p>
        )}
      </div>
      <div
        className="shrink-0 overflow-hidden rounded-sm"
        style={{ width: 80, height: 3, background: "hsl(var(--border))" }}
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: "hsl(var(--primary))",
            transition: "width 0.5s ease",
          }}
        />
      </div>
    </div>
  );
}
