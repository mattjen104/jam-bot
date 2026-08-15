/**
 * CompactStack — the bottom band of the SplitHome layout.
 *
 * Shows the 5 newest kept album groups from the listener's combined
 * kept + Spotify-imported library (first page of useMyLibraryInfinite,
 * grouped with buildAlbumGroups). Each collapsed row is a single line —
 * `album title · artist · <relationship credit>` — over that album's own
 * STATIONARY full-bleed cover art (no motion while collapsed). The third
 * segment is the album's MusicBrainz relationship line (samples / covers /
 * remixes), the most crucial piece of liner-note metadata, omitted cleanly
 * when the knowledge layer has none.
 *
 * Tapping a row expands it IN PLACE inside the band: the tapped album's row
 * becomes a collapse header, its liner-notes metadata (pressing, credits,
 * relationships, claims, books) grows directly below it as individual card
 * rows over that album's own backdrop art (which pans cinematically once
 * loaded), and the remaining compact rows follow underneath. The whole band
 * then scrolls as one column — the mini feed and the CLI strip above never
 * unmount or shift. A `→ Stack` link jumps to the album in the full Stack.
 * Tapping the expanded header collapses back to the plain five-row list
 * (and the art freezes again).
 *
 * Albums imported without artwork fall back to the Cover Art Archive
 * release-group front image derived from the recording's releaseGroupMbid.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type SyntheticEvent,
} from "react";
import { useLocation } from "wouter";
import { useQueries } from "@tanstack/react-query";
import { ArrowRight, ExternalLink } from "lucide-react";
import {
  getRecordingKnowledge,
  getGetRecordingKnowledgeQueryKey,
  getRecordingAlbumTracks,
  type TrackKnowledge,
  type TrackClaim,
} from "@workspace/api-client-react";
import { useMyLibraryInfinite } from "../lib/meHooks";
import { buildAlbumGroups, type AlbumGroup } from "../pages/Library";
import { buildLinerGroups, type LinerGroup } from "../lib/linerNotes";
import { proxyArtUrl } from "../lib/proxyArt";
import { onArtError } from "../lib/rumours";
import { usePlayer, type RideSeed } from "../player/PlayerProvider";
import { CompactPlayButton } from "./CompactPlayButton";

const COMPACT_STACK_SIZE = 5;

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

/**
 * The inline relationship credit for a collapsed row: the first typed
 * MusicBrainz song relationship, rendered exactly like the liner-notes
 * RELATIONSHIPS row ("samples — Title (Artist)"). Null when the knowledge
 * layer has none — the row then degrades to `album · artist`.
 */
export function relationshipCredit(
  knowledge: TrackKnowledge | null | undefined,
): string | null {
  const rel = knowledge?.relationships?.[0];
  if (!rel) return null;
  return rel.title
    ? `${rel.label} — ${rel.title}${rel.artist ? ` (${rel.artist})` : ""}`
    : rel.label;
}

/**
 * Spine artwork for a group: the group's own artwork when present,
 * otherwise the Cover Art Archive release-group front image derived from
 * the newest item that carries a releaseGroupMbid (imports whose art was
 * never resolved). Null when neither exists.
 */
export function spineArtUrl(group: AlbumGroup): string | null {
  if (group.artworkUrl) return group.artworkUrl;
  for (const item of group.items) {
    const rg = item.recording?.releaseGroupMbid;
    if (rg) return `https://coverartarchive.org/release-group/${rg}/front-1200`;
  }
  return null;
}

/** Reorder so the expanded group leads; identity when nothing is expanded. */
export function orderForExpansion(
  groups: AlbumGroup[],
  expandedKey: string | null,
): AlbumGroup[] {
  if (!expandedKey) return groups;
  const idx = groups.findIndex((g) => g.key === expandedKey);
  if (idx <= 0) return groups;
  return [groups[idx], ...groups.slice(0, idx), ...groups.slice(idx + 1)];
}

/** Newest resolved recording MBID in a group, for the collapsed credit. */
export function primaryMbid(group: AlbumGroup): string | null {
  return group.items.find((i) => i.mbid !== null)?.mbid ?? null;
}

