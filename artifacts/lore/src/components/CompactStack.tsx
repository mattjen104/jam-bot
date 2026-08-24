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
import { RUMOURS, onArtError } from "../lib/rumours";
import { usePlayer, type RideSeed } from "../player/PlayerProvider";
import { CompactPlayButton } from "./CompactPlayButton";
import { stackPageSize, type StackDensity } from "../lib/stackDensityState";

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
 * A release the listener swapped into the expanded view via the artist
 * filmstrip: the payload of GET /api/release-groups/:rgMbid/tracks.
 */
export interface SwappedAlbum {
  rgMbid: string;
  rgTitle: string | null;
  releaseYear: number | null;
  artworkUrl: string | null;
  tracks: { mbid: string; title: string; artist: string }[];
}

/**
 * Album replay controls for the compact Stack row. This intentionally mirrors
 * StackRow's full-album launch path, while retaining the resolved label so
 * replay labels supplied by MusicBrainz still identify this row as active.
 *
 * When `swap` is provided (the expanded view is showing a different release
 * from the artist filmstrip), launch replays the swapped release's tracks
 * directly — they were already fetched by the swap — under its own title.
 */
export function useAlbumPlay(
  group: AlbumGroup,
  swap?: { tracks: SwappedAlbum["tracks"]; label: string } | null,
) {
  const { ride } = usePlayer();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [resolvedLabel, setResolvedLabel] = useState<string | null>(null);
  const mbid = primaryMbid(group);
  const sessionLabels = [group.albumTitle, swap?.label ?? null, resolvedLabel].filter(
    (label): label is string => label != null,
  );
  const isThisAlbum = ride.active && sessionLabels.includes(ride.replayLabel ?? "");

  const launch = useCallback(async () => {
    if (!swap && !mbid) return false;
    // Single-flight: never fire a second album-tracks request (and a second
    // startReplay) while one is already in flight for this row.
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    try {
      if (swap) {
        // The swap fetch already returned this release's tracks — no second
        // album-tracks request needed.
        const seeds: RideSeed[] = swap.tracks.map((track) => ({
          mbid: track.mbid,
          title: track.title,
          artist: track.artist,
          artworkUrl: null,
          links: [],
        }));
        if (seeds.length === 0) throw new Error("no tracks");
        setResolvedLabel(swap.label);
        ride.startReplay(seeds, swap.label, {
          timeOrientation: "curated",
          context: "library",
        });
        return true;
      }
      const data = await getRecordingAlbumTracks(mbid!);
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
  }, [group.albumTitle, mbid, ride, swap]);

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
    canLaunch: swap ? swap.tracks.length > 0 : mbid != null,
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
  swappedAlbum,
  onCollapse,
}: {
  group: AlbumGroup;
  /** Release swapped in via the artist filmstrip; null = the kept album. */
  swappedAlbum: SwappedAlbum | null;
  onCollapse: () => void;
}) {
  const displayTitle = swappedAlbum?.rgTitle ?? group.albumTitle;
  const displayYear = swappedAlbum ? swappedAlbum.releaseYear : group.releaseYear;
  const { launch, isActive, isPlaying, isLoading, canLaunch, togglePause } =
    useAlbumPlay(
      group,
      swappedAlbum
        ? { tracks: swappedAlbum.tracks, label: displayTitle }
        : null,
    );
  return (
    <div
      className="compact-stack__row compact-stack__row--expanded-header"
      role="button"
      tabIndex={0}
      aria-expanded="true"
      aria-label={`Collapse ${displayTitle}`}
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
          title={displayTitle}
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
        {displayYear != null && (
          <span className="compact-stack__year compact-stack__year--header">
            {displayYear}
          </span>
        )}
        <span className="compact-stack__album">{displayTitle}</span>
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
  isSkipped = false,
  density = "normal",
  onToggleSkip,
  onExpand,
}: {
  group: AlbumGroup;
  credit: string | null;
  renderSpine: (group: AlbumGroup) => React.ReactNode;
  /** True while the stack shuffle dwells on this row (highlight-only cue). */
  sampling?: boolean;
  /** True when the album is unchecked — row dims and lives below the fold. */
  isSkipped?: boolean;
  /**
   * Row display density. "compact" drops the relationship credit segment;
   * "micro" shows only the year + album title (no artist, no credit) and
   * tapping the row plays the album directly instead of expanding it.
   */
  density?: StackDensity;
  /** Trailing checkbox handler; the checkbox renders only when provided. */
  onToggleSkip?: (key: string) => void;
  onExpand: () => void;
}) {
  const { launch, isActive, isPlaying, isLoading, canLaunch, togglePause } =
    useAlbumPlay(group);
  const label = group.artist
    ? `${group.albumTitle} · ${group.artist}`
    : group.albumTitle;
  // Expansion (liner notes) exists only at normal density — in the denser
  // modes a row tap plays the album directly, the same as the compact dial.
  const directPlay = density !== "normal";
  const handlePress = () => {
    if (!directPlay) {
      onExpand();
      return;
    }
    // Same press semantics as the play button: loading = no-op, active =
    // pause/resume, otherwise launch the album.
    if (isLoading) return;
    if (isActive) {
      togglePause();
    } else {
      void launch();
    }
  };

  return (
    <div
      className={`compact-stack__row${sampling ? " compact-stack__row--sampling" : ""}${isSkipped ? " compact-stack__row--skipped" : ""}`}
      role="button"
      tabIndex={0}
      aria-expanded="false"
      aria-label={directPlay ? `Play ${label}` : `Expand ${label}`}
      onClick={handlePress}
      onKeyDown={(event) => {
        // Only fire when the event originates on the row itself — interactive
        // descendants (e.g. the play button) stop propagation on their own
        // keydown before it reaches here.
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          handlePress();
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
        {group.releaseYear != null && (
          <span className="compact-stack__year">{group.releaseYear}</span>
        )}
        <span className="compact-stack__album">{group.albumTitle}</span>
        {/* Micro density is year + title only — no artist, no credit. */}
        {group.artist && density !== "micro" && (
          <>
            <span className="compact-stack__sep" aria-hidden="true">·</span>
            <span className="compact-stack__artist">{group.artist}</span>
          </>
        )}
        {/* The relationship credit survives only at normal density. */}
        {credit && density === "normal" && (
          <>
            <span className="compact-stack__sep" aria-hidden="true">·</span>
            <span className="compact-stack__credit">{credit}</span>
          </>
        )}
      </span>
      {onToggleSkip && (
        <input
          type="checkbox"
          className="compact-stack__scan-checkbox"
          checked={!isSkipped}
          aria-label={
            isSkipped
              ? `Include ${label} in the Stack window`
              : `Skip ${label} in the Stack window`
          }
          title={
            isSkipped
              ? "Excluded from the Stack window — check to include"
              : "Shown in the Stack window — uncheck to skip"
          }
          onChange={() => onToggleSkip(group.key)}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            // Space/Enter must toggle the checkbox only, never expand the row.
            if (e.key === "Enter" || e.key === " ") e.stopPropagation();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Artist release filmstrip (expanded view)
// ---------------------------------------------------------------------------

/** One entry of GET /api/recordings/:mbid/artist-releases. */
export interface ArtistRelease {
  releaseGroupMbid: string;
  title: string | null;
  primaryType: string | null;
  releaseYear: number | null;
  artworkUrl: string | null;
}

/**
 * Chronological ascending (oldest first, so the listener scrolls right
 * through time); undated releases trail in their fetched order.
 */
export function sortReleasesChronologically(
  releases: ArtistRelease[],
): ArtistRelease[] {
  return releases
    .map((r, i) => ({ r, i }))
    .sort(
      (a, b) =>
        (a.r.releaseYear ?? Number.MAX_SAFE_INTEGER) -
          (b.r.releaseYear ?? Number.MAX_SAFE_INTEGER) || a.i - b.i,
    )
    .map(({ r }) => r);
}

/**
 * Compact artist-release filmstrip for the expanded album view: a horizontal
 * scroll row of cover tiles (same visual grammar as ArtistPortalStrip),
 * sorted oldest → newest, with the currently viewed album's tile highlighted.
 * Tapping a tile swaps the expanded view to that release — a browsing
 * affordance only; nothing auto-plays.
 *
 * Renders nothing while loading, when the artist has ≤1 known release, or
 * when the fetch fails — there is no placeholder state.
 */
function CompactStackFilmstrip({
  recordingMbid,
  activeRgMbid,
  artistName,
  onSelect,
}: {
  /** A resolved recording MBID of the expanded album (artist discovery). */
  recordingMbid: string;
  /** Release-group MBID of the album currently shown (highlighted tile). */
  activeRgMbid: string | null;
  artistName: string;
  onSelect: (rgMbid: string) => void;
}) {
  const [releases, setReleases] = useState<ArtistRelease[] | null>(null);
  const [loading, setLoading] = useState(true);
  const activeTileRef = useRef<HTMLButtonElement | null>(null);

  // Reset synchronously when the recording changes (render-time adjustment,
  // same pattern as ArtistPortalStrip).
  const [prevRecordingMbid, setPrevRecordingMbid] = useState(recordingMbid);
  if (recordingMbid !== prevRecordingMbid) {
    setPrevRecordingMbid(recordingMbid);
    setReleases(null);
    setLoading(true);
  }

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/recordings/${recordingMbid}/artist-releases`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("fetch failed"))))
      .then((data: { releases?: ArtistRelease[] }) => {
        if (!cancelled) setReleases(data.releases ?? []);
      })
      .catch(() => {
        if (!cancelled) setReleases([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [recordingMbid]);

  // Scroll the current album's tile into view once the strip first renders.
  useEffect(() => {
    if (releases && releases.length > 1) {
      activeTileRef.current?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    }
  }, [releases]);

  if (loading || !releases || releases.length <= 1) return null;

  return (
    <div
      className="compact-stack__filmstrip"
      role="group"
      aria-label={`More by ${artistName}`}
    >
      {sortReleasesChronologically(releases).map((r) => {
        const isActive = r.releaseGroupMbid === activeRgMbid;
        return (
          <button
            key={r.releaseGroupMbid}
            type="button"
            ref={isActive ? activeTileRef : undefined}
            className={`compact-stack__filmstrip-tile${isActive ? " compact-stack__filmstrip-tile--active" : ""}`}
            aria-pressed={isActive}
            aria-label={`View ${r.title ?? r.primaryType ?? "release"}${r.releaseYear ? ` (${r.releaseYear})` : ""}`}
            title={[r.title, r.releaseYear].filter(Boolean).join(" · ")}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(r.releaseGroupMbid);
            }}
          >
            <img
              src={proxyArtUrl(r.artworkUrl) ?? RUMOURS}
              alt=""
              className="compact-stack__filmstrip-art"
              loading="lazy"
              onError={onArtError}
            />
            <span className="compact-stack__filmstrip-year">
              {r.releaseYear ?? "····"}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface CompactStackProps {
  /**
   * Zero-based offset into the full library album-group list (a multiple of
   * the density's page size) — the Stack pager's window. Defaults to the
   * first page.
   */
  offset?: number;
  /**
   * Display density of the collapsed band: "normal" (default) = 5 full
   * rows with expansion, "compact" = 10 half-height rows (no credit
   * segment), "micro" = 15 one-third-height rows (year + title only). In
   * the denser modes tapping a row plays the album directly.
   */
  density?: StackDensity;
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
  /**
   * Album-group keys the listener has unchecked. Skipped albums leave the
   * five-slot active window (which is paged over active groups only) and
   * render dimmed in a below-fold overflow region where they stay
   * interactive. Absent = nothing is skipped.
   */
  skipped?: ReadonlySet<string>;
  /**
   * Trailing-checkbox handler for the skip preference. When omitted, rows
   * render no checkbox at all.
   */
  onToggleSkip?: (key: string) => void;
}

export function CompactStack({ offset = 0, density = "normal", shuffleKey = null, onExpandedChange, skipped, onToggleSkip }: CompactStackProps = {}) {
  const [, setLocation] = useLocation();
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [collapsedArtists, setCollapsedArtists] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const { data, isLoading } = useMyLibraryInfinite({}, 100);

  // Rows per page at the current density: 5 (normal), 10 (compact), or
  // 15 (micro). Drives the window slice and the grid's row count alike.
  const pageSize = stackPageSize(density);

  // The full group list splits into active (pager-windowed) and skipped
  // (below-fold overflow) albums — the Stack-side mirror of CompactDial.
  const allGroups = useMemo<AlbumGroup[]>(() => {
    const items = data?.pages[0]?.items ?? [];
    return buildAlbumGroups(items);
  }, [data]);
  const activeGroups = useMemo(
    () => (skipped ? allGroups.filter((g) => !skipped.has(g.key)) : allGroups),
    [allGroups, skipped],
  );
  const skippedGroups = useMemo(
    () => (skipped ? allGroups.filter((g) => skipped.has(g.key)) : []),
    [allGroups, skipped],
  );
  const groups = useMemo(
    () => activeGroups.slice(offset, offset + pageSize),
    [activeGroups, offset, pageSize],
  );

  // The expanded album is looked up in the visible window OR the skipped
  // region — a skipped row stays expandable — but never off-page, so paging
  // away still collapses a stale expansion.
  const expandedGroup = expandedKey
    ? (groups.find((g) => g.key === expandedKey) ??
      skippedGroups.find((g) => g.key === expandedKey) ??
      null)
    : null;

  // Release swapped into the expanded view via the artist filmstrip, guarded
  // against async races. Every swap request carries (a) a monotonic sequence,
  // so a slow response can never overwrite a newer tile tap, and (b) an
  // invalidation token bumped on every expansion change/collapse, so a
  // response that lands after the listener moved to another album is
  // discarded. `requested` tracks the newest pending request for the loading
  // dim; `settled` is the newest committed result (album null = a failed
  // swap, which keeps showing the current album).
  const swapSeqRef = useRef(0);
  const swapInvalidationRef = useRef(0);
  const [requestedSwap, setRequestedSwap] = useState<{
    forKey: string | null;
    seq: number;
  } | null>(null);
  const [settledSwap, setSettledSwap] = useState<{
    forKey: string | null;
    seq: number;
    album: SwappedAlbum | null;
  } | null>(null);

  // Every expansion change invalidates in-flight filmstrip swaps and clears
  // their state. Called from event handlers only — the render-time
  // stale-drop below leaves the swap state alone: its late commits stay
  // hidden (the forKey check fails while collapsed), and any re-expand
  // passes through here, bumping the token so they are dropped for good.
  const changeExpanded = (key: string | null) => {
    if (key === expandedKey) return;
    swapInvalidationRef.current += 1;
    setRequestedSwap(null);
    setSettledSwap(null);
    setExpandedKey(key);
  };

  const swappedAlbum =
    settledSwap?.album != null && settledSwap.forKey === expandedKey
      ? settledSwap.album
      : null;
  const swapLoading =
    requestedSwap != null &&
    requestedSwap.forKey === expandedKey &&
    (settledSwap == null ||
      settledSwap.seq < requestedSwap.seq ||
      settledSwap.forKey !== expandedKey);

  // The release-group MBID of the album currently shown: the swapped release
  // when one is active, otherwise the kept group's own primary RG.
  const groupRgMbid = expandedGroup
    ? (expandedGroup.items.find((i) => i.recording?.releaseGroupMbid)
        ?.recording?.releaseGroupMbid ?? null)
    : null;
  const activeRgMbid = swappedAlbum?.rgMbid ?? groupRgMbid;

  const handleSwapAlbum = useCallback(
    async (rgMbid: string) => {
      if (rgMbid === activeRgMbid) {
        // Tapping the album already on display is a "keep this one"
        // selection: like every filmstrip tap it supersedes any swap still
        // in flight, so the late response can never replace the view the
        // listener just re-affirmed.
        swapInvalidationRef.current += 1;
        setRequestedSwap(null);
        return;
      }
      const seq = ++swapSeqRef.current;
      const invalidation = swapInvalidationRef.current;
      const forKey = expandedKey;
      setRequestedSwap({ forKey, seq });
      try {
        const res = await fetch(`/api/release-groups/${rgMbid}/tracks`);
        if (!res.ok) throw new Error("not_found");
        const album = (await res.json()) as SwappedAlbum;
        // Stale: the expanded album changed (or collapsed) while fetching.
        if (invalidation !== swapInvalidationRef.current) return;
        // Settle only when no newer request has been issued since.
        setSettledSwap((prev) =>
          prev && prev.seq > seq ? prev : { forKey, seq, album },
        );
      } catch {
        if (invalidation !== swapInvalidationRef.current) return;
        // A failed swap keeps showing the current album — record the settle
        // anyway so the request stops counting as pending.
        setSettledSwap((prev) =>
          prev && prev.seq > seq
            ? prev
            : prev && prev.forKey === forKey
              ? { ...prev, seq }
              : { forKey, seq, album: null },
        );
      }
    },
    [activeRgMbid, expandedKey],
  );

  // A library refetch or a page change can remove or reorder the expanded
  // album out of the visible window. Drop the stale key during render (the
  // derived-state pattern) so the collapsed strip, the upward report, and
  // any future reappearance of the album all stay consistent. Expansion is
  // also dropped when the density leaves "normal" — liner notes exist only
  // at the five-row density.
  if (expandedKey && (!expandedGroup || density !== "normal")) {
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
  // Rows below the notes: the window minus the expanded album when it leads
  // the window; the full window when a skipped row is the expanded one.
  const expandedInWindow =
    expandedGroup != null && groups.some((g) => g.key === expandedGroup.key);
  const belowRows = expandedInWindow ? ordered.slice(1) : groups;
  // Backdrop: the swapped release's own art when browsing the filmstrip
  // (release-exact CAA fallback when the swap returned no art), otherwise the
  // kept album's spine art.
  const expandedArt = proxyArtUrl(
    !expandedGroup
      ? null
      : swappedAlbum
        ? (swappedAlbum.artworkUrl ??
          `https://coverartarchive.org/release-group/${swappedAlbum.rgMbid}/front-1200`)
        : spineArtUrl(expandedGroup),
  );

  // Knowledge for the collapsed inline credit — one query per album (its
  // newest resolved recording), covering the window and the skipped region.
  // Cached under the same key the liner-notes sheet uses, so no duplicate
  // fetches.
  const creditMbids = useMemo(
    () =>
      [...groups, ...skippedGroups]
        .map((g) => primaryMbid(g))
        .filter((m): m is string => m !== null),
    [groups, skippedGroups],
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
  // sheet). After a filmstrip swap the notes follow the swapped release's
  // own track list instead of the kept album's recordings.
  // Cheap over one small group; the React Compiler memoizes it (a manual
  // useMemo here can't be preserved by the compiler and forces a skip).
  const expandedMbids = !expandedGroup
    ? []
    : swappedAlbum
      ? [...new Set(swappedAlbum.tracks.map((t) => t.mbid))]
      : groupMbids(expandedGroup);
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

  const artistTree = (items: AlbumGroup[]) => {
    const byArtist = new Map<string, AlbumGroup[]>();
    for (const group of items) {
      const artist = group.artist.trim() || "Unknown artist";
      const existing = byArtist.get(artist);
      if (existing) existing.push(group);
      else byArtist.set(artist, [group]);
    }
    return [...byArtist.entries()].map(([artist, albums]) => ({ artist, albums }));
  };

  const renderTreeRows = (items: AlbumGroup[], withDensity = false) =>
    artistTree(items).map(({ artist, albums }) => {
      const isCollapsed = collapsedArtists.has(artist);
      return (
        <section className="compact-stack__tree-group" key={artist}>
          <div className="compact-stack__tree-heading">
            <button
              type="button"
              className="compact-stack__tree-disclosure"
              aria-expanded={!isCollapsed}
              aria-label={`${isCollapsed ? "Show" : "Hide"} albums by ${artist}`}
              onClick={() =>
                setCollapsedArtists((current) => {
                  const next = new Set(current);
                  if (next.has(artist)) next.delete(artist);
                  else next.add(artist);
                  return next;
                })
              }
            >
              <span aria-hidden="true">{isCollapsed ? "+" : "−"}</span>
              <span>{artist}</span>
              <span className="compact-stack__tree-count">{albums.length}</span>
            </button>
          </div>
          {!isCollapsed && (
            <div className="compact-stack__tree-children">
              {albums.map((group) => {
                const mbid = primaryMbid(group);
                const credit = mbid ? relationshipCredit(knowledgeByMbid.get(mbid)) : null;
                return (
                  <CompactStackRow
                    key={group.key}
                    group={group}
                    credit={credit}
                    renderSpine={renderSpine}
                    sampling={group.key === shuffleKey}
                    density={withDensity ? density : undefined}
                    isSkipped={skippedGroups.includes(group)}
                    onToggleSkip={onToggleSkip}
                    onExpand={() => changeExpanded(group.key)}
                  />
                );
              })}
            </div>
          )}
        </section>
      );
    });

  // ── Expanded: header row + notes in place, remaining rows still listed ──
  if (expandedGroup) {
    // When a filmstrip swap is active, link to the album the listener is
    // actually viewing (derived from the swapped release's title + the kept
    // album's artist, mirroring the buildAlbumGroups key format used by the
    // Library page). Fall back to the kept group's own key when no swap is
    // showing.
    const stackTarget = swappedAlbum
      ? `${swappedAlbum.rgTitle ?? ""}\x1f${expandedGroup.artist}`
      : expandedGroup.key;
    const stackHref = `/library?openAlbum=${encodeURIComponent(stackTarget)}`;
    return (
      <div
        className="compact-stack compact-stack--expanded"
        aria-label="Recent keeps"
      >
        <ExpandedStackHeader
          group={expandedGroup}
          swappedAlbum={swappedAlbum}
          onCollapse={() => changeExpanded(null)}
        />
        {/* The notes region owns its backdrop: the album art covers only this
            section (panning once it overflows), never the whole band. */}
        <div className="compact-stack__notes">
          <CompactStackBackdrop key={expandedArt ?? "no-art"} art={expandedArt} />
          <div
            className={`compact-stack__cards${swapLoading ? " compact-stack__cards--swapping" : ""}`}
            role="region"
            aria-label={`${expandedGroup.albumTitle} liner notes`}
          >
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
          {/* Artist release cycle: every primary release by this artist,
              oldest → newest. Tapping a tile swaps the header identity and
              the notes to that release; nothing auto-plays. */}
          {(() => {
            const filmstripMbid = primaryMbid(expandedGroup);
            return filmstripMbid ? (
              <CompactStackFilmstrip
                recordingMbid={filmstripMbid}
                activeRgMbid={activeRgMbid}
                artistName={expandedGroup.artist}
                onSelect={(rgMbid) => void handleSwapAlbum(rgMbid)}
              />
            ) : null;
          })()}
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
        {belowRows.map((group) => {
          const mbid = primaryMbid(group);
          const credit = mbid ? relationshipCredit(knowledgeByMbid.get(mbid)) : null;
          return (
            <CompactStackRow
              key={group.key}
              group={group}
              credit={credit}
              renderSpine={renderSpine}
              sampling={group.key === shuffleKey}
              onToggleSkip={onToggleSkip}
              onExpand={() => changeExpanded(group.key)}
            />
          );
        })}
        {skippedGroups.filter((g) => g.key !== expandedKey).length > 0 && (
          <div
            className="compact-stack__skipped-region"
            aria-label="Excluded from the Stack window"
          >
            {skippedGroups
              .filter((g) => g.key !== expandedKey)
              .map((group) => {
                const mbid = primaryMbid(group);
                const credit = mbid
                  ? relationshipCredit(knowledgeByMbid.get(mbid))
                  : null;
                return (
                  <CompactStackRow
                    key={group.key}
                    group={group}
                    credit={credit}
                    renderSpine={renderSpine}
                    sampling={group.key === shuffleKey}
                    isSkipped
                    onToggleSkip={onToggleSkip}
                    onExpand={() => changeExpanded(group.key)}
                  />
                );
              })}
          </div>
        )}
      </div>
    );
  }

  // ── Collapsed: single-line rows (+ below-fold skipped region) ──────────
  return (
    <div
      className={`compact-stack${density !== "normal" ? ` compact-stack--${density}` : ""}${skippedGroups.length > 0 ? " compact-stack--has-skipped" : ""}`}
      aria-label="Recent keeps"
    >
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
            density={density}
            onToggleSkip={onToggleSkip}
            onExpand={() => changeExpanded(group.key)}
          />
        );
      })}
      {skippedGroups.length > 0 && (
        <div
          className="compact-stack__skipped-region"
          aria-label="Excluded from the Stack window"
        >
          {skippedGroups.map((group) => {
            const mbid = primaryMbid(group);
            const credit = mbid
              ? relationshipCredit(knowledgeByMbid.get(mbid))
              : null;
            return (
              <CompactStackRow
                key={group.key}
                group={group}
                credit={credit}
                renderSpine={renderSpine}
                sampling={group.key === shuffleKey}
                isSkipped
                density={density}
                onToggleSkip={onToggleSkip}
                onExpand={() => changeExpanded(group.key)}
              />
            );
          })}
        </div>
      )}
      {!isLoading && groups.length === 0 && skippedGroups.length === 0 && (
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
