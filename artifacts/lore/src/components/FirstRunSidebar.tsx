import { useMemo, useState } from "react";
import { Link } from "wouter";

import { liveIdentityKey, type DialSpin, type DialStation } from "../hooks/useDialData";
import { StationChangeCountdown } from "./StationChangeCountdown";
import "./FirstRunSidebar.css";

export interface OnboardingArtist {
  name: string;
  mbid: string | null;
}

export type FirstRunBandId = "broad" | "worlds" | "left-field";

interface EditorialStation {
  slug: string;
  name: string;
  band: FirstRunBandId;
  sentence: string;
}

export interface OnboardingBlock {
  slug: string;
  name: string;
  band: FirstRunBandId;
  sentence: string;
  station: DialStation;
  currentTrack: DialSpin | null;
  recentSet: OnboardingArtist[];
  livePhrase: "just changed" | "about to change" | "on air";
}

// eslint-disable-next-line react-refresh/only-export-components
export const FIRST_RUN_STATIONS: readonly EditorialStation[] = [
  { slug: "kexp", name: "KEXP 90.3 FM", band: "broad", sentence: "Listener-powered independent music from Seattle." },
  { slug: "fip-main", name: "FIP", band: "broad", sentence: "A seamless French mix that travels across genres and eras." },
  { slug: "wfmu", name: "WFMU 91.1 FM", band: "broad", sentence: "Freeform, listener-supported radio from New Jersey." },
  { slug: "kcrw-eclectic24", name: "KCRW — Eclectic 24", band: "broad", sentence: "KCRW’s round-the-clock eclectic music channel." },
  { slug: "bbc-6music", name: "BBC 6 Music", band: "worlds", sentence: "Alternative music, sessions, and deep catalogue from the BBC." },
  { slug: "wwoz", name: "WWOZ 90.7 FM", band: "worlds", sentence: "New Orleans jazz, blues, Latin, Cajun, and funk." },
  { slug: "kutx", name: "KUTX 98.9 FM", band: "worlds", sentence: "Non-commercial music radio from Austin." },
  { slug: "rb-308a9f58-fb54-44dc-b95d-bb40fe4f3631", name: "Radio AlHara", band: "worlds", sentence: "Independent community radio broadcasting from Palestine." },
  { slug: "rb-b58a4aaa-d5be-4925-be71-f69d1cccc13f", name: "KCHUNG Radio", band: "left-field", sentence: "Volunteer-made experimental radio from Los Angeles." },
  { slug: "heady", name: "HEADY", band: "left-field", sentence: "Commercial-free underground music, emerging artists, and deep cuts." },
  { slug: "dublab", name: "Dublab", band: "left-field", sentence: "A Los Angeles non-profit home for adventurous music." },
  { slug: "jamm-fm", name: "JAMM FM", band: "left-field", sentence: "Smooth and funky radio from Amsterdam." },
] as const;

const BANDS: ReadonlyArray<{ id: FirstRunBandId; title: string; note: string }> = [
  { id: "broad", title: "Welcoming, broad doors", note: "Start anywhere." },
  { id: "worlds", title: "Familiar, distinctive worlds", note: "A clear musical point of view." },
  { id: "left-field", title: "Left-field and groove doors", note: "Lore’s stranger corners." },
];

function normalizedName(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function recentArtists(ds: DialStation): OnboardingArtist[] {
  const liveShow = ds.shows.find((show) => show.state === "live");
  const seen = new Set<string>();
  return [...(liveShow?.spins ?? [])]
    .reverse()
    .flatMap((spin) => {
      const key = liveIdentityKey(spin.artist);
      if (!key || seen.has(key)) return [];
      seen.add(key);
      return [{ name: spin.artist, mbid: spin.artistMbid }];
    })
    .slice(0, 5);
}

// eslint-disable-next-line react-refresh/only-export-components
export function firstRunLivePhrase(track: DialSpin | null, now = Date.now()): OnboardingBlock["livePhrase"] {
  if (!track) return "on air";
  const changedAt = Date.parse(track.sourcePlayedAt ?? track.playedAt);
  if (!Number.isFinite(changedAt)) return "on air";
  const age = now - changedAt;
  if (age >= 0 && age < 90_000) return "just changed";
  // This is deliberately an advisory phrase, never a countdown. Long-running
  // tracks may be near a boundary; the catch action verifies against fast-lane
  // duration evidence before it waits.
  if (age >= 3 * 60_000) return "about to change";
  return "on air";
}

/** Exact editorial order, one station per listening identity. */
// eslint-disable-next-line react-refresh/only-export-components
export function buildOnboardingBlocks(stations: DialStation[]): OnboardingBlock[] {
  const bySlug = new Map(stations.map((station) => [station.station.slug, station]));
  const byName = new Map(stations.map((station) => [normalizedName(station.station.name), station]));
  const usedStationIds = new Set<number>();
  return FIRST_RUN_STATIONS.flatMap((entry) => {
    const ds = bySlug.get(entry.slug) ?? byName.get(normalizedName(entry.name));
    if (!ds || usedStationIds.has(ds.station.id)) return [];
    usedStationIds.add(ds.station.id);
    const show = ds.shows.find((candidate) => candidate.state === "live");
    const currentTrack = ds.liveTrack ?? show?.currentTrack ?? null;
    return [{
      slug: ds.station.slug,
      name: entry.name,
      band: entry.band,
      sentence: entry.sentence,
      station: ds,
      currentTrack,
      recentSet: recentArtists(ds),
      livePhrase: firstRunLivePhrase(currentTrack),
    }];
  });
}

function Artist({
  artist,
  seedKeys,
  onKeep,
}: {
  artist: OnboardingArtist;
  seedKeys: Set<string>;
  onKeep: (name: string) => void;
}) {
  if (!artist.mbid) {
    return <span className="frb__artist frb__artist--unresolved" data-mbid="unknown" data-station-artist={artist.name}>{artist.name}</span>;
  }
  const kept = seedKeys.has(liveIdentityKey(artist.name));
  return (
    <span
      className={`frb__artist${kept ? " frb__artist--kept" : ""}`}
      data-mbid={artist.mbid}
      data-station-artist={artist.name}
      role="button"
      tabIndex={0}
      aria-pressed={kept}
      onClick={() => onKeep(artist.name)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onKeep(artist.name);
        }
      }}
    >
      {artist.name}
    </span>
  );
}

