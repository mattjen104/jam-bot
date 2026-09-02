import type { MusicKitInstance } from "./appleMusicReplay";

export type JamMode = "queue" | "record";
export type JamSyncStatus =
  | "authorization-required"
  | "ready"
  | "buffering"
  | "in-sync"
  | "out-of-sync"
  | "unavailable"
  | "reconnecting"
  | "source-offline"
  | "ended";

export interface JamQueueEntry {
  mbid?: string | null;
  title: string;
  artist: string;
  artworkUrl?: string | null;
  appleMusicId?: string | null;
  isrc?: string | null;
  durationMs?: number | null;
}

export interface JamView {
  code: string;
  inviteToken: string;
  status: "active" | "ended" | "expired";
  revision: number;
  expiresAt: string;
  mode: JamMode;
  queue: JamQueueEntry[];
  transport: {
    state: "idle" | "playing" | "paused" | "ended";
    index: number;
    positionMs: number;
    effectiveAt: string | null;
    track: JamQueueEntry | null;
  };
  source: {
    status: "idle" | "capturing" | "identifying" | "matched" | "offline" | "unavailable";
    message: string | null;
    matchedAt: string | null;
    confidence: number | null;
    track: JamQueueEntry | null;
  };
  members: number;
  role: "host" | "listener";
}

export const JAM_JITTER_MS = 350;
export const JAM_SEEK_THRESHOLD_MS = 1_500;
export const JAM_MAX_CORRECTIONS = 3;

export function targetJamPosition(
  view: Pick<JamView, "transport">,
  serverNowMs: number,
): number {
  const anchor = view.transport;
  if (anchor.state !== "playing" || !anchor.effectiveAt) return Math.max(0, anchor.positionMs);
  return Math.max(0, Math.round(anchor.positionMs + serverNowMs - Date.parse(anchor.effectiveAt)));
}

export function estimateServerOffset(samples: Array<{
  clientSentAt: number;
  clientReceivedAt: number;
  serverReceivedAt: number;
  serverSentAt: number;
}>): number {
  if (!samples.length) return 0;
  const ranked = samples.map((sample) => ({
    rtt: Math.max(0, (sample.clientReceivedAt - sample.clientSentAt) - (sample.serverSentAt - sample.serverReceivedAt)),
    offset:
      ((sample.serverReceivedAt - sample.clientSentAt) +
        (sample.serverSentAt - sample.clientReceivedAt)) /
      2,
  })).sort((a, b) => a.rtt - b.rtt);
  const best = ranked.slice(0, Math.max(1, Math.min(3, Math.ceil(ranked.length / 2))));
  return Math.round(best.reduce((sum, item) => sum + item.offset, 0) / best.length);
}

export function correctionAction(
  localPositionMs: number,
  targetPositionMs: number,
  attempts: number,
): "ignore" | "seek" | "give-up" {
  const drift = Math.abs(targetPositionMs - localPositionMs);
  if (drift <= JAM_JITTER_MS) return "ignore";
  if (drift < JAM_SEEK_THRESHOLD_MS) return "ignore";
  return attempts >= JAM_MAX_CORRECTIONS ? "give-up" : "seek";
}

async function jamFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `Jam request failed (${response.status})`);
  }
  if (response.status === 204) return null as T;
  return response.json() as Promise<T>;
}

export function createAppleJam(mode: JamMode, queue: JamQueueEntry[]): Promise<JamView> {
  return jamFetch("/jams", { method: "POST", body: JSON.stringify({ mode, queue }) });
}

export function joinAppleJam(code: string): Promise<JamView> {
  return jamFetch(`/jams/${encodeURIComponent(code)}/join`, { method: "POST" });
}

export function getAppleJam(code: string): Promise<JamView> {
  return jamFetch(`/jams/${encodeURIComponent(code)}`);
}

export function jamCommand(code: string, path: string, body?: unknown): Promise<JamView> {
  return jamFetch(`/jams/${encodeURIComponent(code)}${path}`, {
    method: "POST",
    body: body == null ? undefined : JSON.stringify(body),
  });
}

export async function calibrateJamClock(code: string): Promise<number> {
  const samples = [];
  for (let index = 0; index < 5; index += 1) {
    const clientSentAt = Date.now();
    const result = await jamFetch<{
      clientSentAt: number;
      serverReceivedAt: number;
      serverSentAt: number;
    }>(`/jams/${encodeURIComponent(code)}/clock?clientSentAt=${clientSentAt}`);
    samples.push({ ...result, clientSentAt, clientReceivedAt: Date.now() });
  }
  return estimateServerOffset(samples);
}

export async function applyJamSnapshot(args: {
  view: JamView;
  music: MusicKitInstance;
  serverOffsetMs: number;
  currentAppleId: string | null;
}): Promise<{ currentAppleId: string | null; status: JamSyncStatus }> {
  const { view, music, serverOffsetMs } = args;
  if (view.status !== "active" || view.transport.state === "ended") {
    await music.pause();
    return { currentAppleId: args.currentAppleId, status: "ended" };
  }
  const track = view.transport.track;
  if (!track?.appleMusicId) return { currentAppleId: args.currentAppleId, status: "unavailable" };
  const changed = args.currentAppleId !== track.appleMusicId;
  if (changed) await music.setQueue({ songs: [track.appleMusicId] });
  const target = targetJamPosition(view, Date.now() + serverOffsetMs);
  const localPositionMs = typeof music.currentPlaybackTime === "number"
    ? music.currentPlaybackTime * 1000
    : 0;
  if (
    music.seekToTime &&
    (changed || correctionAction(localPositionMs, target, 0) === "seek")
  ) await music.seekToTime(target / 1000);
  if (view.transport.state === "playing") await music.play();
  else await music.pause();
  return { currentAppleId: track.appleMusicId, status: view.transport.state === "playing" ? "in-sync" : "ready" };
}
