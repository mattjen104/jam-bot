import type { Station } from "@workspace/api-client-react";
import type { WpNow, WpOnAirItem } from "../webplayer/hooks";
import { resolvePlaybackSource } from "../hooks/useRadioPlayer";

export type NextChangeState =
  | "trusted"
  | "estimated"
  | "changing-soon"
  | "unknown"
  | "stale"
  | "just-changed";

export interface LiveNow extends WpNow {
  serverTime?: string;
  estimatedRemainingMs?: number | null;
  likelyExpiring?: boolean;
  timingConfidence?: "trusted" | "estimated" | "unknown";
}

export type NextChangeSource = Pick<
  LiveNow,
  | "freshness"
  | "estimatedRemainingMs"
  | "serverTime"
  | "timestampKind"
  | "timingReason"
  | "timingUncertaintyMs"
  | "clockUncertaintyMs"
  | "timingConfidence"
>;

export const PRECISE_COUNTDOWN_MAX_UNCERTAINTY_MS = 8_000;
export interface NextChangeView {
  state: NextChangeState;
  remainingMs: number | null;
  label: string;
  /** Local epoch at which the server-calculated estimate reaches zero. */
  boundaryAt: number | null;
}

export interface BroadcastAdvisoryView {
  kind: "dj_speaking" | "music_resuming";
  label: "DJ may be speaking" | "Music may be resuming";
}

export function deriveBroadcastAdvisory(
  now: Pick<LiveNow, "freshness" | "observedAt" | "broadcastAdvisory"> | null | undefined,
  atMs = Date.now(),
): BroadcastAdvisoryView | null {
  const advisory = now?.broadcastAdvisory;
  if (!advisory || now?.freshness === "stale") return null;
  const observedAt = Date.parse(advisory.observedAt);
  const expiresAt = Date.parse(advisory.expiresAt);
  const trackObservedAt = now?.observedAt ? Date.parse(now.observedAt) : Number.NaN;
  if (!Number.isFinite(observedAt) || !Number.isFinite(expiresAt) || expiresAt <= atMs) return null;
  if (Number.isFinite(trackObservedAt) && trackObservedAt > observedAt) return null;
  return advisory.kind === "dj_speaking"
    ? { kind: advisory.kind, label: "DJ may be speaking" }
    : { kind: advisory.kind, label: "Music may be resuming" };
}

export interface HandoffCandidate {
  station: Station;
  now: LiveNow;
  score: number;
  reasons: string[];
  changingSoon: boolean;
}

export function trackIdentity(now: Pick<LiveNow, "mbid" | "artist" | "title">): string {
  return now.mbid
    ? `mbid:${now.mbid}`
    : `text:${now.artist.trim().toLowerCase()}|${now.title.trim().toLowerCase()}`;
}

export function tracksDiffer(
  a: Pick<LiveNow, "mbid" | "artist" | "title"> | null | undefined,
  b: Pick<LiveNow, "mbid" | "artist" | "title"> | null | undefined,
): boolean {
  if (!a || !b) return true;
  return trackIdentity(a) !== trackIdentity(b);
}

export function isConfirmedHandoffBoundary(
  baseline: Pick<LiveNow, "mbid" | "artist" | "title"> | null | undefined,
  next: LiveNow | null | undefined,
  playable: boolean,
): boolean {
  return Boolean(
    baseline &&
    next &&
    playable &&
    next.resolved &&
    next.mbid != null &&
    next.freshness === "fresh" &&
    tracksDiffer(baseline, next),
  );
}

/** Commit a live handoff while preserving the single-audio-session boundary. */
export function commitLiveHandoff(
  target: Station,
  currentSlug: string | null | undefined,
  scanActive: boolean,
  stopScan: () => void,
  tune: (station: Station) => void,
): void {
  if (scanActive) stopScan();
  if (target.slug !== currentSlug) tune(target);
}

function localBoundaryAt(now: NextChangeSource): number | null {
  if (now.estimatedRemainingMs == null || now.estimatedRemainingMs < 0) return null;
  const serverMs = now.serverTime ? Date.parse(now.serverTime) : NaN;
  if (!Number.isFinite(serverMs)) return null;
  return serverMs + now.estimatedRemainingMs;
}

