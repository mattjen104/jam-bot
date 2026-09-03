/**
 * useStationFastLane — station-landing fast-lane revalidation.
 *
 * When the listener stops the scan on (or tunes directly to) a station, the
 * Dial's aggregate now-playing snapshot can be up to a poll cycle old. This
 * hook fetches that one station's freshest stored state from the server's
 * fast-lane endpoint (`/api/player/station/:slug/now`) in parallel with
 * starting audio. If the server reports it triggered a one-shot source
 * refresh (the stored state exceeded its freshness budget), the hook briefly
 * re-checks so the corrected track lands within a few seconds. Whenever a
 * result differs from the candidate the listener landed on, `onFreshTrack`
 * fires so the caller can reconcile the displayed track.
 *
 * Landing confirmation (task: parallel live-stream startup) — the hook also
 * models the handoff explicitly, keyed off the landing identity (every
 * landOnStation call takes a fresh generation token; responses from a
 * superseded landing are ignored entirely — no reconciliation callback, no
 * confirmation change, no re-check scheduling):
 *
 *   confirming             — audio started; the bounded window is open.
 *   confirmed              — a fast-lane response arrived with a non-stale
 *                            stored track: the display is current/exact.
 *   unconfirmed-continuing — the window elapsed with no (non-stale) response.
 *                            Playback continues untouched; the UI may show a
 *                            soft "metadata may be delayed" hint. A LATE
 *                            response upgrades this to confirmed seamlessly.
 *
 * A timeout is never a negative claim: no phase transition removes or
 * replaces the displayed track — only a real differing response does (via
 * `onFreshTrack`), exactly as before.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export interface FastLaneNow {
  mbid: string | null;
  artistMbid: string | null;
  title: string;
  artist: string;
  artworkUrl: string | null;
  releaseYear: number | null;
  playedAt: string;
  observedAt: string;
  persistedAt?: string;
  sourceStartedAt?: string | null;
  timestampKind?: "source" | "fingerprint" | "inferred" | "receipt";
  timingReason?: "station_declared_start" | "fingerprint_play_offset" | "inferred_start" | "receipt_only";
  timingUncertaintyMs?: number | null;
  freshness: "fresh" | "aging" | "stale";
  resolved: boolean;
  /**
   * Advisory expiry estimate: how much of the song the server thinks is left
   * (from recording duration + best position signal). Null when duration is
   * unknown. Never changes which track is displayed — it only drives the
   * boundary re-check below.
   */
  estimatedRemainingMs?: number | null;
  /** True when the track is inside the server's likely-expiring window. */
  likelyExpiring?: boolean;
  timingConfidence?: "trusted" | "estimated" | "unknown";
}

export interface FastLaneResponse {
  station: { slug: string; name: string };
  now: FastLaneNow | null;
  refreshTriggered: boolean;
  /** Server confirmed an observation newer than the targeted refresh. */
  confirmed?: boolean;
}

/** The track the listener believes is playing at landing time. */
export interface FastLaneCandidate {
  mbid: string | null;
  title: string;
  artist: string;
}

/** Post-refresh re-check schedule (ms after landing response). */
export const FAST_LANE_RECHECK_DELAYS_MS: readonly number[] = [2500, 5000];

/**
 * Bounded confirmation window: how long after landing we wait for a fresh
 * metadata response before moving to the soft unconfirmed state. Audio is
 * never gated on this — it starts immediately, in parallel.
 */
export const LANDING_CONFIRM_WINDOW_MS = 1500;

/** Padding past the estimated track boundary before the single expiry re-check. */
export const EXPIRY_RECHECK_PAD_MS = 3000;
/** Upper bound on how far out an expiry re-check may be scheduled. */
export const EXPIRY_RECHECK_MAX_MS = 45_000;

/**
 * When a landing result is likely-expiring, when (ms from now) should the
 * single boundary re-check fire? Null when the result carries no usable
 * estimate — advisory only, no estimate ⇒ no re-check.
 */
