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
export function dialShowAsAttribution(show: DialShow): ShowAttributionLike {
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
 * Oxford commas are used for three or more names.
 */
/** Toggle handle for the expandable "Also, …" second sentence. */
export interface AlsoToggle {
  expanded: boolean;
  onToggle: () => void;
}

export function nameNodes(artists: string[]): ReactNode {
  const usable = artists.map((artist) => cleanLiveValue(artist)).filter((artist): artist is string => artist != null);
  if (usable.length === 0) return null;
  const shown = usable.slice(0, 6);
  const rest = usable.length - shown.length;
  const nodes: ReactNode[] = [];
  shown.forEach((name, i) => {
    if (i > 0) {
      if (i === shown.length - 1 && rest === 0) {
        // Oxford comma for three or more names ("A, B, and C").
        nodes.push(shown.length > 2 ? ", and " : " and ");
      } else {
        nodes.push(", ");
      }
    }
    nodes.push(<b className="fdrow__artist" key={i}>{name}</b>);
  });
  if (rest > 0) nodes.push(shown.length > 1 ? ", and " : " and ", `${rest} more`);
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
 * When `also` is provided and timing is "in the current set", that phrase
 * becomes a clickable button that toggles the appended "Also, …" tail.
 * For "now" sentences the timing stays plain text with a leading comma.
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
  alsoTail?: ReactNode,
  also?: AlsoToggle,
): ReactNode {
  // Build the timing element.
  // "now" → plain ", now" (comma rule)
   // "in the current set" + toggle → clickable button
   // "in the current set" without toggle / any other string → plain " <timing>"
  const timingEl: ReactNode = !timing ? null :
    timing === "now" ? ", now" :
    also ? (
      <>
        {" "}
        <button
          type="button"
          className="fdrow__thisset"
          aria-expanded={also.expanded}
          aria-label={also.expanded ? "Hide the rest of this set" : "Show the rest of this set"}
          onClick={(e) => { e.stopPropagation(); also.onToggle(); }}
        >in the current set</button>
      </>
    ) : ` ${timing}`;

  if (artistNodes) {
    if (djName && showName) {
      return (
        <>
          <b className="fdrow__dj">{djName}</b>
          {" selected "}
          {artistNodes}
          {" on "}
          <span className="fdrow__show">{showName}</span>
          {timingEl}
          {"."}
          {alsoTail}
        </>
      );
    }
    if (djName) {
      return (
        <>
          <b className="fdrow__dj">{djName}</b>
          {" selected "}
          {artistNodes}
          {timingEl}
          {"."}
          {alsoTail}
        </>
      );
    }
    if (showName) {
      return (
        <>
          {artistNodes}
          {" on "}
          <span className="fdrow__show">{showName}</span>
          {timingEl}
          {"."}
          {alsoTail}
        </>
      );
    }
    return <>{artistNodes}{timingEl}{"."}{alsoTail}</>;
  }

  // Count-only fallback (no artist names resolved yet) — no toggle affordance
  const countNode = <b>{count} {countLabel}</b>;
  if (djName && showName) {
    return (
      <>
        <b className="fdrow__dj">{djName}</b>
        {" · "}
        {countNode}
        {" on "}
        <span className="fdrow__show">{showName}</span>
        {"."}
      </>
    );
  }
  if (djName) {
    return (
      <>
        <b className="fdrow__dj">{djName}</b>
        {" · "}
        {countNode}
        {"."}
      </>
    );
  }
  if (showName) {
    return (
      <>
        {countNode}
        {" on "}
        <span className="fdrow__show">{showName}</span>
        {!also && timing ? (timing === "now" ? ", now" : ` ${timing}`) : timingEl}
        {"."}
      </>
    );
  }
  return <>{countNode}{!also && timing ? (timing === "now" ? ", now" : ` ${timing}`) : timingEl}{"."}</>;
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
  also?: AlsoToggle & { node: ReactNode },
  past?: PastContext,
): {
  node: ReactNode;
  hasTrack: boolean;
  artistsShown: string[];
  /** Present only in past mode when a real playback service is resolved.
   *  The caller is responsible for appending this as a separate sentence —
   *  never inline it as a provenance verb subject. */
  serviceClause: string | null;
} | null {
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

  // Past-mode timing comes from the set start localised to the station's
  // timezone. Live-mode distinguishes "now" from "in the current set".
  const serviceClause = pastServiceClause(past?.resolvedService);
  let timing: string;
  let activeAlso: (AlsoToggle & { node: ReactNode }) | undefined;
  if (past) {
    timing = classifySetTimeContext({
      startedAt: past.setStartedAt ?? past.playedAt,
      stationIanaTimezone: past.stationIanaTimezone ?? null,
      isCurrentSet: past.isCurrentSet ?? false,
    }).label;
    activeAlso = undefined;
  } else {
    const isLive = !!(current?.isLibraryHit || current?.isArtistHit);
    timing = isLive ? "now" : "in the current set";
    // Only wire the toggle for the current-set sentence.
    activeAlso = !isLive ? also : undefined;
  }

  if (artistNodes) {
    return {
      node: buildAttributedSentence(
        artistNodes,
        count,
        "of yours",
        dj,
        showName,
        timing,
        activeAlso?.expanded ? activeAlso.node : null,
        activeAlso,
      ),
      hasTrack: true,
      artistsShown: artists.slice(0, 6),
      serviceClause,
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
      artistsShown: [],
      serviceClause,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Station-local set time contexts and service attribution
// ---------------------------------------------------------------------------

export type SetDaypart = "day" | "night";
export type SetTimeContext =
  | { kind: "now"; label: "now"; day: string | null; daypart: SetDaypart | null }
  | { kind: "current-set"; label: "in the current set"; day: string | null; daypart: SetDaypart | null }
  | { kind: "last-set"; label: "in the last set"; day: string | null; daypart: SetDaypart | null }
  | { kind: "last-night"; label: "last night"; day: string; daypart: "night" }
  | { kind: "dated"; label: string; day: string | null; daypart: SetDaypart | null };

interface LocalSetTime {
  day: string;
  weekday: string;
  daypart: SetDaypart;
  dateLabel: string;
}

function localSetTime(startedAt: Date, stationIanaTimezone: string | null | undefined): LocalSetTime | null {
  if (!stationIanaTimezone || Number.isNaN(startedAt.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: stationIanaTimezone,
      weekday: "long",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      hourCycle: "h23",
    }).formatToParts(startedAt);
    const value = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value ?? "";
    const hour = Number(value("hour"));
    const year = value("year");
    const month = value("month");
    const dayOfMonth = value("day");
    const numericMonth = new Intl.DateTimeFormat("en-US", {
      timeZone: stationIanaTimezone,
      month: "2-digit",
    }).format(startedAt);
    if (!year || !month || !dayOfMonth || !Number.isFinite(hour)) return null;
    return {
      day: `${year}-${numericMonth}-${dayOfMonth.padStart(2, "0")}`,
      weekday: value("weekday"),
      // Night begins at 9pm and continues through 4:59am, by the station's
      // clock, so a local overnight program keeps its intended identity.
      daypart: hour >= 21 || hour < 5 ? "night" : "day",
      dateLabel: `${month} ${dayOfMonth}, ${year}`,
    };
  } catch {
    return null;
  }
}

/** The one Dial vocabulary for station-local set time. */
export function classifySetTimeContext({
  startedAt,
  stationIanaTimezone,
  now = new Date(),
  isNow = false,
  isCurrentSet = false,
}: {
  startedAt: Date;
  stationIanaTimezone: string | null | undefined;
  now?: Date;
  isNow?: boolean;
  isCurrentSet?: boolean;
}): SetTimeContext {
  const local = localSetTime(startedAt, stationIanaTimezone);
  if (isNow) return { kind: "now", label: "now", day: local?.day ?? null, daypart: local?.daypart ?? null };
  if (isCurrentSet) return { kind: "current-set", label: "in the current set", day: local?.day ?? null, daypart: local?.daypart ?? null };
  if (!local) {
    if (Number.isNaN(startedAt.getTime())) {
      return { kind: "dated", label: "an earlier set", day: null, daypart: null };
    }
    return {
      kind: "dated",
      label: new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(startedAt),
      day: null,
      daypart: null,
    };
  }
  const localNow = localSetTime(now, stationIanaTimezone);
  const previousLocalDay = localSetTime(new Date(now.getTime() - 24 * 60 * 60 * 1000), stationIanaTimezone)?.day;
  if (local.day === localNow?.day) return { kind: "last-set", label: "in the last set", day: local.day, daypart: local.daypart };
  if (local.day === previousLocalDay && local.daypart === "night") {
    return { kind: "last-night", label: "last night", day: local.day, daypart: "night" };
  }
  return { kind: "dated", label: `${local.weekday} ${local.daypart} · ${local.dateLabel}`, day: local.day, daypart: local.daypart };
}

/** Compatibility formatter for individual past spins. Set copy uses the shared classifier. */
export function pastTimingLabel(
  playedAt: Date,
  stationIanaTimezone: string | null,
): string {
  return classifySetTimeContext({ startedAt: playedAt, stationIanaTimezone }).label;
}

/**
 * Returns the playback-service clause appended after a past-mode provenance
 * sentence.  The service is never the grammatical subject of a provenance
 * verb — it is always a co-star in the "Replaying on your X." appendage.
 *
 * Returns null when no service is resolved or the service is unrecognised.
 */
export function pastServiceClause(
  service: string | null | undefined,
): string | null {
  if (!service) return null;
  const label =
    service === "spotify" ? "Spotify"
    : service === "youtube" ? "YouTube"
    : service === "apple-music" ? "Apple Music"
    : null;
  return label ? `Replaying on your ${label}.` : null;
}

/**
 * Optional context injected into `crossingSentence` for past-mode rendering.
 */
export interface PastContext {
  /** When the crossing spin actually aired — drives timing label. */
  playedAt: Date;
  /** Station IANA timezone used to localise the daypart label. */
  stationIanaTimezone?: string | null;
  /**
   * Resolved playback service, if any.  Never speculative — only pass this
   * when a service is actually about to play.  Drives the appended clause
   * "Replaying on your Spotify." which must never claim a service as the
   * subject of a provenance verb.
   */
  resolvedService?: string | null;
  /** Set start enables coherent set-level time wording for replayed crossings. */
  setStartedAt?: Date;
  /** True only when this crossing belongs to the current set. */
  isCurrentSet?: boolean;
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
 *   No DJ, show known     → "[Artist] on [Show] now / in the current set"
 *   Neither               → "[Artist] on now / in the current set"
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
      node: buildAttributedSentence(nn, show.crossings, "of yours", dj, showName, "in the current set"),
    };
  }

  // r=4: library artists aired this show, no exact track match
  if (show.artistCrossings > 0) {
    const nn = show.topArtistNames.length > 0 ? nameNodes(show.topArtistNames) : null;
    return {
      r: 4, cls: "w4",
      node: buildAttributedSentence(nn, show.artistCrossings, "artists of yours", dj, showName, "in the current set"),
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
