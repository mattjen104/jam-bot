/**
 * Stream-first playback session types and pure helpers.
 *
 * The station broadcast (passthrough) is always the default. "Ride in Spotify"
 * is an explicit opt-in that requires a connected, Premium Spotify account.
 *
 * All helpers in this file are pure (deterministic, no side-effects) so they
 * can be unit-tested without React or a browser.
 */

/** Distinguishes the three session shapes without changing the playback module. */
export type TimeOrientation = "live" | "past" | "curated";

/**
 * Which audio path carries the current track.
 *
 * - passthrough      : station broadcast stream (always works, carries DJ voice)
 * - resolve_to_service: full-length play on the listener's connected service
 */
export type PlaybackMode = "passthrough" | "resolve_to_service";

/** Connected remote-control service. */
export type ConnectedService = "spotify" | "youtube" | "apple-music" | "bandcamp";

/**
 * One playback session — "tuned into this content, in this mode".
 * Created on every ride start; cleared on stop.
 */
export interface PlaybackSession {
  /** The picker or station the ride departs from (slug or handle). */
  pickerId: string | null;
  /** Distinguishes live radio, ghost-radio replay, and curated picker sequences. */
  timeOrientation: TimeOrientation;
  /**
   * Whether the broadcast or a remote service carries audio.
   * Default is always 'passthrough'; only switches when the user explicitly
   * enables it AND a service is connected.
   */
  mode: PlaybackMode;
  /** Which service is wired for service-ride mode. Null when mode is passthrough. */
  connectedService: ConnectedService | null;
  /** MBID of the track currently being commanded. */
  currentMbid: string | null;
  /**
   * True when the current track is unavailable on the connected service and the
   * session fell back: passthrough broadcast (live) or 30s preview (past/curated).
   */
  fallbackUsed: boolean;
}

// ---------------------------------------------------------------------------
// Pure fallback ladder — deterministic, unit-tested exhaustively
// ---------------------------------------------------------------------------

/**
 * Audio path for a track in service-ride mode after a service attempt.
 *
 * - "service"     : service plays it full-length (success path)
 * - "passthrough" : live broadcast covers this track (live orientation only)
 * - "preview"     : 30s clip + link-out (past / curated orientations)
 * - "skip"        : nothing available — auto-advance, never a hard stop
 */
export type FallbackResult = "service" | "passthrough" | "preview" | "skip";

/**
 * Resolve which audio path carries a track in service-ride mode.
 * Pure — called with the final availability flags after the service attempt.
 */
export function resolveFallback(
  serviceAvailable: boolean,
  timeOrientation: TimeOrientation,
  previewAvailable: boolean,
): FallbackResult {
  if (serviceAvailable) return "service";
  if (timeOrientation === "live") return "passthrough";
  if (previewAvailable) return "preview";
  return "skip";
}

/**
 * Derive the audio path for a track given the full session context.
 * Pure; mirrors what the PlayerProvider runs imperatively.
 */
export function resolveAudioPath(
  session: Pick<PlaybackSession, "mode" | "timeOrientation">,
  opts: {
    serviceConnected: boolean;
    serviceFailed: boolean;
    previewAvailable: boolean;
  },
): FallbackResult {
  if (session.mode !== "resolve_to_service") {
    return session.timeOrientation === "live" ? "passthrough" : "preview";
  }
  const serviceOk = opts.serviceConnected && !opts.serviceFailed;
  return resolveFallback(serviceOk, session.timeOrientation, opts.previewAvailable);
}

// ---------------------------------------------------------------------------
// Device-lost fallback — pure poll counter and label helpers
// ---------------------------------------------------------------------------

/**
 * Consecutive no-confirmation polls before the Spotify device is declared lost.
 * Each poll fires every 3 s, so 5 polls ≈ 15 s before falling back.
 */
export const DEVICE_LOST_POLLS = 5;

/** Outcome of one no-device-confirmation poll tick. */
export type NoDevicePollResult =
  | { outcome: "wait"; noDevicePolls: number }
  | { outcome: "device-lost" };

