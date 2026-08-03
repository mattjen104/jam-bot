import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import type { LibraryItem } from "../lib/meHooks";
import { usePlayer, type RideSeed } from "../player/PlayerProvider";
import { getRecordingAlbumTracks, spotifyPlay } from "@workspace/api-client-react";
import { toast } from "../hooks/use-toast";
import { useMyAlbumAvatar, useSetAlbumAvatar } from "../lib/meHooks";

/** Deterministic gradient fallback for artwork */
function artGradient(a: string, b: string): string {
  let x = 0;
  for (const c of a + b) x = ((x * 31 + c.charCodeAt(0)) >>> 0);
  const h = x % 360;
  return `linear-gradient(150deg,hsl(${h},22%,20%),hsl(${(h + 42) % 360},28%,32%))`;
}

interface LibraryRowProps {
  item: LibraryItem;
  /** When true the track is currently on air — shows live badge + blue rule */
  isOnAir?: boolean;
  /** Whether this row's door strip is open */
  isOpen?: boolean;
  /** Called when the ▶ button is tapped — parent coordinates single-open */
  onToggle?: () => void;
}

/** §7 byline ladder: picked-by+station → picked-by → heard-on → service import → null */
function Byline({ prov, soft }: { prov: LibraryItem["provenance"]; soft?: boolean }) {
  if (prov.kind === "keep") {
    const pickerName = prov.pickerName ?? prov.pickerHandle ?? null;
    const stationName = prov.stationName ?? prov.stationSlug ?? null;

    if (pickerName) {
      return (
        <p className="lrow__by">
          <span className="lrow__by-phrase">picked by </span>
          {prov.pickerHandle ? (
            <Link href={`/archive/selectors/${prov.pickerHandle}`} className="lrow__by-name">
              {pickerName}
            </Link>
          ) : (
            <span className="lrow__by-name">{pickerName}</span>
          )}
          {stationName && prov.stationSlug && (
            <>
              {" "}
              <Link href={`/archive/stations/${prov.stationSlug}`} className="lrow__by-stn">
                {stationName}
              </Link>
            </>
          )}
        </p>
      );
    }
    if (stationName) {
      return (
        <p className="lrow__by">
          <span className="lrow__by-phrase">heard on </span>
          {prov.stationSlug ? (
            <Link href={`/archive/stations/${prov.stationSlug}`} className="lrow__by-name">
              {stationName}
            </Link>
          ) : (
            <span className="lrow__by-name">{stationName}</span>
          )}
        </p>
      );
    }
  }
  if (prov.kind === "import" && prov.service) {
    return (
      <p className="lrow__by lrow__by--import">
        {soft ? (
          <>
            <span style={{ opacity: 0.5, fontSize: "0.85em", marginRight: 3 }}>𝗦</span>
            from Spotify · unmatched
          </>
        ) : prov.service === "matt-starter" ? (
          <>from Matt’s starter library</>
        ) : (
          <>imported from {prov.service}</>
        )}
      </p>
    );
  }
  return null;
}

/** Three play doors — expands inline below the row. */
function DoorStrip({ item, onClose }: { item: LibraryItem; onClose: () => void }) {
  // DoorStrip is only rendered for resolved rows (item.mbid is non-null).
  const mbid = item.mbid!;

  const { ride, spotify } = usePlayer();
  const [, navigate] = useLocation();
  const [albumBusy, setAlbumBusy] = useState(false);
  const [albumPreview, setAlbumPreview] = useState<{ rgTitle: string; trackCount: number } | null>(null);

  // Pre-fetch album info as soon as the strip opens so the label is informative
  // before the listener commits to tapping.
  useEffect(() => {
    let cancelled = false;
    getRecordingAlbumTracks(mbid)
      .then((data) => {
        if (!cancelled) {
          setAlbumPreview({ rgTitle: data.rgTitle ?? "", trackCount: data.tracks.length });
        }
      })
      .catch(() => { /* 404 = no album data yet — label stays generic */ });
    return () => { cancelled = true; };
  }, [mbid]);

  const rec = item.recording;
  const title = rec?.title ?? mbid.slice(0, 8);
  const artist = rec?.artist ?? "";
  const artworkUrl = rec?.artworkUrl ?? null;

  const seed: RideSeed = { mbid, title, artist, artworkUrl, links: [] };

  const spotifyEligible = spotify.connected && spotify.premium;

  function handleTrack() {
    if (spotifyEligible) {
      // Spotify connected: play the track directly on the listener's device,
      // bypassing the preview fallback entirely.
      void spotifyPlay({
        mbid,
        deviceId: spotify.pinnedDevice?.id ?? undefined,
      }).then(() => {
        toast({ title: `Playing on Spotify: ${title}` });
      }).catch(() => {
        // If the direct play fails, fall back to the replay ride.
        ride.startReplay([seed], title, { timeOrientation: "curated", context: "library" });
        toast({ title: "Couldn't play on Spotify — using preview" });
      });
      onClose();
      return;
    }
    ride.startReplay([seed], title, { timeOrientation: "curated", context: "library" });
    onClose();
  }

  async function handleAlbum() {
    setAlbumBusy(true);
    try {
      const data = await getRecordingAlbumTracks(mbid);
      const seeds: RideSeed[] = data.tracks.map((t) => ({
        mbid: t.mbid,
        title: t.title,
        artist: t.artist,
        artworkUrl: null,
        links: [],
      }));
      if (seeds.length > 0) {
        ride.startReplay(seeds, data.rgTitle ?? title, { timeOrientation: "curated", context: "library" });
        onClose();
      }
    } catch {
      /* 404 = no album data yet */
    } finally {
      setAlbumBusy(false);
    }
  }

  const prov = item.provenance;
  const broadcastHref =
    prov.kind === "keep" && prov.pickerHandle
      ? `/archive/selectors/${prov.pickerHandle}`
      : prov.kind === "keep" && prov.stationSlug
      ? `/archive/stations/${prov.stationSlug}`
      : null;

  return (
    <div className="lrow__doors" onClick={(e) => e.stopPropagation()}>
      <button type="button" className="lrow__door" onClick={handleTrack} title="Play this track">
        ▶ Track
      </button>
      <button
        type="button"
        className="lrow__door"
        onClick={() => void handleAlbum()}
        disabled={albumBusy}
        title="Play full album from track 1"
      >
        {albumBusy
          ? "…"
          : albumPreview
          ? `💿 ${albumPreview.rgTitle} · ${albumPreview.trackCount} track${albumPreview.trackCount === 1 ? "" : "s"}`
          : "💿 Album"}
      </button>
      {broadcastHref ? (
        <button
          type="button"
          className="lrow__door"
          onClick={() => { navigate(broadcastHref); onClose(); }}
          title="Go to broadcast context"
        >
          📻 Broadcast
        </button>
      ) : (
        <button type="button" className="lrow__door lrow__door--off" disabled title="No broadcast history">
          📻 Broadcast
        </button>
      )}
    </div>
  );
}

