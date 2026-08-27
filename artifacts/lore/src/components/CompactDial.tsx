/**
 * CompactDial — the SplitHome mini dial feed.
 *
 * Layout model
 * ─────────────
 * Category-first (the home Feed): a tab strip — All plus the seven editorial
 * categories under their short labels (Anchor, Campus, Specialist, Public,
 * Indie, Ambient, Discovery). Each category tab also carries an include
 * checkbox: checked categories appear as cards in the All overview;
 * unchecking a tab keeps it in the strip (dimmed) so the listener can
 * exclude a whole station class without losing the saved choice. Clicking a
 * checked tab focuses the feed on that category's station list; clicking an
 * unchecked tab re-includes and focuses it. Selecting All returns to the
 * category-card overview.
 *
 * Category cards lead with now-playing information — the freshest available
 * track in the category — and make each station card itself the play control.
 * Crossings/first-play metric badges and the
 * age-distribution pie are intentionally not rendered here for now; the
 * underlying data and APIs are untouched.
 *
 * Ungrouped fallback (no editorial categories present): the classic paged
 * layout.
 *   activeRows  — stations NOT in the skip set, sliced to the current page
 *                 (5 normal / 10 compact / 15 micro). These fill the dial band.
 *   skippedRows — ALL skipped stations, appended below in a scrollable
 *                 overflow region so the listener can still reach them without
 *                 navigating to a different page.
 *
 * Checkbox: far-right trailing edge of each row.
 *   Checked  (active)  → filled key, normal opacity
 *   Unchecked (skipped) → open key, row dims, row lives in the below-fold
 *                         overflow region regardless of alphabetical position
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import type { DialLaneRow } from "./dial/DialFeedLane";
import type { StationPresence } from "../hooks/useStationPresence";
import type { DialDisplayMode } from "../hooks/useDialData";
import { FrontDoorRow } from "./dial/FrontDoorRow";
import { resolvePlaybackSource } from "../hooks/useRadioPlayer";
import type { PlayerStatus } from "../hooks/useRadioPlayer";
import { CompactPlayButton } from "./CompactPlayButton";
import { CompactDialRemote } from "./CompactDialRemote";
import { MicroDialRemote } from "./MicroDialRemote";
import {
  type CrossingScope,
  DEFAULT_CROSSING_SCOPE,
  hasAnyCrossing,
} from "../lib/crossingScope";
import type { DialDensity } from "../lib/dialDensityState";
import type { LastSetSummary } from "../lib/latestSet";
import {
  STATION_CATEGORY_DEFINITIONS,
  stationCategoryShortLabel,
  type StationCategory,
} from "../lib/dialCategories";
import { cleanLiveValue } from "./dialViewHelpers";
import { StationMark } from "./StationMark";
import { usePlayer } from "../player/PlayerProvider";
import { releaseDateLabel } from "../lib/firstPlayDate";

const COMPACT_DIAL_SIZE = 5;
/** Rows per page at the "compact" (name-only remote) density. */
const COMPACT_REMOTE_SIZE = 10;
/** The front-door tab strip leads with the everyday listening categories. */
const COMPACT_CATEGORY_ORDER: readonly StationCategory[] = [
  "anchor",
  "campus",
  "specialist",
  "public",
  "indie",
  "ambient",
  "discovery",
];