/**
 * Advance the no-device-seen counter for a Spotify track whose playback has
 * not yet been confirmed (sawPlaying still false).  After DEVICE_LOST_POLLS
 * consecutive polls without confirmation the device is treated as lost and
 * the caller must trigger the fallback path.
 *
 * Pure — no side-effects; called from the Spotify poll interval in
 * PlayerProvider so the threshold is testable without React or timers.
 */
export function tickNoDevicePoll(noDevicePolls: number): NoDevicePollResult {
  const next = noDevicePolls + 1;
  if (next >= DEVICE_LOST_POLLS) return { outcome: "device-lost" };
  return { outcome: "wait", noDevicePolls: next };
}

/**
 * Human-readable label shown in the RideBar fallback indicator.
 *
 * - deviceLost=true (Spotify only) → "Spotify device lost · …"
 * - deviceLost=false              → "Unavailable on <service> · …"
 *
 * The suffix distinguishes live (broadcast) from past/curated (preview) so
 * the listener knows which fallback audio is playing.
 *
 * Pure — extracted from the inline JSX ternary in RideBar so it can be
 * unit-tested and kept consistent between the component and any future toast.
 *
 * @param service  defaults to "spotify" for backwards-compatibility
 */
export function rideFallbackLabel(
  deviceLost: boolean,
  timeOrientation: TimeOrientation,
  service: ConnectedService = "spotify",
): string {
  const serviceName =
    service === "youtube"
      ? "YouTube"
      : service === "apple-music"
        ? "Apple Music"
        : "Spotify";
  const prefix =
    deviceLost && service === "spotify"
      ? "Spotify device lost"
      : `Unavailable on ${serviceName}`;
  const suffix =
    timeOrientation === "live"
      ? "listening to broadcast"
      : "playing preview";
  return `${prefix} · ${suffix}`;
}

/**
 * Outcome of one Spotify-player poll tick for the pre-confirmation phase of a
 * track (before the device has acknowledged it is playing our URI).
 *
 * - "confirmed"        : device just reported our track playing → set sawPlaying=true
 * - "wait"             : device silent but below the threshold → increment counter
 * - "device-lost"      : threshold reached → trigger the device-lost fallback
 * - "already-confirmed": sawPlaying was already true AND the device is not
 *                        reporting our track as playing → caller handles
 *                        paused/other-device/track-end branches
 */
export type DeviceConfirmationOutcome =
  | { type: "confirmed" }
  | { type: "wait"; noDevicePolls: number }
  | { type: "device-lost" }
  | { type: "already-confirmed" };

/**
 * Decide the device-confirmation outcome for one Spotify poll tick.
 *
 * Encapsulates the first two branches of the Spotify poll effect in
 * PlayerProvider so the reconnect and device-lost paths are testable without
 * React, timers, or module mocks:
 *
 *   if (ours && isPlaying)   → "confirmed"
 *   if (!sawPlaying)         → tickNoDevicePoll → "wait" | "device-lost"
 *   (sawPlaying && not ours-playing) → "already-confirmed"
 *
 * The caller applies state mutations (cur.sawPlaying, spotifyFailedRef, etc.)
 * based on the returned outcome.
 *
 * Pure — no side-effects.
 */
export function processDeviceConfirmation(
  cur: { sawPlaying: boolean; noDevicePolls: number },
  poll: { ours: boolean; isPlaying: boolean },
): DeviceConfirmationOutcome {
  if (poll.ours && poll.isPlaying) {
    return { type: "confirmed" };
  }
  if (!cur.sawPlaying) {
    const tick = tickNoDevicePoll(cur.noDevicePolls);
    if (tick.outcome === "wait") return { type: "wait", noDevicePolls: tick.noDevicePolls };
    return { type: "device-lost" };
  }
  return { type: "already-confirmed" };
}

/**
 * True when the session is in the combination that suppresses the default
 * Spotify-poll advance (now-playing MBID change drives advances instead).
 */
