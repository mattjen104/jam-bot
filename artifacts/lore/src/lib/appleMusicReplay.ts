import type { AppleMusicReplayMaterialization, AppleMusicReplayMaterializationEntry } from "@workspace/api-client-react";

export type AppleMusicQueueEntry = AppleMusicReplayMaterializationEntry & {
  appleMusicId: string;
};

export type AppleMusicQueue = {
  ids: string[];
  entries: AppleMusicQueueEntry[];
};

export type MusicKitPlaybackState =
  | "idle"
  | "loading"
  | "authorizing"
  | "ready"
  | "playing"
  | "paused"
  | "complete"
  | "error";

export type MusicKitErrorKind =
  | "authorization-cancelled"
  | "authorization-expired"
  | "subscription-required"
  | "configuration"
  | "provider"
  | "unknown";

export type MusicKitError = {
  kind: MusicKitErrorKind;
  message: string;
};

export type MusicKitInstance = {
  authorize: () => Promise<unknown>;
  setQueue: (options: { songs: string[] }) => Promise<unknown>;
  play: () => Promise<unknown> | unknown;
  pause: () => Promise<unknown> | unknown;
  stop?: () => Promise<unknown> | unknown;
  skipToNextItem?: () => Promise<unknown> | unknown;
  skipToPreviousItem?: () => Promise<unknown> | unknown;
  /** Seek to a position in the current track. Time is in seconds. */
  seekToTime?: (timeInSeconds: number) => Promise<void>;
  /** Current playhead position in seconds. */
  currentPlaybackTime?: number;
  /** Total duration of the current track in seconds. */
  currentPlaybackDuration?: number;
  addEventListener: (event: string, listener: (event: unknown) => void) => void;
  removeEventListener: (event: string, listener: (event: unknown) => void) => void;
  storefrontId?: string;
  isAuthorized?: boolean;
  api?: {
    music?: (
      path: string,
      options?: { limit?: number; offset?: number },
    ) => Promise<unknown>;
    library?: {
      songs: (options?: { limit?: number; offset?: number }) => Promise<unknown>;
    };
  };
};

export type MusicKitGlobal = {
  configure: (options: {
    developerToken: string;
    appName: string;
    storefrontId?: string;
  }) => void;
  getInstance: () => MusicKitInstance;
  Events?: Record<string, string>;
};

declare global {
  interface Window {
    MusicKit?: MusicKitGlobal;
  }
}

const MUSICKIT_SCRIPT_SRC = "https://js-cdn.music.apple.com/musickit/v3/musickit.js";
let musicKitScriptPromise: Promise<MusicKitGlobal> | null = null;

export function buildAppleMusicQueue(
  materialization: Pick<AppleMusicReplayMaterialization, "entries">,
): AppleMusicQueue {
  const entries = materialization.entries.filter(
    (entry): entry is AppleMusicQueueEntry =>
      entry.status === "available" &&
      typeof entry.appleMusicId === "string" &&
      entry.appleMusicId.trim().length > 0,
  );
  return { ids: entries.map((entry) => entry.appleMusicId), entries };
}

export function canPlayAppleMusic(
  materialization: Pick<
    AppleMusicReplayMaterialization,
    "configured" | "developerToken" | "coverage" | "entries"
  > | null | undefined,
): boolean {
  return Boolean(
    materialization?.configured &&
      materialization.developerToken &&
      materialization.coverage.available > 0 &&
      materialization.entries.some(
        (entry) => entry.status === "available" && entry.appleMusicId,
      ),
  );
}

export function musicKitEvent(
  music: MusicKitInstance,
  name: string,
): string {
  return musicKitGlobal()?.Events?.[name] ?? name;
}

export function musicKitGlobal(): MusicKitGlobal | null {
  return typeof window !== "undefined" ? window.MusicKit ?? null : null;
}

export type AppleMusicClientConfig = {
  configured: boolean;
  developerToken: string | null;
  appName: string;
  storefront: string;
};

export type AppleLibrarySong = {
  appleId: string;
  title: string;
  artist: string;
  albumName: string | null;
  artworkUrl: string | null;
  isrc: string | null;
};

export type AppleMusicImportProgress = {
  pages: number;
  received: number;
  resolved: number;
  total: number | null;
};

