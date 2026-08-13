import { useMemo, useState } from "react";

import { liveIdentityKey, type DialStation } from "../hooks/useDialData";
import "./FirstRunSidebar.css";

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

export interface OnboardingArtist {
  name: string;
  /** Artist MBID (not recording MBID). null = artist identity not yet resolved —
   *  hollow-square indicator, never "kept" visually. */
  mbid: string | null;
}

export interface OnboardingBlock {
  slug: string;
  name: string;
  /** Provenance rung: 1 = named selector on air; 2 = live shift, unnameable;
   *  3 = attributed station, no agent claim; 4 = automation. */
  rung: 1 | 2 | 3 | 4;
  pickerName: string | null; // rung 1 only
  showName: string | null;
  location: string | null;
  /** Top artists from the current hour, raw spin order. */
  artists: OnboardingArtist[];
  /** How many more artists aired this hour beyond what's shown. */
  extraCount: number;
  currentArtist: OnboardingArtist | null;
}

// ---------------------------------------------------------------------------
// Derivation helpers
// ---------------------------------------------------------------------------

const ARTISTS_SHOWN = 4; // per spec: "first 3–4 named"
const STATIONS_CAP = 5; // visible before "N more stations on air →"

function stationLocation(
  station: Pick<DialStation["station"], "city" | "country">,
): string | null {
  const parts = [station.city, station.country].filter(Boolean) as string[];
  return parts.length > 0 ? parts.join(", ") : null;
}

function deriveRung(ds: DialStation): 1 | 2 | 3 | 4 {
  // Automation class takes absolute precedence — no schedule data overrides it.
  if (ds.station.automationClass === "automated") return 4;
  const liveShow = ds.shows.find((sh) => sh.state === "live") ?? null;
  // Rung 1: validated single selector — picker ID + exactly one eligible DJ in feed.
  // isPickerShow is the explicit gate; djName alone is insufficient (could be ambiguous
  // or station-level attribution rather than a confirmed human selector).
  if (liveShow?.isPickerShow) return 1;
  // Rung 2: live human shift present, but host not validated as a picker.
  if (liveShow) return 2;
  // Rung 3: attributed station, no current agent claim.
  return 3;
}

function stationArtists(ds: DialStation): OnboardingArtist[] {
  const liveShow = ds.shows.find((sh) => sh.state === "live") ?? null;
  const seen = new Set<string>();
  const result: OnboardingArtist[] = [];

  // Raw spin order, oldest first (chronological broadcast order).
  // Use artistMbid (not recording mbid) for the resolved/unresolved decision:
  // a recording may be unresolved while the artist identity is known, or vice versa.
  for (const spin of liveShow?.spins ?? []) {
    const raw = spin.artist.trim();
    const key = raw.toLowerCase();
    if (!raw || seen.has(key)) continue;
    seen.add(key);
    result.push({ name: raw, mbid: spin.artistMbid });
  }

  // Fallback to the live track when no show spins are loaded yet
  if (result.length === 0 && ds.liveTrack?.artist) {
    const raw = ds.liveTrack.artist.trim();
    if (raw) result.push({ name: raw, mbid: ds.liveTrack.artistMbid });
  }

  return result;
}

/** Pure function: derive ordered station blocks from live DialStation data. */
// eslint-disable-next-line react-refresh/only-export-components
export function buildOnboardingBlocks(stations: DialStation[]): OnboardingBlock[] {
  const liveStations = stations.filter((ds) => ds.isLive);
  type Tagged = OnboardingBlock & { _rung: 1 | 2 | 3 | 4 };
  const blocks: Tagged[] = liveStations.map((ds): Tagged => {
    const rung = deriveRung(ds);
    const liveShow = ds.shows.find((sh) => sh.state === "live") ?? null;
    const allArtists = stationArtists(ds);
    const artists = allArtists.slice(0, ARTISTS_SHOWN);
    const extraCount = Math.max(0, allArtists.length - artists.length);
    return {
      slug: ds.station.slug,
      name: ds.station.name,
      rung,
      pickerName: rung === 1 ? (liveShow?.djName ?? null) : null,
      showName: liveShow?.showName ?? null,
      location: stationLocation(ds.station),
      artists,
      extraCount,
      currentArtist: ds.liveTrack?.artist
        ? { name: ds.liveTrack.artist, mbid: ds.liveTrack.artistMbid }
        : liveShow?.currentTrack?.artist
          ? { name: liveShow.currentTrack.artist, mbid: liveShow.currentTrack.artistMbid }
          : allArtists[allArtists.length - 1] ?? null,
      _rung: rung,
    };
  });

  // Sort by rung ascending; ties keep source-list order (stable on V8)
  blocks.sort((a, b) => a._rung - b._rung);
  return blocks.map(({ _rung: _, ...block }) => block);
}

// ---------------------------------------------------------------------------
// Artist list — "A, B and C" grammar (no Oxford comma, per spec)
// ---------------------------------------------------------------------------

