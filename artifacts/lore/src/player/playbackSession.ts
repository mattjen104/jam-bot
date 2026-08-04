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
export type ConnectedService = "spotify" | "youtube" | "apple-music";

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
