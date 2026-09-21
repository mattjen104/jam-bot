import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Link2, Pause, Play, SkipBack, SkipForward, Square, X } from "lucide-react";
import {
  spotifyPlayAlbum,
  type ProviderPlayback,
  type ProviderPlaybackValue,
} from "@workspace/api-client-react";
import { AppleMusicReplayPanel } from "./AppleMusicReplayPanel";
import {
  getSpotifyPlaybackToken,
  loadSpotifyWebPlaybackSdk,
  subscribeSpotifyPlayer,
  type SpotifySdkPlayer,
} from "../lib/spotifyWebPlayback";

export type AppleMusicConfig = {
  configured: boolean;
  developerToken: string | null;
  appName: string;
  storefront: string;
};

export type AlbumProviderPlaybackProps = {
  providerPlayback?: ProviderPlayback;
  fallbackExternalLinks?: Partial<Record<keyof ProviderPlayback, string>>;
  appleMusicConfig?: AppleMusicConfig;
  releaseGroupMbid?: string;
  albumTitle?: string;
  artistName?: string;
  albumTracks?: Array<{ mbid: string; title: string; artist: string }>;
};

const PROVIDERS = [
  ["spotify", "Spotify"],
  ["appleMusic", "Apple Music"],
  ["bandcamp", "Bandcamp"],
  ["qobuz", "Qobuz"],
] as const;

const EMPTY_PROVIDER_PLAYBACK: ProviderPlayback = {
  spotify: { capability: "unavailable", reason: "No verified Spotify mapping is available." },
  appleMusic: { capability: "unavailable", reason: "No verified Apple Music mapping is available." },
  bandcamp: { capability: "unavailable", reason: "No verified Bandcamp mapping is available." },
  qobuz: { capability: "unavailable", reason: "No verified Qobuz mapping is available." },
};

function link(provider: ProviderPlaybackValue): string | null {
  return provider.externalUrl ?? null;
}

function fallbackExternalLink(
  provider: keyof ProviderPlayback,
  value: string | undefined,
): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    if (provider === "spotify") {
      return url.hostname === "open.spotify.com" &&
        /^\/album\/[A-Za-z0-9]{22}$/.test(url.pathname)
        ? url.toString()
        : null;
    }
    if (provider === "appleMusic") {
      return url.hostname === "music.apple.com" &&
        /\/album\/[^/]+\/\d+$/.test(url.pathname)
        ? url.toString()
        : null;
    }
    if (provider === "bandcamp") {
      return (url.hostname === "bandcamp.com" || url.hostname.endsWith(".bandcamp.com")) &&
        /\/album\/[^/]+/.test(url.pathname)
        ? url.toString()
        : null;
    }
    return url.hostname === "www.qobuz.com" && /\/album\/[^/]+/.test(url.pathname)
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function appleMaterialization(
  provider: ProviderPlaybackValue,
  config: AppleMusicConfig,
  title: string,
  artist: string,
  albumTracks: AlbumProviderPlaybackProps["albumTracks"] = [],
) {
  const trackByMbid = new Map(albumTracks.map((track) => [track.mbid, track]));
  const entries = (provider.tracks ?? []).map((track) => ({
    ...trackByMbid.get(track.recordingMbid),
    position: track.position,
    spinId: track.position,
    recordingMbid: track.recordingMbid,
    rawArtist: trackByMbid.get(track.recordingMbid)?.artist ?? artist,
    rawTitle: trackByMbid.get(track.recordingMbid)?.title ?? title,
    title: trackByMbid.get(track.recordingMbid)?.title ?? title,
    artist: trackByMbid.get(track.recordingMbid)?.artist ?? artist,
    appleMusicId: track.providerTrackId,
    url: track.providerTrackUrl,
    status: "available" as const,
    reason: null,
  }));
  return {
    ...config,
    coverage: { total: entries.length, available: entries.length, unavailable: 0, unresolved: 0, dead: 0 },
    entries,
    replayId: 0,
    apiBase: "https://api.music.apple.com",
  };
}