function ArtistList({
  artists,
  seedKeys,
  onKeep,
}: {
  artists: OnboardingArtist[];
  seedKeys: Set<string>;
  onKeep: (name: string) => void;
}) {
  return (
    <>
      {artists.map((a, i) => {
        const isUnresolved = a.mbid == null;
        // Known artists: show kept state from seedKeys.
        // Unknown MBID: hollow square only — never frb__artist--kept, per spec.
        const isKept = !isUnresolved && seedKeys.has(liveIdentityKey(a.name));
        const separator = i === 0 ? null : i === artists.length - 1 ? " and " : ", ";
        // Unresolved artists: plain non-focusable span — no button role, no handlers.
        // Interactive semantics are reserved for resolved artists only.
        if (isUnresolved) {
          return (
            <span key={`${a.name}-${i}`}>
              {separator}
              <span
                className="frb__artist frb__artist--unresolved"
                data-mbid="unknown"
                data-station-artist={a.name}
              >
                {a.name}
              </span>
            </span>
          );
        }

        return (
          <span key={`${a.name}-${i}`}>
            {separator}
            <span
              className={["frb__artist", isKept ? "frb__artist--kept" : ""].join(" ").trim()}
              data-mbid={a.mbid}
              data-station-artist={a.name}
              role="button"
              tabIndex={0}
              aria-pressed={isKept}
              onClick={() => onKeep(a.name)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onKeep(a.name);
                }
              }}
            >
              {a.name}
            </span>
          </span>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Station block — compact identity + attribution
// ---------------------------------------------------------------------------

function StationBlock({
  block,
  seedKeys,
  onKeep,
  onTune,
}: {
  block: OnboardingBlock;
  seedKeys: Set<string>;
  onKeep: (name: string) => void;
  onTune: (slug: string) => void;
}) {
  const rawShow = block.showName?.trim() ?? "";
  const cleanShow = rawShow
    && rawShow.toLowerCase() !== "unknown show"
    && rawShow.toLowerCase() !== "continuous"
    && rawShow.localeCompare(block.name, undefined, { sensitivity: "accent" }) !== 0
    && rawShow.localeCompare(block.pickerName?.trim() ?? "", undefined, { sensitivity: "accent" }) !== 0
    ? rawShow
    : null;
  const pickerName = block.pickerName?.trim() || null;
  const attribution = pickerName ?? cleanShow;
  const currentArtist = block.currentArtist;

  return (
    <div
      className="frb__block"
      data-rung={block.rung}
    >
      <button
        type="button"
        className="frb__tune-target"
        aria-label={`Tune ${block.name}`}
        onClick={() => onTune(block.slug)}
      />
      <div className="frb__sentence">
        <span className="fdrow__compact-identity">
          <span className="fdrow__compact-lead">
            {currentArtist && (
              <>
                <b className="fdrow__compact-crossing-artist">
                  <ArtistList artists={[currentArtist]} seedKeys={seedKeys} onKeep={onKeep} />
                </b>
                <span className="fdrow__compact-separator" aria-hidden="true">·</span>
              </>
            )}
            <span className="fdrow__compact-station">{block.name}</span>
          </span>
        </span>
        {attribution && (
          <div className="fdrow__live-secondary">{attribution}</div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Eyebrow — "On air right now · someone is choosing"
// ---------------------------------------------------------------------------

function SidebarEyebrow() {
  return (
    <div className="frb__eyebrow">
      <span className="frb__eyebrow-pip" aria-hidden="true" />
      <span className="frb__eyebrow-label">On air right now</span>
      <span className="frb__eyebrow-sep" aria-hidden="true">·</span>
      <span className="frb__eyebrow-hint">someone is choosing</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function FirstRunSidebar({
  stations,
  seeds,
  onAddSeed,
  onTune,
}: {
  stations: DialStation[];
  seeds: string[];
  onAddSeed: (artist: string) => void;
  onTune: (slug: string) => void;
}) {
  const blocks = useMemo(() => buildOnboardingBlocks(stations), [stations]);
  const [showAll, setShowAll] = useState(false);

  const seedKeys = useMemo(
    () => new Set(seeds.map((s) => liveIdentityKey(s))),
    [seeds],
  );

  const visible = showAll ? blocks : blocks.slice(0, STATIONS_CAP);
  const hiddenCount = blocks.length - STATIONS_CAP;

  if (blocks.length === 0) {
    return (
      <div className="frb frb--empty reading-context">
        <div className="frb__empty-inner">
          <p className="frb__empty-text">No stations on air right now.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="frb reading-context">
      <SidebarEyebrow />
      <div className="frb__list">
        {visible.map((block) => (
          <StationBlock
            key={block.slug}
            block={block}
            seedKeys={seedKeys}
            onKeep={onAddSeed}
            onTune={onTune}
          />
        ))}
      </div>
      {!showAll && hiddenCount > 0 && (
        <button
          type="button"
          className="frb__more-stations"
          onClick={() => setShowAll(true)}
        >
          {hiddenCount} more station{hiddenCount !== 1 ? "s" : ""} on air →
        </button>
      )}
    </div>
  );
}
