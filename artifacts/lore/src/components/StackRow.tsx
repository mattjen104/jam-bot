import { useState, useCallback } from "react";
import { usePlayer, type RideSeed } from "../player/PlayerProvider";
import { getRecordingAlbumTracks } from "@workspace/api-client-react";
import type { AlbumGroup } from "../pages/Library";
import type { LibraryItem } from "../lib/meHooks";
import { useMutationKeep } from "../lib/meHooks";
import { AlbumInvestigationSheet } from "./AlbumInvestigationSheet";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Track sub-row
// ---------------------------------------------------------------------------

function TrackSubRow({ item }: { item: LibraryItem }) {
  const title = item.recording?.title ?? (item.mbid ? item.mbid.slice(0, 8) : "Unknown track");
  const prov = item.provenance;
  const isSoft = item.soft === true;
  const isRemoved = item.removed === true;

  // Minimal secondary: station or service name only — no date, no "kept directly" filler.
  const stationName = prov.stationName ?? prov.stationSlug ?? null;
  const pickerName = prov.pickerName ?? prov.pickerHandle ?? null;
  let secondary = "";
  if (prov.kind === "keep") {
    secondary = stationName ?? pickerName ?? "";
  } else if (prov.kind === "import" && prov.service) {
    secondary = prov.service;
  }

  // Keep button only for resolved import tracks (not yet explicitly kept).
  const showKeep = item.mbid != null && prov.kind !== "keep" && !isSoft && !isRemoved;

  return (
    <div
      className="stack-row__track"
      data-testid="stack-track-row"
      style={{
        display: "flex",
        alignItems: "baseline",
        padding: "5px 15px 5px 30px",
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
        {secondary && (
          <>
            <span style={{ color: "hsl(var(--faint))", margin: "0 4px" }}>·</span>
            <span style={{ color: "hsl(var(--dim))" }}>{secondary}</span>
          </>
        )}
      </span>
      {showKeep && <TrackKeepBtn mbid={item.mbid!} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline keep button for import-kind tracks inside TrackSubRow
// ---------------------------------------------------------------------------

function TrackKeepBtn({ mbid }: { mbid: string }) {
  const keep = useMutationKeep();
  return (
    <button
      type="button"
      disabled={keep.isPending || keep.isSuccess}
      onClick={(e) => {
        e.stopPropagation();
        keep.mutate({ mbid });
      }}
      data-testid="track-keep-button"
      title="Keep this track in your Lore library"
      aria-label="Keep this track in your Lore library"
      style={{
        fontFamily: "var(--app-font-mono)",
        fontSize: 10,
        color: keep.isSuccess ? "hsl(var(--library))" : "hsl(var(--dim))",
        background: "none",
        border: `1px solid hsl(var(--border) / ${keep.isSuccess ? "0.6" : "0.4"})`,
        borderRadius: 3,
        padding: "1px 6px",
        cursor: keep.isPending || keep.isSuccess ? "default" : "pointer",
        flexShrink: 0,
        marginLeft: 6,
        opacity: keep.isPending ? 0.6 : 1,
        transition: "color 0.12s, border-color 0.12s",
      }}
    >
      {keep.isPending ? "…" : keep.isSuccess ? "✓ kept" : "keep"}
    </button>
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

  const launch = useCallback(async (): Promise<boolean> => {
    if (!firstMbid) return false;
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
      return true;
    } catch {
      return false;
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

  // Stack identity is album-first. When only one value is available, show it
  // without a dangling separator.
  const albumDisplay = group.albumTitle || "";
  const artistDisplay = group.artist || "";
  const identityParts = [albumDisplay, artistDisplay].filter(Boolean);
  const identity = identityParts.length > 0 ? identityParts : ["Unknown album"];

  return (
    <>
      {/* Row header */}
      <div data-testid="stack-album-row">
        {/* Collapsed header */}
        <div
          data-testid="stack-album-header"
          role="button"
          tabIndex={0}
          onClick={onToggle}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onToggle();
            }
          }}
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
            {/* Single-line Stack identity: album · artist */}
          <div
            style={{
              flex: 1,
              minWidth: 0,
              fontFamily: "var(--app-font-mono)",
              fontSize: 13,
              color: "hsl(var(--foreground))",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {identity.map((part, index) => (
              <span key={`${part}-${index}`}>
                {index > 0 && (
                  <span style={{ color: "hsl(var(--faint))", margin: "0 5px" }}>·</span>
                )}
                <span style={{ color: index === 0 ? "hsl(var(--foreground))" : "hsl(var(--dim))" }}>
                  {part}
                </span>
              </span>
            ))}
          </div>

          {/* Chevron indicator */}
          <span
            aria-hidden="true"
            style={{
              fontFamily: "var(--app-font-mono)",
              fontSize: 10,
              color: "hsl(var(--faint))",
              flexShrink: 0,
              marginLeft: 8,
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
                  void launch().then((ok) => {
                    if (!ok) setInvestigationOpen(true);
                  });
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
          onLaunch={canLaunch ? launch : undefined}
        />
      )}
    </>
  );
}
