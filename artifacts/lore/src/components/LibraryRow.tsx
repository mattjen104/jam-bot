import { useState } from "react";
import { Link, useLocation } from "wouter";
import type { LibraryItem } from "../lib/meHooks";
import { usePlayer, type RideSeed } from "../player/PlayerProvider";
import { getRecordingAlbumTracks, spotifyPlay } from "@workspace/api-client-react";
import { toast } from "../hooks/use-toast";

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
function Byline({ prov }: { prov: LibraryItem["provenance"] }) {
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
      <p className="lrow__by lrow__by--import">imported from {prov.service}</p>
    );
  }
  return null;
}

/** Three play doors — expands inline below the row. */
function DoorStrip({ item, onClose }: { item: LibraryItem; onClose: () => void }) {
  const { ride, spotify } = usePlayer();
  const [, navigate] = useLocation();
  const [albumBusy, setAlbumBusy] = useState(false);

  const rec = item.recording;
  const title = rec?.title ?? item.mbid.slice(0, 8);
  const artist = rec?.artist ?? "";
  const artworkUrl = rec?.artworkUrl ?? null;

  const seed: RideSeed = { mbid: item.mbid, title, artist, artworkUrl, links: [] };

  const spotifyEligible = spotify.connected && spotify.premium;

  function handleTrack() {
    if (spotifyEligible) {
      // Spotify connected: play the track directly on the listener's device,
      // bypassing the preview fallback entirely.
      void spotifyPlay({
        mbid: item.mbid,
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
      const data = await getRecordingAlbumTracks(item.mbid);
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
        {albumBusy ? "…" : "💿 Album"}
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
  const title = rec?.title ?? item.mbid.slice(0, 8);
  const artist = rec?.artist ?? "";
  const artwork = rec?.artworkUrl ?? null;
  const prov = item.provenance;

  const hasProvenance =
    prov.kind === "keep" &&
    (prov.pickerHandle != null || prov.stationSlug != null);

  const rowClass = [
    "lrow",
    isOnAir ? "lrow--onair" : hasProvenance ? "lrow--kept" : "",
    isOpen ? "lrow--open" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <li className={rowClass} data-testid="library-row">
      {/* 38×38 artwork swatch */}
      <Link href={`/song/${item.mbid}`} className="lrow__art" tabIndex={-1} aria-hidden="true">
        {artwork ? (
          <img src={artwork} alt="" className="lrow__art-img" loading="lazy" />
        ) : (
          <span
            className="lrow__art-grad"
            style={{ background: artGradient(title, artist) }}
          />
        )}
      </Link>

      {/* Main text */}
      <div className="lrow__body">
        <Link href={`/song/${item.mbid}`} className="lrow__tr">
          {title}
        </Link>
        {artist && <p className="lrow__ar">{artist}</p>}
        <Byline prov={prov} />
        {isOnAir && <p className="lrow__badge">● on air</p>}
      </div>

      {/* Right rail — ▶ toggles the door strip */}
      <div className="lrow__rail">
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

      {/* Door strip — only mounted when open */}
      {isOpen && <DoorStrip item={item} onClose={() => onToggle?.()} />}
    </li>
  );
}