/** All distinct resolved MBIDs in a group, for the expanded metadata. */
export function groupMbids(group: AlbumGroup): string[] {
  return [
    ...new Set(
      group.items.map((i) => i.mbid).filter((m): m is string => m !== null),
    ),
  ];
}

/**
 * Merge per-recording knowledge + claims into one set of liner groups for
 * the album: the richest knowledge wins (most relationships + personnel),
 * claims are aggregated across recordings and deduped by text.
 */
export function buildAlbumLinerGroups(
  results: Array<{ knowledge: TrackKnowledge | null; claims: TrackClaim[] }>,
): LinerGroup[] {
  let best: TrackKnowledge | null = null;
  let bestScore = -1;
  for (const r of results) {
    if (!r.knowledge) continue;
    const score =
      (r.knowledge.personnel?.length ?? 0) +
      (r.knowledge.relationships?.length ?? 0) +
      (r.knowledge.pressing ? 1 : 0);
    if (score > bestScore) {
      best = r.knowledge;
      bestScore = score;
    }
  }
  const seen = new Set<string>();
  const claims: TrackClaim[] = [];
  for (const r of results) {
    for (const c of r.claims) {
      if (seen.has(c.text)) continue;
      seen.add(c.text);
      claims.push(c);
    }
  }
  return buildLinerGroups(best, claims);
}

function CompactStackBackdrop({ art }: { art: string | null }) {
  const [canPan, setCanPan] = useState(false);

  const handleLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget;
    const container = image.parentElement?.getBoundingClientRect();
    if (!container) return;

    // The class is only added from onLoad, so an image can never animate
    // while it is still loading. object-position can then reveal the portions
    // of the high-resolution cover that overflow the hero window, one very
    // slow corner-to-corner round trip at a time.
    setCanPan(
      image.naturalWidth > container.width ||
        image.naturalHeight > container.height,
    );
  };

  const handleError = (event: SyntheticEvent<HTMLImageElement>) => {
    setCanPan(false);
    onArtError(event);
  };

  if (!art) return null;

  return (
    <img
      key={art}
      className={`compact-stack__backdrop-art${canPan ? " compact-stack__backdrop-art--pan" : ""}`}
      src={art}
      alt=""
      aria-hidden="true"
      loading="eager"
      onLoad={handleLoad}
      onError={handleError}
    />
  );
}

/**
 * Album replay controls for the compact Stack row. This intentionally mirrors
 * StackRow's full-album launch path, while retaining the resolved label so
 * replay labels supplied by MusicBrainz still identify this row as active.
 */
