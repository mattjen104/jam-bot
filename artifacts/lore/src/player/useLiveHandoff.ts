import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Station } from "@workspace/api-client-react";
import type { WpOnAirItem } from "../webplayer/hooks";
import {
  deriveNextChange,
  isConfirmedHandoffBoundary,
  rankHandoffCandidates,
  tracksDiffer,
  type HandoffCandidate,
  type LiveNow,
  type NextChangeView,
} from "./liveHandoff";
import { resolvePlaybackSource } from "../hooks/useRadioPlayer";

export const HANDOFF_MAX_WAIT_MS = 45_000;
export const HANDOFF_POLL_MS = 2_500;

export type HandoffPhase = "checking" | "watching" | "ready" | "timed-out";

export interface PendingHandoff {
  /** Station that was sounding when this handoff was armed. */
  sourceSlug: string | null;
  target: Station;
  phase: HandoffPhase;
  reason: string;
  baseline: LiveNow | null;
  destinationNow: LiveNow | null;
  startedAt: number;
  deadlineAt: number;
}

interface FastLaneBody {
  serverTime?: string;
  station: { slug: string; name: string };
  now: LiveNow | null;
  refreshTriggered?: boolean;
}

async function fetchFastLane(slug: string): Promise<FastLaneBody | null> {
  const response = await fetch(`/api/player/station/${encodeURIComponent(slug)}/now`, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) return null;
  const body = await response.json() as FastLaneBody;
  return body.now ? { ...body, now: { ...body.now, serverTime: body.serverTime } } : body;
}

export function useLiveHandoff(
  currentStation: Station | null,
  onAirItems: WpOnAirItem[],
  onSwitch: (station: Station) => void,
) {
  const slug = currentStation?.slug ?? null;
  const [nowState, setNowState] = useState<{ slug: string; value: LiveNow } | null>(null);
  const now = nowState?.slug === slug ? nowState.value : null;
  const [clockMs, setClockMs] = useState(() => Date.now());
  const [pendingState, setPending] = useState<PendingHandoff | null>(null);
  const pending = pendingState?.sourceSlug === slug ? pendingState : null;
  const [noQualifiedSlug, setNoQualifiedSlug] = useState<string | null>(null);
  const generationRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const checkedBoundaryRef = useRef<string | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const refresh = useCallback(async (targetSlug: string, generation?: number) => {
    const body = await fetchFastLane(targetSlug).catch(() => null);
    if (generation != null && generationRef.current !== generation) return null;
    if (targetSlug === slug && body?.now) setNowState({ slug: targetSlug, value: body.now });
    return body;
  }, [slug]);

  useEffect(() => {
    generationRef.current += 1;
    clearTimer();
    // State from an old source must not reappear if the listener later tunes
    // back. Queueing keeps the effect focused on the external timer lifecycle.
    queueMicrotask(() => {
      setPending((value) => value && value.sourceSlug !== slug ? null : value);
    });
    if (!slug) {
      return;
    }
    let cancelled = false;
    const load = async () => {
      const body = await fetchFastLane(slug).catch(() => null);
      if (!cancelled && body?.now) setNowState({ slug, value: body.now });
    };
    void load();
    const interval = window.setInterval(load, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [slug, clearTimer]);

  useEffect(() => {
    const interval = window.setInterval(() => setClockMs(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, []);

  const nextChange = useMemo<NextChangeView>(
    () => deriveNextChange(now, clockMs),
    [now, clockMs],
  );

  // Countdown zero is a re-check signal only. The separate on-air query/SSE
  // remains the authority for what is displayed and what is sounding.
  useEffect(() => {
    if (!slug || !now || nextChange.state !== "just-changed") return;
    const key = `${slug}:${now.mbid ?? `${now.artist}|${now.title}`}:${now.playedAt}`;
    if (checkedBoundaryRef.current === key) return;
    checkedBoundaryRef.current = key;
    void refresh(slug);
  }, [slug, now, nextChange.state, refresh]);

  const candidates = useMemo(
    () => rankHandoffCandidates(onAirItems, currentStation, now),
    [onAirItems, currentStation, now],
  );

  const cancel = useCallback(() => {
    generationRef.current += 1;
    clearTimer();
    setPending(null);
  }, [clearTimer]);

  const arm = useCallback((target: Station, reason: string) => {
    generationRef.current += 1;
    const generation = generationRef.current;
    clearTimer();
    const startedAt = Date.now();
    const deadlineAt = startedAt + HANDOFF_MAX_WAIT_MS;
    let baseline: LiveNow | null = null;
    setNoQualifiedSlug(null);
    setPending({
      sourceSlug: slug,
      target,
      phase: "checking",
      reason,
      baseline: null,
      destinationNow: null,
      startedAt,
      deadlineAt,
    });

    const check = async () => {
      if (generationRef.current !== generation) return;
      const body = await fetchFastLane(target.slug).catch(() => null);
      if (generationRef.current !== generation) return;
      const current = body?.now ?? null;
      const elapsed = Date.now() - startedAt;
      if (!current) {
        if (elapsed >= HANDOFF_MAX_WAIT_MS) {
          setPending((value) => value?.target.slug === target.slug
            ? { ...value, phase: "timed-out" }
            : value);
          return;
        }
        timerRef.current = setTimeout(check, HANDOFF_POLL_MS);
        return;
      }

      const wasChanged = baseline != null && tracksDiffer(baseline, current);
      baseline ??= current;
      const isReady = wasChanged && isConfirmedHandoffBoundary(
        baseline,
        current,
        resolvePlaybackSource(target) != null,
      );
      setPending((value) => {
        if (!value || value.target.slug !== target.slug) return value;
        if (isReady) {
          return { ...value, baseline, destinationNow: current, phase: "ready" };
        }
        return {
          ...value,
          baseline,
          destinationNow: current,
          phase: "watching",
        };
      });

      if (elapsed >= HANDOFF_MAX_WAIT_MS) {
        setPending((value) => value?.target.slug === target.slug && value.phase !== "ready"
          ? { ...value, phase: "timed-out" }
          : value);
        return;
      }
      if (isReady) {
        clearTimer();
        return;
      }
      timerRef.current = setTimeout(check, HANDOFF_POLL_MS);
    };
    void check();
  }, [clearTimer, slug]);

  const catchCurrent = useCallback(() => {
    if (currentStation) arm(currentStation, "Stay here and catch this station's next song.");
  }, [arm, currentStation]);

  const catchBest = useCallback(() => {
    const best = candidates[0];
    if (!best) {
      setNoQualifiedSlug(slug);
      return;
    }
    arm(best.station, `Selected for ${best.reasons.join(" and ")}.`);
  }, [arm, candidates, slug]);

  const catchCandidate = useCallback((candidate: HandoffCandidate) => {
    arm(candidate.station, `Selected for ${candidate.reasons.join(" and ")}.`);
  }, [arm]);

  const switchNow = useCallback(() => {
    if (!pending) return;
    const target = pending.target;
    cancel();
    onSwitch(target);
  }, [cancel, onSwitch, pending]);

  const keepWatching = useCallback(() => {
    if (!pending) return;
    arm(pending.target, pending.reason);
  }, [arm, pending]);

  useEffect(() => () => {
    generationRef.current += 1;
    clearTimer();
  }, [clearTimer]);

  return {
    now,
    nextChange,
    candidates,
    pending,
    noQualifiedStation: noQualifiedSlug === slug,
    catchCurrent,
    catchBest,
    catchCandidate,
    cancel,
    switchNow,
    keepWatching,
  };
}