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

import type { DialStation, DialShow, DialSpin } from "../hooks/useDialData";

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

export interface CrossingSpinsResult {
  spins: DialSpin[];
  /**
   * True when the client's local spin data may be incomplete for the requested
   * scope. Callers should surface `partialNote` to avoid implying the list
   * matches the displayed crossing count.
   *
   * 24h:       partial because useDialData fetches today's spins only; a
   *            rolling 24h window always includes yesterday after midnight.
   * 7d/lifetime: partial because the client only holds a recent window.
   * now/set:   never partial (live data; the client always has it).
   */
  partial: boolean;
  /** Human-readable note for the UI explaining the data boundary. */
  partialNote?: string;
}

/**
 * Extract crossing spins for the drill-down panel, filtered to the active
 * scope. Returns confirmed library/artist hit spins (never resolving entries).
 *
 * The 24h scope applies the same rolling boundary that useDialData uses when
 * computing `ds.crossings` — spins from yesterday's loaded shows that fall
 * outside the window are excluded so the drill-down matches the count.
 *
 * `nowMs` defaults to `Date.now()`; pass a fixed value in tests.
 *
 * Scope mapping:
 *   now      → live track only (if it is a library/artist hit)
 *   set      → live show's spins that are hits, newest-first
 *   24h      → all shows' spins within the rolling 24h window
 *   7d/lifetime → all available shows' spins; partial=true (client has today+yesterday only)
 */
export function crossingSpinsForScope(
  ds: DialStation,
  scope: CrossingScope,
  nowMs = Date.now(),
): CrossingSpinsResult {
  const window24hCutoffMs = nowMs - 24 * 60 * 60 * 1000;
  const liveSh = ds.shows.find((sh) => sh.state === "live") ?? null;

  if (scope === "now") {
    const track = ds.liveTrack ?? liveSh?.currentTrack ?? null;
    if (track && !track.resolving && (track.isLibraryHit || track.isArtistHit)) {
      return { spins: [track], partial: false };
    }
    return { spins: [], partial: false };
  }

  if (scope === "set") {
    // The confirmed live track (ds.liveTrack) arrives via the SSE/live-pulse
    // path independently of the recent-spins poll. It can be one poll cycle
    // ahead of liveSh.spins, so a confirmed crossing may be missing from the
    // show's spin array even though the ⬤ detail already reflects it. Merge
    // it in first so it always appears in the drill-down, then deduplicate
    // against the spin array to avoid showing it twice once the poll catches up.
    const seenSet = new Set<string>();
    const spins: DialSpin[] = [];
    const liveT = ds.liveTrack;
    if (liveT && !liveT.resolving && (liveT.isLibraryHit || liveT.isArtistHit)) {
      const key = `${liveT.playedAt}::${liveT.artist}::${liveT.title}`;
      seenSet.add(key);
      spins.push(liveT);
    }
    if (liveSh) {
      for (const sp of liveSh.spins) {
        if (sp.resolving || !(sp.isLibraryHit || sp.isArtistHit)) continue;
        const key = `${sp.playedAt}::${sp.artist}::${sp.title}`;
        if (seenSet.has(key)) continue;
        seenSet.add(key);
        spins.push(sp);
      }
    }
    spins.sort((a, b) => new Date(b.playedAt).getTime() - new Date(a.playedAt).getTime());
    return { spins, partial: false };
  }

  // 24h / 7d / lifetime: enumerate all client-side show spins.
  //
  // 24h: the rolling window extends up to 24h into the past, but useDialData
  // only loads today's recent spins (not yesterday's calendar data). After
  // midnight any crossings from yesterday remain in the server's rolling count
  // but are absent from ds.shows[].spins. We apply the time cutoff to exclude
  // spins that fall outside the window, but always mark partial=true so the UI
  // surfaces a note rather than implying the list matches the displayed count.
  //
  // 7d / lifetime: the client holds only a recent window; always partial.
  const cutoffMs = scope === "24h" ? window24hCutoffMs : 0;
  const seen = new Set<string>();
  const all: DialSpin[] = [];
  for (const show of ds.shows) {
    for (const sp of show.spins) {
      if (sp.resolving || !(sp.isLibraryHit || sp.isArtistHit)) continue;
      if (new Date(sp.playedAt).getTime() < cutoffMs) continue;
      // Deduplicate by identity key — the same spin can appear in overlapping
      // show windows (e.g. a spin near a show boundary).
      const key = `${sp.playedAt}::${sp.artist}::${sp.title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(sp);
    }
  }
  // Merge in the confirmed live track for the same SSE timing reason as the
  // set scope: it may not yet be in show.spins but IS a confirmed crossing.
  const liveTWide = ds.liveTrack;
  if (liveTWide && !liveTWide.resolving && (liveTWide.isLibraryHit || liveTWide.isArtistHit)) {
    const liveMs = new Date(liveTWide.playedAt).getTime();
    if (liveMs >= cutoffMs) {
      const key = `${liveTWide.playedAt}::${liveTWide.artist}::${liveTWide.title}`;
      if (!seen.has(key)) {
        all.push(liveTWide);
      }
    }
  }
  all.sort((a, b) => new Date(b.playedAt).getTime() - new Date(a.playedAt).getTime());
  const partialNote =
    scope === "24h" ? "today's spins only" : "recent crossings shown";
  return { spins: all, partial: true, partialNote };
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
