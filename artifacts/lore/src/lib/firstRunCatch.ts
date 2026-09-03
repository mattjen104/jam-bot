import type { DialStation } from "../hooks/useDialData";
import { BroadcastClockEstimator } from "./broadcastClock";

export const CATCH_MAX_WAIT_MS = 45_000;

type BoundaryNow = {
  mbid: string | null;
  artist: string;
  title: string;
  estimatedRemainingMs?: number | null;
  likelyExpiring?: boolean;
  timestampKind?: "source" | "fingerprint" | "inferred" | "receipt";
  timingUncertaintyMs?: number | null;
  timingConfidence?: "trusted" | "estimated" | "unknown";
};

function sameBoundaryTrack(a: BoundaryNow, b: BoundaryNow): boolean {
  if (a.mbid && b.mbid) return a.mbid === b.mbid;
  return a.artist.trim().toLowerCase() === b.artist.trim().toLowerCase()
    && a.title.trim().toLowerCase() === b.title.trim().toLowerCase();
}

type BoundaryResponse = {
  serverTime?: string;
  now?: BoundaryNow | null;
};

async function fetchBoundary(
  slug: string,
  clock: BroadcastClockEstimator,
): Promise<BoundaryResponse | null> {
  const started = clock.mark();
  const response = await fetch(`/api/player/station/${encodeURIComponent(slug)}/now`, {
    headers: { accept: "application/json" },
  });
  const received = clock.mark();
  if (!response.ok) return null;
  const body = await response.json() as BoundaryResponse;
  if (body.serverTime) clock.addSample(body.serverTime, started, received);
  return body;
}

export async function catchNextSong(
  station: DialStation,
  play: (station: DialStation) => void,
  wait: (milliseconds: number) => Promise<void> = (milliseconds) =>
    new Promise((resolve) => window.setTimeout(resolve, milliseconds)),
  now: () => number = () => performance.now(),
): Promise<string> {
  const slug = station.station.slug;
  const clock = new BroadcastClockEstimator();
  const first = await fetchBoundary(slug, clock).catch(() => null);
  const initial = first?.now ?? null;
  const remaining = initial?.estimatedRemainingMs;
  if (
    !initial?.likelyExpiring ||
    initial.timestampKind === "receipt" ||
    initial.timingConfidence === "unknown" ||
    remaining == null ||
    remaining < 0 ||
    remaining > CATCH_MAX_WAIT_MS
  ) {
    play(station);
    return "No trustworthy short boundary was available, so this station is playing now.";
  }

  const started = now();
  const uncertainty = Math.max(0, initial.timingUncertaintyMs ?? 0);
  const serverBoundaryAt =
    first?.serverTime && Number.isFinite(Date.parse(first.serverTime))
      ? Date.parse(first.serverTime) + remaining
      : null;
  const alignedNow = clock.now();
  const alignedRemaining =
    serverBoundaryAt != null && alignedNow != null
      ? Math.max(0, serverBoundaryAt - alignedNow)
      : remaining;
  await wait(Math.min(alignedRemaining + uncertainty + 1_500, CATCH_MAX_WAIT_MS));
  while (now() - started < CATCH_MAX_WAIT_MS) {
    const next = (await fetchBoundary(slug, clock).catch(() => null))?.now ?? null;
    if (next && !sameBoundaryTrack(initial, next)) {
      play(station);
      return "The next song just started.";
    }
    await wait(2_000);
  }
  play(station);
  return "The boundary stayed uncertain, so this station is playing now.";
}