export function expiryRecheckDelayMs(now: FastLaneNow | null): number | null {
  if (!now?.likelyExpiring) return null;
  const remaining = now.estimatedRemainingMs;
  if (remaining == null || remaining < 0) return null;
  const uncertainty = Math.max(0, now.timingUncertaintyMs ?? 0);
  return Math.min(
    remaining + uncertainty + EXPIRY_RECHECK_PAD_MS,
    EXPIRY_RECHECK_MAX_MS,
  );
}

/**
 * Does the fast-lane result name a different track than the landing
 * candidate? MBIDs win when both sides have one; otherwise compare
 * normalized text. No candidate at all ⇒ any result is news.
 */
export function tracksDiffer(
  candidate: FastLaneCandidate | null | undefined,
  next: FastLaneNow,
): boolean {
  if (!candidate) return true;
  if (candidate.mbid && next.mbid) return candidate.mbid !== next.mbid;
  const norm = (s: string) => s.trim().toLowerCase();
  return (
    norm(candidate.title) !== norm(next.title) ||
    norm(candidate.artist) !== norm(next.artist)
  );
}

export function useStationFastLane(
  onFreshTrack: (slug: string, now: FastLaneNow) => void,
): {
  landOnStation: (slug: string, candidate: FastLaneCandidate | null) => void;
  /** Handoff state for the most recent landing (see module doc). */
  confirmation: LandingConfirmation | null;
} {
  // Latest callback in a ref so landOnStation stays referentially stable.
  const cbRef = useRef(onFreshTrack);
  useEffect(() => { cbRef.current = onFreshTrack; }, [onFreshTrack]);

  // Pending re-check timers per slug — a new landing on the same station
  // supersedes any in-flight re-check schedule.
  const timersRef = useRef(new Map<string, number[]>());

  // ── Landing confirmation state machine ────────────────────────────────
  // Keyed off the landing identity: every landOnStation call takes a fresh
  // generation token. A response (or re-check) from a superseded landing is
  // ignored entirely — no reconciliation callback, no confirmation change,
  // no re-check scheduling. Zeroing the generation on unmount invalidates
  // every in-flight fetch too.
  const [confirmation, setConfirmation] = useState<LandingConfirmation | null>(null);
  const landingGenRef = useRef(0);
  const windowTimerRef = useRef<number | null>(null);

  const clearWindowTimer = useCallback(() => {
    if (windowTimerRef.current != null) {
      window.clearTimeout(windowTimerRef.current);
      windowTimerRef.current = null;
    }
  }, []);

  const clearSlugTimers = useCallback((slug: string) => {
    const ids = timersRef.current.get(slug);
    if (ids) {
      for (const id of ids) window.clearTimeout(id);
      timersRef.current.delete(slug);
    }
  }, []);

  const landOnStation = useCallback(
    (slug: string, candidate: FastLaneCandidate | null) => {
      clearSlugTimers(slug);

      // Open the bounded confirmation window for this landing. Audio startup
      // runs in parallel at the call site — never gated on this.
      const gen = ++landingGenRef.current;
      const landedAtMs = Date.now();
      const landingId =
        globalThis.crypto?.randomUUID?.() ?? `${landedAtMs}-${gen}`;
      const candidateKey = candidate?.mbid
        ? `mbid:${candidate.mbid}`
        : candidate
          ? `text:${candidate.artist.trim().toLowerCase()}|${candidate.title.trim().toLowerCase()}`
          : "";
      const isCurrent = () => landingGenRef.current === gen;
      clearWindowTimer();
      setConfirmation({ slug, phase: "confirming" });
      windowTimerRef.current = window.setTimeout(() => {
        windowTimerRef.current = null;
        // Window elapsed with no confirming response: soft unconfirmed state.
        // NEVER a negative claim — the displayed track is untouched, and a
        // late response below still upgrades this to confirmed.
        setConfirmation((c) =>
          c && c.slug === slug && c.phase === "confirming"
            ? { slug, phase: "unconfirmed" }
            : c,
        );
      }, LANDING_CONFIRM_WINDOW_MS);

      const check = async (): Promise<FastLaneResponse | null> => {
        const res = await fetch(
          `/api/player/station/${encodeURIComponent(slug)}/now`,
          {
            headers: {
              "Content-Type": "application/json",
              "X-Lore-Landed-At": String(landedAtMs),
              "X-Lore-Landing-Id": landingId,
              ...(candidateKey ? { "X-Lore-Landing-Track": candidateKey } : {}),
            },
          },
        );
        // Superseded while in flight: a newer landing owns the handoff now —
        // discard the response completely (no reconciliation callback, no
        // confirmation change, no timers).
        if (!isCurrent()) return null;
        if (!res.ok) return null;
        const body = (await res.json()) as FastLaneResponse;
        if (!isCurrent()) return null;
        if (body.now && tracksDiffer(candidate, body.now)) {
          cbRef.current(slug, body.now);
        }
        // Confirm the landing: any non-stale stored track means the display
        // is now current/exact. Stale responses keep the window open — the
        // triggered one-shot refresh (re-checks below) usually resolves it.
        // Late responses (after the window) upgrade unconfirmed → confirmed.
        const stationSpecificConfirmed =
          body.confirmed ??
          (body.now?.freshness !== "stale" && !body.refreshTriggered);
        if (body.now && stationSpecificConfirmed) {
          clearWindowTimer();
          setConfirmation((c) =>
            c && c.slug === slug ? { slug, phase: "confirmed" } : c,
          );
        }
        return body;
      };

      const addTimers = (ids: number[]) => {
        const existing = timersRef.current.get(slug) ?? [];
        timersRef.current.set(slug, [...existing, ...ids]);
      };

      void check()
        .then((body) => {
          if (!body || !isCurrent()) return;
          const ids: number[] = [];
          if (body.refreshTriggered) {
            // The server kicked a one-shot source refresh — briefly re-check so
            // the corrected track lands. Re-checks never reschedule themselves
            // (the server debounces further refreshes anyway).
            ids.push(
              ...FAST_LANE_RECHECK_DELAYS_MS.map((delay) =>
                window.setTimeout(() => {
                  void check().catch(() => { /* transient — landing is best-effort */ });
                }, delay),
              ),
            );
          }
          // Likely-expiring candidate: the song is close to its end, so the
          // track we just landed on is provisional. Schedule ONE re-check just
          // past the estimated boundary; only a genuinely different track from
          // the server changes the display (tracksDiffer above). The boundary
          // re-check never reschedules itself.
          const expiryDelay = expiryRecheckDelayMs(body.now);
          if (expiryDelay != null) {
            ids.push(
              window.setTimeout(() => {
                void check().catch(() => { /* transient — landing is best-effort */ });
              }, expiryDelay),
            );
          }
          if (ids.length) addTimers(ids);
        })
        .catch(() => { /* transient — landing is best-effort */ });
    },
    [clearSlugTimers, clearWindowTimer],
  );

  // Unmount: cancel every pending re-check, the confirmation window, AND
  // invalidate the landing generation, so an in-flight fetch resolving after
  // cleanup can neither reconcile nor register new timers.
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const ids of timers.values()) {
        for (const id of ids) window.clearTimeout(id);
      }
      timers.clear();
      landingGenRef.current = -1;
      if (windowTimerRef.current != null) {
        window.clearTimeout(windowTimerRef.current);
        windowTimerRef.current = null;
      }
    };
  }, []);

  return { landOnStation, confirmation };
}

/** Handoff phase for the most recent station landing. */
export type LandingConfirmationPhase =
  | "confirming"
  | "confirmed"
  | "unconfirmed";

/** Confirmation state for the most recent landing, or null before any landing. */
export interface LandingConfirmation {
  slug: string;
  phase: LandingConfirmationPhase;
}
