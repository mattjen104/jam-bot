/**
 * crossingScope — the global crossing-scope cycle shared by SplitHome and the
 * full Dial feed (/feed).
 *
 * "Crossings on" used to always mean the current live set. The scope pill
 * lets the listener widen the window: a ⬤ dot on a compact row means the
 * station has ≥1 crossing at the ACTIVE scope, and the crossing-positive
 * filter hides stations with zero crossings at that scope.
 *
 * Scope → data mapping (all fields already on DialStation from useDialData):
 *   now      → the live track's exact/artist crossing flag
 *   set      → live show.crossings + show.artistCrossings (incl. live hit)
 *   24h      → ds.crossings + ds.artistCrossings
 *   7d       → ds.weekCrossings + ds.weekArtistCrossings
 *   lifetime → ds.lifetimeCrossings + ds.lifetimeArtistCrossings
 *
 * Local-first listener state: persisted in localStorage (same pattern as
 * dialRadioMode). Reading falls back to "set" on any malformed value.
 */

import type { DialStation, DialShow } from "../hooks/useDialData";

export type CrossingScope = "now" | "set" | "24h" | "7d" | "lifetime";

/** Cycle order for the scope pill: now → this set → 24h → 7d → lifetime → now. */
export const CROSSING_SCOPE_ORDER: readonly CrossingScope[] = [
  "now",
  "set",
  "24h",
  "7d",
  "lifetime",
];

export const DEFAULT_CROSSING_SCOPE: CrossingScope = "set";

/** Short pill/detail label for each scope. */
export function crossingScopeLabel(scope: CrossingScope): string {
  switch (scope) {
    case "now": return "now";
    case "set": return "this set";
    case "24h": return "24h";
    case "7d": return "7d";
    case "lifetime": return "lifetime";
  }
}

/** The next scope in the cycle (wraps from lifetime back to now). */
export function nextCrossingScope(scope: CrossingScope): CrossingScope {
  const i = CROSSING_SCOPE_ORDER.indexOf(scope);
  return CROSSING_SCOPE_ORDER[(i + 1) % CROSSING_SCOPE_ORDER.length];
}

const LS_CROSSING_SCOPE_KEY = "lore:crossingScope";

/** Parse a raw stored value; anything unrecognised → the default ("set"). */
export function parseCrossingScope(raw: string | null | undefined): CrossingScope {
  return (CROSSING_SCOPE_ORDER as readonly string[]).includes(raw ?? "")
    ? (raw as CrossingScope)
    : DEFAULT_CROSSING_SCOPE;
}

/** Read the persisted scope. Safe under SSR/jsdom without localStorage. */
export function readCrossingScope(): CrossingScope {
  try {
    return parseCrossingScope(localStorage.getItem(LS_CROSSING_SCOPE_KEY));
  } catch {
    return DEFAULT_CROSSING_SCOPE;
  }
}

/** Persist the scope. Failures (private mode, quota) are silently ignored. */
export function writeCrossingScope(scope: CrossingScope): void {
  try {
    localStorage.setItem(LS_CROSSING_SCOPE_KEY, scope);
  } catch {
    // localStorage unavailable — the scope simply won't survive a reload.
  }
}

/** The station's live show (the source of set-level crossing evidence). */
function liveShow(ds: DialStation): DialShow | null {
  return ds.shows.find((sh) => sh.state === "live") ?? null;
}

/** The live track whose hit flags answer the "now" scope. */
function liveHit(ds: DialStation): boolean {
  const track = ds.liveTrack ?? liveShow(ds)?.currentTrack ?? null;
  return !!(track && (track.isLibraryHit || track.isArtistHit));
}

/**
 * Pure: does this station have ≥1 crossing at the given scope?
 * Drives both the ⬤ dot on compact rows and the crossing-positive filter.
 */
export function hasAnyCrossing(ds: DialStation, scope: CrossingScope): boolean {
  switch (scope) {
    case "now":
      return liveHit(ds);
    case "set": {
      const show = liveShow(ds);
      // A live hit is part of the current set even before the set counters
      // catch up — same inclusive semantics as the old compact crossing lead.
      return liveHit(ds) || ((show?.crossings ?? 0) + (show?.artistCrossings ?? 0)) > 0;
    }
    case "24h":
      return (ds.crossings + ds.artistCrossings) > 0;
    case "7d":
      return ((ds.weekCrossings ?? 0) + (ds.weekArtistCrossings ?? 0)) > 0;
    case "lifetime":
      return ((ds.lifetimeCrossings ?? 0) + (ds.lifetimeArtistCrossings ?? 0)) > 0;
  }
}

export interface CrossingScopeDetail {
  /** Scope label for the disclosure ("now", "this set", "24h", …). */
  scopeLabel: string;
  /** Total crossings at this scope (exact + artist-level). */
  count: number;
  /** Top crossing artist names at this scope (up to 3, deduplicated). */
  artists: string[];
}

/**
 * Data for the inline ⬤ detail panel: which artists crossed at this scope
 * and how many crossings in total. Artist names come from the best available
 * source:
 *   now/set   → live show's topArtists/topArtistNames (set-level, real-time)
 *   24h       → ds.topArtistNames24h (per-window from the API)
 *   7d        → ds.topArtistNames7d  (per-window from the API)
 *   lifetime  → ds.topArtistNamesLifetime (per-window from the API)
 *
 * The per-window lists are populated by the server's crossings aggregate and
 * always match the displayed scope, so a 7d panel never shows an artist who
 * only crossed in the last 24 hours.
 */
export function crossingScopeDetail(ds: DialStation, scope: CrossingScope): CrossingScopeDetail {
  const show = liveShow(ds);
  let count = 0;
  let source: string[] = [];
  switch (scope) {
    case "now": {
      const track = ds.liveTrack ?? show?.currentTrack ?? null;
      count = liveHit(ds) ? 1 : 0;
      source = track?.artist ? [track.artist] : [];
      break;
    }
    case "set": {
      count = (show?.crossings ?? 0) + (show?.artistCrossings ?? 0);
      if (count === 0 && liveHit(ds)) count = 1;
      source = [...(show?.topArtists ?? []), ...(show?.topArtistNames ?? [])];
      // A live hit IS a set crossing — name the on-air artist even before the
      // set's top-artist counters include them.
      const liveArtist = (ds.liveTrack ?? show?.currentTrack)?.artist;
      if (liveHit(ds) && liveArtist) source = [liveArtist, ...source];
      break;
    }
    case "24h":
      count = ds.crossings + ds.artistCrossings;
      source = ds.topArtistNames24h ?? [];
      break;
    case "7d":
      count = (ds.weekCrossings ?? 0) + (ds.weekArtistCrossings ?? 0);
      source = ds.topArtistNames7d ?? [];
      break;
    case "lifetime":
      count = (ds.lifetimeCrossings ?? 0) + (ds.lifetimeArtistCrossings ?? 0);
      source = ds.topArtistNamesLifetime ?? [];
      break;
  }
  const artists = source
    .map((a) => a?.replace(/\s+/g, " ").trim())
    .filter((a): a is string => !!a)
    .filter((a, i, all) => all.findIndex((o) =>
      o.localeCompare(a, undefined, { sensitivity: "accent" }) === 0) === i)
    .slice(0, 3);
  return { scopeLabel: crossingScopeLabel(scope), count, artists };
}
