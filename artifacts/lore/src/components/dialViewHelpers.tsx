/**
 * Pure helpers for the Dial front-door copy: crossing sentences, reason-ladder
 * text, and artist-name list formatting.
 *
 * Extracted into a separate module so they can be unit-tested independently of
 * the full DialView component tree.  DialView.tsx re-exports nothing from here
 * directly — it imports the functions it needs directly from this file.
 */
import { type ReactNode } from "react";
import { eligibleDjName, eligibleDjNames, type ShowAttributionLike } from "@workspace/lore-attribution";
import { type DialShow, type DialDisplayMode } from "../hooks/useDialData";

// ---------------------------------------------------------------------------
// Adapter: DialShow → ShowAttributionLike
// ---------------------------------------------------------------------------

/**
 * Maps a DialShow into the ShowAttributionLike shape expected by
 * lore-attribution helpers.  DialShow uses `showName` (not `name`), and
 * carries djName as `string | null` (library uses `string | undefined`).
 */
function dialShowAsAttribution(show: DialShow): ShowAttributionLike {
  return {
    name: show.showName,
    djName: show.djName ?? undefined,
    djNames: show.djNames,
  };
}

// ---------------------------------------------------------------------------
// String cleaning
// ---------------------------------------------------------------------------

export const MISSING_LIVE_VALUES = new Set([
  "unknown",
  "unknown show",
  "n/a",
  "na",
  "none",
  "null",
  "undefined",
  "continuous",
]);

export function cleanLiveValue(value: string | null | undefined): string | null {
  const cleaned = value?.replace(/\s+/g, " ").trim() ?? "";
  return cleaned && !MISSING_LIVE_VALUES.has(cleaned.toLowerCase()) ? cleaned : null;
}

export function sameLiveValue(a: string | null, b: string | null): boolean {
  return a != null && b != null && a.localeCompare(b, undefined, { sensitivity: "accent" }) === 0;
}

// ---------------------------------------------------------------------------
// Artist name list rendering
// ---------------------------------------------------------------------------

/**
 * Renders a list of artist names with each name in its own <b> element so the
 * CSS colour applies only to the names, not the separators.
 *
 * Up to 6 names are shown in full; any overflow is collapsed to "… and N more".
 */
export function nameNodes(artists: string[]): ReactNode {
  const usable = artists.map((artist) => cleanLiveValue(artist)).filter((artist): artist is string => artist != null);
  if (usable.length === 0) return null;
  const shown = usable.slice(0, 6);
  const rest = usable.length - shown.length;
  const nodes: ReactNode[] = [];
  shown.forEach((name, i) => {
    if (i > 0) nodes.push(i === shown.length - 1 && rest === 0 ? " and " : ", ");
    nodes.push(<b className="fdrow__artist" key={i}>{name}</b>);
  });
  if (rest > 0) nodes.push(` and ${rest} more`);
  return <>{nodes}</>;
}

// ---------------------------------------------------------------------------
// Show-name sanitisation
// ---------------------------------------------------------------------------

/**
 * Returns the show name when it adds meaningful context — suppresses values
 * that duplicate the DJ name, match "Continuous", or are otherwise junk.
 *
 * Multi-DJ rule: when the show has two or more distinct eligible DJ names the
 * individual DJs are ambiguous and no single name can be credited.  In that
 * case the show name becomes mandatory (suppression is skipped) so attribution
 * never collapses to nothing.
 */
export function usableShowName(show: DialShow | null): string | null {
  if (!show) return null;
  const raw = cleanLiveValue(show.showName);
  // cleanLiveValue already rejects MISSING_LIVE_VALUES ("unknown show", etc.);
  // the explicit check below is belt-and-suspenders for the placeholder default
  // written by useDialData when no show is linked ("Unknown show").
  if (!raw) return null;
  if (MISSING_LIVE_VALUES.has(raw.toLowerCase())) return null;
  // Resolve effective DJ list — covers both legacy djName and new djNames array.
  const djList = eligibleDjNames(dialShowAsAttribution(show));
  // Multi-DJ: when DJs are ambiguous the show name must surface — skip the
  // djName-equality suppression so attribution falls back to the show level.
  if (djList.length > 1) return raw;
  // Single-DJ suppression: hide the show name when it merely echoes the DJ name.
  // Compare against the effective resolved name (works whether it came from
  // djName or from djNames) so single-entry djNames arrays are handled correctly.
  const effectiveDj = djList.length === 1 ? djList[0] : (show.djName ?? null);
  if (effectiveDj && sameLiveValue(raw, effectiveDj)) return null;
  return raw;
}

