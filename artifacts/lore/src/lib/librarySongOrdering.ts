import type { LibraryItem } from "./meHooks";

export type LibrarySongSort = "added" | "artist" | "title" | "genre" | "era";

/** Stable semantic era used by every Library presentation. */
export function libraryEra(item: LibraryItem): "current" | "catalog" | "deep" | "unknown" {
  const year = item.recording?.releaseYear;
  if (year == null || !Number.isFinite(year)) return "unknown";
  const currentYear = new Date().getUTCFullYear();
  if (year >= currentYear - 1) return "current";
  if (year >= currentYear - 5) return "catalog";
  return "deep";
}

export function compareLibrarySongs(a: LibraryItem, b: LibraryItem, sort: LibrarySongSort): number {
  const ar = a.recording;
  const br = b.recording;
  const tie = () => (ar?.artist ?? "").localeCompare(br?.artist ?? "")
    || (ar?.title ?? "").localeCompare(br?.title ?? "")
    || (a.mbid ?? a.spotifyId ?? "").localeCompare(b.mbid ?? b.spotifyId ?? "");
  if (sort === "genre") {
    return (ar?.genres?.[0] ?? "\uffff").localeCompare(br?.genres?.[0] ?? "\uffff") || tie();
  }
  if (sort === "era") {
    const rank = { current: 0, catalog: 1, deep: 2, unknown: 3 } as const;
    const tier = rank[libraryEra(a)] - rank[libraryEra(b)];
    return tier || ((br?.releaseYear ?? -Infinity) - (ar?.releaseYear ?? -Infinity)) || tie();
  }
  if (sort === "artist") return tie();
  if (sort === "title") return (ar?.title ?? "").localeCompare(br?.title ?? "") || tie();
  return (Date.parse(b.addedAt) || 0) - (Date.parse(a.addedAt) || 0) || tie();
}