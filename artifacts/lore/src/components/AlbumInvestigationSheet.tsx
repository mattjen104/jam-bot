import { useEffect, useRef, useCallback, useMemo } from "react";
import { ExternalLink, X, Play } from "lucide-react";
import { useQueries } from "@tanstack/react-query";
import {
  getRecordingKnowledge,
  getGetRecordingKnowledgeQueryKey,
  type TrackClaim,
} from "@workspace/api-client-react";
import { proxyArtUrl } from "../lib/proxyArt";
import { onArtError } from "../lib/rumours";
import type { AlbumGroup } from "../pages/Library";
import type { LibraryItem } from "../lib/meHooks";

// ---------------------------------------------------------------------------
// Source catalogue — every source Lore knows how to index per album
// ---------------------------------------------------------------------------

interface KnownSource {
  /** Matches claim.sourceHandle; also used as React key */
  id: string;
  label: string;
  type: string;
}

/** All sources Lore catalogues — some indexable today, some not yet scraped. */
export const ALL_KNOWN_SOURCES: KnownSource[] = [
  { id: "song-exploder",  label: "Song Exploder",     type: "Podcast interview"   },
  { id: "classic-albums", label: "Classic Albums",     type: "Documentary"         },
  { id: "genius",         label: "Genius",             type: "Lyrics & annotations"},
  { id: "wikipedia",      label: "Wikipedia",          type: "Critical summary"    },
  { id: "wikipedia-album",label: "Wikipedia",          type: "Album overview"      },
  { id: "beato",          label: "Rick Beato",         type: "Video essay"         },
  { id: "sound-on-sound", label: "Sound on Sound",     type: "Production profile"  },
  { id: "audiodb",        label: "TheAudioDB",           type: "Community review"    },
  { id: "pitchfork",      label: "Pitchfork",          type: "Review"              },
  { id: "allmusic",       label: "AllMusic",           type: "Review"              },
  { id: "metacritic",     label: "Metacritic",         type: "Critic aggregate"    },
  { id: "rym",            label: "Rate Your Music",    type: "Community rating"    },
];

const KNOWN_SOURCE_BY_ID = new Map(ALL_KNOWN_SOURCES.map((s) => [s.id, s]));

// ---------------------------------------------------------------------------
// Card types
// ---------------------------------------------------------------------------

export interface IndexedSourceCard {
  id: string;
  label: string;
  type: string;
  /** Up to two claim texts joined by space — never fabricated. */
  excerpt: string;
  url: string | null;
}

// ---------------------------------------------------------------------------
// Pure claim → card logic (exported for unit testing)
// ---------------------------------------------------------------------------

/**
 * Transforms published claims from one or more recording lookups into:
 *  - `indexed`: one card per unique sourceHandle that has ≥1 published claim
 *  - `notIndexed`: catalogued sources with no claims for this album
 */
export function buildInvestigationCards(claims: TrackClaim[]): {
  indexed: IndexedSourceCard[];
  notIndexed: KnownSource[];
} {
  const published = claims.filter(
    (c) => !c.status || c.status === "published",
  );

  // Group by sourceHandle, preserving insertion order
  const byHandle = new Map<string, TrackClaim[]>();
  for (const claim of published) {
    const arr = byHandle.get(claim.sourceHandle) ?? [];
    arr.push(claim);
    byHandle.set(claim.sourceHandle, arr);
  }

  const indexed: IndexedSourceCard[] = [];
  for (const [handle, handleClaims] of byHandle) {
    const first = handleClaims[0]!;
    const knownSrc = KNOWN_SOURCE_BY_ID.get(handle);
    indexed.push({
      id: handle,
      label: first.sourceLabel,
      type: knownSrc?.type ?? "Source",
      // Two sentences max from the claims for this source
      excerpt: handleClaims
        .slice(0, 2)
        .map((c) => c.text)
        .join(" "),
      url: first.sourceUrl || null,
    });
  }

  // Catalogued sources without any claims → "Not yet indexed"
  const indexedHandles = new Set(byHandle.keys());
  const notIndexed = ALL_KNOWN_SOURCES.filter((s) => !indexedHandles.has(s.id));

  return { indexed, notIndexed };
}

