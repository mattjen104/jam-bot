import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import type { LibraryItem } from "../lib/meHooks";
import { proxyArtUrl } from "../lib/proxyArt";
import { onArtError } from "../lib/rumours";
import type { CSSProperties } from "react";
import {
  anchorKey,
  useSetContexts,
  type SetContext,
  type SetContextAnchor,
} from "../lib/setContexts";
import { SetContextDeck } from "./SetContextDeck";
import { stopInlinePreview } from "../player/inlinePreview";
import { usePlayer } from "../player/PlayerProvider";
// Read-model helpers live in ../lib/crate so this file exports only
// components — mixed exports break Vite Fast Refresh (split module
// instances → phantom "invalid hook call" crashes).
import {
  buildAddedArtists,
  buildCrateReleases,
  crateTilt,
  isReleaseMetadataPending,
  keepCopy,
  keepTimestamp,
  queueReleaseMetadata,
  releaseMetadataCache,
  sortCrateReleases,
  type AddedArtist,
  type ArtistCatalogueRelease,
  type CrateRelease,
  type ReleaseMetadata,
} from "../lib/crate";

const OPENED_STORAGE_KEY = "lore:library-opened";

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
  setContext,
  onPlayStart,
}: {
  item: LibraryItem;
  release: CrateRelease;
  metadata: ReleaseMetadata | null;
  setContext?: SetContext | null;
  onPlayStart?: () => void;
  position: number;
  opened: boolean;
  onOpened: (key: string) => void;
}) {
  // Name of the deck cover the listener is peeking at (null = the kept track).
  const [peekLabel, setPeekLabel] = useState<string | null>(null);
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
      className={`library-crate__track${setContext ? " library-crate__track--deck" : ""}${opened ? " library-crate__track--opened" : ""}`}
      data-testid="library-crate-track"
      data-track-key={openedKey}
    >
      <div className="library-crate__track-art">
        {setContext ? (
          <SetContextDeck context={setContext} onPlayStart={onPlayStart} onSelectionChange={setPeekLabel} />
        ) : releaseHref ? (
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
        {/* The live region stays mounted between peeks so screen readers
            catch the first announcement; empty while on the kept track. */}
        {setContext && (
          <div className="set-context-deck__caption" data-testid="set-context-caption" aria-live="polite">
            {peekLabel}
          </div>
        )}
        <div className="library-crate__track-title">{title}</div>
        <div className="library-crate__track-album">
          {releaseHref ? (
            <Link
              href={releaseHref}
              className="library-crate__album-link"
              onClick={() => onOpened(openedKey)}
            >
              {album}
            </Link>
          ) : (
            album
          )}
        </div>
        <div className="library-crate__track-artist">{artist}</div>
        <div className="library-crate__provenance">{keepCopy(item)}</div>
        {setContext?.station.homepageUrl && (
          <div className="library-crate__station-row">
            <a
              href={setContext.station.homepageUrl}
              target="_blank"
              rel="noreferrer"
              className="library-crate__station-link"
              data-testid="crate-station-link"
              onClick={(e) => e.stopPropagation()}
            >
              {setContext.station.name} ↗
            </a>
          </div>
        )}
      </div>
    </article>
  );
}

function AddedArtistCard({ artist, position, onOpened, setContext, onPlayStart }: {
  artist: AddedArtist;
  position: number;
  onOpened: (key: string) => void;
  setContext?: SetContext | null;
  onPlayStart?: () => void;
}) {
  const [releaseIndex, setReleaseIndex] = useState(0);
  // Name of the deck cover the listener is peeking at (null = the kept track).
  const [peekLabel, setPeekLabel] = useState<string | null>(null);
  const release = artist.releases.length > 0
    ? artist.releases[releaseIndex % artist.releases.length]
    : null;
  const tilt = crateTilt(artist.key, position);
  const releaseHref = release
    ? `/album/${release.releaseGroupMbid}?tilt=${encodeURIComponent(String(tilt))}`
    : null;
  return (
    <article
      className={`library-crate__card library-crate__card--artist${setContext ? " library-crate__card--deck" : ""}`}
      style={{ "--crate-tilt": `${tilt}deg`, "--crate-z": position + 1 } as CSSProperties}
      data-testid="library-crate-added-artist"
      data-artist-key={artist.key}
    >
      <div className="library-crate__art-column">
        {setContext ? (
          <SetContextDeck context={setContext} size={72} onPlayStart={onPlayStart} onSelectionChange={setPeekLabel} />
        ) : (
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
        )}
      </div>
      <div className="library-crate__content">
        <div className="library-crate__scrim" aria-hidden="true" />
        <div className="library-crate__parent">{artist.name}</div>
        {/* Persistent live region; empty while on the kept track. */}
        {setContext && (
          <div className="set-context-deck__caption" data-testid="set-context-caption" aria-live="polite">
            {peekLabel}
          </div>
        )}
        {setContext && release && releaseHref && (
          <div className="library-crate__track-album">
            <Link
              href={releaseHref}
              className="library-crate__album-link"
              onClick={() => { rememberOpened(artist.key); onOpened(artist.key); }}
            >
              {release.title ?? artist.name}
            </Link>
          </div>
        )}
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
        {setContext?.station.homepageUrl && (
          <div className="library-crate__station-row">
            <a
              href={setContext.station.homepageUrl}
              target="_blank"
              rel="noreferrer"
              className="library-crate__station-link"
              data-testid="crate-station-link"
              onClick={(e) => e.stopPropagation()}
            >
              {setContext.station.name} ↗
            </a>
          </div>
        )}
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

export interface LibraryCrateProps {
  items: LibraryItem[];
  seedArtists: string[];
  catalogue?: Record<string, { artistMbid: string | null; releases: ArtistCatalogueRelease[] }>;
  sort: "added" | "artist" | "title";
  unopenedOnly?: boolean;
}

export function LibraryCrate({
  items,
  seedArtists,
  catalogue = {},
  sort,
  unopenedOnly = false,
}: LibraryCrateProps) {
  const [opened, markOpened] = useOpenedKeys();
  const [metadataVersion, setMetadataVersion] = useState(0);
  const releases = useMemo(() => sortCrateReleases(buildCrateReleases(items), sort), [items, sort]);
  const addedArtists = useMemo(
    () => buildAddedArtists(seedArtists, catalogue),
    [catalogue, seedArtists],
  );
  const [showAllArtists, setShowAllArtists] = useState(false);

  useEffect(() => {
    const missing = items
      .filter((item) =>
        item.mbid
        && item.recording
        && (!item.recording.albumTitle || !item.recording.releaseGroupMbid)
        && !releaseMetadataCache.has(item.mbid)
        && !isReleaseMetadataPending(item.mbid),
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
  const visibleArtists = showAllArtists ? addedArtists : addedArtists.slice(0, 20);
  const hasItems = tracks.length > 0 || addedArtists.length > 0;

  // Set-context anchors: kept tracks anchor by MBID (the server finds the
  // retained spin); unresolved tracks and artist-file saves anchor by artist
  // name (most recent resolved set across stations).
  const contextAnchors = useMemo(() => {
    const anchors: SetContextAnchor[] = [];
    for (const { item } of tracks) {
      if (item.mbid) anchors.push({ kind: "mbid", mbid: item.mbid });
      else if (item.recording?.artist) anchors.push({ kind: "artist", artist: item.recording.artist });
    }
    for (const artist of visibleArtists) {
      anchors.push({ kind: "artist", artist: artist.name });
    }
    return anchors;
  }, [tracks, visibleArtists]);
  const setContexts = useSetContexts(contextAnchors);

  // Inline previews share the page's single audio element; stop them when the
  // crate unmounts (navigation) and yield live radio when one starts.
  const { radio } = usePlayer();
  useEffect(() => () => stopInlinePreview(), []);
  const yieldRadio = () => {
    if (radio.status === "playing") radio.stop();
  };

  const contextFor = (item: LibraryItem): SetContext | null | undefined =>
    item.mbid
      ? setContexts.get(`mbid:${item.mbid}`)
      : item.recording?.artist
        ? setContexts.get(anchorKey({ kind: "artist", artist: item.recording.artist }))
        : undefined;

  if (!hasItems) {
    return (
      <div className="library-crate__empty" data-testid="library-crate-empty" aria-hidden="true" />
    );
  }

  return (
    <div className="library-crate" data-testid="library-crate">
      <section className="library-crate__section" data-testid="library-crate-kept">
        <header className="library-crate__section-heading">
          <h2>Kept</h2>
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
                setContext={contextFor(item)}
                onPlayStart={yieldRadio}
              />
            ))}
          </div>
        ) : (
          <p className="library-crate__section-empty">No songs in this view.</p>
        )}
      </section>
      {addedArtists.length > 0 ? (
        <section className="library-crate__section" data-testid="library-crate-added">
          <header className="library-crate__section-heading">
            <h2>Added</h2>
            <span>
              {addedArtists.length} {addedArtists.length === 1 ? "artist" : "artists"} · artist-only
            </span>
          </header>
          <div className="library-crate__rail">
            {visibleArtists.map((artist, index) => (
              <AddedArtistCard
                key={artist.key}
                artist={artist}
                position={index}
                onOpened={markOpened}
                setContext={setContexts.get(anchorKey({ kind: "artist", artist: artist.name }))}
                onPlayStart={yieldRadio}
              />
            ))}
          </div>
          {addedArtists.length > visibleArtists.length ? (
            <button
              type="button"
              className="library-crate__index-link"
              onClick={() => setShowAllArtists(true)}
              data-testid="library-added-show-all"
            >
              Show all {addedArtists.length} artists
            </button>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