/** Load, configure, and authorize MusicKit without requiring playback first. */
export async function authorizeAppleMusic(
  config: AppleMusicClientConfig,
): Promise<MusicKitInstance> {
  if (!config.configured || !config.developerToken) {
    throw new Error("Apple Music is unavailable because this site is not configured.");
  }
  const global = await loadMusicKit();
  global.configure({
    developerToken: config.developerToken,
    appName: config.appName,
    storefrontId: config.storefront,
  });
  const music = global.getInstance();
  if (!music.isAuthorized) await music.authorize();
  return music;
}

function extractLibrarySongs(value: unknown): { songs: AppleLibrarySong[]; hasNext: boolean } {
  const root = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const data = root.data && typeof root.data === "object" ? root.data as Record<string, unknown> : root;
  const raw = Array.isArray(data.data) ? data.data : Array.isArray(data) ? data : [];
  const songs = raw.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    const attrs = item.attributes && typeof item.attributes === "object"
      ? item.attributes as Record<string, unknown>
      : item;
    const id = typeof item.id === "string" ? item.id : "";
    const title = typeof attrs.name === "string" ? attrs.name : "";
    const artist = typeof attrs.artistName === "string" ? attrs.artistName : "";
    if (!id || !title || !artist) return [];
    const album = typeof attrs.albumName === "string" ? attrs.albumName : null;
    const artwork = attrs.artwork && typeof attrs.artwork === "object"
      ? attrs.artwork as Record<string, unknown>
      : null;
    const url = typeof artwork?.url === "string"
      ? artwork.url.replace("{w}", "600").replace("{h}", "600")
      : null;
    return [{
      appleId: id,
      title,
      artist,
      albumName: album,
      artworkUrl: url,
      isrc: typeof attrs.isrc === "string" ? attrs.isrc : null,
    }];
  });
  const next = root.next ?? data.next;
  return { songs, hasNext: typeof next === "string" && next.length > 0 };
}

/**
 * Import every Apple library page through the canonical batch endpoint.
 * Pages are bounded and each POST is idempotent on (listener, Apple song ID),
 * so an interrupted or repeated run can safely resume.
 */
export async function importAppleMusicLibrary(
  config: AppleMusicClientConfig,
  options: {
    signal?: AbortSignal;
    onProgress?: (progress: AppleMusicImportProgress) => void;
    pageLimit?: number;
    maxPages?: number;
  } = {},
): Promise<AppleMusicImportProgress> {
  const music = await authorizeAppleMusic(config);
  const pageLimit = Math.min(Math.max(options.pageLimit ?? 100, 1), 100);
  const maxPages = Math.min(Math.max(options.maxPages ?? 1000, 1), 1000);
  let offset = 0;
  let pages = 0;
  let received = 0;
  let resolved = 0;
  let total: number | null = null;

  for (; pages < maxPages; pages++) {
    if (options.signal?.aborted) throw new DOMException("Import cancelled", "AbortError");
    if (!music.api?.library?.songs && !music.api?.music) {
      throw new Error("Apple Music library access is unavailable in this browser.");
    }
    const response = music.api.library?.songs
      ? await music.api.library.songs({ limit: pageLimit, offset })
      : await music.api.music!("/v1/me/library/songs", { limit: pageLimit, offset });
    const page = extractLibrarySongs(response);
    if (page.songs.length === 0) {
      break;
    }
    const upload = await fetch("/api/me/apple-library-import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ songs: page.songs }),
      signal: options.signal,
    });
    if (!upload.ok && upload.status !== 207) {
      let detail = "";
      try {
        const body = await upload.json() as { error?: string };
        detail = body.error ? `: ${body.error}` : "";
      } catch { /* use status below */ }
      throw new Error(`Apple Music import failed (${upload.status})${detail}`);
    }
    const result = await upload.json() as {
      received?: number;
      resolved?: number;
      total?: number;
      failures?: Array<{ index: number; reason: string }>;
    };
    if (upload.status === 207 || (result.failures?.length ?? 0) > 0) {
      throw new Error(
        `Apple Music imported part of this page; ${result.failures?.length ?? 1} track(s) need a retry.`,
      );
    }
    received += result.received ?? page.songs.length;
    resolved += result.resolved ?? 0;
    total = typeof result.total === "number" ? result.total : total;
    offset += page.songs.length;
    const progress = { pages: pages + 1, received, resolved, total };
    options.onProgress?.(progress);
    if (!page.hasNext && page.songs.length < pageLimit) break;
  }

  const completion = await fetch("/api/me/apple-library-import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ songs: [], complete: true }),
    signal: options.signal,
  });
  if (!completion.ok) throw new Error(`Apple Music import could not be finalized (${completion.status})`);
  const finalStatus = await getAppleMusicImportStatus();
  options.onProgress?.(finalStatus);
  return finalStatus;
}