export function isLiveServiceRide(
  mode: PlaybackMode,
  timeOrientation: TimeOrientation,
): boolean {
  return mode === "resolve_to_service" && timeOrientation === "live";
}

// ---------------------------------------------------------------------------
// Service tiering — pure helpers for the options panel
// ---------------------------------------------------------------------------

/**
 * A user-accessible playback service option shown in the RideBar options panel.
 * Spotify Connect is intentionally excluded — it is a developer-only feature,
 * not a general listener option.
 */
export interface ServiceOption {
  id: "youtube" | "apple-music";
  /** Human-readable label for the service. */
  label: string;
  /**
   * "seamless"           — full tracks, autoadvancing, no account required
   * "seamless-connected" — full tracks, autoadvancing, requires user authorization
   */
  category: "seamless" | "seamless-connected";
  /** True when the service is configured but the user hasn't yet authorized. */
  requiresConnect: boolean;
  /** True when the current track has a resolvable link for this service. */
  trackSupported: boolean;
}

/** Inputs for `availableServices` / `rankServices`. */
export interface ServiceAvailabilityOpts {
  /** Apple Music developer token is configured (server-side). */
  appleMusicConfigured: boolean;
  /** User has successfully authorized Apple Music at least once this session. */
  appleMusicAuthorized: boolean;
  /** Current track has a YouTube link. */
  trackHasYouTube: boolean;
  /** Current track has an Apple Music link. */
  trackHasAppleMusic: boolean;
}

/**
 * Returns all user-accessible service options given what is configured and
 * what links the current track has.
 *
 * Spotify Connect is excluded — it requires a developer quota slot and is
 * not a general user option.
 *
 * Pure — deterministic, no side-effects.
 */
export function availableServices(opts: ServiceAvailabilityOpts): ServiceOption[] {
  const services: ServiceOption[] = [];

  // YouTube: always present — no account required.
  // Per-track availability depends on whether a YouTube link was resolved.
  services.push({
    id: "youtube",
    label: "YouTube",
    category: "seamless",
    requiresConnect: false,
    trackSupported: opts.trackHasYouTube,
  });

  // Apple Music: shown only when a developer token is configured.
  if (opts.appleMusicConfigured) {
    services.push({
      id: "apple-music",
      label: "Apple Music",
      category: "seamless-connected",
      requiresConnect: !opts.appleMusicAuthorized,
      trackSupported: opts.trackHasAppleMusic,
    });
  }

  return services;
}

/**
 * Returns service options in display order for the options panel:
 *
 *   1. Seamless + track-supported services first (best experience, no extra steps).
 *   2. Seamless + track-unsupported services next (present but grayed out).
 *   3. Seamless-connected services last (require an authorization step).
 *
 * Pure — deterministic, no side-effects.
 */
export function rankServices(opts: ServiceAvailabilityOpts): ServiceOption[] {
  return [...availableServices(opts)].sort((a, b) => {
    // Primary: seamless before seamless-connected
    if (a.category === "seamless" && b.category !== "seamless") return -1;
    if (a.category !== "seamless" && b.category === "seamless") return 1;
    // Secondary: track-supported before unsupported
    if (a.trackSupported && !b.trackSupported) return -1;
    if (!a.trackSupported && b.trackSupported) return 1;
    return 0;
  });
}

// ---------------------------------------------------------------------------
// localStorage persistence — side-effectful wrappers, isolated here so the
// pure helpers above stay testable without a browser.
// ---------------------------------------------------------------------------

export const PLAYBACK_MODE_STORAGE_KEY = "lore:playback-mode";

/** Read the persisted playback mode. Defaults to 'passthrough' (safe fallback). */
export function readStoredPlaybackMode(): PlaybackMode {
  try {
    const v =
      typeof localStorage !== "undefined"
        ? localStorage.getItem(PLAYBACK_MODE_STORAGE_KEY)
        : null;
    if (v === "resolve_to_service") return "resolve_to_service";
  } catch {
    // SSR / sandboxed — ignore
  }
  return "passthrough";
}

