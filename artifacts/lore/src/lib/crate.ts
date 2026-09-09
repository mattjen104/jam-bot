/**
 * Library crate read-model: pure builders, copy helpers, and the shared
 * release-metadata cache. These live outside LibraryCrate.tsx on purpose —
 * that file must export only components, or Vite Fast Refresh splits the
 * module instance and hooks crash with phantom "invalid hook call" errors.
 */
import type { LibraryItem } from "./meHooks";

export interface ReleaseMetadata {
  title: string;
  releaseGroupMbid: string;
}

export const releaseMetadataCache = new Map<string, ReleaseMetadata | null>();
const releaseMetadataPending = new Set<string>();
let releaseMetadataRequestChain: Promise<void> = Promise.resolve();

function releaseDate(release: {
  date?: string;
  "release-group"?: { "first-release-date"?: string };
}): string {
  return release["release-group"]?.["first-release-date"] ?? release.date ?? "9999";
}

export function primaryReleaseMetadata(recording: {
  releases?: Array<{
    date?: string;
    status?: string;
    "release-group"?: {
      id?: string;
      title?: string;
      "primary-type"?: string;
      "secondary-types"?: string[];
      "first-release-date"?: string;
    };
  }>;
}): ReleaseMetadata | null {
  const releases = (recording.releases ?? []).filter(
    (release) => release["release-group"]?.id && release["release-group"]?.title,
  );
  if (releases.length === 0) return null;
  const preferred = releases
    .filter((release) => {
      const group = release["release-group"];
      return group?.["primary-type"] === "Album"
        && (group["secondary-types"]?.length ?? 0) === 0;
    })
    .sort((a, b) => releaseDate(a).localeCompare(releaseDate(b)))[0];
  const fallback = releases
    .filter((release) => release.status === "Official")
    .sort((a, b) => releaseDate(a).localeCompare(releaseDate(b)))[0]
    ?? releases.sort((a, b) => releaseDate(a).localeCompare(releaseDate(b)))[0];
  const group = (preferred ?? fallback)?.["release-group"];
  return group?.id && group.title
    ? { title: group.title, releaseGroupMbid: group.id }
    : null;
}

/**
 * Resolve release metadata through the API server, never musicbrainz.org
 * directly. The server serves its `recording_release_groups` cache and
 * hydrates misses in paced batches of its own, so opening a large crate
 * costs one POST per ~100 unresolved rows instead of minutes of throttled
 * browser-side churn. The local Map still session-caches by MBID so rows
 * don't re-ask on every render burst.
 */
async function fetchReleaseMetadata(mbids: string[]): Promise<void> {
  try {
    const response = await fetch("/api/me/library/release-metadata", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mbids }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`release-metadata returned ${response.status}`);
    const data = await response.json() as {
      metadata?: Record<string, ReleaseMetadata | null>;
    };
    for (const mbid of mbids) {
      releaseMetadataCache.set(mbid, data.metadata?.[mbid] ?? null);
    }
  } catch {
    for (const mbid of mbids) releaseMetadataCache.set(mbid, null);
  } finally {
    for (const mbid of mbids) releaseMetadataPending.delete(mbid);
  }
}

export function queueReleaseMetadata(mbids: string[]): Promise<void> {
  for (const mbid of mbids) releaseMetadataPending.add(mbid);
  const request = releaseMetadataRequestChain.then(() => fetchReleaseMetadata(mbids));
  releaseMetadataRequestChain = request.catch(() => {});
  return request;
}

export function isReleaseMetadataPending(mbid: string): boolean {
  return releaseMetadataPending.has(mbid);
}

export interface CrateRelease {
  key: string;
  releaseGroupMbid: string | null;
  title: string | null;
  artist: string;
  year: number | null;
  artworkUrl: string | null;
  caught: LibraryItem;
  items: LibraryItem[];
  kind: "kept" | "unresolved";
}

export interface AddedArtist {
  key: string;
  name: string;
  artistMbid: string | null;
  releases: ArtistCatalogueRelease[];
}

export interface ArtistCatalogueRelease {
  releaseGroupMbid: string;
  title: string | null;
  primaryType: string | null;
  releaseYear: number | null;
  artworkUrl: string | null;
}

export interface ReleaseAttendance {
  heard: number;
  total: number;
  sinceAdding?: true;
}

function validDate(value: string | null | undefined): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

/** A keep date is only real when Lore created the keep or the source supplied one. */
export function hasGenuineKeepDate(item: LibraryItem): boolean {
  return item.provenance.kind === "keep" || item.provenance.sourceKeepDate === true;
}

export function keepTimestamp(item: LibraryItem): number | null {
  return hasGenuineKeepDate(item) ? validDate(item.addedAt) : null;
}

