/**
 * grammar — the ONE module that owns radio sentence grammar and link policy.
 *
 * Every rail and dial sentence is built through this module (directly, or via
 * the pure builders it re-exports from dialViewHelpers). The link policy is
 * enforced here in one spot:
 *
 *   - LINKABLE roles: artist names and DJ names. A linkable name rendered
 *     with a navigation handler gets a DOTTED UNDERLINE and opens a lens —
 *     dotted underline means "navigate", never "add".
 *   - ADD/SEED is an explicit small `+` affordance rendered NEXT TO a name,
 *     never the name itself. (This deliberately replaces the earlier
 *     "dotted = addable" convention.)
 *   - YOURS (seeded / kept / in library) renders bright white with NO
 *     underline and is still navigable when a handler is supplied.
 *   - Station and show are STRUCTURAL ATTRIBUTION: they appear below the
 *     sentence, not inside it.
 *   - SONG TITLES NEVER APPEAR in radio sentences. No API in this module
 *     accepts a song title; the player owns titles.
 */
import { type ReactNode } from "react";
import { eligibleDjNames } from "@workspace/lore-attribution";
import { type DialShow, type DialDisplayMode } from "../hooks/useDialData";
import {
  cleanLiveValue,
  sameLiveValue,
  dialShowAsAttribution,
  usableShowName,
} from "../components/dialViewHelpers";

// Re-export the pure sentence builders so all sentence rendering can be
// routed through this module — grammar is the single import surface.
export {
  nameNodes,
  buildAttributedSentence,
  crossingSentence,
  reason,
  cleanLiveValue,
  sameLiveValue,
  usableShowName,
  type ReasonResult,
} from "../components/dialViewHelpers";

// ---------------------------------------------------------------------------
// Link policy (documentation + machine-checkable constant)
// ---------------------------------------------------------------------------

export const RADIO_LINK_POLICY = {
  /** Roles that may carry a navigation link (dotted underline → lens). */
  linkableRoles: ["artist", "dj"] as const,
  /** Roles rendered as structural attribution below the sentence. */
  attributionRoles: ["show", "station"] as const,
  /** Content that must never appear in a radio sentence. */
  forbiddenContent: ["songTitle"] as const,
} as const;

// ---------------------------------------------------------------------------
// Link wiring
// ---------------------------------------------------------------------------

export interface GrammarLinks {
  /** Navigate to the artist lens. Dotted underline. */
  onArtist?: (name: string) => void;
  /** Navigate to the DJ/selector lens. Dotted underline. */
  onDj?: (name: string) => void;
  /** True when the artist is already yours (library / seeded). White. */
  isYours?: (name: string) => boolean;
  /** Explicit `+` add/seed affordance rendered beside non-yours artists. */
  onAddArtist?: (name: string) => void;
}

// ---------------------------------------------------------------------------
// Role nodes
// ---------------------------------------------------------------------------

/**
 * An artist name under the link policy:
 *  - yours       → bright white, no underline (navigable when onArtist given)
 *  - navigable   → dotted underline button opening the artist lens
 *  - plus an explicit `+` affordance beside non-yours names when onAddArtist
 *    is provided. The name itself NEVER adds.
 */
export function artistNode(
  name: string,
  links?: GrammarLinks,
  key?: string | number,
  opts?: {
    /** Setlist surfaces render the `+` LEADING the name; sentences keep it
     * trailing. The affordance is identical either way — only order differs. */
    plusBefore?: boolean;
  },
): ReactNode {
  const yours = links?.isYours?.(name) ?? false;
  const cls = `gram__artist${yours ? " gram--yours" : ""}`;
  const nameEl = links?.onArtist ? (
    <button
      type="button"
      className={`${cls} gram-link--nav`}
      onClick={(e) => { e.stopPropagation(); links.onArtist!(name); }}
    >{name}</button>
  ) : (
    <b className={cls}>{name}</b>
  );
  const addEl = !yours && links?.onAddArtist ? (
    <button
      type="button"
      className="gram__add dial-addplus"
      aria-label={`Add ${name} to your artists`}
      onClick={(e) => { e.stopPropagation(); links.onAddArtist!(name); }}
    >+</button>
  ) : null;
  return (
    <span className="gram__artist-wrap" key={key ?? name}>
      {opts?.plusBefore ? <>{addEl}{nameEl}</> : <>{nameEl}{addEl}</>}
    </span>
  );
}

/** A DJ/selector name — linkable role, dotted underline when navigable. */
export function djNode(name: string, links?: GrammarLinks): ReactNode {
  return links?.onDj ? (
    <button
      type="button"
      className="gram__dj gram-link--nav"
      onClick={(e) => { e.stopPropagation(); links.onDj!(name); }}
    >{name}</button>
  ) : (
    <b className="gram__dj">{name}</b>
  );
}

/** Joins role nodes with commas and a final (Oxford where 3+) "and". */
function joinNodes(nodes: ReactNode[]): ReactNode {
  const out: ReactNode[] = [];
  nodes.forEach((node, i) => {
    if (i > 0) {
      out.push(i === nodes.length - 1 ? (nodes.length > 2 ? ", and " : " and ") : ", ");
    }
    out.push(node);
  });
  return <>{out}</>;
}

