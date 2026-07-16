import { useState } from "react";
import { Disc3, Radio, Loader2, ExternalLink } from "lucide-react";
import {
  useMyLibrary,
  useIsAuthenticated,
  startSpotifyLibraryConnect,
  type LibraryItem,
} from "../lib/meHooks";
import { useWpLoreCounts, useWpRecordingSpins, type WpSpinRow } from "./hooks";
import { LoreChip } from "./LoreChip";

const LORE_BATCH_MAX = 60;

interface RunRef {
  runId: number | null;
  slug: string;
  stationName: string;
  showName: string | null;
  djName: string | null;
  day: string;
}

/** Group a recording's broadcast spins into distinct runs, newest first. */
function groupRuns(spins: WpSpinRow[]): RunRef[] {
  const seen = new Map<string, RunRef>();
  for (const s of spins) {
    if (!s.station) continue;
    const day = s.playedAt.slice(0, 10);
    const key = s.runId != null ? `run-${s.runId}` : `${s.station.slug}-${day}`;
    if (seen.has(key)) continue;
    seen.set(key, {
      runId: s.runId,
      slug: s.station.slug,
      stationName: s.station.name,
      showName: s.show?.name ?? null,
      djName: s.show?.djName ?? null,
      day,
    });
  }
  return [...seen.values()];
}

function HearInRuns({
  mbid,
  onOpenRun,
}: {
  mbid: string;
  onOpenRun: (slug: string, runId: number | null) => void;
}) {
  const { data, isLoading, isError, refetch } = useWpRecordingSpins(mbid);
  const runs = groupRuns(data?.spins ?? []).slice(0, 6);

  if (isError) {
    return (
      <p
        style={{ margin: "6px 0 2px", fontSize: 12, color: "var(--wp-text-muted)" }}
        data-testid="runs-error"
      >
        Couldn't load run history.{" "}
        <button type="button" onClick={() => void refetch()} style={{ fontSize: 12 }}>
          Try again
        </button>
      </p>
    );
  }
  if (isLoading) {
    return (
      <p
        style={{
          margin: "6px 0 2px",
          fontSize: 12,
          color: "var(--wp-text-muted)",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <Loader2 size={12} className="animate-spin" aria-hidden="true" /> finding runs…
      </p>
    );
  }
  if (runs.length === 0) {
    return (
      <p style={{ margin: "6px 0 2px", fontSize: 12, color: "var(--wp-text-muted)" }}>
        Not aired in any documented run yet.
      </p>
    );
  }
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "6px 0 2px" }}>
      {runs.map((r) => (
        <button
          key={`${r.runId ?? r.slug}-${r.day}`}
          type="button"
          onClick={() => onOpenRun(r.slug, r.runId)}
          style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 5 }}
          data-testid={`hear-run-${r.runId ?? r.slug}`}
        >
          <Radio size={12} aria-hidden="true" />
          {r.showName ?? r.stationName}
          {r.djName ? ` · ${r.djName}` : ""} · {r.day}
        </button>
      ))}
    </div>
  );
}

