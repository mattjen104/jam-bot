/**
 * CompactDial — the SplitHome mini dial feed.
 *
 * Layout model
 * ─────────────
 * activeRows  — stations NOT in the skip set, sliced to the current page
 *               (5 normal / 10 compact / 15 micro). These fill the dial band.
 * skippedRows — ALL skipped stations, appended below in a scrollable
 *               overflow region so the listener can still reach them without
 *               navigating to a different page.
 *
 * The scan remote's page count and candidate indices are derived from
 * activeRows only — skipped stations never participate in a scan.
 *
 * Checkbox: far-right trailing edge of each row.
 *   Checked  (active)  → filled key, normal opacity
 *   Unchecked (skipped) → open key, row dims, row lives in the below-fold
 *                         overflow region regardless of alphabetical position
 */

import { useMemo, useState, type ReactNode } from "react";
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
  crossingCountForScope,
  crossingScopeLabel,
  firstPlayCountForScope,
  hasAnyCrossing,
} from "../lib/crossingScope";
import type { DialDensity } from "../lib/dialDensityState";
import type { LastSetSummary } from "../lib/latestSet";
import { STATION_CATEGORY_DEFINITIONS, type StationCategory } from "../lib/dialCategories";
import {
  SPECIALIST_SUBCATEGORY_DEFINITIONS,
  specialistSubcategoryForStation,
  specialistSubcategoryLabel,
  type SpecialistSubcategory,
} from "../lib/specialistCategories";
import { cleanLiveValue } from "./dialViewHelpers";
import { AgeDistributionBadge } from "./dial/AgeDistributionBadge";
import { ageDistribution } from "../lib/dialAgeDistribution";

const COMPACT_DIAL_SIZE = 5;
/** Rows per page at the "compact" (name-only remote) density. */
const COMPACT_REMOTE_SIZE = 10;

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
  onToggleCategory?: (category: StationCategory) => void;
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
   * The home Feed's category-first presentation. Categories are concise by
   * default and reveal the same full station rows on demand.
   */
  categoryFirst?: boolean;
  /**
   * Category cards are intentionally unpaged; the direct ungrouped fallback
   * still follows the compact Feed's pager so scan/page commands retain their
   * meaning for personal and unclassified stations.
   */
  visibleUncategorizedSlugs?: ReadonlySet<string>;
  /** Opens the first editorial category on initial render for a tree-first home view. */
  defaultOpenFirstCategory?: boolean;
  /** Renders every editorial category at once, without a category pager. */
  showAllCategories?: boolean;
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
}

interface CategoryScopeMetrics {
  crossings: number;
  firstPlays: number;
}

interface SpecialistSubcategoryGroup {
  id: SpecialistSubcategory;
  label: string;
  rows: CategoryGroup["rows"];
}