/** A single row in the Library "Kept" list. */
export function LibraryRow({ item, isOnAir = false, isOpen = false, onToggle }: LibraryRowProps) {
  const rec = item.recording;
  const title = rec?.title ?? (item.mbid ? item.mbid.slice(0, 8) : "Unknown track");
  const artist = rec?.artist ?? "";
  const artwork = rec?.artworkUrl ?? null;
  const prov = item.provenance;
  const isSoft = item.soft === true;
  const { data: avatar } = useMyAlbumAvatar();
  const setAvatar = useSetAlbumAvatar();
  const isCurrentAvatar = item.mbid != null && avatar?.current?.recordingMbid === item.mbid;
  const canMakeAvatar = item.mbid != null && avatar?.candidates.some((candidate) => candidate.recordingMbid === item.mbid);

  const makeAvatar = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!item.mbid || setAvatar.isPending) return;
    setAvatar.mutate(item.mbid, {
      onSuccess: () => toast({ title: "This album is now your anonymous listener cover" }),
    });
  };

  const hasProvenance =
    prov.kind === "keep" &&
    (prov.pickerHandle != null || prov.stationSlug != null);

  const rowClass = [
    "lrow",
    isSoft ? "lrow--soft" : isOnAir ? "lrow--onair" : hasProvenance ? "lrow--kept" : "",
    isOpen ? "lrow--open" : "",
  ]
    .filter(Boolean)
    .join(" ");

  // Artwork swatch — for soft rows, links to Spotify instead of the song page.
  const artSwatch = (
    <>
      {artwork ? (
        <img src={artwork} alt="" className="lrow__art-img" loading="lazy" />
      ) : (
        <span
          className="lrow__art-grad"
          style={{ background: artGradient(title, artist) }}
        />
      )}
    </>
  );

  return (
    <li className={rowClass} data-testid="library-row">
      {/* 38×38 artwork swatch */}
      {item.mbid ? (
        <Link href={`/song/${item.mbid}`} className="lrow__art" tabIndex={-1} aria-hidden="true">
          {artSwatch}
        </Link>
      ) : (
        <span className="lrow__art lrow__art--soft" aria-hidden="true">
          {artSwatch}
        </span>
      )}

      {/* Main text */}
      <div className="lrow__body">
        {item.mbid ? (
          <Link href={`/song/${item.mbid}`} className="lrow__tr">
            {title}
          </Link>
        ) : (
          <span className="lrow__tr lrow__tr--soft">{title}</span>
        )}
        {artist && <p className="lrow__ar">{artist}</p>}
        <Byline prov={prov} soft={isSoft} />
        {item.fuzzyMatch && (
          <p className="lrow__badge lrow__badge--fuzzy" title="Matched by MusicBrainz text search — verify if unexpected">
            fuzzy match
          </p>
        )}
        {isOnAir && <p className="lrow__badge">● on air</p>}
        {isCurrentAvatar && <p className="lrow__badge" data-testid="library-current-avatar">anonymous listener cover</p>}
      </div>

      {/* Right rail — soft rows have no playback door (no MBID to queue) */}
      {!isSoft && (
        <div className="lrow__rail">
          {canMakeAvatar && (
            <button
              type="button"
              onClick={makeAvatar}
              disabled={setAvatar.isPending || isCurrentAvatar}
              title={isCurrentAvatar ? "Your current anonymous listener cover" : "Make this album my avatar"}
              aria-label={isCurrentAvatar ? "Current anonymous listener cover" : "Make this album my avatar"}
              style={{
                border: "none",
                background: "none",
                color: isCurrentAvatar ? "hsl(var(--library))" : "hsl(var(--faint))",
                fontSize: 13,
                padding: "4px",
                cursor: isCurrentAvatar ? "default" : "pointer",
              }}
              data-testid="library-make-avatar"
            >
              {isCurrentAvatar ? "●" : "◎"}
            </button>
          )}
          <button
            type="button"
            className={`lrow__play${isOpen ? " lrow__play--open" : ""}`}
            aria-label={isOpen ? "Close play options" : `Play ${title}`}
            aria-expanded={isOpen}
            onClick={(e) => { e.preventDefault(); onToggle?.(); }}
          >
            {isOpen ? "✕" : "▶"}
          </button>
        </div>
      )}

      {/* Door strip — only for resolved rows, only when open */}
      {!isSoft && isOpen && <DoorStrip item={item} onClose={() => onToggle?.()} />}
    </li>
  );
}