export interface CompactDialProps {
  /**
   * Active (non-skipped) rows for the current page — already sliced to at
   * most 5 by SplitHome before being passed in. Scan indices in
   * `samplingRowIdx` are positions in the FULL activeRows array (i.e. the
   * pre-sliced list), offset corrected by the caller.
   */
  activeRows: DialLaneRow[];
  /**
   * All skipped rows across the entire filtered list. Rendered below the
   * active grid in a scrollable overflow region.
   */
  skippedRows: DialLaneRow[];
  /**
   * Index into the current page's activeRows of the station being sampled.
   * Null when no scan is running.
   */
  samplingRowIdx?: number | null;
  activeSlug: string | null;
  playerStatus: PlayerStatus;
  presenceMap: Map<number, StationPresence>;
  onTuneIn: (row: DialLaneRow) => void;
  onPlay: (row: DialLaneRow) => void;
  /** Toggle skip state for a station slug (checks ↔ unchecks). */
  onToggleSkip?: (slug: string) => void;
  /** Toggle a category's inclusion in the All overview (the tab checkboxes). */
  onToggleCategory?: (category: StationCategory) => void;
  /**
   * The checked category set. Checked categories render cards in the All
   * overview; unchecked categories stay as dimmed tabs that re-include on
   * click. Undefined means "everything included".
   */
  activeCategories?: ReadonlySet<StationCategory>;
  /** Active crossing scope — drives the per-row ⬤ dot meaning. */
  crossingScope?: CrossingScope;
  /** When true (crossings off), no ⬤ dots render. */
  suppressCrossings?: boolean;
  displayMode?: DialDisplayMode;
  seedsLower?: Set<string>;
  onAddArtist?: (name: string) => void;
  /**
   * Display density (default "normal"). "compact" renders name-only remote
   * rows (10 per page); "micro" renders the page as a numbered keypad (15
   * per page). Remote-control densities never expand a row.
   */
  density?: DialDensity;
  /**
   * 1-based ordinal of activeRows[0] within the FULL active list (i.e. the
   * caller's scan offset + 1), so remote rows/keys show their position across
   * the whole list rather than within the visible page. Default 1.
   */
  firstOrdinal?: number;
  /** Opens the station's last-set scanner (normal-density rows only). */
  onOpenLastSet?: (row: DialLaneRow) => void;
  /**
   * Latest-completed-set summary per station slug — undefined while loading,
   * null when the station has no completed set (affordance hidden).
   */
  lastSetSummaries?: ReadonlyMap<string, LastSetSummary | null>;
  /** Stations still playing whatever the listener's last scan sampled —
   *  drives the "unchanged since your last scan" cue on rows and keys. */
  unchangedSlugs?: ReadonlySet<string>;
  /**
   * The home Feed's category-first presentation: an All / category tab strip
   * with concise now-playing category cards that drill into a single station
   * list per category.
   */
  categoryFirst?: boolean;
  /**
   * Category tabs/cards are intentionally unpaged; the direct ungrouped
   * fallback still follows the compact Feed's pager so scan/page commands
   * retain their meaning for personal and unclassified stations.
   */
  visibleUncategorizedSlugs?: ReadonlySet<string>;
  /** Home-only: hide category filters until the large radio remote opens. */
  hideCategoryFilters?: boolean;
  /** Home-only: expands the category controls into the large radio remote. */
  remoteOpen?: boolean;
  /** Closes the home radio remote. */
  onCloseRemote?: () => void;
}

function CompactDialRow({
  row,
  isSampling,
  isSkipped,
  activeSlug,
  playerStatus,
  presenceMap,
  onTuneIn,
  onPlay,
  onToggleSkip,
  crossingScope = DEFAULT_CROSSING_SCOPE,
  suppressCrossings = false,
  displayMode,
  seedsLower,
  onAddArtist,
  onOpenLastSet,
  lastSetSummaries,
  unchangedSlugs,
}: {
  row: DialLaneRow;
  isSampling: boolean;
  isSkipped: boolean;
  activeSlug: string | null;
  playerStatus: PlayerStatus;
  presenceMap: Map<number, StationPresence>;
  onTuneIn: (row: DialLaneRow) => void;
  onPlay: (row: DialLaneRow) => void;
  onToggleSkip?: (slug: string) => void;
  crossingScope?: CrossingScope;
  suppressCrossings?: boolean;
  displayMode?: DialDisplayMode;
  seedsLower?: Set<string>;
  onAddArtist?: (name: string) => void;
  onOpenLastSet?: (row: DialLaneRow) => void;
  lastSetSummaries?: ReadonlyMap<string, LastSetSummary | null>;
  unchangedSlugs?: ReadonlySet<string>;
}) {
  const slug = row.ds.station.slug;
  return (
    <div
      className={[
        "compact-dial__row",
        isSampling ? "compact-dial__row--sampling" : "",
        isSkipped ? "compact-dial__row--skipped" : "",
      ].filter(Boolean).join(" ")}
    >
      {resolvePlaybackSource(row.ds.station) != null && (
        <CompactPlayButton
          title={row.ds.station.name}
          isPlaying={slug === activeSlug && playerStatus === "playing"}
          isLoading={slug === activeSlug && playerStatus === "loading"}
          onClick={() => onPlay(row)}
          testId={`compact-dial-play-${slug}`}
        />
      )}
      <FrontDoorRow
        ds={row.ds}
        show={row.show}
        ov={0}
        scrubSlug={slug}
        isActive={slug === activeSlug}
        isSampling={isSampling}
        onTuneIn={() => onTuneIn(row)}
        presence={presenceMap.get(row.ds.station.id)}
        compactSentence
        displayMode={displayMode}
        seedsLower={seedsLower}
        onAddArtist={onAddArtist}
        suppressCrossings={suppressCrossings}
        crossingScope={crossingScope}
        hasCrossing={!suppressCrossings && hasAnyCrossing(row.ds, crossingScope)}
        onOpenLastSet={onOpenLastSet ? () => onOpenLastSet(row) : undefined}
        lastSetSummary={lastSetSummaries?.get(slug)}
        unchangedSinceScan={unchangedSlugs?.has(slug) === true}
      />
      {onToggleSkip && (
        <input
          type="checkbox"
          className="compact-dial__scan-checkbox"
          checked={!isSkipped}
          aria-label={
            isSkipped
              ? `Include ${row.ds.station.name} in scan`
              : `Skip ${row.ds.station.name} in scan`
          }
          title={
            isSkipped
              ? "Excluded from scan — check to include"
              : "Included in scan — uncheck to skip"
          }
          onChange={() => onToggleSkip(slug)}
          onClick={(e) => e.stopPropagation()}
        />
      )}
    </div>
  );
}