export function useAlbumPlay(group: AlbumGroup) {
  const { ride } = usePlayer();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [resolvedLabel, setResolvedLabel] = useState<string | null>(null);
  const mbid = primaryMbid(group);
  const sessionLabels = [group.albumTitle, resolvedLabel].filter(
    (label): label is string => label != null,
  );
  const isThisAlbum = ride.active && sessionLabels.includes(ride.replayLabel ?? "");

  const launch = useCallback(async () => {
    if (!mbid) return false;
    // Single-flight: never fire a second album-tracks request (and a second
    // startReplay) while one is already in flight for this row.
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    try {
      const data = await getRecordingAlbumTracks(mbid);
      const seeds: RideSeed[] = data.tracks.map((track) => ({
        mbid: track.mbid,
        title: track.title,
        artist: track.artist,
        artworkUrl: null,
        links: [],
      }));
      if (seeds.length === 0) throw new Error("no tracks");
      const label = data.rgTitle ?? group.albumTitle;
      setResolvedLabel(label);
      ride.startReplay(seeds, label, {
        timeOrientation: "curated",
        context: "library",
      });
      return true;
    } catch {
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [group.albumTitle, mbid, ride]);

  const isPlaying = isThisAlbum && ride.status === "playing";
  // Loading covers both this row's own in-flight album-tracks request (busy)
  // and the provider-reported buffering of this album's replay session.
  const isLoading = busy || (isThisAlbum && ride.status === "loading");
  const togglePause = useCallback(() => {
    ride.togglePause();
  }, [ride]);

  return {
    launch,
    busy,
    canLaunch: mbid != null,
    /** True when this album is the active ride session (any status). */
    isActive: isThisAlbum,
    isPlaying,
    isLoading,
    togglePause,
  };
}

/**
 * The expanded album's header row: tapping it collapses back to the list,
 * and it carries the same triangle play control as the collapsed rows so the
 * listener can start the album straight from the investigation view. This is
 * a div[role=button] (like CompactStackRow), not a native <button>, so the
 * nested play control is valid markup.
 */
function ExpandedStackHeader({
  group,
  onCollapse,
}: {
  group: AlbumGroup;
  onCollapse: () => void;
}) {
  const { launch, isActive, isPlaying, isLoading, canLaunch, togglePause } =
    useAlbumPlay(group);
  return (
    <div
      className="compact-stack__row compact-stack__row--expanded-header"
      role="button"
      tabIndex={0}
      aria-expanded="true"
      aria-label={`Collapse ${group.albumTitle}`}
      onClick={onCollapse}
      onKeyDown={(event) => {
        // The play button stops Enter/Space propagation on its own keydown,
        // so only presses that originate on the header itself collapse.
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onCollapse();
        }
      }}
    >
      <div className="compact-stack__overlay" aria-hidden="true" />
      {canLaunch && (
        <CompactPlayButton
          title={group.albumTitle}
          isPlaying={isPlaying}
          isLoading={isLoading}
          onClick={() => {
            if (isLoading) return;
            if (isActive) {
              togglePause();
            } else {
              void launch();
            }
          }}
          testId={`compact-stack-play-${group.key}`}
        />
      )}
      <span className="compact-stack__text">
        <span className="compact-stack__album">{group.albumTitle}</span>
        {group.artist && (
          <>
            <span className="compact-stack__sep" aria-hidden="true">·</span>
            <span className="compact-stack__artist">{group.artist}</span>
          </>
        )}
      </span>
    </div>
  );
}

function CompactStackRow({
  group,
  credit,
  renderSpine,
  sampling = false,
  onExpand,
}: {
  group: AlbumGroup;
  credit: string | null;
  renderSpine: (group: AlbumGroup) => React.ReactNode;
  /** True while the stack shuffle dwells on this row (highlight-only cue). */
  sampling?: boolean;
  onExpand: () => void;
}) {
  const { launch, isActive, isPlaying, isLoading, canLaunch, togglePause } =
    useAlbumPlay(group);
  const label = group.artist
    ? `${group.albumTitle} · ${group.artist}`
    : group.albumTitle;

  return (
    <div
      className={`compact-stack__row${sampling ? " compact-stack__row--sampling" : ""}`}
      role="button"
      tabIndex={0}
      aria-expanded="false"
      aria-label={`Expand ${label}`}
      onClick={onExpand}
      onKeyDown={(event) => {
        // Only expand when the event originates on the row itself — interactive
        // descendants (e.g. the play button) stop propagation on their own
        // keydown before it reaches here.
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onExpand();
        }
      }}
    >
      {canLaunch && (
        <CompactPlayButton
          title={group.albumTitle}
          isPlaying={isPlaying}
          isLoading={isLoading}
          onClick={() => {
            // Loading: no-op — never restart an in-flight replay.
            if (isLoading) return;
            // Active (playing or paused): toggle pause/resume without relaunch.
            if (isActive) {
              togglePause();
            } else {
              void launch();
            }
          }}
          testId={`compact-stack-play-${group.key}`}
        />
      )}
      {renderSpine(group)}
      <span className="compact-stack__text">
        <span className="compact-stack__album">{group.albumTitle}</span>
        {group.artist && (
          <>
            <span className="compact-stack__sep" aria-hidden="true">·</span>
            <span className="compact-stack__artist">{group.artist}</span>
          </>
        )}
        {credit && (
          <>
            <span className="compact-stack__sep" aria-hidden="true">·</span>
            <span className="compact-stack__credit">{credit}</span>
          </>
        )}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface CompactStackProps {
  /**
   * Zero-based offset into the full library album-group list (a multiple of
   * COMPACT_STACK_SIZE) — the Stack pager's window. Defaults to the first
   * page.
   */
  offset?: number;
  /**
   * Key of the album group the stack shuffle is currently dwelling on; that
   * row is highlighted for the dwell interval. Null when no shuffle runs.
   */
  shuffleKey?: string | null;
  /**
   * Reports expansion state upward. Called with `true` when a row expands
   * and `false` when it collapses. Expansion is now fully in place — no
   * sibling bands unmount — so this is an informational shim kept for
   * callers/tests that still observe it.
   */
  onExpandedChange?: (expanded: boolean) => void;
}

export function CompactStack({ offset = 0, shuffleKey = null, onExpandedChange }: CompactStackProps = {}) {
  const [, setLocation] = useLocation();
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const { data, isLoading } = useMyLibraryInfinite({}, 100);

  // The full group list is windowed by the pager offset; expansion and the
  // inline credits only ever operate on the visible five-album page.
  const allGroups = useMemo<AlbumGroup[]>(() => {
    const items = data?.pages[0]?.items ?? [];
    return buildAlbumGroups(items);
  }, [data]);
  const groups = useMemo(
    () => allGroups.slice(offset, offset + COMPACT_STACK_SIZE),
    [allGroups, offset],
  );

  const expandedGroup = expandedKey
    ? (groups.find((g) => g.key === expandedKey) ?? null)
    : null;

  // A library refetch or a page change can remove or reorder the expanded
  // album out of the visible window. Drop the stale key during render (the
  // derived-state pattern) so the collapsed strip, the upward report, and
  // any future reappearance of the album all stay consistent.
  if (expandedKey && !expandedGroup) {
    setExpandedKey(null);
  }

  // Expansion is only "real" when the key resolves to a live group — the
  // home view must never keep the feed and remote hidden without a hero.
  const isExpanded = expandedGroup !== null;
  useEffect(() => {
    onExpandedChange?.(isExpanded);
  }, [isExpanded, onExpandedChange]);
  // Cheap over ≤5 groups; the React Compiler memoizes it (a manual useMemo
  // here can't be preserved by the compiler and forces a skip).
  const ordered = orderForExpansion(groups, expandedKey);
  const expandedArt = proxyArtUrl(
    expandedGroup ? spineArtUrl(expandedGroup) : null,
  );

  // Knowledge for the collapsed inline credit — one query per album (its
  // newest resolved recording). Cached under the same key the liner-notes
  // sheet uses, so no duplicate fetches.
  const creditMbids = useMemo(
    () =>
      groups
        .map((g) => primaryMbid(g))
        .filter((m): m is string => m !== null),
    [groups],
  );
  const creditResults = useQueries({
    queries: creditMbids.map((mbid) => ({
      queryKey: getGetRecordingKnowledgeQueryKey(mbid),
      queryFn: () => getRecordingKnowledge(mbid),
      staleTime: 10 * 60_000,
      gcTime: 30 * 60_000,
    })),
  });
  const knowledgeByMbid = new Map<string, TrackKnowledge | null>();
  creditMbids.forEach((mbid, i) => {
    knowledgeByMbid.set(mbid, creditResults[i]?.data?.knowledge ?? null);
  });

  // Expanded album: fetch every resolved recording so claims from all kept
  // tracks on the album are aggregated (same pattern as the investigation
  // sheet).
  // Cheap over one small group; the React Compiler memoizes it (a manual
  // useMemo here can't be preserved by the compiler and forces a skip).
  const expandedMbids = expandedGroup ? groupMbids(expandedGroup) : [];
  const expandedResults = useQueries({
    queries: expandedMbids.map((mbid) => ({
      queryKey: getGetRecordingKnowledgeQueryKey(mbid),
      queryFn: () => getRecordingKnowledge(mbid),
      staleTime: 10 * 60_000,
      gcTime: 30 * 60_000,
    })),
  });
  const expandedLoading = expandedResults.some((r) => r.isLoading);
  const linerGroups = expandedGroup
    ? buildAlbumLinerGroups(
        expandedResults
          .map((r) => r.data)
          .filter((d): d is NonNullable<typeof d> => d != null)
          .map((d) => ({ knowledge: d.knowledge ?? null, claims: d.claims ?? [] })),
      )
    : [];

  // Collapsed rows: each album gets its OWN stationary full-size cover
  // behind its row (an <img> so onArtError retry/fallback works). No motion
  // while collapsed — the cinematic pan is reserved for the expanded hero.
  const renderSpine = (group: AlbumGroup) => {
    const art = proxyArtUrl(spineArtUrl(group));
    return (
      <>
        {art && (
          <img
            className="compact-stack__spine-art"
            src={art}
            alt=""
            aria-hidden="true"
            loading="lazy"
            onError={onArtError}
          />
        )}
        <div className="compact-stack__overlay" aria-hidden="true" />
      </>
    );
  };

  // ── Expanded: header row + notes in place, remaining rows still listed ──
  if (expandedGroup) {
    const stackHref = `/library?openAlbum=${encodeURIComponent(expandedGroup.key)}`;
    return (
      <div
        className="compact-stack compact-stack--expanded"
        aria-label="Recent keeps"
      >
        <ExpandedStackHeader
          group={expandedGroup}
          onCollapse={() => setExpandedKey(null)}
        />
        {/* The notes region owns its backdrop: the album art covers only this
            section (panning once it overflows), never the whole band. */}
        <div className="compact-stack__notes">
          <CompactStackBackdrop key={expandedArt ?? "no-art"} art={expandedArt} />
          <div className="compact-stack__cards" role="region" aria-label={`${expandedGroup.albumTitle} liner notes`}>
          {expandedLoading ? (
            <div className="compact-stack__card compact-stack__card--muted">
              Reading the liner notes…
            </div>
          ) : linerGroups.length > 0 ? (
            linerGroups.map((group) =>
              group.rows.map((row) => (
                <div key={`${group.label}-${row.id}`} className="compact-stack__card">
                  <span className="compact-stack__card-kind">{group.label}</span>
                  <span className="compact-stack__card-text">
                    {row.label && (
                      <span className="compact-stack__card-label">{row.label} </span>
                    )}
                    {row.text}
                  </span>
                  {row.sourceLabel && (
                    <span className="compact-stack__card-source">{row.sourceLabel}</span>
                  )}
                  {row.sourceUrl && (
                    <a
                      href={row.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="compact-stack__card-link"
                      aria-label={`Open source for ${row.text.slice(0, 40)}`}
                    >
                      <ExternalLink aria-hidden="true" />
                    </a>
                  )}
                </div>
              )),
            )
          ) : (
            <div className="compact-stack__card compact-stack__card--muted">
              No liner notes available for this album yet.
            </div>
          )}
          <button
            type="button"
            className="compact-stack__card compact-stack__card--stack-link"
            onClick={() => setLocation(stackHref)}
          >
            <ArrowRight aria-hidden="true" />
            <span>Stack</span>
          </button>
          </div>
        </div>
        {/* The remaining compact rows stay mounted below the notes so the
            band reads as one continuous, scrollable column. */}
        {ordered.slice(1).map((group) => {
          const mbid = primaryMbid(group);
          const credit = mbid ? relationshipCredit(knowledgeByMbid.get(mbid)) : null;
          return (
            <CompactStackRow
              key={group.key}
              group={group}
              credit={credit}
              renderSpine={renderSpine}
              sampling={group.key === shuffleKey}
              onExpand={() => setExpandedKey(group.key)}
            />
          );
        })}
      </div>
    );
  }

  // ── Collapsed: five single-line rows ────────────────────────────────────
  return (
    <div className="compact-stack" aria-label="Recent keeps">
      {ordered.map((group) => {
        const mbid = primaryMbid(group);
        const credit = mbid ? relationshipCredit(knowledgeByMbid.get(mbid)) : null;
        return (
          <CompactStackRow
            key={group.key}
            group={group}
            credit={credit}
            renderSpine={renderSpine}
            sampling={group.key === shuffleKey}
            onExpand={() => setExpandedKey(group.key)}
          />
        );
      })}
      {!isLoading && groups.length === 0 && (
        <button
          type="button"
          className="compact-stack__empty"
          onClick={() => setLocation("/library")}
        >
          Nothing kept yet — your Stack starts with the first track you keep.
        </button>
      )}
    </div>
  );
}
