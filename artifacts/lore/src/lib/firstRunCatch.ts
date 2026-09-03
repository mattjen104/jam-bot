import type { DialStation } from "../hooks/useDialData";

export const CATCH_MAX_WAIT_MS = 45_000;

type BoundaryNow = {
  mbid: string | null;
  artist: string;
  title: string;
  estimatedRemainingMs?: number | null;
  likelyExpiring?: boolean;
};

function sameBoundaryTrack(a: BoundaryNow, b: BoundaryNow): boolean {
  if (a.mbid && b.mbid) return a.mbid === b.mbid;
  return a.artist.trim().toLowerCase() === b.artist.trim().toLowerCase()
    && a.title.trim().toLowerCase() === b.title.trim().toLowerCase();
}

async function fetchBoundary(slug: string): Promise<BoundaryNow | null> {
  const response = await fetch(`/api/player/station/${encodeURIComponent(slug)}/now`, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) return null;
  const body = await response.json() as { now?: BoundaryNow | null };
  return body.now ?? null;
}

export async function catchNextSong(
  station: DialStation,
  play: (station: DialStation) => void,
  wait: (milliseconds: number) => Promise<void> = (milliseconds) =>
    new Promise((resolve) => window.setTimeout(resolve, milliseconds)),
  now: () => number = Date.now,
): Promise<string> {
  const slug = station.station.slug;
  const initial = await fetchBoundary(slug).catch(() => null);
  const remaining = initial?.estimatedRemainingMs;
  if (!initial?.likelyExpiring || remaining == null || remaining < 0 || remaining > CATCH_MAX_WAIT_MS) {
    play(station);
    return "No trustworthy short boundary was available, so this station is playing now.";
  }

  const started = now();
  await wait(Math.min(remaining + 1_500, CATCH_MAX_WAIT_MS));
  while (now() - started < CATCH_MAX_WAIT_MS) {
    const next = await fetchBoundary(slug).catch(() => null);
    if (next && !sameBoundaryTrack(initial, next)) {
      play(station);
      return "The next song just started.";
    }
    await wait(2_000);
  }
  play(station);
  return "The boundary stayed uncertain, so this station is playing now.";
}