type CompactCategory = StationCategory | "other";

interface CategoryGroup {
  category: CompactCategory;
  label: string;
  rows: Array<{ row: DialLaneRow; isSkipped: boolean }>;
}

interface CategoryNowPlayingEntry {
  row: DialLaneRow;
  isSkipped: boolean;
  artist: string | null;
  title: string | null;
  label: string;
  hasTrack: boolean;
  /** Source observation time of the displayed track; NaN when trackless. */
  playedAtMs: number;
}

function categoryForRow(row: DialLaneRow): CompactCategory {
  const category = row.ds.station.stationCategories?.[0];
  return STATION_CATEGORY_DEFINITIONS.some((definition) => definition.cat === category)
    ? category as StationCategory
    : "other";
}

function categoryLabel(category: CompactCategory): string {
  if (category === "other") return "Other stations";
  return stationCategoryShortLabel(category);
}

function categoryNowPlaying(rows: CategoryGroup["rows"]): CategoryNowPlayingEntry[] {
  const entries = rows.map(({ row, isSkipped }) => {
    const track = row.ds.isLive ? row.ds.liveTrack ?? row.show?.currentTrack ?? null : null;
    const artist = cleanLiveValue(track?.artist);
    const title = cleanLiveValue(track?.title);
    const hasTrack = Boolean(artist || title);
    // REST live rows deliberately stamp `playedAt` with the current client
    // time for freshness UI. All needs the actual source start time instead;
    // fall back for schedule/SSE rows that already keep it in `playedAt`.
    const playedAtMs = hasTrack && track
      ? new Date(track.sourcePlayedAt ?? track.playedAt).getTime()
      : Number.NaN;
    return {
      row,
      isSkipped,
      artist,
      title,
      hasTrack,
      playedAtMs,
      label: hasTrack
        ? `${artist ?? title}${artist && title ? ` — ${title}` : ""}`
        : "Now playing unavailable",
    };
  });

  // The category itself remains editorially ordered. Only this derived view is
  // sorted by the values currently on air, with station name as a stable tie
  // breaker so a metadata refresh cannot make rows jump randomly.
  return entries.sort((a, b) =>
    Number(b.hasTrack) - Number(a.hasTrack)
    || a.label.localeCompare(b.label, "en", { sensitivity: "base" })
    || a.row.ds.station.name.localeCompare(b.row.ds.station.name, "en", {
      numeric: true,
      sensitivity: "base",
    })
    || a.row.ds.station.slug.localeCompare(b.row.ds.station.slug, "en"),
  );
}

/**
 * The All-overview card feed: one station card per station, ordered so the
 * freshest live now-playing sits far left and the strip scrolls back through
 * older observations; stations without usable metadata sit at the end, so a
 * quiet station never takes the lead spot.
 */
function categoryCardFeed(rows: CategoryGroup["rows"]): CategoryNowPlayingEntry[] {
  const entries = categoryNowPlaying(rows);
  const live = entries
    .filter((entry) => entry.hasTrack && !Number.isNaN(entry.playedAtMs))
    .sort((a, b) => b.playedAtMs - a.playedAtMs);
  const quiet = entries.filter(
    (entry) => !entry.hasTrack || Number.isNaN(entry.playedAtMs),
  );
  return [...live, ...quiet];
}

/**
 * A now-playing observation counts as FRESH — worth a pulse so the listener
 * notices it — when the track was played within the last half hour. Future
 * timestamps (clock skew) also count as fresh.
 */
const CATEGORY_FRESH_WINDOW_MS = 30 * 60_000;

function isFreshEntry(entry: CategoryNowPlayingEntry, nowMs: number): boolean {
  return entry.hasTrack
    && !Number.isNaN(entry.playedAtMs)
    && nowMs - entry.playedAtMs <= CATEGORY_FRESH_WINDOW_MS;
}

