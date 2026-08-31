import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { usePlayer, type RideSeed } from "../player/PlayerProvider";
import {
  spotifyPlay,
} from "@workspace/api-client-react";
import { useSetLibraryRemoved, type LibraryItem } from "../lib/meHooks";
import { proxyArtUrl } from "../lib/proxyArt";
import { onArtError } from "../lib/rumours";
import { Play, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "../hooks/use-toast";
import type { CSSProperties } from "react";

interface ReleaseMetadata {
  title: string;
  releaseGroupMbid: string;
}

const releaseMetadataCache = new Map<string, ReleaseMetadata | null>();
const releaseMetadataPending = new Set<string>();
let releaseMetadataRequestChain: Promise<void> = Promise.resolve();
let lastReleaseMetadataRequestAt = 0;

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

async function fetchReleaseMetadata(mbids: string[]): Promise<void> {
  const query = mbids.map((mbid) => `rid:${mbid}`).join(" OR ");
  const url = `https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(query)}&inc=releases+release-groups&fmt=json&limit=100`;
  try {
    const waitMs = Math.max(0, 1_100 - (Date.now() - lastReleaseMetadataRequestAt));
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    lastReleaseMetadataRequestAt = Date.now();
    const response = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new Error(`MusicBrainz returned ${response.status}`);
    const data = await response.json() as {
      recordings?: Array<{
        id?: string;
        releases?: Parameters<typeof primaryReleaseMetadata>[0]["releases"];
      }>;
    };
    const returned = new Set<string>();
    for (const recording of data.recordings ?? []) {
      if (!recording.id || !mbids.includes(recording.id)) continue;
      returned.add(recording.id);
      releaseMetadataCache.set(recording.id, primaryReleaseMetadata(recording));
    }
    for (const mbid of mbids) {
      if (!returned.has(mbid)) releaseMetadataCache.set(mbid, null);
    }
  } catch {
    for (const mbid of mbids) releaseMetadataCache.set(mbid, null);
  } finally {
    for (const mbid of mbids) releaseMetadataPending.delete(mbid);
  }
}

function queueReleaseMetadata(mbids: string[]): Promise<void> {
  for (const mbid of mbids) releaseMetadataPending.add(mbid);
  const request = releaseMetadataRequestChain.then(() => fetchReleaseMetadata(mbids));
  releaseMetadataRequestChain = request.catch(() => {});
  return request;
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

const OPENED_STORAGE_KEY = "lore:library-opened";

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

function readOpened(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(OPENED_STORAGE_KEY) ?? "[]");
    return new Set(Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : []);
  } catch {
    return new Set();
  }
}