// Retained as a compatibility renderer for callers that still import the
// previous dense category helper; category-first now mounts the feed renderer.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function DenseCategoryStationList({
  group,
  density,
  activeSlug,
  playerStatus,
  onTuneIn,
  onPlay,
  sampledSlug,
}: {
  group: CategoryGroup;
  density: DialDensity;
  activeSlug: string | null;
  playerStatus: PlayerStatus;
  onTuneIn: (row: DialLaneRow) => void;
  onPlay: (row: DialLaneRow) => void;
  sampledSlug: string | null;
}) {
  const pageSize = density === "compact" ? COMPACT_REMOTE_SIZE : COMPACT_DIAL_SIZE;
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(group.rows.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const rows = group.rows.slice(currentPage * pageSize, currentPage * pageSize + pageSize);

  return (
    <div className={`compact-category-dial__dense-list${density === "compact" ? " compact-category-dial__dense-list--remote" : ""}`}
      aria-label={`${group.label} now playing`}>
      {rows.map(({ row, isSkipped }) => {
        const track = row.ds.isLive ? row.ds.liveTrack ?? row.show?.currentTrack : null;
        const artist = cleanLiveValue(track?.artist);
        const title = cleanLiveValue(track?.title);
        const stationName = row.ds.station.name;
        const isPlayable = resolvePlaybackSource(row.ds.station) != null;
        const isActive = row.ds.station.slug === activeSlug;
        const nowPlaying = artist || title
          ? `${artist ?? title}${artist && title ? ` — ${title}` : ""}`
          : "Now playing unavailable";
        return (
          <div
            className={[
              "compact-category-dial__dense-row",
              isSkipped ? "compact-category-dial__dense-row--skipped" : "",
              isActive ? "compact-category-dial__dense-row--active" : "",
              row.ds.station.slug === sampledSlug ? "compact-category-dial__dense-row--sampling" : "",
            ].filter(Boolean).join(" ")}
            key={row.ds.station.slug}
          >
            {isPlayable && (
              <CompactPlayButton
                title={stationName}
                isPlaying={isActive && playerStatus === "playing"}
                isLoading={isActive && playerStatus === "loading"}
                onClick={() => onPlay(row)}
                testId={`compact-category-play-${row.ds.station.slug}`}
              />
            )}
            <button
              type="button"
              className="compact-category-dial__dense-tune"
              onClick={() => onTuneIn(row)}
              aria-label={`${nowPlaying} · ${stationName} — tune in`}
            >
              <span className="compact-category-dial__dense-track">{nowPlaying}</span>
              <b>{stationName}</b>
            </button>
          </div>
        );
      })}
      {pageCount > 1 && (
        <div className="compact-dial__pager" role="group" aria-label={`${group.label} now playing pages`}>
          <button type="button" disabled={currentPage === 0} onClick={() => setPage((value) => value - 1)}
            aria-label={`Previous ${group.label} now playing page`}>←</button>
          <span>Page {currentPage + 1} of {pageCount}</span>
          <button type="button" disabled={currentPage >= pageCount - 1} onClick={() => setPage((value) => value + 1)}
            aria-label={`Next ${group.label} now playing page`}>→</button>
        </div>
      )}
    </div>
  );
}

/**
 * Category totals include skipped stations because those stations remain
 * represented by the category summary and are still reachable when expanded.
 * The separate "in scan" count below continues to describe active rows only.
 */
function categoryScopeMetrics(
  rows: CategoryGroup["rows"],
  scope: CrossingScope,
): CategoryScopeMetrics {
  return rows.reduce(
    (totals, { row }) => ({
      crossings: totals.crossings + crossingCountForScope(row.ds, scope),
      firstPlays: totals.firstPlays + firstPlayCountForScope(row.ds, scope),
    }),
    { crossings: 0, firstPlays: 0 },
  );
}

function categoryForRow(row: DialLaneRow): CompactCategory {
  const category = row.ds.station.stationCategories?.[0];
  return STATION_CATEGORY_DEFINITIONS.some((definition) => definition.cat === category)
    ? category as StationCategory
    : "other";
}

function categoryLabel(category: CompactCategory): string {
  if (category === "other") return "Other stations";
  return STATION_CATEGORY_DEFINITIONS.find((definition) => definition.cat === category)?.label
    ?? "Other stations";
}

function categoryNowPlaying(rows: CategoryGroup["rows"]): CategoryNowPlayingEntry[] {
  const entries = rows.map(({ row, isSkipped }) => {
    const track = row.ds.isLive ? row.ds.liveTrack ?? row.show?.currentTrack ?? null : null;
    const artist = cleanLiveValue(track?.artist);
    const title = cleanLiveValue(track?.title);
    const hasTrack = Boolean(artist || title);
    return {
      row,
      isSkipped,
      artist,
      title,
      hasTrack,
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

function CategoryNowPlayingFeed({
  group,
  density,
  showAll = false,
  activeSlug,
  playerStatus,
  onTuneIn,
  onPlay,
  onToggleSkip,
}: {
  group: CategoryGroup;
  density: DialDensity;
  showAll?: boolean;
  activeSlug: string | null;
  playerStatus: PlayerStatus;
  onTuneIn: (row: DialLaneRow) => void;
  onPlay: (row: DialLaneRow) => void;
  onToggleSkip?: (slug: string) => void;
}) {
  const entries = categoryNowPlaying(group.rows);
  const pageSize = density === "compact" ? COMPACT_REMOTE_SIZE : COMPACT_DIAL_SIZE;
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(entries.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = showAll
    ? entries
    : entries.slice(currentPage * pageSize, currentPage * pageSize + pageSize);

  return (
    <div
      className={`compact-category-dial__now-feed${density === "compact" ? " compact-category-dial__now-feed--remote" : ""}`}
      id={`compact-category-${group.category}`}
      role="region"
      aria-label={`${group.label} now-playing feed`}
      data-testid={`compact-category-${group.category}-now-feed`}
    >
      {visible.map((entry) => {
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
      {!showAll && pageCount > 1 && (
        <div className="compact-dial__pager" role="group" aria-label={`${group.label} now-playing feed pages`}>
          <button type="button" disabled={currentPage === 0} onClick={() => setPage((value) => value - 1)}
            aria-label={`Previous ${group.label} now-playing feed page`}>←</button>
          <span>Page {currentPage + 1} of {pageCount}</span>
          <button type="button" disabled={currentPage >= pageCount - 1} onClick={() => setPage((value) => value + 1)}
            aria-label={`Next ${group.label} now-playing feed page`}>→</button>
        </div>
      )}
    </div>
  );
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

function buildSpecialistSubcategoryGroups(
  rows: CategoryGroup["rows"],
): SpecialistSubcategoryGroup[] {
  const groups = new Map<SpecialistSubcategory, SpecialistSubcategoryGroup>();
  for (const entry of rows) {
    const id = specialistSubcategoryForStation(entry.row.ds.station);
    const group = groups.get(id);
    if (group) {
      group.rows.push(entry);
    } else {
      groups.set(id, {
        id,
        label: specialistSubcategoryLabel(id),
        rows: [entry],
      });
    }
  }
  const order = new Map(
    SPECIALIST_SUBCATEGORY_DEFINITIONS.map((definition, index) => [definition.id, index]),
  );
  return [...groups.values()].sort(
    (a, b) => (order.get(a.id) ?? Number.MAX_SAFE_INTEGER)
      - (order.get(b.id) ?? Number.MAX_SAFE_INTEGER),
  );
}

function specialistNowPlaying(
  rows: SpecialistSubcategoryGroup["rows"],
): Array<{ stationName: string; artist: string | null; title: string | null }> {
  return rows.map(({ row }) => {
    if (!row.ds.isLive) return { stationName: row.ds.station.name, artist: null, title: null };
    const track = row.ds.liveTrack ?? row.show?.currentTrack ?? null;
    const artist = cleanLiveValue(track?.artist);
    const title = cleanLiveValue(track?.title);
    return artist || title
      ? { stationName: row.ds.station.name, artist, title }
      : { stationName: row.ds.station.name, artist: null, title: null };
  });
}

function SpecialistSubcategoryCard({
  group,
  expanded,
  onToggle,
  renderRows,
}: {
  group: SpecialistSubcategoryGroup;
  expanded: boolean;
  onToggle: () => void;
  renderRows: (group: CategoryGroup) => ReactNode;
}) {
  const [page, setPage] = useState(0);
  const nowPlaying = specialistNowPlaying(group.rows);
  const liveCount = nowPlaying.filter((entry) => entry.artist || entry.title).length;
  const categoryGroup: CategoryGroup = {
    category: "other",
    label: group.label,
    rows: group.rows,
  };
  return (
    <section className="compact-specialist-dial__subgroup" data-testid={`compact-specialist-${group.id}`}>
      <button
        type="button"
        className={`compact-specialist-dial__subsummary${expanded ? " compact-specialist-dial__subsummary--expanded" : ""}`}
        aria-expanded={expanded}
        aria-controls={`compact-specialist-${group.id}-stations`}
        onClick={onToggle}
      >
        <span className="compact-specialist-dial__sublabel">{group.label}</span>
        <span className="compact-specialist-dial__subcount">
          {group.rows.length} {group.rows.length === 1 ? "station" : "stations"} · {liveCount} now playing
        </span>
        <span aria-hidden="true">{expanded ? "−" : "+"}</span>
      </button>
      <div className="compact-specialist-dial__now-playing" aria-label={`${group.label} now playing`}>
        <div className="compact-specialist-dial__now-playing-heading">
          Now playing across {group.rows.length} {group.rows.length === 1 ? "station" : "stations"}
        </div>
        <div className="compact-specialist-dial__now-playing-list">
          {nowPlaying.map((entry) => (
            <div className="compact-specialist-dial__now-playing-row" key={entry.stationName}>
              <span>
                {entry.artist || entry.title
                  ? `${entry.artist ?? entry.title}${entry.artist && entry.title ? ` — ${entry.title}` : ""}`
                  : "Now playing unavailable"}
              </span>
              <b>{entry.stationName}</b>
            </div>
          ))}
        </div>
      </div>
      {expanded && (
        <div
          className="compact-specialist-dial__stations"
          id={`compact-specialist-${group.id}-stations`}
          role="region"
          aria-label={`${group.label} station controls`}
        >
          {renderRows({
            ...categoryGroup,
            rows: categoryGroup.rows.slice(page * 5, page * 5 + 5),
          })}
          {group.rows.length > 5 && (
            <div className="compact-dial__pager" role="group" aria-label={`${group.label} pages`}>
              <button type="button" disabled={page === 0} onClick={() => setPage((value) => value - 1)}
                aria-label={`Previous ${group.label} page`}>←</button>
              <span>Page {page + 1} of {Math.ceil(group.rows.length / 5)}</span>
              <button type="button" disabled={page >= Math.ceil(group.rows.length / 5) - 1}
                onClick={() => setPage((value) => value + 1)} aria-label={`Next ${group.label} page`}>→</button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function CategorySummary({
  group,
  expanded,
  onToggle,
  crossingScope,
  active,
  onToggleCategory,
}: {
  group: CategoryGroup;
  expanded: boolean;
  onToggle: () => void;
  crossingScope: CrossingScope;
  active: boolean;
  onToggleCategory?: () => void;
}) {
  const nowPlaying = categoryNowPlaying(group.rows);
  const leadNowPlaying = nowPlaying[0];
  const activeCount = group.rows.filter(({ isSkipped }) => !isSkipped).length;
  const stationCountLabel = `${group.rows.length} ${group.rows.length === 1 ? "station" : "stations"}`;
  const metrics = categoryScopeMetrics(group.rows, crossingScope);
  const scopeLabel = crossingScopeLabel(crossingScope);
  const age = ageDistribution(group.rows.flatMap(({ row }) => {
    const spins = row.show?.spins;
    return spins?.length ? spins : row.ds.liveTrack ? [row.ds.liveTrack] : [];
  }));
  return (
    <div className={`compact-category-dial__summary${expanded ? " compact-category-dial__summary--expanded" : ""}`}>
      <div className="compact-category-dial__topline">
        <button
          type="button"
          className="compact-category-dial__summary-button compact-category-dial__tree-disclosure"
          aria-expanded={expanded}
          aria-controls={`compact-category-${group.category}`}
          onClick={onToggle}
          data-testid={`compact-category-${group.category}`}
          aria-label={`${expanded ? "Close" : "Open"} ${group.label} now-playing feed`}
        >
          <span className="compact-category-dial__tree-mark" aria-hidden="true">
            {expanded ? "−" : "+"}
          </span>
          <span className="compact-category-dial__label">{group.label}</span>
        </button>
        {group.category !== "other" && onToggleCategory && (
          <label className="compact-category-dial__include">
            <input
              type="checkbox"
              checked={active}
              aria-label={`${active ? "Include" : "Exclude"} ${group.label}`}
              onChange={onToggleCategory}
              onClick={(event) => event.stopPropagation()}
            />
          </label>
        )}
      </div>
      <div className="compact-category-dial__now-header-line">
        {leadNowPlaying ? (
          <>
            <span>{leadNowPlaying.label}</span>
            <b>{leadNowPlaying.row.ds.station.name}</b>
          </>
        ) : (
          <span>Now playing unavailable</span>
        )}
      </div>
      <div className="compact-category-dial__meta">
        <span className="compact-category-dial__count">
          {stationCountLabel}{activeCount !== group.rows.length ? ` · ${activeCount} in scan` : ""}
        </span>
        <span
          className="compact-category-dial__metrics"
          aria-label={`${group.label} metrics for ${scopeLabel}`}
        >
          <span
            className="compact-category-dial__metric"
            aria-label={`${metrics.crossings} crossings in ${scopeLabel}`}
            title={`${metrics.crossings} crossings · ${scopeLabel}`}
          >
            <b aria-hidden="true">{metrics.crossings}</b> crossings
          </span>
          <span
            className="compact-category-dial__metric"
            aria-label={`${metrics.firstPlays} first plays in ${scopeLabel}`}
            title={`${metrics.firstPlays} first plays · ${scopeLabel}`}
          >
            <b aria-hidden="true">{metrics.firstPlays}</b> first plays
          </span>
        </span>
        <AgeDistributionBadge distribution={age} label={`${group.label} track age`} />
      </div>
    </div>
  );
}

function CategoryFirstDial({
  activeRows,
  skippedRows,
  samplingRowIdx,
  activeSlug,
  playerStatus,
  presenceMap,
  onTuneIn,
  onPlay,
  onToggleSkip,
  crossingScope,
  suppressCrossings,
  displayMode,
  seedsLower,
  onAddArtist,
  onOpenLastSet,
  lastSetSummaries,
  unchangedSlugs,
  visibleUncategorizedSlugs,
  onToggleCategory,
  activeCategories,
  defaultOpenFirstCategory = false,
  showAllCategories = false,
  density = "normal",
}: CompactDialProps) {
  const groups = useMemo(
    () => buildCompactCategoryGroups(activeRows, skippedRows),
    [activeRows, skippedRows],
  );
  const [expandedCategory, setExpandedCategory] = useState<CompactCategory | null>(null);
  const [hasChosenCategory, setHasChosenCategory] = useState(false);
  const [expandedSpecialist, setExpandedSpecialist] = useState<SpecialistSubcategory | null>(null);
  const [categoryPage, setCategoryPage] = useState(0);
  const specialistGroup = groups.find((group) => group.category === "specialist") ?? null;
  const specialistGroups = useMemo(
    () => (specialistGroup ? buildSpecialistSubcategoryGroups(specialistGroup.rows) : []),
    [specialistGroup],
  );
  const sampledRow = samplingRowIdx != null ? activeRows[samplingRowIdx] ?? null : null;
  const sampledSlug = sampledRow?.ds.station.slug ?? null;
  const sampledCategory = sampledRow ? categoryForRow(sampledRow) : null;
  const editorialGroups = groups.filter((group) => group.category !== "other");
  const defaultExpandedCategory = defaultOpenFirstCategory
    ? editorialGroups[0]?.category ?? null
    : null;
  const uncategorizedGroup = groups.find((group) => group.category === "other") ?? null;
  const visibleUncategorizedGroup = uncategorizedGroup && {
    ...uncategorizedGroup,
    rows: uncategorizedGroup.rows.filter(
      ({ row, isSkipped }) =>
        isSkipped || visibleUncategorizedSlugs == null
        || visibleUncategorizedSlugs.has(row.ds.station.slug),
    ),
  };
  const categoryPageCount = Math.max(1, Math.ceil(editorialGroups.length / 5));
  const visibleGroups = (defaultOpenFirstCategory || showAllCategories)
    ? editorialGroups
    : editorialGroups.slice(categoryPage * 5, categoryPage * 5 + 5);
  const pager = (label: string, page: number, pageCount: number, onPage: (next: number) => void) =>
    pageCount > 1 ? (
      <div className="compact-dial__pager" role="group" aria-label={`${label} pages`}>
        <button type="button" disabled={page === 0} onClick={() => onPage(page - 1)}
          aria-label={`Previous ${label} page`}>←</button>
        <span>Page {page + 1} of {pageCount}</span>
        <button type="button" disabled={page >= pageCount - 1} onClick={() => onPage(page + 1)}
          aria-label={`Next ${label} page`}>→</button>
      </div>
    ) : null;
  const renderRows = (group: CategoryGroup) => group.rows.map(({ row, isSkipped }) => (
    <CompactDialRow
      key={row.ds.station.slug}
      row={row}
      isSampling={row.ds.station.slug === sampledSlug}
      isSkipped={isSkipped}
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
  ));

  return (
    <div className="compact-dial compact-dial--categories" data-testid="compact-category-dial">
      {visibleGroups.map((group) => {
        // A running station scan keeps its current station visible, but does
        // not overwrite the listener's manually chosen category once it ends.
        const isExpanded =
          sampledCategory === group.category
          || expandedCategory === group.category
          || (!hasChosenCategory && defaultExpandedCategory === group.category);
        const isSpecialist = group.category === "specialist";
        return (
          <section
            className={`compact-category-dial__group${isExpanded ? " compact-category-dial__group--expanded" : ""}`}
            key={group.category}
          >
            <CategorySummary
              group={group}
              expanded={isExpanded}
              crossingScope={crossingScope ?? DEFAULT_CROSSING_SCOPE}
              active={activeCategories?.has(group.category as StationCategory) ?? true}
              onToggleCategory={
                onToggleCategory && group.category !== "other"
                  ? () => onToggleCategory(group.category as StationCategory)
                  : undefined
              }
               onToggle={() => {
                 setHasChosenCategory(true);
                  setExpandedCategory((current) => {
                    const activeCategory = current ?? defaultExpandedCategory;
                    return activeCategory === group.category ? null : group.category;
                  });
               }}
            />
            {isExpanded && (
              isSpecialist ? (
                <div
                  className="compact-specialist-dial__subgroups"
                  id={`compact-category-${group.category}`}
                  aria-label="Specialist subcategories"
                >
                  {specialistGroups.map((subcategory) => (
                    <SpecialistSubcategoryCard
                      key={subcategory.id}
                      group={subcategory}
                      expanded={expandedSpecialist === subcategory.id}
                      onToggle={() => setExpandedSpecialist((current) =>
                        current === subcategory.id ? null : subcategory.id)}
                      renderRows={renderRows}
                    />
                  ))}
                </div>
              ) : (
                <CategoryNowPlayingFeed
                  group={group}
                  density={density}
                  showAll={defaultOpenFirstCategory}
                  activeSlug={activeSlug}
                  playerStatus={playerStatus}
                  onTuneIn={onTuneIn}
                  onPlay={onPlay}
                  onToggleSkip={onToggleSkip}
                />
              )
            )}
          </section>
        );
      })}
      {!defaultOpenFirstCategory && !showAllCategories
        && pager("category", categoryPage, categoryPageCount, setCategoryPage)}
      {visibleUncategorizedGroup && visibleUncategorizedGroup.rows.length > 0 && (
        <section className="compact-category-dial__uncategorized" aria-label="Other stations">
          {editorialGroups.length > 0 && (
            <div className="compact-category-dial__uncategorized-label">Other stations</div>
          )}
          <div className="compact-category-dial__stations">
            {renderRows(visibleUncategorizedGroup)}
          </div>
        </section>
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
  defaultOpenFirstCategory,
  showAllCategories,
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
        defaultOpenFirstCategory={defaultOpenFirstCategory}
        showAllCategories={showAllCategories}
        density={density}
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