function ProviderEmbed({ name, provider }: { name: string; provider: ProviderPlaybackValue }) {
  const [failed, setFailed] = useState(false);
  if (failed || !provider.embedUrl) {
    return (
      <div className="mt-4 rounded-lg border border-destructive-border bg-destructive/5 p-3 text-sm text-muted-foreground" role="alert" data-testid={`provider-error-${name.toLowerCase()}`}>
        <p>{provider.reason}</p>
        {link(provider) && <a className="mt-2 inline-flex items-center gap-1 text-primary underline" href={link(provider)!} target="_blank" rel="noreferrer" data-testid={`provider-external-${name.toLowerCase()}`}>Open {name} <ExternalLink className="h-3 w-3" /></a>}
      </div>
    );
  }
  return (
    <div className="mt-4 space-y-3">
      <iframe key={provider.embedUrl} src={provider.embedUrl} title={`${name} player for this album`} allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" allowFullScreen className="aspect-video w-full rounded-lg border border-border/50 bg-black" data-testid={`provider-iframe-${name.toLowerCase()}`} onError={() => setFailed(true)} />
      {link(provider) && <a className="inline-flex items-center gap-1 text-sm text-muted-foreground underline hover:text-primary" href={link(provider)!} target="_blank" rel="noreferrer" data-testid={`provider-external-${name.toLowerCase()}`}>Open in {name} <ExternalLink className="h-3 w-3" /></a>}
    </div>
  );
}

