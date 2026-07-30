import { Link } from "wouter";
import type { LibraryItem } from "../lib/meHooks";

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
}

/** §7 byline ladder: picked-by+station → picked-by → heard-on → service import → null */
function Byline({ prov }: { prov: LibraryItem["provenance"] }) {
  if (prov.kind === "keep") {
    // Prefer rich names; fall back to slugs/handles
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

/** A single row in the Library "Kept" list. */
export function LibraryRow({ item, isOnAir = false }: LibraryRowProps) {
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

      {/* Right rail */}
      <div className="lrow__rail">
        <button
          type="button"
          className="lrow__play"
          aria-label={`Play ${title}`}
          onClick={(e) => e.preventDefault()}
        >
          ▶
        </button>
      </div>
    </li>
  );
}
