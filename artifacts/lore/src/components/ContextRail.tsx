/**
 * ContextRail — the tuned-context navigation surface.
 *
 * Renders in the Dial's context region (replacing the old chip-based rail):
 *   1. the current summary sentence (grammar module — artists/DJs linkable),
 *   2. structural attribution (show · station) below the sentence,
 *   3. the active LENS for the top context frame.
 *
 * Destinations are reached through the sentence: links inside it push lens
 * frames in place (dotted underline = navigate). Each lens is a COMPACT
 * PREVIEW with an explicit "Open" action to the canonical route — never a
 * duplicated mini-page.
 *
 * Playback is never touched here: pushing/popping lenses only mutates the
 * context stack. Nothing in this module talks to the player, and the rail
 * renders below the summary so it never obscures album art.
 */
import { useMemo, type ReactNode } from "react";
import { Link } from "wouter";
import { useSearchArtistRuns, getSearchArtistRunsQueryKey } from "@workspace/api-client-react";
import type { ContextDescriptor, ContextFrame } from "../dial/dialContext";
import {
  radioSummarySentence,
  artistNode,
  djNode,
  usableShowName,
  type GrammarLinks,
} from "../dial/grammar";
import type { DialStation, DialShow, DialSpin, DialDisplayMode } from "../hooks/useDialData";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Structural subset of DialView's SetPanelSet — kept local to avoid an
 * import cycle (DialView imports this module). */
export interface RailSet {
  id: string;
  /** Archive run id when known — canonical route source for the set lens. */
  runId: number | string | null;
  stationSlug: string;
  stationName: string;
  startedAt: string;
  ianaTimezone: string | null;
  showName: string | null;
  djNames: string[];
  artists: { name: string; inLibrary: boolean }[];
  spins: DialSpin[];
}

export interface ContextRailProps {
  ctx: ContextDescriptor;
  /** The tuned station's dial row, when loaded. */
  row: { ds: DialStation; show: DialShow | null } | null;
  /** Every broadcast set currently known to the dial (whole sets). */
  sets: RailSet[];
  /** Lower-cased artist names seeded this session. */
  seedsLower: Set<string>;
  onAddSeed: (name: string) => void;
  /** Push a lens frame onto the context stack (never touches playback). */
  onPush: (frame: ContextFrame) => void;
  /**
   * Open the artist TAB in the set-panel tab strip. Artist navigation no
   * longer pushes lens frames — the artist lens is retired; every artist
   * click routes here instead.
   */
  onOpenArtist: (name: string, mbid: string | null) => void;
  displayMode?: DialDisplayMode;
}

/** Encode an artist frame id: MBID when known, else a name-keyed id. */
export function artistFrameId(name: string, mbid: string | null): string {
  return mbid ?? `name:${name}`;
}

/** Decode the artist name/mbid pair back out of a frame. */
export function decodeArtistFrame(frame: ContextFrame): { name: string | null; mbid: string | null } {
  if (frame.id.startsWith("name:")) return { name: frame.label ?? frame.id.slice(5), mbid: null };
  return { name: frame.label ?? null, mbid: frame.id };
}

function fmtDay(iso: string, timeZone?: string | null): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      ...(timeZone ? { timeZone } : {}),
    }).format(d);
  } catch {
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(d);
  }
}

// ---------------------------------------------------------------------------
// Lens chrome
// ---------------------------------------------------------------------------

function Lens({ title, openHref, openLabel, children }: {
  title: string;
  openHref: string | null;
  openLabel?: string;
  children: ReactNode;
}) {
  return (
    <section className="crail-lens" aria-label={title}>
      <header className="crail-lens__head">
        <span className="crail-lens__title">{title}</span>
        {openHref && (
          <Link href={openHref} className="crail-lens__open">
            {openLabel ?? "Open"} →
          </Link>
        )}
      </header>
      <div className="crail-lens__body">{children}</div>
    </section>
  );
}

/** Compact set row used by station/show/DJ lenses.
 *
 * The row itself opens the set; the individual " · "-joined artist names are
 * their own click targets (artist tab) and must never bubble into the row's
 * open-set action — hence a div[role=button] shell, not a nested <button>. */