// ---------------------------------------------------------------------------
// Sentence assembly
// ---------------------------------------------------------------------------

/**
 * Builds the attributed sentence using the full language hierarchy:
 *
 *   DJ known            → "[DJ] selected [artists] on [Show]"
 *   No DJ, show known   → "[artists] on [Show] {timing}"
 *   Neither             → "[artists] {timing}"
 *
 * When no artistNodes are available, falls back to a count-based phrase.
 * Song titles are never included — the player handles that.
 */
export function buildAttributedSentence(
  artistNodes: ReactNode | null,
  count: number,
  countLabel: string,
  djName: string | null | undefined,
  showName: string | null,
  timing: string,
): ReactNode {
  if (artistNodes) {
    if (djName && showName) {
      return (
        <>
          <b className="fdrow__dj">{djName}</b>
          {" selected "}
          {artistNodes}
          {" on "}
          <span className="fdrow__show">{showName}</span>
        </>
      );
    }
    if (djName) {
      return (
        <>
          <b className="fdrow__dj">{djName}</b>
          {" selected "}
          {artistNodes}
        </>
      );
    }
    if (showName) {
      return (
        <>
          {artistNodes}
          {" on "}
          <span className="fdrow__show">{showName}</span>
          {timing ? ` ${timing}` : ""}
        </>
      );
    }
    return <>{artistNodes}{timing ? ` ${timing}` : ""}</>;
  }

  // Count-only fallback (no artist names resolved yet)
  const countNode = <b>{count} {countLabel}</b>;
  if (djName && showName) {
    return (
      <>
        <b className="fdrow__dj">{djName}</b>
        {" · "}
        {countNode}
        {" on "}
        <span className="fdrow__show">{showName}</span>
      </>
    );
  }
  if (djName) {
    return (
      <>
        <b className="fdrow__dj">{djName}</b>
        {" · "}
        {countNode}
      </>
    );
  }
  if (showName) {
    return (
      <>
        {countNode}
        {" on "}
        <span className="fdrow__show">{showName}</span>
        {timing ? ` ${timing}` : ""}
      </>
    );
  }
  return <>{countNode}{timing ? ` ${timing}` : ""}</>;
}

// ---------------------------------------------------------------------------
// Crossing sentence
// ---------------------------------------------------------------------------

/**
 * Crossing rows explain the music match.  The artist is the discriminating
 * signal; song titles are never shown here (the player handles that).
 */