function SpotifySurface({ provider, releaseGroupMbid }: { provider: ProviderPlaybackValue; releaseGroupMbid?: string }) {
  const playerRef = useRef<SpotifySdkPlayer | null>(null);
  const cleanupsRef = useRef<Array<() => void>>([]);
  const sessionRef = useRef(0);
  const mountedRef = useRef(false);
  const [status, setStatus] = useState<"idle" | "connecting" | "playing" | "paused" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const releasePlayer = (player = playerRef.current) => {
    cleanupsRef.current.forEach((cleanup) => cleanup());
    cleanupsRef.current = [];
    if (playerRef.current === player) playerRef.current = null;
    if (!player) return;
    void Promise.resolve(player.pause())
      .catch(() => undefined)
      .finally(() => player.disconnect());
  };
  const isCurrent = (session: number) =>
    mountedRef.current && sessionRef.current === session;
  const fail = (cause: unknown, session: number) => {
    if (!isCurrent(session)) return;
    const message = cause instanceof Error ? cause.message : String(cause);
    sessionRef.current += 1;
    releasePlayer();
    setError(message);
    setStatus("error");
  };
  const disconnect = () => {
    sessionRef.current += 1;
    releasePlayer();
    if (mountedRef.current) setStatus("idle");
  };
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      sessionRef.current += 1;
      releasePlayer();
    };
  }, []);
  const start = async () => {
    releasePlayer();
    const session = ++sessionRef.current;
    setStatus("connecting");
    setError(null);
    try {
      const Player = await loadSpotifyWebPlaybackSdk();
      if (!isCurrent(session)) return;
      let deviceId: string | null = null;
      const player = new Player({
        name: "Lore album playback",
        getOAuthToken: (callback) => {
          void getSpotifyPlaybackToken()
            .then((token) => callback(isCurrent(session) ? token : ""))
            .catch((cause) => {
              callback("");
              fail(cause, session);
            });
        },
      });
      if (!isCurrent(session)) {
        player.disconnect();
        return;
      }
      playerRef.current = player;
      cleanupsRef.current.push(subscribeSpotifyPlayer(player, "ready", (event) => {
        if (!isCurrent(session)) return;
        deviceId = (event as { device_id?: string }).device_id ?? null;
      }));
      cleanupsRef.current.push(subscribeSpotifyPlayer(player, "player_state_changed", (state) => {
        if (!isCurrent(session)) return;
        const playback = state as { paused?: boolean } | null;
        if (playback) setStatus(playback.paused ? "paused" : "playing");
      }));
      cleanupsRef.current.push(subscribeSpotifyPlayer(player, "not_ready", () => fail("Spotify browser device is no longer ready.", session)));
      cleanupsRef.current.push(subscribeSpotifyPlayer(player, "initialization_error", (event) => fail((event as { message?: string }).message ?? "Spotify player failed to initialize.", session)));
      cleanupsRef.current.push(subscribeSpotifyPlayer(player, "authentication_error", (event) => fail((event as { message?: string }).message ?? "Spotify authorization failed.", session)));
      cleanupsRef.current.push(subscribeSpotifyPlayer(player, "account_error", (event) => fail((event as { message?: string }).message ?? "Spotify Premium playback is unavailable.", session)));
      cleanupsRef.current.push(subscribeSpotifyPlayer(player, "playback_error", (event) => fail((event as { message?: string }).message ?? "Spotify playback failed.", session)));
      if (!(await player.connect())) throw new Error("Spotify could not connect to this browser.");
      if (!isCurrent(session)) {
        player.disconnect();
        return;
      }
      for (let i = 0; i < 50 && !deviceId; i += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 100));
        if (!isCurrent(session)) {
          player.disconnect();
          return;
        }
      }
      if (!deviceId) throw new Error("Spotify did not provide a browser device.");
      if (!releaseGroupMbid) throw new Error("This album is missing its Lore identity.");
      if (!isCurrent(session)) return;
      await spotifyPlayAlbum({ releaseGroupMbid, deviceId });
      if (isCurrent(session)) setStatus("playing");
    } catch (cause) {
      fail(cause, session);
    }
  };
  return (
    <div className="mt-3 space-y-3" data-testid="spotify-full-playback">
      <p className="text-sm text-muted-foreground">Full playback uses your authorized Spotify Premium browser device.</p>
      <p role="status" data-testid="spotify-status">Spotify {status}</p>
      {(status === "idle" || status === "error") && <button type="button" onClick={() => void start()} className="rounded-full bg-foreground px-4 py-2 font-mono text-xs uppercase text-background" data-testid="spotify-start">{status === "error" ? "Retry full playback" : "Start full playback"}</button>}
      {(status === "connecting" || status === "playing" || status === "paused") && <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void playerRef.current?.pause()} aria-label="Pause Spotify" data-testid="spotify-pause"><Pause /></button>
        <button type="button" onClick={() => void playerRef.current?.resume()} aria-label="Resume Spotify" data-testid="spotify-resume"><Play /></button>
        <button type="button" onClick={() => void playerRef.current?.previousTrack()} aria-label="Previous Spotify track" data-testid="spotify-previous"><SkipBack /></button>
        <button type="button" onClick={() => void playerRef.current?.nextTrack()} aria-label="Next Spotify track" data-testid="spotify-next"><SkipForward /></button>
        <button type="button" onClick={disconnect} data-testid="spotify-stop"><Square /> Stop</button>
      </div>}
      {error && <p role="alert" data-testid="spotify-error">{error}</p>}
      {link(provider) && <a className="inline-flex items-center gap-1 text-sm text-muted-foreground underline hover:text-primary" href={link(provider)!} target="_blank" rel="noreferrer">Open in Spotify <ExternalLink className="h-3 w-3" /></a>}
      {status === "error" && provider.embedUrl ? <ProviderEmbed name="Spotify" provider={provider} /> : null}
    </div>
  );
}

