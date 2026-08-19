import type { Station } from "@workspace/api-client-react";
import type { StationCategory } from "../lib/dialCategories";

export interface CategoryPreviewCandidate {
  mbid: string;
  title: string;
  artist: string;
  stationName: string;
  stationSlug: string;
  category: StationCategory;
  playedAt: string | null;
}

export interface CategorySpinLike {
  mbid?: string | null;
  title?: string | null;
  artist?: string | null;
  playedAt?: string | null;
  isFirstSpin?: boolean;
}

/** Recent, resolved first-play tracks for one category, newest first. */
export function buildCategoryPreviewQueue(
  category: StationCategory,
  stations: Station[],
  spinsBySlug: Map<string, readonly CategorySpinLike[]>,
): CategoryPreviewCandidate[] {
  const allowed = new Map(
    stations
      .filter((station) => station.stationCategories?.[0] === category)
      .map((station) => [station.slug, station]),
  );
  const seen = new Set<string>();
  const result: CategoryPreviewCandidate[] = [];
  for (const [slug, spins] of spinsBySlug) {
    const station = allowed.get(slug);
    if (!station) continue;
    for (const spin of [...spins].sort((a, b) =>
      String(b.playedAt ?? "").localeCompare(String(a.playedAt ?? "")))) {
      const mbid = spin.mbid?.trim();
      const artist = spin.artist?.trim();
      const title = spin.title?.trim();
      if (!spin.isFirstSpin || !mbid || !artist || !title || seen.has(mbid)) continue;
      seen.add(mbid);
      result.push({
        mbid, artist, title, stationName: station.name, stationSlug: slug,
        category, playedAt: spin.playedAt ?? null,
      });
    }
  }
  return result.sort((a, b) => String(b.playedAt ?? "").localeCompare(String(a.playedAt ?? "")));
}