// ---------------------------------------------------------------------------
// Structural attribution (below the sentence — never inline)
// ---------------------------------------------------------------------------

export interface AttributionHandlers {
  onShow?: (showName: string) => void;
  onStation?: (stationName: string) => void;
}

/**
 * "on <Show> · <Station>" — the structural line rendered BELOW the sentence.
 * Show/station are attribution roles: they never appear inside the sentence
 * built by radioSummarySentence. Handlers open the show/station lens.
 */
export function attributionLine(
  stationName: string | null,
  showName: string | null,
  handlers?: AttributionHandlers,
): ReactNode | null {
  if (!stationName && !showName) return null;
  const part = (label: string, cls: string, onClick?: () => void) =>
    onClick ? (
      <button type="button" className={`${cls} gram-link--nav`} onClick={(e) => { e.stopPropagation(); onClick(); }}>
        {label}
      </button>
    ) : (
      <span className={cls}>{label}</span>
    );
  return (
    <span className="gram__attribution">
      {showName && part(showName, "gram__show", handlers?.onShow && (() => handlers.onShow!(showName)))}
      {showName && stationName && <span className="gram__attr-sep" aria-hidden="true"> · </span>}
      {stationName && part(stationName, "gram__station", handlers?.onStation && (() => handlers.onStation!(stationName)))}
    </span>
  );
}

// ---------------------------------------------------------------------------
// The rail summary sentence
// ---------------------------------------------------------------------------

export interface RadioSummary {
  /** The sentence: linkable artists/DJ only. No station/show, no titles. */
  sentence: ReactNode;
  /** Structural attribution rendered below the sentence. */
  attribution: ReactNode | null;
  /** Artist names surfaced in the sentence, in order. */
  artistsShown: string[];
  /** Single credited DJ, when unambiguous. */
  djShown: string | null;
}

const MAX_SENTENCE_ARTISTS = 4;

/**
 * Builds the tuned-context summary sentence for a station.
 *
 * Grammar (personal mode):
 *   DJ + artists → "<DJ> selected <A>, <B>, now." / "… in the current set."
 *   artists only → "<A> and <B> in the current set."
 *   DJ only      → "<DJ> is on air."
 *   nothing      → "On air."
 *
 * Station and show never appear in the sentence — they are returned as the
 * attribution line. Song titles never appear anywhere: this function does
 * not read `currentTrack.title` and accepts no title input.
 */
export function radioSummarySentence({
  stationName,
  show,
  displayMode = "personal",
  links,
  attributionHandlers,
}: {
  stationName: string;
  show: DialShow | null;
  displayMode?: DialDisplayMode;
  links?: GrammarLinks;
  attributionHandlers?: AttributionHandlers;
}): RadioSummary {
  const station = cleanLiveValue(stationName);
  const showName = usableShowName(show);
  const attribution = attributionLine(station, showName, attributionHandlers);

  if (!show) {
    return { sentence: <>On air.</>, attribution, artistsShown: [], djShown: null };
  }

  const current = show.currentTrack;
  const djList = eligibleDjNames(dialShowAsAttribution(show), {
    artist: current?.artist,
    title: current?.title,
    showTitle: show.showName,
    stationName,
  });
  const dj = djList.length === 1 ? djList[0] : null;

  // Artist selection mirrors the crossing sentence: the current hit leads;
  // otherwise the crossing lists; personal mode only surfaces YOUR evidence,
  // blended mode surfaces whatever is playing.
  const currentArtist = cleanLiveValue(current?.artist);
  const isLiveHit = !!(current?.isLibraryHit || current?.isArtistHit);
  const sourceArtists = show.crossings > 0 ? show.topArtists : show.topArtistNames;
  const candidates = isLiveHit && currentArtist ? [currentArtist]
    : displayMode === "blended" && currentArtist ? [currentArtist]
    : (show.crossings > 0 || show.artistCrossings > 0) ? sourceArtists
    : currentArtist ? [currentArtist]
    : [];
  const artists = candidates
    .map((a) => cleanLiveValue(a))
    .filter((a): a is string => a != null)
    .filter((a) => !sameLiveValue(a, station))
    .filter((a, i, all) => all.findIndex((o) => sameLiveValue(o, a)) === i)
    .slice(0, MAX_SENTENCE_ARTISTS);

  const timing = isLiveHit || (artists.length === 1 && sameLiveValue(artists[0], currentArtist))
    ? ", now" : " in the current set";

  if (artists.length > 0) {
    const artistEls = joinNodes(artists.map((a, i) => artistNode(a, links, i)));
    const sentence = dj ? (
      <>{djNode(dj, links)}{" selected "}{artistEls}{timing}{"."}</>
    ) : (
      <>{artistEls}{timing}{"."}</>
    );
    return { sentence, attribution, artistsShown: artists, djShown: dj };
  }

  if (dj) {
    return { sentence: <>{djNode(dj, links)}{" is on air."}</>, attribution, artistsShown: [], djShown: dj };
  }
  return { sentence: <>On air.</>, attribution, artistsShown: [], djShown: null };
}