/** Persist the user's playback mode choice. */
export function writeStoredPlaybackMode(mode: PlaybackMode): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(PLAYBACK_MODE_STORAGE_KEY, mode);
    }
  } catch {
    // Ignore write failures
  }
}

// ---------------------------------------------------------------------------
// Pinned device persistence
// ---------------------------------------------------------------------------

export const PINNED_DEVICE_STORAGE_KEY = "lore:pinned-device";

export interface StoredPinnedDevice {
  id: string;
  name: string;
  type: string;
}

/** Read the persisted pinned device. Returns null when absent or unreadable. */
export function readStoredPinnedDevice(): StoredPinnedDevice | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(PINNED_DEVICE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "id" in parsed &&
      "name" in parsed &&
      "type" in parsed &&
      typeof (parsed as Record<string, unknown>).id === "string" &&
      typeof (parsed as Record<string, unknown>).name === "string" &&
      typeof (parsed as Record<string, unknown>).type === "string"
    ) {
      return parsed as StoredPinnedDevice;
    }
  } catch {
    // Corrupt / SSR — ignore
  }
  return null;
}

/** Persist the pinned device. */
export function writeStoredPinnedDevice(device: StoredPinnedDevice): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(PINNED_DEVICE_STORAGE_KEY, JSON.stringify(device));
    }
  } catch {
    // Ignore write failures
  }
}

/** Remove the persisted pinned device. */
export function clearStoredPinnedDevice(): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(PINNED_DEVICE_STORAGE_KEY);
    }
  } catch {
    // Ignore
  }
}

// ---------------------------------------------------------------------------
// Live-to-past pipeline crossing detection
// ---------------------------------------------------------------------------

/**
 * True when the ride session crosses from live broadcast to past replay.
 * This boundary swaps audio pipelines: station passthrough → service-orchestrated
 * playback. The caller is responsible for wiring the interstitial tone.
 *
 * Pure — compare the previous and next orientations; no side-effects.
 */
export function isLiveToPastCrossing(
  prev: TimeOrientation | null,
  next: TimeOrientation,
): boolean {
  return prev === "live" && next === "past";
}

/**
 * True when the listener is moving between two non-live orientations.
 * No interstitial is needed — the audio pipeline does not change.
 *
 * Pure — no side-effects.
 */
export function isPastToPastTransition(
  prev: TimeOrientation | null,
  next: TimeOrientation,
): boolean {
  return prev !== null && prev !== "live" && next !== "live";
}

// ---------------------------------------------------------------------------
// Device continuity — pure check before a live→past crossing
// ---------------------------------------------------------------------------

export interface DeviceContinuityResult {
  /**
   * True when the pinned device matches the current output, or when Connect
   * is not active (no pinned device) — no prompt needed.
   */
  matches: boolean;
  /** True when Connect is not configured (no pinned device). */
  noPinnedDevice: boolean;
}

/**
 * Decide whether a device-continuity prompt is needed before a live→past crossing.
 *
 * When `pinnedDeviceId` is null/undefined, Connect is not active — skip check.
 * When the ids match, audio stays in the same room — no prompt needed.
 * Otherwise the crossing would silently move audio to a different device —
 * surface the existing device picker so the listener can confirm.
 *
 * Pure — no side-effects.
 */
export function checkDeviceContinuity(
  pinnedDeviceId: string | null | undefined,
  activeDeviceId: string | null | undefined,
): DeviceContinuityResult {
  if (!pinnedDeviceId) return { matches: true, noPinnedDevice: true };
  if (pinnedDeviceId === activeDeviceId) return { matches: true, noPinnedDevice: false };
  return { matches: false, noPinnedDevice: false };
}

// ---------------------------------------------------------------------------
// Adaptive prefetch depth — EWMA per service
// ---------------------------------------------------------------------------

/** Maximum prefetch depth — beyond this, memory pressure outweighs latency gain. */
export const PREFETCH_DEPTH_MAX = 12;

/** Starting depth before any observations — conservative but responsive. */
export const PREFETCH_DEPTH_START = 3;