function buildCompactCategoryGroups(
  activeRows: DialLaneRow[],
  skippedRows: DialLaneRow[],
): CategoryGroup[] {
  const groups = new Map<CompactCategory, CategoryGroup>();
  const append = (row: DialLaneRow, isSkipped: boolean) => {
    const category = categoryForRow(row);
    const existing = groups.get(category);
    if (existing) {
      existing.rows.push({ row, isSkipped });
      return;
    }
    groups.set(category, {
      category,
      label: categoryLabel(category),
      rows: [{ row, isSkipped }],
    });
  };

  activeRows.forEach((row) => append(row, false));
  skippedRows.forEach((row) => append(row, true));

  const editorialOrder = new Map(
    STATION_CATEGORY_DEFINITIONS.map((definition, index) => [definition.cat, index]),
  );
  return [...groups.values()].sort((a, b) =>
    (editorialOrder.get(a.category as StationCategory) ?? Number.MAX_SAFE_INTEGER)
    - (editorialOrder.get(b.category as StationCategory) ?? Number.MAX_SAFE_INTEGER));
}

/**
 * A focused category's station list: every station in the category (skipped
 * included, dimmed) in the existing compact now-playing row format with
 * play, tune-in, and per-station scan-skip controls.
 */
function CategoryNowPlayingFeed({
  group,
  activeSlug,
  playerStatus,
  onTuneIn,
  onPlay,
  onToggleSkip,
}: {
  group: CategoryGroup;
  activeSlug: string | null;
  playerStatus: PlayerStatus;
  onTuneIn: (row: DialLaneRow) => void;
  onPlay: (row: DialLaneRow) => void;
  onToggleSkip?: (slug: string) => void;
}) {
  const entries = categoryNowPlaying(group.rows);

  return (
    <div
      className="compact-category-dial__now-feed"
      id={`compact-category-${group.category}`}
      role="region"
      aria-label={`${group.label} now-playing feed`}
      data-testid={`compact-category-${group.category}-now-feed`}
    >
      {entries.length === 0 && (
        <p className="compact-category-dial__empty-category">
          No stations in {group.label} yet.
        </p>
      )}
      {entries.map((entry) => {
        const slug = entry.row.ds.station.slug;
        const isActive = slug === activeSlug;
        const isPlayable = resolvePlaybackSource(entry.row.ds.station) != null;
        return (
          <div
            className={[
              "compact-category-dial__feed-row",
              entry.isSkipped ? "compact-category-dial__feed-row--skipped" : "",
              isActive ? "compact-category-dial__feed-row--active" : "",
            ].filter(Boolean).join(" ")}
            key={slug}
          >
            {isPlayable && (
              <CompactPlayButton
                title={entry.row.ds.station.name}
                isPlaying={isActive && playerStatus === "playing"}
                isLoading={isActive && playerStatus === "loading"}
                onClick={() => onPlay(entry.row)}
                testId={`compact-category-feed-play-${slug}`}
              />
            )}
            <button
              type="button"
              className="compact-category-dial__feed-tune"
              onClick={() => onTuneIn(entry.row)}
              aria-label={`${entry.label} · ${entry.row.ds.station.name} — tune in`}
            >
              {/* Station identity cube — station logo or neutral fallback,
                  immediately left of the now-playing text. */}
              <StationMark
                name={entry.row.ds.station.name}
                logoUrl={entry.row.ds.station.logoUrl}
                homepageUrl={entry.row.ds.station.homepageUrl}
                variant="cube"
              />
              <span>{entry.label}</span>
              <b>{entry.row.ds.station.name}</b>
            </button>
            {onToggleSkip && (
              <input
                type="checkbox"
                className="compact-dial__scan-checkbox"
                checked={!entry.isSkipped}
                aria-label={entry.isSkipped
                  ? `Include ${entry.row.ds.station.name} in scan`
                  : `Skip ${entry.row.ds.station.name} in scan`}
                onChange={() => onToggleSkip(slug)}
                onClick={(event) => event.stopPropagation()}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * The All tab is one uninterrupted live feed: every station from the checked
 * categories competes in the same freshest-first ordering. CSS lays the
 * sequence into a four-row, horizontally scrollable station rail.
 */
function AllNowPlayingFeed({
  groups,
  activeSlug,
  playerStatus,
  onPlay,
}: {
  groups: readonly CategoryGroup[];
  activeSlug: string | null;
  playerStatus: PlayerStatus;
  onPlay: (row: DialLaneRow) => void;
}) {
  const entries = categoryCardFeed(groups.flatMap((group) => group.rows));
  // Freshness is judged against mount time (the StationList-sanctioned
  // pattern — Date.now() belongs in a state initializer, not in render);
  // the keyed fade-in on the artist line is the per-update cue instead.
  const [nowMs] = useState(() => Date.now());
  return (
    <div
      className="compact-category-dial__all-feed"
      role="group"
      aria-label="Selected stations now playing"
      data-testid="compact-category-all-feed"
    >
      {entries.map((entry) => {
        const station = entry.row.ds.station;
        const slug = station.slug;
        const isActive = slug === activeSlug;
        const isPlayable = resolvePlaybackSource(station) != null;
        const fresh = isFreshEntry(entry, nowMs);
        const playbackAction = !isPlayable
          ? "Unavailable"
          : isActive && playerStatus === "playing"
            ? "Pause"
            : isActive && playerStatus === "loading"
              ? "Loading"
              : "Play";
        const trackDescription = entry.hasTrack
          ? [entry.artist, entry.title].filter(Boolean).join(" — ")
          : "no current metadata";
        return (
          <button
            type="button"
            key={slug}
            className={[
              "compact-category-dial__station",
              fresh ? "compact-category-dial__station--fresh" : "",
              entry.hasTrack ? "" : "compact-category-dial__station--quiet",
              entry.isSkipped ? "compact-category-dial__station--skipped" : "",
              isActive ? "compact-category-dial__station--active" : "",
            ].filter(Boolean).join(" ")}
            data-testid={`compact-category-station-${slug}`}
            aria-label={`${playbackAction} ${station.name}, ${entry.hasTrack ? `currently playing ${trackDescription}` : trackDescription}`}
            aria-pressed={isActive && playerStatus === "playing"}
            aria-disabled={!isPlayable || (isActive && playerStatus === "loading") ? true : undefined}
            onClick={() => {
              if (isPlayable && !(isActive && playerStatus === "loading")) onPlay(entry.row);
            }}
          >
            {/* Station identity mark — same safe treatment as every other
                listener surface: proxied/validated logo with a neutral
                fallback, never a broken image or track artwork. */}
            <StationMark
              name={station.name}
              logoUrl={station.logoUrl}
              homepageUrl={station.homepageUrl}
              variant="cube"
              className="compact-category-dial__station-logo"
            />
            <span className="compact-category-dial__station-lines">
              <span
                className="compact-category-dial__station-name"
                title={station.name}
              >
                {station.name}
              </span>
              <span className="compact-category-dial__station-track-line">
                <span
                  className="compact-category-dial__station-track"
                  key={entry.hasTrack ? `${entry.artist}|${entry.playedAtMs}` : "quiet"}
                >
                  {entry.hasTrack
                    ? entry.artist ?? entry.title ?? "No metadata"
                    : "No metadata"}
                </span>
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

interface FirstPlayHistoryItem {
  id: number;
  mbid: string;
  title: string;
  artist: string;
  artworkUrl: string | null;
  releaseYear: number | null;
  releaseDate: string | null;
  playedAt: string;
  station: { slug: string; name: string };
}

/**
 * A home-only premiere rail. The archive endpoint supplies confirmed,
 * resolved first appearances that also meet Lore's established First/premiere
 * release-date rule, rather than inferring "new" from a station's transient
 * current metadata.
 */
export function FirstPlayFeed() {
  const { ride } = usePlayer();
  const [items, setItems] = useState<FirstPlayHistoryItem[]>([]);
  const [loading, setLoading] = useState(() => typeof fetch === "function");

  useEffect(() => {
    if (typeof fetch !== "function") return;
    let cancelled = false;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8_000);
    void fetch("/api/player/history?scope=7d&filter=firstPlays&order=desc&limit=18&home=1", {
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error("first plays unavailable");
        return response.json() as Promise<{ items?: FirstPlayHistoryItem[] }>;
      })
      .then((data) => {
        if (!cancelled) setItems(data.items ?? []);
      })
      .catch(() => {
        // The live station rail remains useful when the optional archive read
        // is unavailable; fail quietly rather than leaving a broken panel.
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        clearTimeout(timeoutId);
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timeoutId);
    };
  }, []);

  return (
    <section className="compact-first-plays" aria-label="Recent first plays">
      <div className="compact-first-plays__header">
        <span>First plays</span>
        {loading && <span>Loading…</span>}
      </div>
      <div className="compact-first-plays__rail" data-testid="compact-first-plays">
        {!loading && items.length === 0 && (
          <p className="home-discovery__empty">No first plays in the last 7 days.</p>
        )}
        {items.map((item) => (
          <button
            type="button"
            key={item.id}
            className="compact-first-plays__tile"
            aria-label={`Preview ${item.artist} — ${item.title}, first played on ${item.station.name}`}
            onClick={() => {
              ride.startReplay(
                [{
                  mbid: item.mbid,
                  title: item.title,
                  artist: item.artist,
                  artworkUrl: item.artworkUrl,
                  links: [],
                }],
                `First play · ${item.station.name}`,
                { timeOrientation: "curated", previewOnly: true, previewDwellMs: 7_000 },
              );
            }}
          >
            <span className="compact-first-plays__artist">{item.artist}</span>
            <span className="compact-first-plays__title">{item.title}</span>
            <span className="compact-first-plays__byline">
              <span className="compact-first-plays__release-date">
                {releaseDateLabel(item)}
              </span>
              <span className="compact-first-plays__separator" aria-hidden="true"> · </span>
              <span className="compact-first-plays__station">{item.station.name}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function CategoryFirstDial({
  activeRows,
  skippedRows,
  activeSlug,
  playerStatus,
  onTuneIn,
  onPlay,
  onToggleSkip,
  visibleUncategorizedSlugs,
  onToggleCategory,
  activeCategories,
  hideCategoryFilters = false,
  remoteOpen = false,
  onCloseRemote,
}: CompactDialProps) {
  const groups = useMemo(
    () => buildCompactCategoryGroups(activeRows, skippedRows),
    [activeRows, skippedRows],
  );
  // Which category the feed is focused on; null = the All card overview.
  const [focusedCategory, setFocusedCategory] = useState<StationCategory | null>(null);

  const groupByCategory = useMemo(() => {
    const map = new Map<CompactCategory, CategoryGroup>();
    for (const group of groups) map.set(group.category, group);
    return map;
  }, [groups]);

  const isChecked = useCallback(
    (category: StationCategory) => activeCategories?.has(category) ?? true,
    [activeCategories],
  );

  // Clicking a tab focuses its category's station list. An unchecked
  // (excluded) tab re-includes the category on click so the strip doubles as
  // the re-entry point for a saved-but-hidden station class.
  const focusTab = useCallback(
    (category: StationCategory) => {
      if (!isChecked(category)) onToggleCategory?.(category);
      setFocusedCategory(category);
    },
    [isChecked, onToggleCategory],
  );

  // The tab checkbox only governs All-overview membership. Excluding the
  // focused category returns to All — its station list would no longer
  // reflect the listener's selection.
  const toggleTabInclusion = useCallback(
    (category: StationCategory) => {
      onToggleCategory?.(category);
      if (isChecked(category) && focusedCategory === category) {
        setFocusedCategory(null);
      }
    },
    [isChecked, onToggleCategory, focusedCategory],
  );

  // The All feed includes every station from a checked category. Excluded
  // categories remain in the tabs as an immediate way to restore them.
  const overviewGroups = COMPACT_CATEGORY_ORDER
    .filter((category) => isChecked(category) && groupByCategory.has(category))
    .map((category) => groupByCategory.get(category)!);

  const focusedGroup = focusedCategory
    ? groupByCategory.get(focusedCategory) ?? {
        category: focusedCategory,
        label: stationCategoryShortLabel(focusedCategory),
        rows: [],
      }
    : null;

  const uncategorizedGroup = groupByCategory.get("other") ?? null;
  const visibleUncategorizedGroup = uncategorizedGroup && {
    ...uncategorizedGroup,
    rows: uncategorizedGroup.rows.filter(
      ({ row, isSkipped }) =>
        isSkipped || visibleUncategorizedSlugs == null
        || visibleUncategorizedSlugs.has(row.ds.station.slug),
    ),
  };
  const selectedOverviewGroups = visibleUncategorizedGroup?.rows.length
    ? [...overviewGroups, visibleUncategorizedGroup]
    : overviewGroups;

  const remoteRows = useMemo(() => {
    const source = focusedGroup ? [focusedGroup] : selectedOverviewGroups;
    const seen = new Set<string>();
    return source.flatMap((group) => group.rows)
      .filter(({ row, isSkipped }) => {
        const slug = row.ds.station.slug;
        if (isSkipped || seen.has(slug)) return false;
        seen.add(slug);
        return true;
      })
      .map(({ row }) => row);
  }, [focusedGroup, selectedOverviewGroups]);

  useEffect(() => {
    if (!remoteOpen || !onCloseRemote) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRemote();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [remoteOpen, onCloseRemote]);

  const tabStrip = (
    <div className="compact-category-dial__tabs" role="tablist" aria-label="Station categories">
      <button
        type="button"
        role="tab"
        id="compact-category-tab-all"
        aria-selected={focusedCategory === null}
        aria-controls="compact-category-panel"
        className={[
          "compact-category-dial__tab-button",
          focusedCategory === null ? "compact-category-dial__tab-button--selected" : "",
        ].filter(Boolean).join(" ")}
        data-testid="compact-category-tab-all"
        onClick={() => setFocusedCategory(null)}
      >
        All
      </button>
      {COMPACT_CATEGORY_ORDER.map((category) => {
        const checked = isChecked(category);
        const selected = focusedCategory === category;
        const label = stationCategoryShortLabel(category);
        return (
          <span
            key={category}
            className={[
              "compact-category-dial__tab",
              checked ? "" : "compact-category-dial__tab--excluded",
            ].filter(Boolean).join(" ")}
          >
            <button
              type="button"
              role="tab"
              id={`compact-category-tab-${category}`}
              aria-selected={selected}
              aria-controls="compact-category-panel"
              className={[
                "compact-category-dial__tab-button",
                selected ? "compact-category-dial__tab-button--selected" : "",
              ].filter(Boolean).join(" ")}
              data-testid={`compact-category-tab-${category}`}
              onClick={() => focusTab(category)}
            >
              {label}
            </button>
            {onToggleCategory && (
              <input
                type="checkbox"
                className="compact-category-dial__tab-check"
                checked={checked}
                aria-label={`Include ${label}`}
                title={checked
                  ? `Included in All — uncheck to exclude ${label}`
                  : `Excluded from All — check to include ${label}`}
                onChange={() => toggleTabInclusion(category)}
              />
            )}
          </span>
        );
      })}
    </div>
  );

  return (
    <div className="compact-dial compact-dial--categories" data-testid="compact-category-dial">
      {!hideCategoryFilters && tabStrip}
      {remoteOpen && (
        <div
          id="compact-category-remote"
          className="compact-category-dial__remote"
          role="dialog"
          aria-modal="true"
          aria-label="Radio remote"
          data-testid="compact-category-remote"
        >
          <div className="compact-category-dial__remote-header">
            <span>Radio remote</span>
            <button
              type="button"
              className="compact-category-dial__remote-close"
              aria-label="Close radio remote"
              onClick={onCloseRemote}
            >
              <X aria-hidden="true" />
            </button>
          </div>
          <div className="compact-category-dial__remote-filters">
            {tabStrip}
          </div>
          <div
            className="compact-category-dial__remote-rail"
            role="group"
            aria-label="Remote stations"
            data-testid="compact-category-remote-rail"
          >
            {remoteRows.map((row, index) => (
              <CompactDialRemote
                key={row.ds.station.slug}
                row={row}
                ordinal={index + 1}
                isSampling={false}
                isActive={row.ds.station.slug === activeSlug}
                onTuneIn={onTuneIn}
              />
            ))}
          </div>
        </div>
      )}
      {focusedGroup ? (
        <div
          className="compact-category-dial__focused"
          role="tabpanel"
          id="compact-category-panel"
          aria-labelledby={`compact-category-tab-${focusedGroup.category}`}
        >
          <CategoryNowPlayingFeed
            group={focusedGroup}
            activeSlug={activeSlug}
            playerStatus={playerStatus}
            onTuneIn={onTuneIn}
            onPlay={onPlay}
            onToggleSkip={onToggleSkip}
          />
        </div>
      ) : (
        <div
          className="compact-category-dial__overview"
          role="tabpanel"
          id="compact-category-panel"
          aria-labelledby="compact-category-tab-all"
        >
          <AllNowPlayingFeed
            groups={selectedOverviewGroups}
            activeSlug={activeSlug}
            playerStatus={playerStatus}
            onPlay={onPlay}
          />
        </div>
      )}
    </div>
  );
}

export function CompactDial({
  activeRows,
  skippedRows,
  samplingRowIdx = null,
  activeSlug,
  playerStatus,
  presenceMap,
  onTuneIn,
  onPlay,
  onToggleSkip,
  crossingScope = DEFAULT_CROSSING_SCOPE,
  suppressCrossings = false,
  displayMode,
  seedsLower,
  onAddArtist,
  density = "normal",
  firstOrdinal = 1,
  onOpenLastSet,
  lastSetSummaries,
  unchangedSlugs,
  categoryFirst = false,
  visibleUncategorizedSlugs,
  onToggleCategory,
  activeCategories,
  hideCategoryFilters = false,
  remoteOpen = false,
  onCloseRemote,
}: CompactDialProps) {
  const totalRows = activeRows.length + skippedRows.length;

  if (totalRows === 0) {
    return (
      <div className="compact-dial compact-dial--empty">
        <p className="compact-dial__empty-msg">No stations to show right now.</p>
      </div>
    );
  }

  if (categoryFirst) {
    return (
      <CategoryFirstDial
        activeRows={activeRows}
        skippedRows={skippedRows}
        samplingRowIdx={samplingRowIdx}
        activeSlug={activeSlug}
        playerStatus={playerStatus}
        presenceMap={presenceMap}
        onTuneIn={onTuneIn}
        onPlay={onPlay}
        onToggleSkip={onToggleSkip}
        crossingScope={crossingScope}
        suppressCrossings={suppressCrossings}
        displayMode={displayMode}
        seedsLower={seedsLower}
        onAddArtist={onAddArtist}
        onOpenLastSet={onOpenLastSet}
        lastSetSummaries={lastSetSummaries}
        unchangedSlugs={unchangedSlugs}
        visibleUncategorizedSlugs={visibleUncategorizedSlugs}
        onToggleCategory={onToggleCategory}
        activeCategories={activeCategories}
        hideCategoryFilters={hideCategoryFilters}
        remoteOpen={remoteOpen}
        onCloseRemote={onCloseRemote}
      />
    );
  }

  // ── Micro density: the current 15-station page as a numbered keypad.
  //    Skipped rows and track detail stay on the normal density — one tap
  //    on the remote's density key brings them back. ─────────────────────
  if (density === "micro") {
    return (
      <div className="compact-dial compact-dial--micro">
        <MicroDialRemote
          rows={activeRows}
          firstOrdinal={firstOrdinal}
          samplingRowIdx={samplingRowIdx}
          activeSlug={activeSlug}
          onTuneIn={onTuneIn}
          unchangedSlugs={unchangedSlugs}
        />
      </div>
    );
  }

  // ── Compact density: name-only remote rows, ten to a page. ────────────
  if (density === "compact") {
    const emptyRemoteSlots = Math.max(0, COMPACT_REMOTE_SIZE - activeRows.length);
    return (
      <div className="compact-dial compact-dial--compact">
        {activeRows.map((row, i) => (
          <CompactDialRemote
            key={row.ds.station.slug}
            row={row}
            ordinal={firstOrdinal + i}
            isSampling={samplingRowIdx === i}
            isActive={row.ds.station.slug === activeSlug}
            onTuneIn={onTuneIn}
            unchanged={unchangedSlugs?.has(row.ds.station.slug) === true}
          />
        ))}
        {/* Empty filler slots so the grid always spans 10 rows */}
        {Array.from({ length: emptyRemoteSlots }).map((_, i) => (
          <div
            key={`empty-${i}`}
            className="compact-dial__remote-row compact-dial__remote-row--empty"
            aria-hidden="true"
          />
        ))}
      </div>
    );
  }

  const emptySlots = Math.max(0, COMPACT_DIAL_SIZE - activeRows.length);

  return (
    <div className="compact-dial">
      {/* ── Active rows: fixed 5-slot grid ─────────────────────────────── */}
      {activeRows.map((row, i) => (
          <CompactDialRow
          key={row.ds.station.slug}
          row={row}
          isSampling={samplingRowIdx === i}
          isSkipped={false}
          activeSlug={activeSlug}
          playerStatus={playerStatus}
          presenceMap={presenceMap}
          onTuneIn={onTuneIn}
          onPlay={onPlay}
          onToggleSkip={onToggleSkip}
          crossingScope={crossingScope}
          suppressCrossings={suppressCrossings}
          displayMode={displayMode}
          seedsLower={seedsLower}
          onAddArtist={onAddArtist}
          onOpenLastSet={onOpenLastSet}
          lastSetSummaries={lastSetSummaries}
          unchangedSlugs={unchangedSlugs}
        />
      ))}
      {/* Empty filler slots so the grid always spans 5 rows */}
      {Array.from({ length: emptySlots }).map((_, i) => (
        <div
          key={`empty-${i}`}
          className="compact-dial__row compact-dial__row--empty"
          aria-hidden="true"
        />
      ))}
      {/* ── Skipped rows: scrollable overflow below the fold ────────────── */}
      {skippedRows.length > 0 && (
        <div className="compact-dial__skipped-region" aria-label="Excluded from scan">
          {skippedRows.map((row) => (
            <CompactDialRow
              key={row.ds.station.slug}
              row={row}
              isSampling={false}
              isSkipped={true}
              activeSlug={activeSlug}
              playerStatus={playerStatus}
              presenceMap={presenceMap}
              onTuneIn={onTuneIn}
              onPlay={onPlay}
              onToggleSkip={onToggleSkip}
              crossingScope={crossingScope}
              suppressCrossings={suppressCrossings}
              displayMode={displayMode}
              seedsLower={seedsLower}
              onAddArtist={onAddArtist}
            />
          ))}
        </div>
      )}
    </div>
  );
}
