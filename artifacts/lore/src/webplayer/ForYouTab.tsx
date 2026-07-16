import { Radio, TrendingUp } from "lucide-react";
import { useWpForYou, type WpForYouRun } from "./hooks";
import { useIsAuthenticated, startSpotifyLibraryConnect } from "../lib/meHooks";

function OverlapBadge({ pct }: { pct: number }) {
  return (
    <span
      className="wp-mono"
      style={{
        fontSize: 11,
        fontWeight: 600,
        color: "var(--wp-text-success)",
        background: "var(--wp-bg-success)",
        padding: "3px 7px",
        borderRadius: 4,
        flexShrink: 0,
        letterSpacing: "0.04em",
      }}
    >
      {pct}%
    </span>
  );
}

function RunCard({
  run,
  onOpen,
}: {
  run: WpForYouRun;
  onOpen: () => void;
}) {
  const label = run.showName ?? run.stationName;
  const sub = [
    run.djName,
    run.stationName !== label ? run.stationName : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      style={{
        padding: "12px 14px",
        borderBottom: "0.5px solid var(--wp-border)",
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}
      data-testid={`wp-foryou-run-${run.runId}`}
    >
      {/* Overlap badge */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, flexShrink: 0 }}>
        <OverlapBadge pct={run.overlapPct} />
        <span style={{ fontSize: 10, color: "var(--wp-text-muted)" }}>overlap</span>
      </div>

      {/* Run info */}
      <button
        type="button"
        onClick={onOpen}
        style={{
          flex: 1,
          minWidth: 0,
          background: "none",
          border: "none",
          padding: 0,
          textAlign: "left",
          cursor: "pointer",
        }}
        aria-label={`Open run: ${label}`}
      >
        <p style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>
          {label}
          {run.djName && run.showName && (
            <span style={{ fontSize: 12, color: "var(--wp-text-muted)", fontWeight: 400 }}>
              {" "}· {run.djName}
            </span>
          )}
        </p>
        {sub && (
          <p style={{ margin: "1px 0 0", fontSize: 12, color: "var(--wp-text-muted)" }}>{sub}</p>
        )}
        <p className="wp-mono" style={{ margin: "4px 0 0", fontSize: 11, color: "var(--wp-text-secondary)" }}>
          {run.day} · {run.matchCount} of {run.totalResolved} resolved tracks
        </p>
      </button>

      {/* Station icon + arrow */}
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open run for ${label}`}
        style={{
          flexShrink: 0,
          background: "none",
          border: "none",
          padding: 4,
          cursor: "pointer",
          color: "var(--wp-text-muted)",
          display: "flex",
          alignItems: "center",
          gap: 4,
        }}
      >
        <Radio size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * "For You" shelf — top 5 past runs (last 90 days) ranked by what fraction
 * of their resolved spins overlap the user's Spotify library. Each card
 * opens that run's drawer directly at the right historical partition.
 */
export function ForYouTab({
  onOpenRun,
}: {
  onOpenRun: (slug: string, runId: number) => void;
}) {
  const isAuthenticated = useIsAuthenticated();
  const { data, isLoading, isError, refetch } = useWpForYou();
  const runs = data?.runs ?? [];

  if (isAuthenticated === false) {
    return (
      <div className="wp-card" style={{ padding: "18px 16px", textAlign: "center" }}>
        <TrendingUp
          size={28}
          aria-hidden="true"
          style={{ color: "var(--wp-text-muted)", marginBottom: 10 }}
        />
        <p style={{ margin: "0 0 10px", fontSize: 14, color: "var(--wp-text-secondary)" }}>
          Connect Spotify to see the runs that best match your taste — ranked
          by how much of your library they played.
        </p>
        <button
          type="button"
          onClick={() => void startSpotifyLibraryConnect()}
          style={{
            background: "var(--wp-fill-primary)",
            color: "var(--wp-on-primary)",
            border: "none",
            fontSize: 13,
            padding: "8px 16px",
          }}
          data-testid="wp-foryou-connect"
        >
          Connect Spotify
        </button>
      </div>
    );
  }

  return (
    <div className="wp-card" style={{ overflow: "hidden" }} data-testid="wp-foryou-tab">
      {/* Header hint */}
      <div
        style={{
          padding: "10px 14px 8px",
          borderBottom: "0.5px solid var(--wp-border)",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <TrendingUp size={13} style={{ color: "var(--wp-text-accent)", flexShrink: 0 }} aria-hidden="true" />
        <p className="wp-mono" style={{ margin: 0, fontSize: 11, color: "var(--wp-text-muted)", letterSpacing: "0.04em" }}>
          RUNS RANKED BY YOUR LIBRARY OVERLAP · LAST 90 DAYS
        </p>
      </div>

      {isLoading && (
        <p style={{ padding: "14px 16px", margin: 0, fontSize: 13, color: "var(--wp-text-muted)" }}>
          Finding your best runs…
        </p>
      )}

      {isError && !isLoading && (
        <div style={{ padding: "14px 16px" }} data-testid="foryou-error">
          <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--wp-text-muted)" }}>
            Couldn't load your runs — connection dropped or library not yet
            synced.
          </p>
          <button type="button" onClick={() => void refetch()} style={{ fontSize: 12 }}>
            Try again
          </button>
        </div>
      )}

      {!isLoading && !isError && runs.length === 0 && (
        <p style={{ padding: "14px 16px", margin: 0, fontSize: 13, color: "var(--wp-text-muted)" }}>
          No runs with your music found in the last 90 days — stations build
          history over time, check back soon.
        </p>
      )}

      {runs.map((run) => (
        <RunCard
          key={`${run.slug}-${run.day}-${run.runId}`}
          run={run}
          onOpen={() => onOpenRun(run.slug, run.runId)}
        />
      ))}
    </div>
  );
}
