import { useState } from "react";
import { Radio, TrendingUp, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { useWpForYou, useWpRun, useWpLoreCounts, type WpForYouRun, type WpRunSpin } from "./hooks";
import { useIsAuthenticated, startSpotifyLibraryConnect } from "../lib/meHooks";
import { LoreChip } from "./LoreChip";

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

/** Inline tracklist for an expanded run card. */
function RunTrackList({
  slug,
  runId,
  onOpenLore,
}: {
  slug: string;
  runId: number;
  onOpenLore: (mbid: string) => void;
}) {
  const { data, isLoading, isError } = useWpRun(slug, runId);

  if (isLoading) {
    return (
      <div
        style={{
          padding: "10px 14px",
          display: "flex",
          alignItems: "center",
          gap: 6,
          color: "var(--wp-text-muted)",
          fontSize: 12,
        }}
      >
        <Loader2 size={12} className="animate-spin" aria-hidden="true" />
        Loading tracks…
      </div>
    );
  }

  if (isError || !data) {
    return (
      <p style={{ padding: "8px 14px", margin: 0, fontSize: 12, color: "var(--wp-text-muted)" }}>
        Couldn't load tracks.
      </p>
    );
  }

  // Combine and sort chronologically so the list mirrors broadcast order.
  const all: WpRunSpin[] = [...data.fromLibrary, ...data.newToYou].sort(
    (a, b) => a.playedAt.localeCompare(b.playedAt),
  );

  // Batch lore counts for all resolved MBIDs in this run.
  const resolvedMbids = all.map((s) => s.mbid).filter((m): m is string => m != null);
  const { data: loreCounts } = useWpLoreCounts(resolvedMbids);

  if (all.length === 0) {
    return (
      <p style={{ padding: "8px 14px", margin: 0, fontSize: 12, color: "var(--wp-text-muted)" }}>
        No resolved tracks in this run yet.
      </p>
    );
  }

  return (
    <div
      style={{
        background: "var(--wp-surface-2)",
        borderTop: "0.5px solid var(--wp-border)",
      }}
    >
      {all.map((spin, i) => (
        <div
          key={`${spin.mbid ?? spin.title}-${i}`}
          style={{
            padding: "6px 14px",
            display: "flex",
            alignItems: "center",
            gap: 8,
            borderBottom: i < all.length - 1 ? "0.5px solid var(--wp-border)" : "none",
          }}
        >
          {spin.artworkUrl ? (
            <img
              src={spin.artworkUrl}
              alt=""
              style={{ width: 24, height: 24, borderRadius: 3, objectFit: "cover", flexShrink: 0 }}
            />
          ) : (
            <div
              style={{
                width: 24,
                height: 24,
                borderRadius: 3,
                background: "var(--wp-surface-3, var(--wp-border))",
                flexShrink: 0,
              }}
            />
          )}
          <p
            style={{
              margin: 0,
              fontSize: 12,
              flex: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              color: spin.inLibrary ? "var(--wp-text-success)" : "var(--wp-text-primary)",
            }}
          >
            {spin.artist} — {spin.title}
          </p>
          {spin.mbid && (
            <LoreChip
              count={loreCounts?.get(spin.mbid)}
              onOpen={() => onOpenLore(spin.mbid!)}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function RunCard({
  run,
  onOpen,
  onOpenLore,
}: {
  run: WpForYouRun;
  onOpen: () => void;
  onOpenLore: (mbid: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const label = run.showName ?? run.stationName;
  const sub = [
    run.djName,
    run.stationName !== label ? run.stationName : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      style={{ borderBottom: "0.5px solid var(--wp-border)" }}
      data-testid={`wp-foryou-run-${run.runId}`}
    >
      {/* Card header row */}
      <div style={{ padding: "12px 14px", display: "flex", alignItems: "center", gap: 12 }}>
        {/* Overlap badge */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, flexShrink: 0 }}>
          <OverlapBadge pct={run.overlapPct} />
          <span style={{ fontSize: 10, color: "var(--wp-text-muted)" }}>overlap</span>
        </div>

        {/* Run info — clicking opens the full run drawer */}
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

        {/* Expand tracklist toggle */}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={expanded ? "Hide tracks" : "Show tracks"}
          style={{
            flexShrink: 0,
            background: "none",
            border: "none",
            padding: 4,
            cursor: "pointer",
            color: "var(--wp-text-muted)",
            display: "flex",
            alignItems: "center",
            gap: 3,
          }}
        >
          <Radio size={13} aria-hidden="true" />
          {expanded ? <ChevronUp size={13} aria-hidden="true" /> : <ChevronDown size={13} aria-hidden="true" />}
        </button>
      </div>

      {/* Inline tracklist (lazy — only fetches on first expand) */}
      {expanded && <RunTrackList slug={run.slug} runId={run.runId} onOpenLore={onOpenLore} />}
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
  onOpenLore,
}: {
  onOpenRun: (slug: string, runId: number) => void;
  onOpenLore: (mbid: string) => void;
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
          onOpenLore={onOpenLore}
        />
      ))}
    </div>
  );
}