/** EWMA smoothing factor α ∈ (0, 1). Higher = responds faster to recent samples. */
export const PREFETCH_EWMA_ALPHA = 0.3;

export interface ServicePrefetchTracker {
  /** EWMA of materialization latency in ms. Null until the first observation. */
  latencyEwma: number | null;
  /** EWMA of inter-detent cadence (ms between successive track advances). Null until first. */
  cadenceEwma: number | null;
  /** Current computed prefetch depth. Starts at PREFETCH_DEPTH_START. */
  depth: number;
}

/** Create a fresh per-service prefetch tracker with the conservative starting depth. */
export function createServicePrefetchTracker(): ServicePrefetchTracker {
  return { latencyEwma: null, cadenceEwma: null, depth: PREFETCH_DEPTH_START };
}

/**
 * Record one materialization latency observation and recompute depth.
 *
 * Depth converges UP for slow services (high latency per track) and DOWN for
 * fast ones, so we pre-resolve further ahead when each track takes longer.
 *
 * Pure — returns a new tracker value.
 */
export function observeMaterializationLatency(
  tracker: ServicePrefetchTracker,
  latencyMs: number,
): ServicePrefetchTracker {
  const next =
    tracker.latencyEwma === null
      ? latencyMs
      : PREFETCH_EWMA_ALPHA * latencyMs + (1 - PREFETCH_EWMA_ALPHA) * tracker.latencyEwma;
  return recomputePrefetchDepth({ ...tracker, latencyEwma: next });
}

/**
 * Record one scrub-cadence observation and recompute depth.
 *
 * Faster scrubbing (shorter cadence between advances) increases depth so more
 * tracks are resolved ahead of time before the listener reaches them.
 *
 * Pure — returns a new tracker value.
 */
export function observeScrubCadence(
  tracker: ServicePrefetchTracker,
  cadenceMs: number,
): ServicePrefetchTracker {
  const next =
    tracker.cadenceEwma === null
      ? cadenceMs
      : PREFETCH_EWMA_ALPHA * cadenceMs + (1 - PREFETCH_EWMA_ALPHA) * tracker.cadenceEwma;
  return recomputePrefetchDepth({ ...tracker, cadenceEwma: next });
}

function recomputePrefetchDepth(tracker: ServicePrefetchTracker): ServicePrefetchTracker {
  if (
    tracker.latencyEwma === null ||
    tracker.cadenceEwma === null ||
    tracker.cadenceEwma <= 0
  ) {
    // Not enough data yet — keep the current depth (starts at PREFETCH_DEPTH_START).
    return tracker;
  }
  // depth = how many tracks ahead must be pre-resolved so one is always ready
  // by the time the listener advances. Clamped to [1, PREFETCH_DEPTH_MAX].
  const raw = Math.ceil(tracker.latencyEwma / tracker.cadenceEwma);
  const depth = Math.max(1, Math.min(PREFETCH_DEPTH_MAX, raw));
  return { ...tracker, depth };
}

// ---------------------------------------------------------------------------
// Past-mode playback tier — derived from GUIDED_SERVICE_OPTIONS manifest
// ---------------------------------------------------------------------------

import type { GuidedServiceOption } from "../lib/guidedReplay";

/**
 * Playback tier for a past crossing moment.
 *
 *  1 — Spotify Connect: whole run queued in one `uris`-array call, gapless
 *  2 — Embed + auto-advance (e.g. YouTube): IFrame ENDED handler advances
 *  3 — Embed + manual advance (e.g. Bandcamp): listener taps next each track
 *  4 — Cue sheet: timed "Next: {artist} — {title}" affordance
 *
 * Tier 0 (export) is already shipped and not represented here.
 */
export type PlaybackTier = 1 | 2 | 3 | 4;

/** localStorage key for the last-used service preference. */
export const LAST_USED_SERVICE_KEY = "lore:last-used-service";

/** Read the last-used service from localStorage. Returns null when absent or unreadable. */
export function readLastUsedService(): string | null {
  try {
    return typeof localStorage !== "undefined"
      ? localStorage.getItem(LAST_USED_SERVICE_KEY)
      : null;
  } catch {
    return null;
  }
}

