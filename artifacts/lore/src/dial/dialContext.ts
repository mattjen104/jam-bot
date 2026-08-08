/**
 * dialContext — the Dial's two-mode surface state machine.
 *
 * The Dial front door is either:
 *   - mode "dial"    → station selection (the list, discovery bands)
 *   - mode "context" → tuned: the list area is replaced by the current
 *     context (summary sentence + contextual subpanel / rail).
 *
 * Context is a serializable stack of generic frames (station → lens →
 * object), deliberately NOT radio-specific so future sources (review
 * summaries, etc.) can drive the same container. Time scrubbing is a
 * TEMPORAL MODIFIER carried on the descriptor, not a stack level: it marks
 * the root (station) frame as live-vs-past and never adds a breadcrumb crumb.
 *
 * This module is framework-free and owns:
 *   - the state shape + pure transitions (tune, push, pop, toDial, temporal)
 *   - (de)serialization to/from URL query params on "/" so refresh and
 *     shared links rebuild the exact context.
 *
 * Playback is intentionally OUT of scope: no transition here touches the
 * player. Only the deliberate actions (tune, station change, scrub) retune,
 * and those call the player at the call site, never from this module.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One level of the context stack. Generic on purpose. */
export interface ContextFrame {
  /** Frame kind — e.g. "station", "artist", "album", "review". */
  kind: string;
  /** Stable identifier — slug, MBID, etc. Must not contain "/" or newline. */
  id: string;
  /** Optional display label (not serialized; rebuilt from data on restore). */
  label?: string;
}

/** Live-vs-past position of the root (station) frame. Never a stack level. */
export type TemporalPosition =
  | { kind: "live" }
  | { kind: "past"; runId: number };

/** Generic context descriptor — source kind + stack + temporal modifier. */
export interface ContextDescriptor {
  /** Context source — "radio" today; future: "review", "library", … */
  source: string;
  /** Root-first stack; stack[0] is the committing frame (e.g. the station). */
  stack: ContextFrame[];
  temporal: TemporalPosition;
}

export type DialSurfaceState =
  | { mode: "dial"; ctx: null }
  | { mode: "context"; ctx: ContextDescriptor };

export const LIVE: TemporalPosition = { kind: "live" };

// ---------------------------------------------------------------------------
// Constructors & transitions (all pure)
// ---------------------------------------------------------------------------

/** The untuned front door: station selection. */
export function dialState(): DialSurfaceState {
  return { mode: "dial", ctx: null };
}

/**
 * Commit to a station context — the first click on a station row (or a scan
 * landing, which counts as the committing click). Always a deliberate reset:
 * any prior stack and temporal position are discarded.
 */
export function tuneToStation(slug: string, label?: string): DialSurfaceState {
  return {
    mode: "context",
    ctx: {
      source: "radio",
      stack: [{ kind: "station", id: slug, ...(label ? { label } : {}) }],
      temporal: LIVE,
    },
  };
}

/** Enter context mode from an arbitrary (possibly non-radio) descriptor. */
export function enterContext(ctx: ContextDescriptor): DialSurfaceState {
  return { mode: "context", ctx };
}

/** Push one lens/object frame. No-op in dial mode. Preserves temporal. */
export function pushFrame(state: DialSurfaceState, frame: ContextFrame): DialSurfaceState {
  if (state.mode !== "context") return state;
  return { mode: "context", ctx: { ...state.ctx, stack: [...state.ctx.stack, frame] } };
}

/**
 * Back: pop one context level. Popping the root frame returns to dial mode.
 * Temporal position is PRESERVED while any frame remains (Back never resets
 * the scrub position — only Dial / station-change do).
 */
export function popFrame(state: DialSurfaceState): DialSurfaceState {
  if (state.mode !== "context") return state;
  const stack = state.ctx.stack.slice(0, -1);
  if (stack.length === 0) return dialState();
  return { mode: "context", ctx: { ...state.ctx, stack } };
}