function StationBlock({
  block,
  seedKeys,
  onKeep,
  onPlay,
  onCatchNext,
}: {
  block: OnboardingBlock;
  seedKeys: Set<string>;
  onKeep: (name: string) => void;
  onPlay: (station: DialStation) => void;
  onCatchNext: (station: DialStation) => Promise<string>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [catchStatus, setCatchStatus] = useState<string | null>(null);
  const current = block.currentTrack;

  return (
    <article className="frb__block" data-station-slug={block.slug}>
      <div className="frb__station-line">
        <h3 className="frb__station-name">{block.name}</h3>
        <span className="frb__live-phrase">{block.livePhrase}</span>
      </div>
      <p className="frb__identity">{block.sentence}</p>
      <p className="frb__now">
        {current ? (
          <>
            <Artist artist={{ name: current.artist, mbid: current.artistMbid }} seedKeys={seedKeys} onKeep={onKeep} />
            <span aria-hidden="true"> · </span>
            <span>{current.title}</span>
          </>
        ) : (
          <span>Live track details aren’t available yet.</span>
        )}
      </p>
      <div className="frb__actions-bar">
        <button type="button" className="frb__btn-play" onClick={() => onPlay(block.station)} aria-label={`Play ${block.name} now`}>
          <span>Play now</span>
          <StationChangeCountdown track={current} className="frb__countdown" />
        </button>
        {current && (
          <button
            type="button"
            className="frb__btn-catch"
            onClick={() => {
              setCatchStatus("Checking the next boundary…");
              void onCatchNext(block.station).then(setCatchStatus);
            }}
            aria-label={`Catch the next song on ${block.name}`}
          >
            Catch the next song
          </button>
        )}
      </div>
      {catchStatus && <p className="frb__catch-status" role="status">{catchStatus}</p>}
      {block.recentSet.length > 1 && (
        <div className="frb__recent-context">
          <button type="button" className="frb__recent-toggle" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
            {expanded ? "Hide recent set" : "Recent set"}
          </button>
          {expanded && (
            <p className="frb__recent-list">
              {block.recentSet.map((artist, index) => (
                <span key={`${artist.name}-${index}`}>
                  {index > 0 ? index === block.recentSet.length - 1 ? " and " : ", " : ""}
                  <Artist artist={artist} seedKeys={seedKeys} onKeep={onKeep} />
                </span>
              ))}
            </p>
          )}
        </div>
      )}
    </article>
  );
}

export function FirstRunSidebar({
  stations,
  seeds,
  onAddSeed,
  onPlay,
  onCatchNext,
  onTune,
}: {
  stations: DialStation[];
  seeds: string[];
  onAddSeed: (artist: string) => void;
  onPlay?: (station: DialStation) => void;
  onCatchNext?: (station: DialStation) => Promise<string>;
  /** Compatibility bridge for the full /feed first-run placeholder. */
  onTune?: (slug: string) => void;
}) {
  const blocks = useMemo(() => buildOnboardingBlocks(stations), [stations]);
  const seedKeys = useMemo(() => new Set(seeds.map(liveIdentityKey)), [seeds]);
  const [expanded, setExpanded] = useState(false);

  return (
    <section className="frb reading-context" aria-labelledby="first-run-heading">
      <header className="frb__intro">
        <p className="frb__eyebrow"><span className="frb__eyebrow-pip" aria-hidden="true" />Live radio, a few good doors</p>
        <h2 id="first-run-heading">Play something now.</h2>
        <p>Choose by what’s sounding, or wait briefly for a clean start.</p>
      </header>
      {blocks.length === 0 ? (
        <p className="frb__empty-text">The first stations are still coming on air.</p>
      ) : (
        <div className="frb__bands">
          {BANDS.map((band) => {
            const bandBlocks = blocks.filter((block) => block.band === band.id);
            if (bandBlocks.length === 0) return null;
            return (
              <section key={band.id} className="frb__band" data-band={band.id}>
                <header className="frb__band-heading">
                  <h2>{band.title}</h2>
                  <p>{band.note}</p>
                </header>
                <div className="frb__list">
                  {bandBlocks.map((block) => (
                    <StationBlock
                      key={block.slug}
                      block={block}
                      seedKeys={seedKeys}
                      onKeep={onAddSeed}
                      onPlay={onPlay ?? ((station) => onTune?.(station.station.slug))}
                      onCatchNext={onCatchNext ?? (async (station) => {
                        onTune?.(station.station.slug);
                        return "Playing now.";
                      })}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
      <div className="frb__expansion">
        <button type="button" className="frb__more-stations" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
          {expanded ? "Close more stations" : "More stations"}
        </button>
        {expanded && (
          <div className="frb__shelves">
            <Link href="/feed">Electronic and ambient</Link>
            <Link href="/feed">Guitars and left-field</Link>
            <Link href="/feed">Hip-hop, soul, and global</Link>
            <Link href="/feed">Jazz and funk</Link>
            <Link href="/feed">Browse categories</Link>
            <Link href="/index?section=stations">Search stations</Link>
          </div>
        )}
      </div>
    </section>
  );
}