/** Persist the last-used service to localStorage. */
export function writeLastUsedService(service: string): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(LAST_USED_SERVICE_KEY, service);
    }
  } catch {
    // Ignore write failures
  }
}

/**
 * Derive the playback tier for a single `GUIDED_SERVICE_OPTIONS` entry.
 *
 * Derived exclusively from manifest fields — no per-service switch statements:
 *  - `embedUrlBuilder && embedAutoAdvance` → Tier 2
 *  - `embedUrlBuilder && !embedAutoAdvance` → Tier 3
 *  - otherwise (external-only) → Tier 4
 *
 * A synthetic entry added to GUIDED_SERVICE_OPTIONS with `embedUrlBuilder +
 * embedAutoAdvance` is treated as Tier 2 with no other code change — proves
 * derivation from the manifest, not from a hardcoded per-service switch.
 *
 * Pure — deterministic, no side-effects.
 */
export function serviceOptionTier(option: GuidedServiceOption): PlaybackTier {
  if (option.embedUrlBuilder) {
    return option.embedAutoAdvance ? 2 : 3;
  }
  return 4;
}

/** Inputs for `selectPastModeTier`. */
export interface PastModeTierOpts {
  /** Spotify Connect availability for this listener. */
  spotify: {
    connected: boolean;
    premium: boolean;
    /** True when a pinned Connect device is reachable. */
    hasActiveDevice: boolean;
  };
  /** Service options to evaluate (typically `GUIDED_SERVICE_OPTIONS`). */
  guidedOptions: ReadonlyArray<GuidedServiceOption>;
  /**
   * The last-used service key from localStorage.  When set and achievable,
   * returns that service's tier directly, overriding the best-available ranking.
   * Ignored when the service is "spotify" but Spotify is not Tier-1 eligible.
   */
  lastUsedService?: string | null;
}

/**
 * Select the highest achievable playback tier for a past crossing moment.
 *
 * Algorithm:
 *  1. If `lastUsedService` is set and achievable, return its tier (preference
 *     overrides the best-available ranking).
 *  2. Otherwise return the minimum (best) tier across Spotify + all options.
 *
 * Pure — deterministic, no side-effects.
 */
export function selectPastModeTier(opts: PastModeTierOpts): PlaybackTier {
  const { spotify, guidedOptions, lastUsedService } = opts;

  const spotifyTier1Eligible =
    spotify.connected && spotify.premium && spotify.hasActiveDevice;

  // Honour the listener's last-used preference when it is achievable.
  if (lastUsedService) {
    if (lastUsedService === "spotify") {
      if (spotifyTier1Eligible) return 1;
      // Preferred but not eligible — fall through to best available.
    } else {
      const preferred = guidedOptions.find((o) => o.service === lastUsedService);
      if (preferred) return serviceOptionTier(preferred);
    }
  }

  // No preference (or preferred was ineligible) — find the best tier.
  let best: PlaybackTier = 4;
  if (spotifyTier1Eligible) best = 1;

  for (const option of guidedOptions) {
    const tier = serviceOptionTier(option);
    if (tier < best) best = tier;
  }

  return best;
}

/**
 * One-sentence tier announcement shown before a past-crossing replay starts.
 *
 * Clear, not apologetic. Copy frames the cue-sheet tier as a feature, not an
 * apology or a promise of future support.
 *
 * Pure — deterministic, no side-effects.
 */
export function tierAnnouncementText(tier: PlaybackTier, serviceLabel?: string): string {
  switch (tier) {
    case 1:
      return "This will play hands-free on Spotify";
    case 2:
      return serviceLabel
        ? `${serviceLabel} will auto-advance through the run`
        : "Audio will auto-advance through the run";
    case 3:
      return serviceLabel
        ? `Each track opens in ${serviceLabel} — you'll advance manually`
        : "Each track opens in a player — you'll advance manually";
    case 4:
      return "Follow the cue sheet to advance each track";
  }
}