function rememberOpened(key: string): void {
  try {
    const opened = readOpened();
    opened.add(key);
    localStorage.setItem(OPENED_STORAGE_KEY, JSON.stringify([...opened]));
  } catch {
    // Open state is intentionally best effort and never blocks navigation.
  }
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

function Swatch({ title, artworkUrl, className = "" }: {
  title: string;
  artworkUrl: string | null;
  className?: string;
}) {
  return (
    <span className={`library-crate__swatch ${className}`} aria-hidden="true" title={title}>
      {artworkUrl ? (
        <img src={proxyArtUrl(artworkUrl) ?? artworkUrl} alt="" onError={onArtError} loading="lazy" />
      ) : (
        <img
          src={`${import.meta.env.BASE_URL}rumours.jpg`}
          alt=""
          className="library-crate__swatch-fallback"
          loading="lazy"
        />
      )}
    </span>
  );
}

function CrateTrackCard({
  item,
  release,
  metadata,
  position,
  opened,
  onOpened,
}: {
  item: LibraryItem;
  release: CrateRelease;
  metadata: ReleaseMetadata | null;
  position: number;
  opened: boolean;
  onOpened: (key: string) => void;
}) {
  const rec = item.recording;
  const title = rec?.title ?? "Unresolved recording";
  const album = rec?.albumTitle ?? release.title ?? metadata?.title ?? "Release unknown";
  const artist = rec?.artist ?? release.artist ?? "Unknown artist";
  const releaseGroupMbid =
    rec?.releaseGroupMbid
    ?? release.releaseGroupMbid
    ?? metadata?.releaseGroupMbid
    ?? null;
  const cover = rec?.artworkUrl
    ?? release.artworkUrl
    ?? (releaseGroupMbid
      ? `https://coverartarchive.org/release-group/${releaseGroupMbid}/front-1200`
      : null);
  const openedKey = item.mbid ?? item.spotifyId ?? `${release.key}:${position}`;
  const releaseHref = releaseGroupMbid
    ? `/album/${releaseGroupMbid}`
    : null;

  return (
    <article
      className={`library-crate__track${opened ? " library-crate__track--opened" : ""}`}
      data-testid="library-crate-track"
      data-track-key={openedKey}
    >
      <div className="library-crate__track-art">
        {releaseHref ? (
          <Link
            href={releaseHref}
            className="library-crate__cover-link"
            onClick={() => onOpened(openedKey)}
            aria-label={`Open ${album}`}
          >
            <Swatch title={album} artworkUrl={cover} className="library-crate__track-swatch" />
          </Link>
        ) : (
          <Swatch title={album} artworkUrl={cover} className="library-crate__track-swatch" />
        )}
      </div>
      <div className="library-crate__track-copy">
        <div className="library-crate__track-title">{title}</div>
        <div className="library-crate__track-album">{album}</div>
        <div className="library-crate__track-artist">{artist}</div>
        <div className="library-crate__provenance">{keepCopy(item)}</div>
      </div>
    </article>
  );
}

function TrackPlayButton({ item }: { item: LibraryItem }) {
  const { ride, spotify } = usePlayer();
  const rec = item.recording;
  const title = rec?.title ?? "Unknown track";
  const artist = rec?.artist ?? "";
  const play = () => {
    if (!item.mbid) return;
    const seed: RideSeed = {
      mbid: item.mbid,
      title,
      artist,
      artworkUrl: rec?.artworkUrl ?? null,
      links: rec?.appleMusicId
        ? [{ kind: "exact", name: "apple_music", url: `https://music.apple.com/song/i=${rec.appleMusicId}` }]
        : [],
    };
    if (spotify.connected && spotify.premium) {
      void spotifyPlay({ mbid: item.mbid, deviceId: spotify.pinnedDevice?.id })
        .then(() => toast({ title: `Playing on Spotify: ${title}` }))
        .catch(() => {
          ride.startReplay([seed], title, { timeOrientation: "curated", context: "library" });
          toast({ title: "Couldn't play on Spotify — using preview" });
        });
    } else {
      ride.startReplay([seed], title, { timeOrientation: "curated", context: "library" });
    }
  };
  return (
    <button
      type="button"
      className="library-crate__play"
      onClick={(event) => { event.preventDefault(); event.stopPropagation(); play(); }}
      disabled={!item.mbid}
      aria-label={`Play ${title}`}
      title={item.mbid ? "Play this caught track" : "This recording is not resolved yet"}
      data-testid="library-crate-play"
    >
      <Play size={13} fill="currentColor" />
    </button>
  );
}

function ReleaseCard({
  release,
  position,
  opened,
  attendance,
  onOpened,
}: {
  release: CrateRelease;
  position: number;
  opened: boolean;
  attendance?: ReleaseAttendance;
  onOpened: (key: string) => void;
}) {
  const setRemoved = useSetLibraryRemoved();
  const item = release.caught;
  const rec = item.recording;
  const title = release.title ?? rec?.title ?? "Unresolved recording";
  const artist = release.artist || rec?.artist || "Unknown artist";
  const removed = item.removed === true;
  const tilt = crateTilt(release.key, position);
  const releaseHref = release.releaseGroupMbid
    ? `/album/${release.releaseGroupMbid}?tilt=${encodeURIComponent(String(tilt))}`
    : null;
  const attendanceLine = attendanceCopy(release.releaseGroupMbid, attendance);
  const openedKey = release.releaseGroupMbid ?? release.key;
  return (
    <article
      className={`library-crate__card${removed ? " library-crate__card--removed" : ""}${opened ? " library-crate__card--opened" : ""}`}
      style={{ "--crate-tilt": `${tilt}deg`, "--crate-z": position + 1 } as CSSProperties}
      data-testid="library-crate-release"
      data-release-key={release.key}
    >
      <div className="library-crate__art-column">
        {releaseHref ? (
          <Link
            href={releaseHref}
            className="library-crate__cover-link"
            onClick={() => { rememberOpened(openedKey); onOpened(openedKey); }}
            aria-label={`Open ${title}`}
            data-testid="library-crate-release-link"
          >
            <Swatch title={title} artworkUrl={release.artworkUrl} />
          </Link>
        ) : (
          <Swatch title={title} artworkUrl={release.artworkUrl} />
        )}
      </div>
      <div className="library-crate__content">
        <div className="library-crate__scrim" aria-hidden="true" />
        <div className="library-crate__parent">
          {releaseHref ? (
            <Link
              href={releaseHref}
              onClick={() => { rememberOpened(openedKey); onOpened(openedKey); }}
              data-testid="library-crate-parent-link"
            >
              {title}{release.year ? ` · ${release.year}` : ""}
            </Link>
          ) : (
            <span>Unresolved recording</span>
          )}
        </div>
        <div className="library-crate__caught">
          <span className="library-crate__caught-title">{rec?.title ?? "Unresolved recording"}</span>
          <TrackPlayButton item={item} />
        </div>
        <Link href={rec?.artistMbid ? `/artist/${rec.artistMbid}` : "#"} className="library-crate__artist">
          {artist}
        </Link>
        {attendanceLine && <div className="library-crate__attendance">{attendanceLine}</div>}
        {release.releaseGroupMbid && !attendanceLine && <div className="library-crate__attendance library-crate__attendance--unknown">Attendance unknown</div>}
        <div className="library-crate__provenance">{keepCopy(item)}</div>
        <div className="library-crate__actions">
          <button
            type="button"
            className="library-crate__remove"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (item.mbid) setRemoved.mutate({ mbid: item.mbid, spotifyId: item.spotifyId, removed: !removed });
            }}
            disabled={setRemoved.isPending || !item.mbid}
            aria-label={removed ? `Restore ${rec?.title ?? "recording"}` : `Remove ${rec?.title ?? "recording"}`}
          >
            {removed ? <RotateCcw size={12} /> : <Trash2 size={12} />}
          </button>
          {item.fuzzyMatch && <span className="library-crate__fuzzy">fuzzy match</span>}
        </div>
      </div>
    </article>
  );
}

