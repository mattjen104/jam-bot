/**
 * useDialSurface — React owner of the Dial's two-mode surface state.
 *
 * Wraps the pure dialContext state machine and keeps the URL query on "/"
 * in sync. Every update uses history.replaceState — intra-context steps
 * (lens push/pop, scrub moves) must NEVER push history entries.
 *
 * On mount, the state is rebuilt from the current URL so refresh and shared
 * links restore the exact context. Restoring never starts playback — the
 * `restored` flag tells the caller the initial state came from the URL.
 */
import { useCallback, useMemo, useState } from "react";
import {
  type ContextFrame,
  type DialSurfaceState,
  type TemporalPosition,
  dialState,
  popFrame,
  pushFrame,
  readContextParams,
  setTemporal,
  toDial,
  tuneToStation,
  writeContextParams,
} from "./dialContext";

function readInitialState(): DialSurfaceState {
  if (typeof window === "undefined") return dialState();
  return readContextParams(new URLSearchParams(window.location.search));
}

/** Sync the surface state into the URL via replace (never push). */
function replaceUrl(state: DialSurfaceState): void {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  writeContextParams(params, state);
  const qs = params.toString();
  const url = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`;
  window.history.replaceState(window.history.state, "", url);
}

export interface DialSurface {
  state: DialSurfaceState;
  mode: DialSurfaceState["mode"];
  ctx: DialSurfaceState["ctx"];
  /** True when the initial state was rebuilt from the URL in context mode. */
  restored: boolean;
  /** Commit to a station (row click / scan landing). Resets stack + temporal. */
  tune: (slug: string, label?: string) => void;
  /** Push one lens/object frame (never touches playback). */
  push: (frame: ContextFrame) => void;
  /** Back — pop one level; popping the root returns to dial mode. */
  back: () => void;
  /** Dial — return to station selection; audio keeps playing. */
  dial: () => void;
  /** Update live-vs-past position (scrub). URL updates via replace only. */
  temporal: (t: TemporalPosition) => void;
}

export function useDialSurface(): DialSurface {
  const [state, setState] = useState<DialSurfaceState>(readInitialState);
  // Whether the initial state was rebuilt from the URL in context mode. This is
  // a fixed property of the first render, so it lives in state (read safely in
  // render) rather than a ref (which must not be read during render).
  const [restored] = useState(() => state.mode === "context");

  const apply = useCallback((next: (prev: DialSurfaceState) => DialSurfaceState) => {
    setState((prev) => {
      const value = next(prev);
      if (value !== prev) replaceUrl(value);
      return value;
    });
  }, []);

  const tune = useCallback((slug: string, label?: string) => {
    apply(() => tuneToStation(slug, label));
  }, [apply]);
  const push = useCallback((frame: ContextFrame) => {
    apply((prev) => pushFrame(prev, frame));
  }, [apply]);
  const back = useCallback(() => {
    apply((prev) => popFrame(prev));
  }, [apply]);
  const dial = useCallback(() => {
    apply(() => toDial());
  }, [apply]);
  const temporal = useCallback((t: TemporalPosition) => {
    apply((prev) => setTemporal(prev, t));
  }, [apply]);

  return useMemo(() => ({
    state,
    mode: state.mode,
    ctx: state.ctx,
    restored,
    tune,
    push,
    back,
    dial,
    temporal,
  }), [state, restored, tune, push, back, dial, temporal]);
}
