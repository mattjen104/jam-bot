/**
 * Pure helpers for the Dial front-door copy: crossing sentences, reason-ladder
 * text, and artist-name list formatting.
 *
 * Extracted into a separate module so they can be unit-tested independently of
 * the full DialView component tree.  DialView.tsx re-exports nothing from here
 * directly — it imports the functions it needs directly from this file.
 */
import { type ReactNode } from "react";
import { eligibleDjName } from "@workspace/lore-attribution";
import { type DialShow, type DialDisplayMode } from "../hooks/useDialData";

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
 * CSS amber colour applies only to the names, not the separators.
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
// Crossing sentence
// ---------------------------------------------------------------------------

/**
 * Crossing rows explain the match, rather than repeating the full now-playing
 * metadata. The artist is the discriminating signal; the title remains
 * available after tune-in and belongs on ordinary live rows only.
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

  if (artistNodes) {
    const dj = eligibleDjName(show.djName, {
      artist: current?.artist,
      title: current?.title,
      showTitle: show.showName,
      stationName,
    });
    if (artists.length === 1) {
      return {
        node: dj
          ? <>{dj} — {artistNodes} on air.</>
          : <>{artistNodes} on air.</>,
        hasTrack: true,
      };
    }
    return {
      node: dj
        ? <>{dj} — {artistNodes} this set</>
        : <>{artistNodes} this set</>,
      hasTrack: true,
    };
  }

  if (count > 0) {
    return {
      node: <>{count} track{count === 1 ? "" : "s"} from your library {count === 1 ? "has" : "have"} aired.</>,
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

/** One sentence per rung; returns the strongest rung that applies (spec §3).
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
    // Community mode must never fall through to the personal current-track
    // flags below. With no aggregate signal, retain only public live
    // attribution (or the intentionally dark row).
    return show.djName
      ? { r: 5, cls: "w5", node: `on air · ${intoSet(show.startedAt)} into the set` }
      : { r: 0, cls: "w0", node: "on air · Lore can't see who's playing" };
  }

  // r=1: exact library track playing right now
  if (show.currentTrack?.isLibraryHit) {
    return {
      r: 1, cls: "w1",
      node: <><b>{show.currentTrack.title}</b><span className="fdrow__t1-sfx"> on air — in your library</span></>,
    };
  }

  // r=2: library artist playing right now (not an exact track match).
  // The live track hasn't been logged into spins yet (SSE lag), so
  // show.artistCrossings won't include it — check currentTrack directly.
  if (show.currentTrack?.isArtistHit) {
    return {
      r: 2, cls: "w2",
      node: <><b className="fdrow__artist">{show.currentTrack.artist}</b><span className="fdrow__t1-sfx"> on air — artist from your library</span></>,
    };
  }

  // r=3: exact library tracks already aired this show
  if (show.crossings > 0) {
    const nn = show.topArtists.length > 0 ? nameNodes(show.topArtists) : null;
    return {
      r: 3, cls: "w3",
      node: nn
        ? <>{nn} this set</>
        : <><b>{show.crossings} of yours</b> this set</>,
    };
  }

  // r=4: library artists aired this show, no exact track match
  if (show.artistCrossings > 0) {
    const nn = show.topArtistNames.length > 0 ? nameNodes(show.topArtistNames) : null;
    return {
      r: 4, cls: "w4",
      node: nn
        ? <>{nn} this set</>
        : <><b>{show.artistCrossings}</b> tracks by artists from your library</>,
    };
  }

  // r=5: attributed show on air, no crossing evidence yet
  if (show.djName) {
    return { r: 5, cls: "w5", node: `on air · ${intoSet(show.startedAt)} into the set` };
  }

  // r=6: 24h station exact crossings (no selector listed)
  if (stationCrossings > 0) {
    const nn = stationTopArtistNames.length > 0 ? nameNodes(stationTopArtistNames) : null;
    return {
      r: 6, cls: "w6",
      node: nn
        ? <>{nn} in the last 24 hours</>
        : <><b>{stationCrossings} of yours</b> here in the last 24h</>,
    };
  }

  // r=7: 24h station artist crossings (no exact hits, no selector listed)
  if (stationArtistCrossings > 0) {
    const nn = stationTopArtistNames.length > 0 ? nameNodes(stationTopArtistNames) : null;
    return {
      r: 7, cls: "w7",
      node: nn
        ? <>{nn} in the last 24 hours</>
        : <><b>{stationArtistCrossings}</b> tracks by your artists here in the last 24h</>,
    };
  }

  // r=0: dark — nothing to go on
  return { r: 0, cls: "w0", node: "on air · Lore can't see who's playing" };
}