function AddedArtistCard({ artist, position, onOpened }: {
  artist: AddedArtist;
  position: number;
  onOpened: (key: string) => void;
}) {
  const [releaseIndex, setReleaseIndex] = useState(0);
  const release = artist.releases.length > 0
    ? artist.releases[releaseIndex % artist.releases.length]
    : null;
  const tilt = crateTilt(artist.key, position);
  const releaseHref = release
    ? `/album/${release.releaseGroupMbid}?tilt=${encodeURIComponent(String(tilt))}`
    : null;
  return (
    <article
      className="library-crate__card library-crate__card--artist"
      style={{ "--crate-tilt": `${tilt}deg`, "--crate-z": position + 1 } as CSSProperties}
      data-testid="library-crate-added-artist"
      data-artist-key={artist.key}
    >
      <div className="library-crate__art-column">
        <div className="library-crate__artist-stack">
          {artist.releases.slice(1, 3).map((ghost, index) => (
            <Swatch key={ghost.releaseGroupMbid} title={ghost.title ?? artist.name} artworkUrl={ghost.artworkUrl} className={`library-crate__ghost library-crate__ghost--${index + 1}`} />
          ))}
          {release && releaseHref ? (
            <Link
              href={releaseHref}
              className="library-crate__cover-link"
              onClick={() => { rememberOpened(artist.key); onOpened(artist.key); }}
              aria-label={`Browse ${release.title ?? "release"} by ${artist.name}`}
            >
              <Swatch title={release.title ?? artist.name} artworkUrl={release.artworkUrl} />
            </Link>
          ) : (
            <Swatch title={artist.name} artworkUrl={null} />
          )}
        </div>
      </div>
      <div className="library-crate__content">
        <div className="library-crate__scrim" aria-hidden="true" />
        <div className="library-crate__parent">{artist.name}</div>
        <div className="library-crate__caught library-crate__caught--artist">
          <span>Artist catalogue</span>
          {artist.releases.length > 1 && (
            <button
              type="button"
              className="library-crate__cycle"
              onClick={() => setReleaseIndex((index) => (index + 1) % artist.releases.length)}
              aria-label={`Show another release by ${artist.name}`}
              data-testid="library-crate-cycle"
            >
              {releaseIndex + 1}/{artist.releases.length} · browse
            </button>
          )}
        </div>
        <div className="library-crate__attendance library-crate__attendance--unknown">
          Attendance unknown — nothing witnessed yet
        </div>
        <div className="library-crate__provenance">Added · date unknown</div>
        <div className="library-crate__artist-note">No keep or album choice has been made.</div>
      </div>
    </article>
  );
}

function useOpenedKeys() {
  const [opened, setOpened] = useState<Set<string>>(() => readOpened());
  const mark = (key: string) => {
    rememberOpened(key);
    setOpened((current) => new Set(current).add(key));
  };
  return [opened, mark] as const;
}

