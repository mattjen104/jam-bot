import { useState, useCallback } from "react";
import { usePlayer, type RideSeed } from "../player/PlayerProvider";
import { getRecordingAlbumTracks } from "@workspace/api-client-react";
import type { AlbumGroup } from "../pages/Library";
import type { LibraryItem } from "../lib/meHooks";
import { toast } from "../hooks/use-toast";
import { AlbumInvestigationSheet } from "./AlbumInvestigationSheet";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return "today";
    if (diffDays === 1) return "yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

/** Derive the most informative provenance phrase for an album header byline. */
function albumByline(items: LibraryItem[]): string | null {
  const item = items[0];
  if (!item) return null;
  const prov = item.provenance;
  if (prov.kind === "keep") {
    const station = prov.stationName ?? prov.stationSlug ?? null;
    const picker = prov.pickerName ?? prov.pickerHandle ?? null;
    // When multiple sources, note ambiguity
    const sources = new Set(
      items.map((i) => i.provenance.stationSlug ?? i.provenance.stationName ?? i.provenance.pickerHandle),
    );
    const hasMany = sources.size > 1;
    if (hasMany) return "kept from multiple sources";
    if (picker && station) return `via ${picker} · ${station}`;
    if (picker) return `via ${picker}`;
    if (station) return `kept on ${station}`;
    return "kept from Lore";
  }
  if (prov.kind === "import") {
    return prov.service ? `imported from ${prov.service}` : "imported";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Track sub-row
// ---------------------------------------------------------------------------

function TrackSubRow({ item }: { item: LibraryItem }) {
  const title = item.recording?.title ?? (item.mbid ? item.mbid.slice(0, 8) : "Unknown track");
  const prov = item.provenance;
  const stationName = prov.stationName ?? prov.stationSlug ?? null;
  const pickerName = prov.pickerName ?? prov.pickerHandle ?? null;
  const isSoft = item.soft === true;
  const isRemoved = item.removed === true;

  let provPart = "";
  if (prov.kind === "keep") {
    if (stationName && pickerName) provPart = `${stationName} · ${pickerName}`;
    else if (stationName) provPart = stationName;
    else if (pickerName) provPart = pickerName;
  } else if (prov.kind === "import" && prov.service) {
    provPart = prov.service;
  }

  const date = formatDate(item.addedAt);

  return (
    <div
      className="stack-row__track"
      data-testid="stack-track-row"
      style={{
        display: "flex",
        alignItems: "baseline",
        padding: "5px 15px 5px 55px",
        gap: 6,
        opacity: isRemoved ? 0.38 : isSoft ? 0.6 : 1,
        borderBottom: "1px solid hsl(var(--border) / 0.25)",
        fontFamily: "var(--app-font-mono)",
        fontSize: 12,
        color: isRemoved ? "hsl(var(--faint))" : "hsl(var(--foreground))",
      }}
    >
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        <span style={{ color: isRemoved ? "hsl(var(--faint))" : "hsl(var(--foreground))" }}>
          {title}
        </span>
        {provPart && (
          <>
            <span style={{ color: "hsl(var(--faint))", margin: "0 4px" }}>·</span>
            <span style={{ color: "hsl(var(--dim))" }}>{provPart}</span>
          </>
        )}
        {isRemoved && (
          <span style={{ color: "hsl(var(--faint))", marginLeft: 6, fontSize: 10 }}>removed</span>
        )}
      </span>
      <span style={{ color: "hsl(var(--faint))", fontSize: 10, flexShrink: 0, marginLeft: 8 }}>
        {date}
      </span>
    </div>
  );
}

// AlbumInvestigationStub removed — AlbumInvestigationSheet (Task 92) is used directly below.

// ---------------------------------------------------------------------------
// Launch button — plays the full album via the ride player
// ---------------------------------------------------------------------------

function useLaunchAlbum(group: AlbumGroup) {
  const { ride } = usePlayer();
  const [busy, setBusy] = useState(false);

  const firstMbid = group.items.find((i) => i.mbid != null)?.mbid ?? null;

  const launch = useCallback(async () => {
    if (!firstMbid) return;
    setBusy(true);
    try {
      const data = await getRecordingAlbumTracks(firstMbid);
      const seeds: RideSeed[] = data.tracks.map((t) => ({
        mbid: t.mbid,
        title: t.title,
        artist: t.artist,
        artworkUrl: null,
        links: [],
      }));
      if (seeds.length === 0) throw new Error("no tracks");
      const label = data.rgTitle ?? group.albumTitle;
      // Always use the universal ride player so the full album queue is
      // enqueued regardless of whether Spotify is connected. The ride player
      // itself resolves to Spotify, preview, or YouTube depending on the
      // listener's preferred service — consistent with ghost-set replay.
      ride.startReplay(seeds, label, { timeOrientation: "curated", context: "library" });
    } catch {
      toast({ title: "Couldn't load album — try again" });
    } finally {
      setBusy(false);
    }
  }, [firstMbid, group.albumTitle, ride]);

  return { launch, busy, canLaunch: firstMbid != null };
}

// ---------------------------------------------------------------------------
// Main StackRow component
// ---------------------------------------------------------------------------

export interface StackRowProps {
  group: AlbumGroup;
  /** True when investigation sources have been indexed for this album */
  hasInvestigation?: boolean;
  /** Propagated from parent for single-open coordination */
  isOpen: boolean;
  onToggle: () => void;
}

export function StackRow({ group, hasInvestigation = false, isOpen, onToggle }: StackRowProps) {
  const [investigationOpen, setInvestigationOpen] = useState(false);
  const { launch, busy, canLaunch } = useLaunchAlbum(group);

  const byline = albumByline(group.items);
  const keepCount = group.items.filter((i) => !i.removed).length;
  const totalCount = group.items.length;

  // Display label: prefer album title; fall back to "artist — unknown album"
  const albumDisplay = group.albumTitle || group.artist || "Unknown album";
  const artistDisplay = group.artist && group.albumTitle ? group.artist : "";

  return (
    <>
      {/* Row header */}
      <div data-testid="stack-album-row">
        {/* Collapsed header */}
        <div
          role="button"
          tabIndex={0}
          onClick={onToggle}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onToggle(); }}
          aria-expanded={isOpen}
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 0,
            padding: "9px 15px",
            cursor: "pointer",
            borderBottom: isOpen
              ? "1px solid hsl(var(--border) / 0.3)"
              : "1px solid hsl(var(--border) / 0.5)",
            background: isOpen ? "hsl(var(--secondary) / 0.6)" : "transparent",
            transition: "background 0.15s",
            userSelect: "none",
          }}
        >
          {/* Primary line */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontFamily: "var(--app-font-mono)",
                fontSize: 13,
                color: "hsl(var(--foreground))",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {/* Album title */}
              <span>{albumDisplay}</span>

              {/* ✳ coverage marker — only when investigation sources are indexed */}
              {hasInvestigation && (
                <button
                  type="button"
                  title="Album investigation sources available"
                  aria-label="Open album investigation"
                  onClick={(e) => {
                    e.stopPropagation();
                    setInvestigationOpen(true);
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    fontFamily: "var(--app-font-mono)",
                    fontSize: 11,
                    color: "hsl(var(--library))",
                    padding: "0 2px",
                    verticalAlign: "super",
                    lineHeight: 1,
                  }}
                >
                  ✳
                </button>
              )}

              {/* · artist */}
              {artistDisplay && (
                <>
                  <span style={{ color: "hsl(var(--faint))", margin: "0 6px" }}>·</span>
                  <span style={{ color: "hsl(var(--dim))" }}>{artistDisplay}</span>
                </>
              )}
            </div>

            {/* Byline */}
            {byline && (
              <div
                style={{
                  fontFamily: "var(--app-font-mono)",
                  fontSize: 10,
                  color: "hsl(var(--faint))",
                  marginTop: 3,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {byline}
              </div>
            )}
          </div>

          {/* Keep count */}
          <span
            style={{
              fontFamily: "var(--app-font-mono)",
              fontSize: 10,
              color: "hsl(var(--dim))",
              flexShrink: 0,
              marginLeft: 12,
              marginRight: 6,
            }}
          >
            {keepCount < totalCount
              ? `${keepCount}/${totalCount}`
              : totalCount}
          </span>

          {/* Chevron indicator */}
          <span
            aria-hidden="true"
            style={{
              fontFamily: "var(--app-font-mono)",
              fontSize: 10,
              color: "hsl(var(--faint))",
              flexShrink: 0,
            }}
          >
            {isOpen ? "▴" : "▾"}
          </span>
        </div>

        {/* Expanded body */}
        {isOpen && (
          <div data-testid="stack-album-expanded">
            {/* Track sub-rows */}
            {group.items.map((item, idx) => (
              <TrackSubRow
                key={item.mbid ?? `soft:${item.spotifyId ?? item.addedAt}:${idx}`}
                item={item}
              />
            ))}

            {/* Footer — Launch + Investigate */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "8px 15px",
                borderBottom: "1px solid hsl(var(--border) / 0.5)",
                background: "hsl(var(--secondary) / 0.3)",
              }}
            >
              {/* Launch button */}
              <button
                type="button"
                disabled={!canLaunch || busy}
                onClick={(e) => {
                  e.stopPropagation();
                  void launch();
                }}
                style={{
                  fontFamily: "var(--app-font-mono)",
                  fontSize: 11,
                  color: canLaunch && !busy ? "hsl(var(--library))" : "hsl(var(--faint))",
                  background: "none",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 3,
                  padding: "4px 10px",
                  cursor: canLaunch && !busy ? "pointer" : "default",
                  transition: "color 0.12s, border-color 0.12s",
                }}
                data-testid="stack-launch-btn"
                title={canLaunch ? "Launch full album" : "No playable tracks yet"}
              >
                {busy ? "…" : "▶ Launch album"}
              </button>

              {/* Investigate affordance */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setInvestigationOpen(true);
                }}
                style={{
                  fontFamily: "var(--app-font-mono)",
                  fontSize: 11,
                  color: hasInvestigation ? "hsl(var(--library))" : "hsl(var(--faint))",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: "4px 0",
                  display: "flex",
                  alignItems: "center",
                  gap: 3,
                }}
                data-testid="stack-investigate-btn"
                title="Open album investigation"
              >
                ↗ Investigate
                {hasInvestigation && <span style={{ fontSize: 9, color: "hsl(var(--library))" }}>✳</span>}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Album Investigation sheet */}
      {investigationOpen && (
        <AlbumInvestigationSheet
          group={group}
          onDismiss={() => setInvestigationOpen(false)}
        />
      )}
    </>
  );
}