export async function getAppleMusicImportStatus(): Promise<AppleMusicImportProgress & {
  unresolved: number;
  complete: boolean;
}> {
  const response = await fetch("/api/me/apple-library-import/status", {
    credentials: "include",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Could not read Apple Music import status (${response.status})`);
  return response.json() as Promise<AppleMusicImportProgress & {
    unresolved: number;
    complete: boolean;
  }>;
}

export function loadMusicKit(): Promise<MusicKitGlobal> {
  if (musicKitGlobal()) return Promise.resolve(musicKitGlobal()!);
  if (typeof document === "undefined") {
    return Promise.reject(new Error("MusicKit is only available in a browser"));
  }
  if (musicKitScriptPromise) return musicKitScriptPromise;

  musicKitScriptPromise = new Promise<MusicKitGlobal>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${MUSICKIT_SCRIPT_SRC}"]`,
    );
    const script = existing ?? document.createElement("script");
    let settled = false;
    const finish = () => {
      const global = musicKitGlobal();
      if (global) {
        settled = true;
        resolve(global);
      } else if (!settled) {
        settled = true;
        reject(new Error("Apple MusicKit loaded without its browser API"));
      }
    };
    const onLoaded = () => finish();
    script.addEventListener("load", onLoaded, { once: true });
    // MusicKit dispatches this event after its runtime has initialized. The
    // script's load event can precede window.MusicKit on some browsers.
    document.addEventListener("musickitloaded", onLoaded, { once: true });
    script.addEventListener("error", () => {
      if (!settled) {
        settled = true;
        document.removeEventListener("musickitloaded", onLoaded);
        reject(new Error("Apple MusicKit could not be loaded"));
      }
    }, { once: true });
    if (!existing) {
      script.src = MUSICKIT_SCRIPT_SRC;
      script.async = true;
      document.head.appendChild(script);
    } else if (musicKitGlobal()) {
      finish();
    }
  }).catch((error) => {
    musicKitScriptPromise = null;
    throw error;
  });
  return musicKitScriptPromise;
}

export function describeMusicKitError(error: unknown): MusicKitError {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const normalized = raw.toLowerCase();
  // Check for mid-session token expiry before the user-cancel check, since
  // expired tokens can also surface "not authorized" messages.
  if (
    normalized.includes("expired") ||
    normalized.includes("401") ||
    normalized.includes("authorization_error") ||
    normalized.includes("token refresh")
  ) {
    return {
      kind: "authorization-expired",
      message: "Apple Music authorization expired. Attempting to re-authorize.",
    };
  }
  if (
    normalized.includes("cancel") ||
    normalized.includes("denied") ||
    normalized.includes("not authorized")
  ) {
    return {
      kind: "authorization-cancelled",
      message: "Apple Music authorization was cancelled. You can try again.",
    };
  }
  if (
    normalized.includes("subscription") ||
    normalized.includes("not entitled") ||
    normalized.includes("403")
  ) {
    return {
      kind: "subscription-required",
      message: "An Apple Music subscription is required to play this track.",
    };
  }
  if (normalized.includes("token") || normalized.includes("configure")) {
    return {
      kind: "configuration",
      message: "Apple Music playback is not configured for this site.",
    };
  }
  if (raw) return { kind: "provider", message: `Apple Music could not play this replay: ${raw}` };
  return { kind: "unknown", message: "Apple Music could not play this replay." };
}

export function eventTrackId(event: unknown): string | null {
  if (!event || typeof event !== "object") return null;
  const value = event as Record<string, unknown>;
  const item =
    value.item && typeof value.item === "object"
      ? (value.item as Record<string, unknown>)
      : value;
  for (const candidate of [item.id, item.songId, item.contentId]) {
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
  }
  return null;
}