function useReleaseAttendance(releases: CrateRelease[]) {
  const ids = useMemo(
    () => releases.map((release) => release.releaseGroupMbid).filter((id): id is string => Boolean(id)).sort(),
    [releases],
  );
  const [stats, setStats] = useState<Record<string, ReleaseAttendance>>({});
  const sinceKey = useMemo(
    () => JSON.stringify(Object.fromEntries(
      releases
        .filter((release) =>
          release.releaseGroupMbid &&
          release.caught.provenance.kind === "import" &&
          release.caught.provenance.sourceKeepDate === true)
        .map((release) => [release.releaseGroupMbid!, release.caught.addedAt]),
    )),
    [releases],
  );
  useEffect(() => {
    if (ids.length === 0) return;
    let cancelled = false;
    fetch(
      `/api/me/library/release-stats?rg=${ids.map(encodeURIComponent).join(",")}&since=${encodeURIComponent(sinceKey)}`,
    )
      .then((response) => response.ok ? response.json() as Promise<{ stats?: Record<string, ReleaseAttendance> }> : Promise.reject())
      .then((payload) => { if (!cancelled) setStats(payload.stats ?? {}); })
      .catch(() => { if (!cancelled) setStats({}); });
    return () => { cancelled = true; };
  }, [ids, sinceKey]);
  return ids.length === 0 ? {} : stats;
}

export interface LibraryCrateProps {
  items: LibraryItem[];
  seedArtists: string[];
  sort: "added" | "artist" | "title";
  unopenedOnly?: boolean;
  /** True when a deep-linked Library lens is currently narrowing the crate. */
  activeLens?: boolean;
}

export function LibraryCrate({
  items,
  sort,
  unopenedOnly = false,
  activeLens = false,
}: LibraryCrateProps) {
  const [location, setLocation] = useLocation();
  const [opened, markOpened] = useOpenedKeys();
  const [metadataVersion, setMetadataVersion] = useState(0);
  const releases = useMemo(() => sortCrateReleases(buildCrateReleases(items), sort), [items, sort]);

  useEffect(() => {
    const missing = items
      .filter((item) =>
        item.mbid
        && item.recording
        && (!item.recording.albumTitle || !item.recording.releaseGroupMbid)
        && !releaseMetadataCache.has(item.mbid)
        && !releaseMetadataPending.has(item.mbid),
      )
      .map((item) => item.mbid!)
      .slice(0, 100);
    if (missing.length === 0) return;
    let active = true;
    void queueReleaseMetadata(missing).finally(() => {
      if (active) setMetadataVersion((version) => version + 1);
    });
    return () => { active = false; };
  }, [items, metadataVersion]);

  const visibleReleases = unopenedOnly ? releases.filter((release) => !opened.has(release.releaseGroupMbid ?? release.key)) : releases;
  const tracks = useMemo(
    () => visibleReleases.flatMap((release) =>
      release.items.map((item) => ({ item, release })),
    ).sort((a, b) => {
      if (sort === "artist") {
        return (a.item.recording?.artist ?? "").localeCompare(b.item.recording?.artist ?? "")
          || (a.item.recording?.title ?? "").localeCompare(b.item.recording?.title ?? "");
      }
      if (sort === "title") {
        return (a.item.recording?.title ?? "").localeCompare(b.item.recording?.title ?? "")
          || (a.item.recording?.artist ?? "").localeCompare(b.item.recording?.artist ?? "");
      }
      return (keepTimestamp(b.item) ?? -Infinity) - (keepTimestamp(a.item) ?? -Infinity)
        || (a.item.mbid ?? a.item.spotifyId ?? "").localeCompare(b.item.mbid ?? b.item.spotifyId ?? "");
    }),
    [sort, visibleReleases],
  );
  const hasItems = tracks.length > 0;

  if (!hasItems) {
    return (
      <div className="library-crate__empty" data-testid="library-crate-empty" aria-hidden="true" />
    );
  }

  return (
    <div className="library-crate" data-testid="library-crate">
      <section className="library-crate__section" data-testid="library-crate-kept">
        <header className="library-crate__section-heading">
          <h2>Release crate</h2>
          <span>
            {tracks.length} {tracks.length === 1 ? "song" : "songs"}
          </span>
        </header>
        {tracks.length > 0 ? (
          <div className="library-crate__track-list">
            {tracks.map(({ item, release }, index) => (
              <CrateTrackCard
                key={`${release.key}:${item.mbid ?? item.spotifyId ?? index}`}
                item={item}
                release={release}
                metadata={item.mbid ? releaseMetadataCache.get(item.mbid) ?? null : null}
                position={index}
                opened={opened.has(item.mbid ?? item.spotifyId ?? `${release.key}:${index}`)}
                onOpened={markOpened}
              />
            ))}
          </div>
        ) : (
          <p className="library-crate__section-empty">No songs in this view.</p>
        )}
      </section>
    </div>
  );
}
