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
  const initials = title.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join("").toUpperCase();
  return (
    <span className={`library-crate__swatch ${className}`} aria-hidden="true">
      {artworkUrl ? (
        <img src={proxyArtUrl(artworkUrl) ?? artworkUrl} alt="" onError={onArtError} loading="lazy" />
      ) : (
        <span className="library-crate__swatch-fallback">{initials || "·"}</span>
      )}
    </span>
  );
}

function TrackPlayButton({ item }: { item: LibraryItem }) {
  const { ride, spotify } = usePlayer();
  const rec = item.recording;
  const title = rec?.title ?? "Unknown track";
  const artist = rec?.artist ?? "";
  const play = () => {
    if (!item.mbid) return;
    const seed: RideSeed = { mbid: item.mbid, title, artist, artworkUrl: rec?.artworkUrl ?? null, links: [] };
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
  onImport: () => void;
}

export function LibraryCrate({ items, seedArtists, sort, unopenedOnly = false, onImport }: LibraryCrateProps) {
  const [location, setLocation] = useLocation();
  const [opened, markOpened] = useOpenedKeys();
  const [catalogue, setCatalogue] = useState<Record<string, { artistMbid: string | null; releases: ArtistCatalogueRelease[] }>>({});
  const { dated, undated } = useMemo(() => partitionCrateItems(items), [items]);
  const releases = useMemo(() => sortCrateReleases(buildCrateReleases(dated), sort), [dated, sort]);
  const attendance = useReleaseAttendance(releases);
  const addedArtists = useMemo(
    () => buildAddedArtists(seedArtists, catalogue, undated),
    [catalogue, seedArtists, undated],
  );
  const addedArtistNames = useMemo(() => addedArtists.map((artist) => artist.name), [addedArtists]);

  useEffect(() => {
    if (addedArtistNames.length === 0) return;
    let cancelled = false;
    fetch(`/api/me/taste-seeds/catalog?artists=${addedArtistNames.map(encodeURIComponent).join(",")}`)
      .then((response) => response.ok ? response.json() as Promise<{ artists?: Record<string, { artistMbid: string | null; releases: ArtistCatalogueRelease[] }> }> : Promise.reject())
      .then((payload) => { if (!cancelled) setCatalogue(payload.artists ?? {}); })
      .catch(() => { if (!cancelled) setCatalogue({}); });
    return () => { cancelled = true; };
  }, [addedArtistNames]);

  const visibleReleases = unopenedOnly ? releases.filter((release) => !opened.has(release.releaseGroupMbid ?? release.key)) : releases;
  const visibleArtists = (unopenedOnly ? addedArtists.filter((artist) => !opened.has(artist.key)) : addedArtists).slice(0, 20);
  const hasItems = releases.length > 0 || addedArtists.length > 0;
  const setUnopened = (value: boolean) => {
    const path = location.split("?")[0] ?? "/library";
    const params = new URLSearchParams(location.split("?")[1] ?? "");
    if (value) params.set("unopened", "1");
    else params.delete("unopened");
    setLocation(params.size > 0 ? `${path}?${params}` : path);
  };
  const setSort = (value: "added" | "artist" | "title") => {
    const path = location.split("?")[0] ?? "/library";
    const params = new URLSearchParams(location.split("?")[1] ?? "");
    if (value === "added") params.delete("sort");
    else params.set("sort", value);
    setLocation(params.size > 0 ? `${path}?${params}` : path);
  };

  if (!hasItems) {
    return (
      <div className="library-crate__empty" data-testid="library-crate-empty">
        <p>Your crate is empty.</p>
        <button type="button" onClick={onImport} data-testid="library-import-cta">Add music</button>
        <Link href="/" className="library-crate__empty-dial">Open the dial</Link>
      </div>
    );
  }

  return (
    <div className="library-crate" data-testid="library-crate">
      <div className="library-crate__toolbar">
        <span>Release crate</span>
        {(["added", "artist", "title"] as const).map((value) => (
          <button
            key={value}
            type="button"
            className={sort === value ? "is-active" : ""}
            onClick={() => setSort(value)}
            data-testid={`library-sort-${value}`}
          >
            {value === "added" ? "Added" : value === "artist" ? "Artist" : "Title"}
          </button>
        ))}
        <button type="button" onClick={() => setUnopened(true)} className={unopenedOnly ? "is-active" : ""} data-testid="library-unopened-toggle">
          {unopenedOnly ? "Showing not yet opened" : "Not yet opened"}
        </button>
        {unopenedOnly && <button type="button" onClick={() => setUnopened(false)}>Show all</button>}
      </div>
      <section className="library-crate__section" data-testid="library-crate-kept">
        <header className="library-crate__section-heading">
          <h2>Kept</h2>
          <span>
            {visibleReleases.length} · {sort === "added" ? "newest first" : sort === "artist" ? "A–Z by artist" : "A–Z by title"}
          </span>
        </header>
        {visibleReleases.length > 0 ? (
          <div className="library-crate__rail">
            {visibleReleases.map((release, index) => (
              <ReleaseCard
                key={release.key}
                release={release}
                position={index}
                opened={opened.has(release.releaseGroupMbid ?? release.key)}
                attendance={release.releaseGroupMbid ? attendance[release.releaseGroupMbid] : undefined}
                onOpened={markOpened}
              />
            ))}
          </div>
        ) : (
          <p className="library-crate__section-empty">{unopenedOnly ? "Nothing with a known keep date is waiting to be opened." : "Nothing with a known keep date yet."}</p>
        )}
      </section>
      {addedArtists.length > 0 && (
        <section className="library-crate__section" data-testid="library-crate-added">
          <header className="library-crate__section-heading">
            <h2>Added</h2>
            <span>{visibleArtists.length} artists · A–Z</span>
          </header>
          {visibleArtists.length > 0 ? (
            <div className="library-crate__rail">
              {visibleArtists.map((artist, index) => (
                <AddedArtistCard key={artist.key} artist={artist} position={index + visibleReleases.length} onOpened={markOpened} />
              ))}
            </div>
          ) : (
            <p className="library-crate__section-empty">Every added artist has been opened.</p>
          )}
          {addedArtists.length > 20 && (
            <Link href="/index" className="library-crate__index-link">Showing 20 of {addedArtists.length}. Browse all in Index →</Link>
          )}
        </section>
      )}
    </div>
  );
}
