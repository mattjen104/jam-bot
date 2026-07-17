import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Disc3, Radio, Loader2, Search, X } from "lucide-react";
import {
  useMyLibraryInfinite,
  useIsAuthenticated,
  startSpotifyLibraryConnect,
  type LibraryItem,
  type LibraryQueryOptions,
} from "../lib/meHooks";
import { useWpLoreCounts, useWpRecordingSpins, type WpSpinRow } from "./hooks";
import { LoreChip } from "./LoreChip";

function VinylIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="11" fill="#1a1a1a" />
      <circle cx="12" cy="12" r="9" fill="none" stroke="#3a3a3a" strokeWidth="0.7" />
      <circle cx="12" cy="12" r="7" fill="none" stroke="#2e2e2e" strokeWidth="0.7" />
      <circle cx="12" cy="12" r="5" fill="none" stroke="#3a3a3a" strokeWidth="0.7" />
      <circle cx="12" cy="12" r="3.2" fill="#c8a84b" />
      <circle cx="12" cy="12" r="1.1" fill="#1a1a1a" />
    </svg>
  );
}

function GhostIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 2C8.134 2 5 5.134 5 9v10.5l2-1.8 2 1.8 2-1.8 2 1.8 2-1.8 2 1.8V9c0-3.866-3.134-7-7-7z"
        fill="currentColor"
      />
      <circle cx="9.5" cy="10" r="1.2" fill="#1a1a1a" />
      <circle cx="14.5" cy="10" r="1.2" fill="#1a1a1a" />
    </svg>
  );
}

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
            <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--wp-text-secondary)" }}>
              {rec.albumTitle}
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
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          {rec?.spotifyUrl && rec?.albumTitle && (
            <a
              href={`https://open.spotify.com/search/${encodeURIComponent(rec.artist + " " + rec.albumTitle)}/albums`}
              target="_blank"
              rel="noopener noreferrer"
              title={`Play ${rec.albumTitle} on Spotify`}
              onClick={(e) => e.stopPropagation()}
              style={{
                width: 32,
                height: 32,
                borderRadius: "50%",
                background: "var(--wp-surface-2)",
                border: "1px solid var(--wp-border)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--wp-text-secondary)",
                flexShrink: 0,
              }}
            >
              <VinylIcon size={18} />
            </a>
          )}
          <button
            type="button"
            onClick={() => setShowRuns((v) => !v)}
            title={showRuns ? "Hide ghost radio runs" : "Ghost radio — hear in runs"}
            aria-expanded={showRuns}
            data-testid={`hear-in-runs-${item.mbid}`}
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              background: showRuns ? "var(--wp-accent, #7c3aed)" : "var(--wp-surface-2)",
              border: "1px solid var(--wp-border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: showRuns ? "#fff" : "var(--wp-text-secondary)",
              flexShrink: 0,
              padding: 0,
            }}
          >
            <GhostIcon size={17} />
          </button>
        </div>
      </div>
      {showRuns && <HearInRuns mbid={item.mbid} onOpenRun={onOpenRun} />}
    </div>
  );
}

/**
 * One page of library rows. Isolated as a component so each page batches its
 * own lore-counts request (≤ page size MBIDs) instead of capping chips at the
 * first N items overall.
 */
function LibraryPage({
  items,
  onOpenLore,
  onOpenRun,
}: {
  items: LibraryItem[];
  onOpenLore: (mbid: string) => void;
  onOpenRun: (slug: string, runId: number | null) => void;
}) {
  const { data: loreCounts } = useWpLoreCounts(items.map((i) => i.mbid));
  return (
    <>
      {items.map((item) => (
        <LibraryRow
          key={item.mbid}
          item={item}
          loreCounts={loreCounts}
          onOpenLore={onOpenLore}
          onOpenRun={onOpenRun}
        />
      ))}
    </>
  );
}

/**
 * Library tab — the user's kept/imported tracks with lore chips and a
 * "Hear in runs" expander that lists documented runs containing each
 * recording; tapping one opens that run's drawer. Pages load automatically
 * as you scroll (with a manual Load more fallback).
 */