export function AlbumProviderPlayback({ providerPlayback, fallbackExternalLinks = {}, appleMusicConfig = { configured: false, developerToken: null, appName: "Lore", storefront: "us" }, releaseGroupMbid, albumTitle = "this album", artistName = "", albumTracks = [] }: AlbumProviderPlaybackProps) {
  const playback = providerPlayback ?? EMPTY_PROVIDER_PLAYBACK;
  const [active, setActive] = useState<keyof ProviderPlayback | null>(null);
  const triggerRefs = useRef<Partial<Record<keyof ProviderPlayback, HTMLButtonElement | null>>>({});
  const regionRef = useRef<HTMLElement>(null);
  const safeFallbacks = useMemo(
    () => Object.fromEntries(PROVIDERS.map(([key]) => [
      key,
      fallbackExternalLink(key, fallbackExternalLinks[key]),
    ])) as Record<keyof ProviderPlayback, string | null>,
    [fallbackExternalLinks],
  );
  const available = useMemo(
    () => PROVIDERS.filter(([key]) =>
      playback[key].capability !== "unavailable" || Boolean(safeFallbacks[key]),
    ),
    [playback, safeFallbacks],
  );
  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => regionRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [active]);
  const close = () => { const previous = active; setActive(null); window.setTimeout(() => triggerRefs.current[previous ?? "spotify"]?.focus(), 0); };
  const renderSurface = (key: keyof ProviderPlayback, provider: ProviderPlaybackValue) => {
    if (provider.capability === "unavailable") {
      const fallback = safeFallbacks[key];
      return fallback ? (
        <div className="mt-4 rounded-lg bg-card/30 p-3">
          <p className="text-sm text-muted-foreground">
            Lore has not yet verified this album for inline playback.
          </p>
          <a className="mt-3 inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 font-mono text-xs uppercase tracking-wider" href={fallback} target="_blank" rel="noreferrer" data-testid={`provider-fallback-${key}`}>Open in {PROVIDERS.find(([candidate]) => candidate === key)?.[1]} <ExternalLink className="h-3 w-3" /></a>
        </div>
      ) : <p className="mt-4 text-sm text-muted-foreground" role="status" data-testid={`provider-status-${key}`}>{provider.reason}</p>;
    }
    if (key === "qobuz" || provider.capability === "external_only") return <div className="mt-4 rounded-lg border border-border/50 bg-card/30 p-3"><p className="text-sm text-muted-foreground">{provider.reason}</p>{link(provider) && <a className="mt-3 inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 font-mono text-xs uppercase tracking-wider" href={link(provider)!} target="_blank" rel="noreferrer" data-testid={`provider-external-${key}`}>Open in {key === "appleMusic" ? "Apple Music" : key} <ExternalLink className="h-3 w-3" /></a>}</div>;
    if (key === "appleMusic") return <div className="mt-4"><AppleMusicReplayPanel materialization={appleMaterialization(provider, appleMusicConfig, albumTitle, artistName, albumTracks)} />{link(provider) && <a className="inline-flex items-center gap-1 text-sm text-muted-foreground underline hover:text-primary" href={link(provider)!} target="_blank" rel="noreferrer">Open in Apple Music <ExternalLink className="h-3 w-3" /></a>}</div>;
    if (key === "spotify" && provider.capability === "full_authenticated_playback") {
      return <SpotifySurface provider={provider} releaseGroupMbid={releaseGroupMbid} />;
    }
    return <ProviderEmbed name={key === "spotify" ? "Spotify" : "Bandcamp"} provider={provider} />;
  };
  if (available.length === 0) return null;
  return <section className="mt-6" aria-label="Album provider playback" data-testid="album-provider-playback"><div className="flex flex-wrap gap-2">{available.map(([key, label]) => {
    const provider = playback[key]; const isActive = active === key; const action = provider.capability === "external_only" || provider.capability === "unavailable" || key === "qobuz" ? `Open in ${label}` : `Play with ${label}`;
    return <button key={key} type="button" ref={(element) => { triggerRefs.current[key] = element; }} onClick={() => (isActive ? close() : setActive(key))} className="inline-flex h-10 items-center gap-2 rounded-full border border-border px-4 font-mono text-xs uppercase tracking-wider" aria-expanded={isActive} data-testid={`provider-action-${key}`}>{action.startsWith("Play") ? <Play className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}{action}</button>;
  })}</div>{active && <section ref={regionRef} tabIndex={-1} className="mt-4 rounded-xl border border-primary/20 bg-card/30 p-4 outline-none" aria-label={`${active} playback`} data-testid="provider-playback-surface"><div className="flex items-start justify-between gap-3"><div><h2 className="font-mono text-sm uppercase tracking-[0.16em] text-primary">{PROVIDERS.find(([key]) => key === active)?.[1]} playback</h2><p className="mt-1 text-sm text-muted-foreground">{playback[active].reason}</p></div><button type="button" onClick={close} aria-label="Close provider playback" data-testid="provider-playback-close"><X /></button></div>{renderSurface(active, playback[active])}</section>}</section>;
}

export default AlbumProviderPlayback;