function SetRow({ set, links, onOpenSet }: {
  set: RailSet;
  links?: GrammarLinks;
  onOpenSet: (set: RailSet) => void;
}) {
  const visible = set.artists.slice(0, 3);
  return (
    <div
      role="button"
      tabIndex={0}
      className="crail-setrow gram-link--nav"
      onClick={() => onOpenSet(set)}
      onKeyDown={(e) => { if (e.key === "Enter") onOpenSet(set); }}
    >
      <span className="crail-setrow__when">{fmtDay(set.startedAt, set.ianaTimezone)}</span>
      {set.showName && <span className="crail-setrow__show">{set.showName}</span>}
      <span className="crail-setrow__names">
        {visible.map((a, i) => (
          <span key={`${a.name}-${i}`}>
            {i > 0 && " · "}
            {artistNode(a.name, links, i, { plusBefore: true })}
          </span>
        ))}
        {set.artists.length > 3 ? " …" : ""}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lenses
// ---------------------------------------------------------------------------

function StationLens({ row, sets, links, onOpenSet }: {
  row: { ds: DialStation; show: DialShow | null } | null;
  sets: RailSet[];
  links: GrammarLinks;
  onOpenSet: (set: RailSet) => void;
}) {
  const slug = row?.ds.station.slug ?? sets[0]?.stationSlug ?? null;
  const recentSpins = (row?.show?.spins ?? []).slice(-6).reverse();
  // Nothing to preview → render no lens at all. The tuned front door shows
  // filler chrome ("No recent spins visible yet.") to nobody's benefit.
  if (recentSpins.length === 0 && sets.length === 0) return null;
  return (
    <Lens
      title="Station"
      openHref={slug ? `/archive/stations/${slug}` : null}
      openLabel="Open archive"
    >
      {recentSpins.length > 0 ? (
        <ul className="crail-list">
          {recentSpins.map((spin, i) => (
            <li key={`${spin.playedAt}-${i}`} className="crail-list__item">
              {artistNode(spin.artist, links, i, { plusBefore: true })}
            </li>
          ))}
        </ul>
      ) : sets.length > 0 ? (
        <ul className="crail-list">
          {sets.slice(0, 4).map((set) => <li key={set.id}><SetRow set={set} links={links} onOpenSet={onOpenSet} /></li>)}
        </ul>
      ) : (
        <p className="crail-empty">No recent spins visible yet.</p>
      )}
    </Lens>
  );
}

function ShowLens({ frame, sets, links, stationSlug, onOpenSet }: {
  frame: ContextFrame;
  sets: RailSet[];
  links: GrammarLinks;
  stationSlug: string | null;
  onOpenSet: (set: RailSet) => void;
}) {
  const showName = frame.label ?? frame.id;
  const matching = sets.filter((set) => set.showName === showName);
  const djNames = [...new Set(matching.flatMap((set) => set.djNames))];
  return (
    <Lens title="Show" openHref={stationSlug ? `/archive/stations/${stationSlug}` : null} openLabel="Open archive">
      <p className="crail-lens__lede">{showName}{djNames.length > 0 && <> — {djNames.map((dj, i) => <span key={dj}>{i > 0 && ", "}{djNode(dj, links)}</span>)}</>}</p>
      {matching.length > 0 ? (
        <ul className="crail-list">
          {matching.slice(0, 4).map((set) => <li key={set.id}><SetRow set={set} links={links} onOpenSet={onOpenSet} /></li>)}
        </ul>
      ) : (
        <p className="crail-empty">No archived sets loaded for this show yet.</p>
      )}
    </Lens>
  );
}

function DjLens({ frame, sets, links, onOpenSet }: {
  frame: ContextFrame;
  sets: RailSet[];
  links?: GrammarLinks;
  onOpenSet: (set: RailSet) => void;
}) {
  const name = frame.label ?? frame.id;
  const matching = sets.filter((set) => set.djNames.includes(name));
  return (
    <Lens title="Selector" openHref={`/dj/${encodeURIComponent(name)}`}>
      <p className="crail-lens__lede">{name}</p>
      {matching.length > 0 ? (
        <ul className="crail-list">
          {matching.slice(0, 4).map((set) => <li key={set.id}><SetRow set={set} links={links} onOpenSet={onOpenSet} /></li>)}
        </ul>
      ) : (
        <p className="crail-empty">No sets by {name} loaded yet.</p>
      )}
    </Lens>
  );
}

function SetLens({ frame, sets, links }: {
  frame: ContextFrame;
  sets: RailSet[];
  links: GrammarLinks;
}) {
  // The canonical route comes from the SELECTED set's own run id — never the
  // currently-tuned show, which may be a different run entirely.
  const set = sets.find((candidate) => candidate.id === frame.id) ?? null;
  const openHref = set?.runId != null
    ? `/archive/station-runs/${set.runId}`
    : set ? `/archive/stations/${set.stationSlug}` : null;
  const artists = set?.artists ?? [];
  return (
    <Lens title="Set" openHref={openHref}>
      {artists.length > 0 ? (
        <ol className="crail-list crail-list--ordered">
          {artists.map((artist, i) => (
            <li key={`${artist.name}-${i}`} className="crail-list__item">
              {artistNode(artist.name, links, i, { plusBefore: true })}
            </li>
          ))}
        </ol>
      ) : (
        <p className="crail-empty">This set's tracklist isn't visible yet.</p>
      )}
    </Lens>
  );
}

/**
 * ArtistPane — the artist page content, rendered as the BODY of an artist tab
 * in the set-panel tab strip. This is the retired artist lens's content,
 * reused verbatim: identity lede with add affordance, sets containing the
 * artist (archive endpoint with loaded-set fallback), and the canonical
 * artist-route link when a strong identifier (MBID) exists.
 */
export function ArtistPane({ name: givenName, mbid, sets, rowSpins, links, onOpenSet }: {
  /** Display name when known; null for an MBID-only restore. */
  name: string | null;
  mbid: string | null;
  sets: RailSet[];
  rowSpins: readonly { artist: string; artistMbid?: string | null }[];
  links: GrammarLinks;
  onOpenSet: (set: RailSet) => void;
}) {
  // Tab scopes serialize only the identifier, so an MBID-backed artist tab
  // restored from a refresh/shared link can arrive with no name. Recover it
  // from everything the dial has already loaded — the pane must stay fully
  // functional (search, fallback list, add affordance) after restore.
  const name = useMemo(() => {
    if (givenName) return givenName;
    if (!mbid) return null;
    for (const spin of rowSpins) {
      if (spin.artistMbid === mbid) return spin.artist;
    }
    for (const set of sets) {
      for (const spin of set.spins) {
        if (spin.artistMbid === mbid) return spin.artist;
      }
    }
    return null;
  }, [givenName, mbid, sets, rowSpins]);
  const enabled = !!name && name.length >= 2;
  // "Sets containing this artist" — the archive artist-runs endpoint groups
  // matching spins into whole runs. Cheap (bounded, indexed) and already
  // exists; when it fails or is empty we degrade to already-loaded dial sets.
  const { data, isLoading, isError } = useSearchArtistRuns(
    { q: name ?? "" },
    { query: { queryKey: getSearchArtistRunsQueryKey({ q: name ?? "" }), enabled, staleTime: 5 * 60_000, retry: 1 } },
  );
  const loadedMatches = useMemo(() => name ? sets.filter((set) =>
    set.spins.some((spin) => spin.artist.toLowerCase().includes(name.toLowerCase())),
  ) : [], [sets, name]);
  const stationRuns = data?.stationRuns ?? [];
  const yours = name ? (links.isYours?.(name) ?? false) : false;

  return (
    <Lens title="Artist" openHref={mbid ? `/artist/${mbid}` : null}>
      <p className="crail-lens__lede">
        {name ?? "Artist"}
        {name && !yours && links.onAddArtist && (
          <button
            type="button"
            className="gram__add dial-addplus"
            aria-label={`Add ${name} to your artists`}
            onClick={() => links.onAddArtist!(name)}
          >+</button>
        )}
        {yours && <span className="crail-yours-mark"> — in your artists</span>}
      </p>
      <div className="crail-lens__sub">Sets containing this artist</div>
      {enabled && isLoading && loadedMatches.length === 0 ? (
        <p className="crail-empty">Searching the archive…</p>
      ) : stationRuns.length > 0 ? (
        <ul className="crail-list">
          {stationRuns.slice(0, 4).map((hit) => (
            <li key={hit.run.runId}>
              <Link href={`/archive/station-runs/${hit.run.runId}`} className="crail-setrow gram-link--nav">
                <span className="crail-setrow__when">{hit.run.date}</span>
                <span className="crail-setrow__show">{hit.station.name}</span>
                {hit.run.show?.name && <span className="crail-setrow__names">{hit.run.show.name}</span>}
              </Link>
            </li>
          ))}
        </ul>
      ) : loadedMatches.length > 0 ? (
        <ul className="crail-list">
          {loadedMatches.slice(0, 4).map((set) => <li key={set.id}><SetRow set={set} links={links} onOpenSet={onOpenSet} /></li>)}
        </ul>
      ) : (
        <p className="crail-empty">
          {isError
            ? "Archive search is unavailable right now — showing nothing rather than guessing."
            : "No archived sets found for this artist yet."}
        </p>
      )}
    </Lens>
  );
}

// ---------------------------------------------------------------------------
// The rail
// ---------------------------------------------------------------------------

export function ContextRail({
  ctx,
  row,
  sets,
  seedsLower,
  onAddSeed,
  onPush,
  onOpenArtist,
  displayMode = "personal",
}: ContextRailProps) {
  const stationSlug = ctx.stack[0]?.kind === "station" ? ctx.stack[0].id : null;
  const stationSets = useMemo(
    () => sets.filter((set) => stationSlug == null || set.stationSlug === stationSlug),
    [sets, stationSlug],
  );

  // Guarded push — re-pushing the frame that is already on top is a no-op so
  // repeated sentence taps don't grow the stack.
  const push = (frame: ContextFrame) => {
    const top = ctx.stack[ctx.stack.length - 1];
    if (top && top.kind === frame.kind && top.id === frame.id) return;
    onPush(frame);
  };

  // Artist name → MBID from everything the dial has loaded.
  const artistMbids = useMemo(() => {
    const map = new Map<string, string>();
    for (const set of sets) {
      for (const spin of set.spins) {
        if (spin.artistMbid && !map.has(spin.artist.toLowerCase())) {
          map.set(spin.artist.toLowerCase(), spin.artistMbid);
        }
      }
    }
    for (const spin of row?.show?.spins ?? []) {
      if (spin.artistMbid && !map.has(spin.artist.toLowerCase())) {
        map.set(spin.artist.toLowerCase(), spin.artistMbid);
      }
    }
    return map;
  }, [sets, row]);

  const isYours = (name: string): boolean => {
    const key = name.trim().toLowerCase();
    if (seedsLower.has(key)) return true;
    const spins = [...(row?.show?.spins ?? []), ...sets.flatMap((set) => set.spins)];
    return spins.some((spin) => spin.artist.toLowerCase() === key && (spin.isLibraryHit || spin.isArtistHit));
  };

  const links: GrammarLinks = {
    // Artist navigation opens the artist TAB — never a lens frame. The panel
    // dedups by identifier, so repeated clicks focus the existing tab.
    onArtist: (name) => onOpenArtist(name, artistMbids.get(name.trim().toLowerCase()) ?? null),
    onDj: (name) => push({ kind: "dj", id: name, label: name }),
    isYours,
    onAddArtist: onAddSeed,
  };

  const summary = radioSummarySentence({
    stationName: row?.ds.station.name ?? ctx.stack[0]?.label ?? "",
    show: row?.show ?? null,
    displayMode,
    links,
    attributionHandlers: {
      onShow: (showName) => push({ kind: "show", id: showName, label: showName }),
      // The station is the root frame: tapping it pops nothing and pushes
      // nothing new — the station lens is the default. Provide no handler.
    },
  });

  const openSetFromRow = (set: RailSet) => push({ kind: "set", id: set.id, label: set.showName ?? set.stationName });

  const top = ctx.stack[ctx.stack.length - 1] ?? null;
  // Quiet-front-door rules: a bare "On air." sentence with no usable show
  // name is placeholder filler, and the default station lens is empty when
  // there are neither recent spins nor loaded sets. Suppress both rather
  // than rendering intermediate text between the art and the corner links.
  const sentenceIsBare = summary.artistsShown.length === 0 && summary.djShown == null;
  const hideSummary = sentenceIsBare && !usableShowName(row?.show ?? null);
  const stationLensEmpty = (row?.show?.spins.length ?? 0) === 0 && stationSets.length === 0;
  let lens: ReactNode = null;
  if (!top || top.kind === "station") {
    lens = stationLensEmpty
      ? null
      : <StationLens row={row} sets={stationSets} links={links} onOpenSet={openSetFromRow} />;
  } else if (top.kind === "show") {
    lens = <ShowLens frame={top} sets={sets} links={links} stationSlug={stationSlug} onOpenSet={openSetFromRow} />;
  } else if (top.kind === "dj") {
    lens = <DjLens frame={top} sets={sets} links={links} onOpenSet={openSetFromRow} />;
  } else if (top.kind === "set") {
    lens = <SetLens frame={top} sets={sets} links={links} />;
  } else if (top.kind === "artist") {
    // The artist lens is retired: artist frames only appear here transiently
    // (e.g. restored from an old serialized URL before DialView maps them to
    // a tab). Degrade to the default station lens rather than rendering a
    // second artist surface.
    lens = stationLensEmpty
      ? null
      : <StationLens row={row} sets={stationSets} links={links} onOpenSet={openSetFromRow} />;
  }

  // All placeholder → render nothing: no empty container, no leftover rule.
  if (hideSummary && lens == null) return null;

  return (
    <div className="crail">
      {!hideSummary && <p className="crail__sentence">{summary.sentence}</p>}
      {!hideSummary && summary.attribution && <p className="crail__attribution">{summary.attribution}</p>}
      {lens}
    </div>
  );
}
