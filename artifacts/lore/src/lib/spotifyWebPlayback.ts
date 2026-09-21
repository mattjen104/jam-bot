import { getSpotifyWebPlaybackToken } from "@workspace/api-client-react";

export type SpotifyPlayerState = "connecting" | "playing" | "paused" | "error" | "stopped";

export type SpotifySdkPlayer = {
  connect: () => Promise<boolean>;
  disconnect: () => void;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  previousTrack: () => Promise<void>;
  nextTrack: () => Promise<void>;
  addListener: (event: string, listener: (value: unknown) => void) => void;
  removeListener?: (event: string, listener: (value: unknown) => void) => void;
  on?: (event: string, listener: (value: unknown) => void) => void;
  off?: (event: string, listener: (value: unknown) => void) => void;
  setName?: (name: string) => Promise<void>;
};

export type SpotifyPlayerConstructor = new (options: {
  name: string;
  getOAuthToken: (callback: (token: string) => void) => void;
  volume?: number;
}) => SpotifySdkPlayer;

declare global {
  interface Window {
    Spotify?: { Player: SpotifyPlayerConstructor };
    onSpotifyWebPlaybackSDKReady?: () => void;
  }
}

let sdkPromise: Promise<SpotifyPlayerConstructor> | null = null;

/** Must only be called from an explicit user gesture. */
export function loadSpotifyWebPlaybackSdk(): Promise<SpotifyPlayerConstructor> {
  if (typeof window === "undefined") return Promise.reject(new Error("Spotify playback is browser-only."));
  if (window.Spotify?.Player) return Promise.resolve(window.Spotify.Player);
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise<SpotifyPlayerConstructor>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://sdk.scdn.co/spotify-player.js";
    script.async = true;
    const timeout = window.setTimeout(() => reject(new Error("Spotify playback SDK timed out.")), 15_000);
    window.onSpotifyWebPlaybackSDKReady = () => {
      window.clearTimeout(timeout);
      if (window.Spotify?.Player) resolve(window.Spotify.Player);
      else reject(new Error("Spotify playback SDK loaded without a player."));
    };
    script.onerror = () => {
      window.clearTimeout(timeout);
      reject(new Error("Spotify playback SDK could not be loaded."));
    };
    document.head.appendChild(script);
  }).catch((error) => {
    sdkPromise = null;
    throw error;
  });
  return sdkPromise!;
}

export function subscribeSpotifyPlayer(
  player: SpotifySdkPlayer,
  event: string,
  listener: (value: unknown) => void,
): () => void {
  if (player.on) {
    player.on(event, listener);
    return () => player.off?.(event, listener);
  }
  player.addListener(event, listener);
  return () => player.removeListener?.(event, listener);
}

export async function getSpotifyPlaybackToken(): Promise<string> {
  const result = await getSpotifyWebPlaybackToken();
  if (!result.accessToken) throw new Error("Spotify did not provide a playback token.");
  return result.accessToken;
}