function LibraryRow({
  item,
  loreCounts,
  onOpenLore,
  onOpenRun,
}: {
  item: LibraryItem;
  loreCounts: Map<string, import("./hooks").WpLoreCount> | undefined;
  onOpenLore: (mbid: string) => void;
  onOpenRun: (slug: string, runId: number | null) => void;
}) {
  const [showRuns, setShowRuns] = useState(false);
  const rec = item.recording;

  return (
    <div
      style={{ padding: "10px 14px", borderBottom: "0.5px solid var(--wp-border)" }}
      data-testid={`wp-library-${item.mbid}`}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {rec?.artworkUrl ? (
          <img
            src={rec.artworkUrl}
            alt=""
            style={{ width: 36, height: 36, borderRadius: 6, objectFit: "cover", flexShrink: 0 }}
          />
        ) : (
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 6,
              background: "var(--wp-surface-2)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Disc3 size={16} style={{ color: "var(--wp-text-muted)" }} aria-hidden="true" />
          </div>
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={{ margin: 0, fontSize: 14 }}>
            {rec ? `${rec.artist} — ${rec.title}` : item.mbid}
          </p>
          {rec?.albumTitle && (
            <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--wp-text-secondary)", display: "flex", alignItems: "center", gap: 5 }}>
              {rec.albumTitle}
              {rec.spotifyUrl && (
                <a
                  href={`https://open.spotify.com/search/${encodeURIComponent(rec.artist + " " + rec.albumTitle)}/albums`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Find album on Spotify"
                  onClick={(e) => e.stopPropagation()}
                  style={{ color: "var(--wp-text-muted)", display: "inline-flex", alignItems: "center" }}
                >
                  <ExternalLink size={11} aria-hidden="true" />
                </a>
              )}
            </p>
          )}
          <p className="wp-mono" style={{ margin: "2px 0 0", fontSize: 11, color: "var(--wp-text-muted)" }}>
            kept {item.addedAt.slice(0, 10)}
            {item.provenance.kind === "station" && item.provenance.stationSlug
              ? ` · via ${item.provenance.stationSlug}`
              : item.provenance.service
                ? ` · via ${item.provenance.service}`
                : ""}
          </p>
        </div>
        <LoreChip count={loreCounts?.get(item.mbid)} onOpen={() => onOpenLore(item.mbid)} />
        <button
          type="button"
          onClick={() => setShowRuns((v) => !v)}
          style={{ fontSize: 12, whiteSpace: "nowrap" }}
          aria-expanded={showRuns}
          data-testid={`hear-in-runs-${item.mbid}`}
        >
          {showRuns ? "Hide runs" : "Hear in runs"}
        </button>
      </div>
      {showRuns && <HearInRuns mbid={item.mbid} onOpenRun={onOpenRun} />}
    </div>
  );
}

/**
 * Library tab — the user's kept/imported tracks with lore chips and a
 * "Hear in runs" expander that lists documented runs containing each
 * recording; tapping one opens that run's drawer.
 */
export function LibraryTab({
  onOpenLore,
  onOpenRun,
}: {
  onOpenLore: (mbid: string) => void;
  onOpenRun: (slug: string, runId: number | null) => void;
}) {
  const isAuthenticated = useIsAuthenticated();
  const { data, isLoading } = useMyLibrary();
  const items = data?.items ?? [];
  const { data: loreCounts } = useWpLoreCounts(
    items.slice(0, LORE_BATCH_MAX).map((i) => i.mbid),
  );

  if (isAuthenticated === false) {
    return (
      <div className="wp-card" style={{ padding: "18px 16px", textAlign: "center" }}>
        <p style={{ margin: "0 0 10px", fontSize: 14, color: "var(--wp-text-secondary)" }}>
          Connect Spotify to see your kept and imported tracks here — with their
          lore and the runs they aired in.
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
          data-testid="wp-library-connect"
        >
          Connect Spotify
        </button>
      </div>
    );
  }

  return (
    <div className="wp-card" style={{ overflow: "hidden" }} data-testid="wp-library-tab">
      {isLoading && (
        <p style={{ padding: "14px 16px", margin: 0, fontSize: 13, color: "var(--wp-text-muted)" }}>
          Loading your library…
        </p>
      )}
      {!isLoading && items.length === 0 && (
        <p style={{ padding: "14px 16px", margin: 0, fontSize: 13, color: "var(--wp-text-muted)" }}>
          Nothing kept yet — keep a track from the on-air list or import your
          Spotify library.
        </p>
      )}
      {items.map((item) => (
        <LibraryRow
          key={item.mbid}
          item={item}
          loreCounts={loreCounts}
          onOpenLore={onOpenLore}
          onOpenRun={onOpenRun}
        />
      ))}
    </div>
  );
}