export function LibraryTab({
  onOpenLore,
  onOpenRun,
}: {
  onOpenLore: (mbid: string) => void;
  onOpenRun: (slug: string, runId: number | null) => void;
}) {
  const isAuthenticated = useIsAuthenticated();
  const [searchInput, setSearchInput] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [sort, setSort] = useState<NonNullable<LibraryQueryOptions["sort"]>>("added");
  const [source, setSource] = useState<NonNullable<LibraryQueryOptions["source"]>>("");

  // Debounce search input so we don't refetch on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const hasFilters = debouncedQ !== "" || sort !== "added" || source !== "";
  const {
    data,
    isLoading,
    isFetching,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useMyLibraryInfinite({ q: debouncedQ, sort, source });
  const pages = data?.pages ?? [];
  const totalLoaded = pages.reduce((n, p) => n + p.items.length, 0);

  // Auto-load the next page when the sentinel scrolls into view.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !isFetchingNextPage) {
          void fetchNextPage();
        }
      },
      { rootMargin: "300px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

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

  const selectStyle: CSSProperties = {
    fontSize: 12,
    background: "var(--wp-surface-2)",
    color: "var(--wp-text-secondary)",
    border: "0.5px solid var(--wp-border)",
    borderRadius: 6,
    padding: "5px 6px",
  };

  return (
    <div className="wp-card" style={{ overflow: "hidden" }} data-testid="wp-library-tab">
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 8,
          padding: "10px 14px",
          borderBottom: "0.5px solid var(--wp-border)",
        }}
        data-testid="wp-library-controls"
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            flex: "1 1 160px",
            minWidth: 140,
            background: "var(--wp-surface-2)",
            border: "0.5px solid var(--wp-border)",
            borderRadius: 6,
            padding: "5px 8px",
          }}
        >
          <Search size={13} style={{ color: "var(--wp-text-muted)", flexShrink: 0 }} aria-hidden="true" />
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search title or artist…"
            aria-label="Search library"
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 13,
              background: "transparent",
              border: "none",
              outline: "none",
              color: "var(--wp-text)",
            }}
            data-testid="wp-library-search"
          />
          {searchInput !== "" && (
            <button
              type="button"
              onClick={() => setSearchInput("")}
              aria-label="Clear search"
              style={{
                display: "inline-flex",
                alignItems: "center",
                background: "transparent",
                border: "none",
                padding: 0,
                color: "var(--wp-text-muted)",
                cursor: "pointer",
              }}
              data-testid="wp-library-search-clear"
            >
              <X size={13} aria-hidden="true" />
            </button>
          )}
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as typeof sort)}
          aria-label="Sort library"
          style={selectStyle}
          data-testid="wp-library-sort"
        >
          <option value="added">Recently added</option>
          <option value="artist">Artist A–Z</option>
          <option value="title">Title A–Z</option>
        </select>
        <select
          value={source}
          onChange={(e) => setSource(e.target.value as typeof source)}
          aria-label="Filter by source"
          style={selectStyle}
          data-testid="wp-library-source"
        >
          <option value="">All sources</option>
          <option value="keep">Kept here</option>
          <option value="import">Imported</option>
        </select>
        {isFetching && !isLoading && !isFetchingNextPage && (
          <Loader2
            size={13}
            className="animate-spin"
            style={{ color: "var(--wp-text-muted)", flexShrink: 0 }}
            aria-label="Updating results"
          />
        )}
      </div>
      {isLoading && (
        <p style={{ padding: "14px 16px", margin: 0, fontSize: 13, color: "var(--wp-text-muted)" }}>
          Loading your library…
        </p>
      )}
      {!isLoading && totalLoaded === 0 && (
        <p
          style={{ padding: "14px 16px", margin: 0, fontSize: 13, color: "var(--wp-text-muted)" }}
          data-testid="wp-library-empty"
        >
          {hasFilters
            ? "No tracks match — try a different search or filter."
            : "Nothing kept yet — keep a track from the on-air list or import your Spotify library."}
        </p>
      )}
      {pages.map((page, i) => (
        <LibraryPage
          key={i}
          items={page.items}
          onOpenLore={onOpenLore}
          onOpenRun={onOpenRun}
        />
      ))}
      {hasNextPage && <div ref={sentinelRef} aria-hidden="true" />}
      {totalLoaded > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            padding: "12px 16px",
          }}
          data-testid="wp-library-footer"
        >
          {hasNextPage ? (
            <button
              type="button"
              onClick={() => void fetchNextPage()}
              disabled={isFetchingNextPage}
              style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6 }}
              data-testid="wp-library-load-more"
            >
              {isFetchingNextPage && (
                <Loader2 size={12} className="animate-spin" aria-hidden="true" />
              )}
              {isFetchingNextPage ? "Loading…" : "Load more"}
            </button>
          ) : (
            <p className="wp-mono" style={{ margin: 0, fontSize: 11, color: "var(--wp-text-muted)" }}>
              that's everything
            </p>
          )}
          <p className="wp-mono" style={{ margin: 0, fontSize: 11, color: "var(--wp-text-muted)" }}>
            {totalLoaded} loaded
          </p>
        </div>
      )}
    </div>
  );
}
