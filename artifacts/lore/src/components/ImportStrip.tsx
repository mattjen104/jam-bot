import { RefreshCw } from "lucide-react";
import { useLatestImportJob } from "../lib/meHooks";

/**
 * Site-wide import progress strip — visible while a Spotify library import
 * is running or pending. Renders nothing otherwise.
 */
export function ImportStrip() {
  const { data: job } = useLatestImportJob();
  if (!job || (job.status !== "running" && job.status !== "pending")) return null;

  const pct = job.total > 0 ? Math.round((100 * job.resolved) / job.total) : 0;

  return (
    <div
      className="flex items-center gap-3 border-b border-border px-4 py-2.5"
      style={{ background: "hsl(var(--card))" }}
      data-testid="import-strip"
    >
      <RefreshCw
        size={14}
        className="animate-spin shrink-0"
        style={{ color: "hsl(var(--primary))" }}
        aria-hidden="true"
      />
      <p className="flex-1 font-mono text-[11px] text-muted-foreground">
        {job.resumedFrom != null && job.phase !== "fetching"
          ? <>Resuming from previous session · {job.resolved.toLocaleString()} /{" "}
              {job.total.toLocaleString()} tracks resolved — matches update as we go</>
          : <>Reading your Spotify library · {job.resolved.toLocaleString()} /{" "}
              {job.total.toLocaleString()} tracks resolved — matches update as we go</>}
      </p>
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