export function crossingSentence(
  stationName: string,
  show: DialShow | null,
  displayMode: DialDisplayMode = "personal",
): { node: ReactNode; hasTrack: boolean } | null {
  if (!show) return null;
  if (displayMode === "blended") return null;

  const station = cleanLiveValue(stationName);
  const current = show.currentTrack;
  const hasExactCrossing = current?.isLibraryHit === true || show.crossings > 0;
  const hasArtistCrossing = current?.isArtistHit === true || show.artistCrossings > 0;
  if (!hasExactCrossing && !hasArtistCrossing) return null;

  const currentArtist = cleanLiveValue(current?.artist);
  const sourceArtists = hasExactCrossing ? show.topArtists : show.topArtistNames;
  const candidateArtists = currentArtist && (
    current?.isLibraryHit || (!hasExactCrossing && current?.isArtistHit)
  ) ? [currentArtist] : sourceArtists;
  const artists = candidateArtists
    .map((artist) => cleanLiveValue(artist))
    .filter((artist): artist is string => artist != null)
    .filter((artist) => !sameLiveValue(artist, station))
    .filter((artist, index, all) => all.findIndex((other) => sameLiveValue(other, artist)) === index);
  const artistNodes = nameNodes(artists);
  const count = hasExactCrossing
    ? Math.max(show.crossings, current?.isLibraryHit ? 1 : 0)
    : Math.max(show.artistCrossings, current?.isArtistHit ? 1 : 0);

  const djList = eligibleDjNames(dialShowAsAttribution(show), {
    artist: current?.artist,
    title: current?.title,
    showTitle: show.showName,
    stationName,
  });
  // Ambiguous multi-DJ: suppress the individual name and fall back to show level.
  const dj = djList.length === 1 ? djList[0] : null;
  const showName = usableShowName(show);

  // Live (single artist currently on air) vs. "this set" (multiple/historical)
  const isLive = !!(current?.isLibraryHit || current?.isArtistHit);
  const timing = isLive ? "now" : "this set";

  if (artistNodes) {
    return {
      node: buildAttributedSentence(artistNodes, count, "of yours", dj, showName, timing),
      hasTrack: true,
    };
  }

  if (count > 0) {
    return {
      node: buildAttributedSentence(
        null,
        count,
        count === 1 ? "track of yours" : "tracks of yours",
        dj,
        showName,
        timing,
      ),
      hasTrack: true,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Reason ladder
// ---------------------------------------------------------------------------

export interface ReasonResult { r: number; cls: string; node: ReactNode }

/** How far into the current show the set started */
export function intoSet(startedAt: string): string {
  const ms = Math.max(0, Date.now() - new Date(startedAt).getTime());
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/** One sentence per rung; returns the strongest rung that applies.
 *
 * r values are consecutive integers — no gaps, no shared values:
 *   r=1 — exact library track playing right now             (Zone 1, warm)
 *   r=2 — library artist playing right now (live, SSE-fresh)(Zone 1, warm)
 *   r=3 — exact library tracks already aired this show      (Zone 1, warm)
 *   r=4 — library artists aired this show, no exact match   (Zone 1, warm)
 *   r=5 — attributed show on air, no crossing evidence yet  (Zone 3, dim)
 *   r=6 — 24h station exact crossings, no selector listed   (Zone 1, dim)
 *   r=7 — 24h station artist crossings, no exact hits       (Zone 1, dim)
 *   r=0 — dark: Lore has no now-playing data                (Zone 3, dim)
 *
 * Zone boundary: r >= 1 && r <= 4, or r === 6/7 → Zone 1 ("with a reason").
 *                r === 0 || r === 5 → Zone 3 ("also on air", dimmed).
 *
 * Sentence language hierarchy (personal mode):
 *   DJ known              → "[DJ] selected [Artist] on [Show]"
 *   No DJ, show known     → "[Artist] on [Show] now / this set"
 *   Neither               → "[Artist] on now / this set"
 * Song titles are never shown — the player handles that.
 */
export function reason(
  show: DialShow | null,
  stationCrossings: number,
  stationArtistCrossings = 0,
  displayMode: DialDisplayMode = "personal",
  stationTopArtistNames: string[] = [],
): ReasonResult {
  if (!show) return { r: 0, cls: "w0", node: "on air · Lore can't see who's playing" };

  if (displayMode === "blended") {
    if (stationCrossings > 0) {
      return {
        r: 1,
        cls: "w1",
        node: <><b>{stationCrossings} community match{stationCrossings === 1 ? "" : "es"}</b> here in the last 24h</>,
      };
    }
    if (stationArtistCrossings > 0) {
      return {
        r: 2,
        cls: "w2",
        node: <><b>{stationArtistCrossings} community artist match{stationArtistCrossings === 1 ? "" : "es"}</b> here in the last 24h</>,
      };
    }
    // Community mode: retain only public live attribution or go dark.
    // Use eligibleDjNames so multi-DJ ambiguity suppresses individual names.
    const blendedDjList = eligibleDjNames(dialShowAsAttribution(show));
    const blendedDj = blendedDjList.length === 1 ? blendedDjList[0] : null;
    const blendedShow = usableShowName(show);
    if (blendedDj && blendedShow) {
      return { r: 5, cls: "w5", node: <><b className="fdrow__dj">{blendedDj}</b> · <span className="fdrow__show">{blendedShow}</span> · {intoSet(show.startedAt)} in</> };
    }
    if (blendedDj) {
      return { r: 5, cls: "w5", node: <><b className="fdrow__dj">{blendedDj}</b> · {intoSet(show.startedAt)} in</> };
    }
    // Ambiguous multi-DJ only: suppress individual names and show the show name.
    // When no DJ is listed at all (not a multi-DJ conflict), stay dark in
    // blended mode — a show name alone is not enough community context.
    if (blendedDjList.length > 1 && blendedShow) {
      return { r: 5, cls: "w5", node: <><span className="fdrow__show">{blendedShow}</span> · {intoSet(show.startedAt)} in</> };
    }
    return { r: 0, cls: "w0", node: "on air · Lore can't see who's playing" };
  }

  // Resolve the effective single DJ name — null when ambiguous (2+ distinct eligible names).
  // DialView's safeShow already ran the single eligibleDjName guard; we re-run
  // eligibleDjNames here so the multi-DJ collapse path is always honoured.
  const djList = eligibleDjNames(dialShowAsAttribution(show));
  const dj = djList.length === 1 ? djList[0] : null;
  const showName = usableShowName(show);

  // r=1: exact library track playing right now — show artist, not title
  if (show.currentTrack?.isLibraryHit) {
    const artist = cleanLiveValue(show.currentTrack.artist);
    const artistNode = artist ? <b className="fdrow__artist">{artist}</b> : null;
    return {
      r: 1, cls: "w1",
      node: buildAttributedSentence(artistNode, 1, "track of yours", dj, showName, "now"),
    };
  }

  // r=2: library artist playing right now (not an exact track match).
  if (show.currentTrack?.isArtistHit) {
    const artist = cleanLiveValue(show.currentTrack.artist);
    const artistNode = artist ? <b className="fdrow__artist">{artist}</b> : null;
    return {
      r: 2, cls: "w2",
      node: buildAttributedSentence(artistNode, 1, "artist of yours", dj, showName, "now"),
    };
  }

  // r=3: exact library tracks already aired this show
  if (show.crossings > 0) {
    const nn = show.topArtists.length > 0 ? nameNodes(show.topArtists) : null;
    return {
      r: 3, cls: "w3",
      node: buildAttributedSentence(nn, show.crossings, "of yours", dj, showName, "this set"),
    };
  }

  // r=4: library artists aired this show, no exact track match
  if (show.artistCrossings > 0) {
    const nn = show.topArtistNames.length > 0 ? nameNodes(show.topArtistNames) : null;
    return {
      r: 4, cls: "w4",
      node: buildAttributedSentence(nn, show.artistCrossings, "artists of yours", dj, showName, "this set"),
    };
  }

  // r=6: 24h station exact crossings — takes priority over r=5 (show attribution)
  // because actually having played your music is stronger evidence than just having
  // an attributed show name.  Checks before r=5 so a named-but-uncrossed show does
  // not shadow a station that DID play your tracks in the last 24h.
  if (stationCrossings > 0) {
    const nn = stationTopArtistNames.length > 0 ? nameNodes(stationTopArtistNames) : null;
    return {
      r: 6, cls: "w6",
      node: buildAttributedSentence(nn, stationCrossings, "of yours", null, null, "here in the last 24h"),
    };
  }

  // r=7: 24h station artist crossings — likewise takes priority over r=5.
  if (stationArtistCrossings > 0) {
    const nn = stationTopArtistNames.length > 0 ? nameNodes(stationTopArtistNames) : null;
    return {
      r: 7, cls: "w7",
      node: buildAttributedSentence(nn, stationArtistCrossings, "tracks by your artists", null, null, "here in the last 24h"),
    };
  }

  // r=5: attributed show or DJ on air, no crossing evidence yet.
  // Expanded to fire when either djName or showName is known (previously
  // only djName triggered r=5, leaving shows-without-DJ-name as r=0 dark).
  if (dj || showName) {
    if (dj && showName) {
      return { r: 5, cls: "w5", node: <><b className="fdrow__dj">{dj}</b> · <span className="fdrow__show">{showName}</span> · {intoSet(show.startedAt)} in</> };
    }
    if (dj) {
      return { r: 5, cls: "w5", node: <><b className="fdrow__dj">{dj}</b> · {intoSet(show.startedAt)} in</> };
    }
    return { r: 5, cls: "w5", node: <><span className="fdrow__show">{showName}</span> · {intoSet(show.startedAt)} in</> };
  }

  // r=0: dark — nothing to go on
  return { r: 0, cls: "w0", node: "on air · Lore can't see who's playing" };
}