/**
 * Dial: return to station selection. This clears the context (and with it
 * the temporal modifier) but is a pure UI transition — audio keeps playing;
 * the caller must never stop the player here.
 */
export function toDial(): DialSurfaceState {
  return dialState();
}

/** Update the temporal modifier on the root frame. No-op in dial mode. */
export function setTemporal(state: DialSurfaceState, temporal: TemporalPosition): DialSurfaceState {
  if (state.mode !== "context") return state;
  if (sameTemporal(state.ctx.temporal, temporal)) return state;
  return { mode: "context", ctx: { ...state.ctx, temporal } };
}

export function sameTemporal(a: TemporalPosition, b: TemporalPosition): boolean {
  return a.kind === b.kind && (a.kind !== "past" || b.kind !== "past" || a.runId === b.runId);
}

/** The root station slug when the context is radio-sourced, else null. */
export function contextStationSlug(state: DialSurfaceState): string | null {
  if (state.mode !== "context" || state.ctx.source !== "radio") return null;
  const root = state.ctx.stack[0];
  return root?.kind === "station" ? root.id : null;
}

// ---------------------------------------------------------------------------
// URL (de)serialization
// ---------------------------------------------------------------------------
//
// Encoding on "/":
//   ?ctx=station:kexp                      root frame (kind:id)
//   &lens=artist:<mbid>&lens=album:<mbid>  additional frames, in order
//   &at=run:123                            temporal modifier (past only)
//   &src=review                            source, only when not "radio"
//
// Unrelated params (e.g. ?library=connected) are always preserved.

const CTX_PARAM = "ctx";
const LENS_PARAM = "lens";
const AT_PARAM = "at";
const SRC_PARAM = "src";

function encodeFrame(frame: ContextFrame): string {
  return `${frame.kind}:${frame.id}`;
}

function decodeFrame(raw: string): ContextFrame | null {
  const i = raw.indexOf(":");
  if (i <= 0 || i === raw.length - 1) return null;
  return { kind: raw.slice(0, i), id: raw.slice(i + 1) };
}

/**
 * Write the context portion of `params` in place (removing stale keys first).
 * Callers apply the result with history.replaceState — intra-context steps
 * must never pollute history.
 */
export function writeContextParams(params: URLSearchParams, state: DialSurfaceState): void {
  params.delete(CTX_PARAM);
  params.delete(LENS_PARAM);
  params.delete(AT_PARAM);
  params.delete(SRC_PARAM);
  if (state.mode !== "context") return;
  const { source, stack, temporal } = state.ctx;
  const [root, ...rest] = stack;
  if (!root) return;
  params.set(CTX_PARAM, encodeFrame(root));
  for (const frame of rest) params.append(LENS_PARAM, encodeFrame(frame));
  if (temporal.kind === "past") params.set(AT_PARAM, `run:${temporal.runId}`);
  if (source !== "radio") params.set(SRC_PARAM, source);
}

/** Rebuild the surface state from URL params. Malformed input → dial mode. */
export function readContextParams(params: URLSearchParams): DialSurfaceState {
  const rawRoot = params.get(CTX_PARAM);
  if (!rawRoot) return dialState();
  const root = decodeFrame(rawRoot);
  if (!root) return dialState();
  const stack: ContextFrame[] = [root];
  for (const rawLens of params.getAll(LENS_PARAM)) {
    const frame = decodeFrame(rawLens);
    if (frame) stack.push(frame);
  }
  let temporal: TemporalPosition = LIVE;
  const at = params.get(AT_PARAM);
  if (at?.startsWith("run:")) {
    const runId = Number(at.slice(4));
    if (Number.isFinite(runId)) temporal = { kind: "past", runId };
  }
  const source = params.get(SRC_PARAM) ?? "radio";
  return { mode: "context", ctx: { source, stack, temporal } };
}