export function partitionCrateItems(items: LibraryItem[]): {
  dated: LibraryItem[];
  undated: LibraryItem[];
} {
  const dated: LibraryItem[] = [];
  const undated: LibraryItem[] = [];
  for (const item of items) {
    if (keepTimestamp(item) !== null) dated.push(item);
    else undated.push(item);
  }
  return { dated, undated };
}

function releaseIdentity(item: LibraryItem): string | null {
  return item.recording?.releaseGroupMbid ?? null;
}

/**
 * Collapse active library recordings into release-grain cards. The caught
 * recording is the newest dated item in each release and remains the
 * playback target; other recordings only establish the release membership.
 */
export function buildCrateReleases(items: LibraryItem[]): CrateRelease[] {
  const groups = new Map<string, CrateRelease>();
  for (const item of items) {
    const rec = item.recording;
    const rg = releaseIdentity(item);
    const key = rg
      ? `release:${rg}`
      : `recording:${item.mbid ?? item.spotifyId ?? item.addedAt}`;
    const current = groups.get(key);
    if (!current) {
      groups.set(key, {
        key,
        releaseGroupMbid: rg,
        title: rec?.albumTitle ?? null,
        artist: rec?.artist ?? "",
        year: rec?.releaseYear ?? null,
        artworkUrl: rec?.artworkUrl ?? null,
        caught: item,
        items: [item],
        kind: rg ? "kept" : "unresolved",
      });
      continue;
    }
    current.items.push(item);
    if (!current.artworkUrl && rec?.artworkUrl) current.artworkUrl = rec.artworkUrl;
    if (keepTimestamp(item) !== null &&
        (keepTimestamp(current.caught) ?? -Infinity) < (keepTimestamp(item) ?? -Infinity)) {
      current.caught = item;
    }
  }
  return [...groups.values()];
}

export function sortCrateReleases(
  releases: CrateRelease[],
  sort: "added" | "artist" | "title",
): CrateRelease[] {
  return [...releases].sort((a, b) => {
    if (sort === "artist") return a.artist.localeCompare(b.artist) || a.key.localeCompare(b.key);
    if (sort === "title") {
      return (a.title ?? a.caught.recording?.title ?? "").localeCompare(
        b.title ?? b.caught.recording?.title ?? "",
      ) || a.key.localeCompare(b.key);
    }
    return (keepTimestamp(b.caught) ?? -Infinity) - (keepTimestamp(a.caught) ?? -Infinity)
      || a.key.localeCompare(b.key);
  });
}

export function buildAddedArtists(
  seedArtists: string[],
  catalogue: Record<string, { artistMbid: string | null; releases: ArtistCatalogueRelease[] }>,
  undatedItems: LibraryItem[] = [],
): AddedArtist[] {
  const seen = new Set<string>();
  const names = [
    ...seedArtists,
    ...undatedItems.map((item) => item.recording?.artist ?? "").filter(Boolean),
  ];
  return names
    .map((name) => name.trim())
    .filter((name) => {
      const key = name.toLocaleLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.localeCompare(b))
    .map((name) => {
      const entry = catalogue[name.toLocaleLowerCase()];
      return {
        key: `artist:${name.toLocaleLowerCase()}`,
        name,
        artistMbid: entry?.artistMbid ?? null,
        releases: entry?.releases ?? [],
      };
    });
}

export function crateTilt(identity: string, position: number): number {
  let hash = 2166136261;
  for (const char of identity) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  const magnitude = 5 + (Math.abs(hash) % 8);
  return (position % 2 === 0 ? -1 : 1) * magnitude;
}

export function keepCopy(item: LibraryItem): string {
  const prov = item.provenance;
  const timestamp = keepTimestamp(item);
  const date = timestamp === null
    ? null
    : new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" })
      .format(new Date(timestamp));
  if (prov.kind === "keep" && date) {
    const station = prov.stationName ?? prov.stationSlug;
    const selector = prov.pickerName ?? prov.pickerHandle;
    return `Kept ${date}${station ? ` from ${station}` : " from Lore"}${selector ? ` · ${selector}` : ""}`;
  }
  if (prov.kind === "import" && date) return `Liked ${date} · ${prov.service ?? "another service"}`;
  return "Added · date unknown";
}

export function attendanceCopy(
  releaseGroupMbid: string | null,
  attendance?: ReleaseAttendance,
): string {
  if (!releaseGroupMbid) return "Release unknown — no group resolved";
  if (!attendance || attendance.heard <= 0 || attendance.total <= 0) return "";
  return `Heard ${attendance.heard} of ${attendance.total}${attendance.sinceAdding ? " since adding" : ""}`;
}