// ---------------------------------------------------------------------------
// Provenance helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function getMostRecentItem(items: LibraryItem[]): LibraryItem | null {
  return (
    [...items]
      .filter((item) => item.addedAt)
      .sort((a, b) => (b.addedAt > a.addedAt ? 1 : -1))[0] ?? null
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface AlbumInvestigationSheetProps {
  group: AlbumGroup;
  onDismiss: () => void;
  /** Optional: launch the album for playback from the sheet */
  onLaunch?: () => void;
}

// ---------------------------------------------------------------------------
// Sheet
// ---------------------------------------------------------------------------

export function AlbumInvestigationSheet({
  group,
  onDismiss,
  onLaunch,
}: AlbumInvestigationSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const swipeStartYRef = useRef<number | null>(null);
  const swipeDeltaRef = useRef<number>(0);

  // Deduplicated resolved MBIDs across all kept tracks in the group
  const resolvedMbids = useMemo(
    () => [
      ...new Set(
        group.items
          .map((i) => i.mbid)
          .filter((m): m is string => m !== null),
      ),
    ],
    [group.items],
  );

  // Parallel queries for every resolved recording in the album
  const queryResults = useQueries({
    queries: resolvedMbids.map((mbid) => ({
      queryKey: getGetRecordingKnowledgeQueryKey(mbid),
      queryFn: () => getRecordingKnowledge(mbid),
      staleTime: 10 * 60_000,
      gcTime: 30 * 60_000,
    })),
  });

  const isLoading = queryResults.some((r) => r.isLoading);
  // Aggregate claims from all recording lookups, then build cards
  const allClaims: TrackClaim[] = queryResults.flatMap(
    (r) => r.data?.claims ?? [],
  );
  const { indexed, notIndexed } = buildInvestigationCards(allClaims);

  // Dismiss on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onDismiss]);

  // Swipe-down to dismiss (handle only)
  const onHandlePointerDown = useCallback((e: React.PointerEvent) => {
    swipeStartYRef.current = e.clientY;
    swipeDeltaRef.current = 0;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onHandlePointerMove = useCallback((e: React.PointerEvent) => {
    if (swipeStartYRef.current === null) return;
    const delta = e.clientY - swipeStartYRef.current;
    if (delta > 0) {
      swipeDeltaRef.current = delta;
      if (sheetRef.current) {
        sheetRef.current.style.transform = `translateY(${delta}px)`;
        sheetRef.current.style.transition = "none";
      }
    }
  }, []);

  const onHandlePointerUp = useCallback(() => {
    if (swipeStartYRef.current === null) return;
    swipeStartYRef.current = null;
    if (swipeDeltaRef.current > 80) {
      onDismiss();
    } else {
      if (sheetRef.current) {
        sheetRef.current.style.transform = "";
        sheetRef.current.style.transition = "";
      }
    }
    swipeDeltaRef.current = 0;
  }, [onDismiss]);

  // Provenance
  const keepCount = group.items.length;
  const mostRecent = getMostRecentItem(group.items);
  const mostRecentStation =
    mostRecent?.provenance.stationName ??
    mostRecent?.provenance.stationSlug ??
    null;
  const mostRecentDate = mostRecent?.addedAt ? formatDate(mostRecent.addedAt) : null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="liner-sheet__backdrop"
        aria-hidden="true"
        onClick={onDismiss}
      />

      {/* Sheet */}
      <div
        ref={sheetRef}
        className="liner-sheet album-inv"
        role="dialog"
        aria-modal="true"
        aria-label={`Investigate ${group.albumTitle}`}
      >
        {/* Drag handle */}
        <div
          className="liner-sheet__handle"
          aria-hidden="true"
          onPointerDown={onHandlePointerDown}
          onPointerMove={onHandlePointerMove}
          onPointerUp={onHandlePointerUp}
          onPointerCancel={onHandlePointerUp}
        />

        {/* Header */}
        <div className="liner-sheet__header album-inv__header">
          {group.artworkUrl ? (
            <img
              src={proxyArtUrl(group.artworkUrl)!}
              alt=""
              className="liner-sheet__header-art"
              draggable={false}
              onError={onArtError}
            />
          ) : (
            <div className="liner-sheet__header-art liner-sheet__header-art--empty" />
          )}

          <div className="liner-sheet__header-copy">
            <strong className="liner-sheet__header-title">{group.albumTitle}</strong>
            <span className="liner-sheet__header-artist">{group.artist}</span>
          </div>

          <div className="album-inv__header-actions">
            {onLaunch && (
              <button
                type="button"
                className="album-inv__launch-btn"
                onClick={() => {
                  onDismiss();
                  onLaunch();
                }}
                aria-label={`Launch ${group.albumTitle}`}
                title="Launch album"
              >
                <Play aria-hidden="true" />
                <span>launch</span>
              </button>
            )}
            <button
              type="button"
              className="liner-sheet__close"
              onClick={onDismiss}
              aria-label="Close investigation sheet"
            >
              <X aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Provenance strip */}
        <div className="album-inv__provenance">
          <span className="album-inv__provenance-count">
            {keepCount} track{keepCount === 1 ? "" : "s"} kept
          </span>
          {(mostRecentStation || mostRecentDate) && (
            <>
              <span className="album-inv__provenance-dot" aria-hidden="true">·</span>
              {mostRecentStation && (
                <span className="album-inv__provenance-station">{mostRecentStation}</span>
              )}
              {mostRecentStation && mostRecentDate && (
                <span className="album-inv__provenance-dot" aria-hidden="true">·</span>
              )}
              {mostRecentDate && (
                <span className="album-inv__provenance-date">{mostRecentDate}</span>
              )}
            </>
          )}
        </div>

        {/* Body */}
        <div className="liner-sheet__body">
          {isLoading ? (
            <div className="liner-sheet__skeleton-wrap">
              {[0, 1, 2].map((i) => (
                <div key={i} className="liner-sheet__skeleton-row" />
              ))}
            </div>
          ) : (
            <>
              {/* ── Indexed sources ── */}
              <div className="liner-sheet__section">
                <p className="liner-sheet__section-label">Sources</p>

                {indexed.length > 0 ? (
                  <ul className="album-inv__card-list" data-testid="album-inv-indexed">
                    {indexed.map((src) => (
                      <li key={src.id} className="album-inv__card">
                        <div className="album-inv__card-header">
                          <span className="album-inv__card-label">{src.label}</span>
                          <span className="album-inv__card-sep" aria-hidden="true">·</span>
                          <span className="album-inv__card-type">{src.type}</span>
                          {src.url && (
                            <a
                              href={src.url}
                              target="_blank"
                              rel="noreferrer"
                              className="album-inv__card-link"
                              aria-label={`Open ${src.label}`}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <ExternalLink aria-hidden="true" />
                            </a>
                          )}
                        </div>
                        {src.excerpt && (
                          <p className="album-inv__card-excerpt">{src.excerpt}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="liner-sheet__empty album-inv__no-sources">
                    No indexed sources yet for this album
                  </p>
                )}
              </div>

              {/* ── Not yet indexed ── */}
              {notIndexed.length > 0 && (
                <div className="liner-sheet__section">
                  <p className="liner-sheet__section-label album-inv__pending-label">
                    Not yet indexed
                  </p>
                  <ul className="album-inv__pending-list" data-testid="album-inv-pending">
                    {notIndexed.map((src) => (
                      <li key={src.id} className="album-inv__pending-item">
                        <span className="album-inv__pending-source">{src.label}</span>
                        <span className="album-inv__pending-type">{src.type}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="album-inv__pending-hint">
                    Will appear here when Lore indexes them
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