export function formatRemaining(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export function formatApproximateRemaining(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  return minutes === 1 ? "about a minute" : `about ${minutes} minutes`;
}

/**
 * Translate the server's advisory expiry into honest display language.
 * No server timestamp means no exact countdown: this is intentionally
 * "watching" rather than pretending the browser's clock is authoritative.
 */
export function deriveNextChange(
  now: NextChangeSource | null | undefined,
  atMs: number | null = Date.now(),
): NextChangeView {
  if (!now) {
    return { state: "unknown", remainingMs: null, label: "Watching for the next song", boundaryAt: null };
  }
  if (now.freshness === "stale") {
    return { state: "stale", remainingMs: null, label: "Waiting for a fresh signal", boundaryAt: null };
  }
  if (now.timestampKind === "receipt" || now.timingReason === "receipt_only") {
    return {
      state: "unknown",
      remainingMs: null,
      label: "No station start time to count from",
      boundaryAt: null,
    };
  }
  if (atMs == null) {
    return {
      state: "unknown",
      remainingMs: null,
      label: "Aligning with the broadcast clock",
      boundaryAt: null,
    };
  }
  const boundaryAt = localBoundaryAt(now);
  if (boundaryAt == null || now.estimatedRemainingMs == null) {
    return { state: "unknown", remainingMs: null, label: "Watching for the next song", boundaryAt: null };
  }
  const timingUncertaintyMs = now.timingUncertaintyMs;
  const totalUncertaintyMs =
    timingUncertaintyMs == null
      ? null
      : timingUncertaintyMs + Math.max(0, now.clockUncertaintyMs ?? 0);
  if (
    totalUncertaintyMs != null &&
    totalUncertaintyMs > VISIBLE_COUNTDOWN_MAX_UNCERTAINTY_MS
  ) {
    return {
      state: "unknown",
      remainingMs: null,
      label: "Timing is too uncertain to count down",
      boundaryAt,
    };
  }
  const remainingMs = Math.max(0, boundaryAt - atMs);
  if (remainingMs === 0) {
    return { state: "just-changed", remainingMs, label: "Checking for the next song", boundaryAt };
  }
  if (
    now.timingConfidence === "trusted" &&
    (totalUncertaintyMs == null ||
      totalUncertaintyMs <= PRECISE_COUNTDOWN_MAX_UNCERTAINTY_MS)
  ) {
    return { state: "trusted", remainingMs, label: `Next change in ${formatRemaining(remainingMs)}`, boundaryAt };
  }
  if (remainingMs <= 30_000) {
    if (
      totalUncertaintyMs != null &&
      totalUncertaintyMs > PRECISE_COUNTDOWN_MAX_UNCERTAINTY_MS
    ) {
      return {
        state: "estimated",
        remainingMs,
        label: `About ${formatRemaining(remainingMs)} left`,
        boundaryAt,
      };
    }
    return {
      state: "changing-soon",
      remainingMs,
      label: "Changing soon · Lore is watching",
      boundaryAt,
    };
  }
  return {
    state: "estimated",
    remainingMs,
    label: `${formatApproximateRemaining(remainingMs)} left`,
    boundaryAt,
  };
}

/**
 * Rank only resolved, fresh, playable live stations. `matchCount` is the
 * existing library-overlap signal; current-artist and category matches add
 * sound affinity without inventing a crossing from unresolved metadata.
 */
export function rankHandoffCandidates(
  items: WpOnAirItem[],
  currentStation: Station | null,
  currentNow: LiveNow | null,
  atMs = Date.now(),
): HandoffCandidate[] {
  const currentArtist = currentNow?.artist.trim().toLowerCase() ?? "";
  const currentCategories = new Set(currentStation?.stationCategories ?? []);
  return items
    .filter((item) =>
      item.station.slug !== currentStation?.slug &&
      item.now.resolved &&
      item.now.mbid != null &&
      item.now.freshness === "fresh" &&
      resolvePlaybackSource(item.station) != null,
    )
    .map((item) => {
      const now = item.now as LiveNow;
      const reasons: string[] = [];
      let score = 0;
      const timing = deriveNextChange(now, atMs);
      const changingSoon =
        timing.remainingMs != null && timing.remainingMs <= 30_000;
      if (item.matchCount != null && item.matchCount > 0) {
        score += Math.min(item.matchCount, 12) * 4;
        reasons.push(`${item.matchCount} library matches`);
      }
      if (currentArtist && now.artist.trim().toLowerCase() === currentArtist) {
        score += 30;
        reasons.push(`playing ${now.artist}`);
      }
      if (
        currentArtist &&
        item.earlier.some((artist) => artist.trim().toLowerCase() === currentArtist)
      ) {
        score += 14;
        reasons.push(`played ${currentNow?.artist ?? "this sound"} recently`);
      }
      const sharedCategories = (item.station.stationCategories ?? [])
        .filter((category) => currentCategories.has(category));
      if (sharedCategories.length) {
        score += sharedCategories.length * 5;
        reasons.push("similar station sound");
      }
      if (now.freshness === "fresh") {
        score += 10;
        reasons.push("fresh live signal");
      }
      if (changingSoon) {
        score -= 35;
        reasons.unshift("changing soon");
      } else if (timing.remainingMs != null && timing.remainingMs >= 60_000) {
        score += timing.state === "trusted" ? 10 : 5;
        reasons.push("enough time to listen");
      } else if (timing.state === "trusted") {
        score += 4;
      }
      if (item.station.discoveryScore != null) score += Math.min(item.station.discoveryScore, 100) / 20;
      if (reasons.length === 0) reasons.push("a fresh live signal");
      return {
        station: item.station,
        now,
        score,
        reasons: reasons.slice(0, 2),
        changingSoon,
      };
    })
    .sort((a, b) =>
      Number(a.changingSoon) - Number(b.changingSoon) ||
      b.score - a.score ||
      a.station.name.localeCompare(b.station.name),
    );
}

/**
 * Preserve card positions while replacing their live metadata in place.
 * Ineligible stations disappear immediately; newly eligible stations fill
 * vacancies in ranked order. Callers reset `previousSlugs` only for a
 * confirmed track boundary or an explicit refresh.
 */
export function stabilizeCandidateOrder(
  previousSlugs: readonly string[],
  ranked: readonly HandoffCandidate[],
): HandoffCandidate[] {
  const bySlug = new Map(ranked.map((candidate) => [candidate.station.slug, candidate]));
  const stable = previousSlugs
    .map((slug) => bySlug.get(slug))
    .filter((candidate): candidate is HandoffCandidate => candidate != null);
  const seen = new Set(stable.map((candidate) => candidate.station.slug));
  for (const candidate of ranked) {
    if (stable.length >= 3) break;
    if (!seen.has(candidate.station.slug)) {
      stable.push(candidate);
      seen.add(candidate.station.slug);
    }
  }
  return stable;
}

export const VISIBLE_COUNTDOWN_MAX_UNCERTAINTY_MS = 45_000;
