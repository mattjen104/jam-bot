import type { DialSpin, DialStation } from "../hooks/useDialData";
import { crossingScopeDetail } from "./crossingScope";
import { resolvePlaybackSource } from "../hooks/radioPlaybackSources";
import { stationCurationSentence } from "./stationDisplayMetadata";

export interface DemoEvidenceArtist {
  name: string;
  artistMbid: string | null;
}

export interface DemoStationEvidence {
  kind: "crossings" | "current-set" | "recent-play" | "mission" | "none";
  lead: string;
  artists: DemoEvidenceArtist[];
  canOpenCrossings: boolean;
  rank: number;
  liveContext?: string | null;
}

const MISSION_STATIONS = new Map<string, number>([
  ["wwoz", 1],
  ["wfmu", 2],
  ["dublab", 3],
  ["the-lot-radio", 4],
  ["worldwide-fm", 5],
  ["xray-fm", 6],
  ["wxyc", 7],
  ["wruw", 8],
  ["kuvo", 9],
  ["amazing-radio", 10],
  ["glacer-fm", 11],
  ["radio-k", 12],
  ["fbi-radio", 13],
  ["cjlo", 14],
  ["soho-radio", 15],
  ["voices-radio", 16],
  ["kool-fm", 17],
]);

export function missionStationDefinition(station: DialStation) {
  const definition = MISSION_STATIONS.get(station.station.slug);
  if (!definition) return null;
  const playable = resolvePlaybackSource(station.station) !== null;
  // Membership in this explicit roster is the editorial review. Longtail is
  // an ingest tier, not a judgement about whether a station has a mission.
  const editorial = station.station.automationClass !== "automated";
  return playable && editorial
    ? { order: definition, sentence: stationCurationSentence(station.station) }
    : null;
}

export function missionStationOrder(station: DialStation): number {
  return missionStationDefinition(station)?.order ?? Number.POSITIVE_INFINITY;
}

function verifiedLiveContext(station: DialStation): string | null {
  const show = station.shows.find((item) => item.state === "live");
  if (!show) return null;
  const programme = show.showName?.trim();
  const dj = show.djName?.trim();
  if (programme && dj) return `${programme} · ${dj}`;
  return programme || dj || null;
}

export function missionStationEvidence(station: DialStation): DemoStationEvidence | null {
  const definition = missionStationDefinition(station);
  if (!definition) return null;
  return {
    kind: "mission",
    lead: definition.sentence,
    artists: [],
    canOpenCrossings: false,
    rank: 1,
    liveContext: verifiedLiveContext(station),
  };
}

export function normalizeDemoArtist(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .toLocaleLowerCase();
}

function validArtist(spin: DialSpin | null | undefined): spin is DialSpin {
  return Boolean(
    spin
    && !spin.resolving
    && spin.freshness !== "stale"
    && spin.artistMbid
    && normalizeDemoArtist(spin.artist),
  );
}

export function currentSetArtists(station: DialStation): DemoEvidenceArtist[] {
  const liveShow = station.shows.find((show) => show.state === "live") ?? null;
  if (!liveShow) return [];
  const candidates = [...liveShow.spins];
  if (station.liveTrack) candidates.push(station.liveTrack);
  candidates.sort((a, b) => Date.parse(b.playedAt) - Date.parse(a.playedAt));
  const seen = new Set<string>();
  const artists: DemoEvidenceArtist[] = [];
  for (const spin of candidates) {
    if (!validArtist(spin)) continue;
    const key = spin.artistMbid || normalizeDemoArtist(spin.artist);
    if (seen.has(key)) continue;
    seen.add(key);
    artists.push({ name: spin.artist.trim(), artistMbid: spin.artistMbid });
    if (artists.length === 3) break;
  }
  return artists;
}

function focusMatches(
  artist: DemoEvidenceArtist,
  focusedArtist: string,
  focusedArtistMbid?: string | null,
): boolean {
  if (focusedArtistMbid && artist.artistMbid) return artist.artistMbid === focusedArtistMbid;
  return normalizeDemoArtist(artist.name) === normalizeDemoArtist(focusedArtist);
}

function recentFocusedArtist(
  station: DialStation,
  focusedArtist: string,
  focusedArtistMbid?: string | null,
): DemoEvidenceArtist | null {
  const candidates = station.shows
    .flatMap((show) => show.spins)
    .sort((a, b) => Date.parse(b.playedAt) - Date.parse(a.playedAt));
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  for (const spin of candidates) {
    if (!validArtist(spin) || Date.parse(spin.playedAt) < cutoff) continue;
    const artist = { name: spin.artist.trim(), artistMbid: spin.artistMbid };
    if (focusMatches(artist, focusedArtist, focusedArtistMbid)) return artist;
  }
  return null;
}

export function focusedArtistWeeklyCrossingCount(
  station: DialStation,
  focusedArtist: string,
  focusedArtistMbid?: string | null,
): number {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return station.shows
    .flatMap((show) => show.spins)
    .filter((spin) => {
      if (
        (!spin.isLibraryHit && !spin.isArtistHit)
        || !validArtist(spin)
        || Date.parse(spin.playedAt) < cutoff
      ) return false;
      return focusMatches(
        { name: spin.artist, artistMbid: spin.artistMbid },
        focusedArtist,
        focusedArtistMbid,
      );
    })
    .length;
}

export function demoStationEvidence(
  station: DialStation,
  hasPersonalTaste: boolean,
  focusedArtist?: string | null,
  focusedArtistMbid?: string | null,
): DemoStationEvidence {
  const weekly = crossingScopeDetail(station, "7d");
  const current = currentSetArtists(station);

  if (focusedArtist) {
    const focused = current.find((artist) =>
      focusMatches(artist, focusedArtist, focusedArtistMbid));
    const focusedCrossingCount = focusedArtistWeeklyCrossingCount(
      station,
      focusedArtist,
      focusedArtistMbid,
    );
    const personal = focusedCrossingCount > 0 || weekly.artists.some((name) =>
      normalizeDemoArtist(name) === normalizeDemoArtist(focusedArtist));
    const recent = recentFocusedArtist(station, focusedArtist, focusedArtistMbid);
    const artist = focused
      ?? recent
      ?? { name: focusedArtist, artistMbid: focusedArtistMbid ?? null };
    if (hasPersonalTaste && personal) {
      return {
        kind: "crossings",
        lead: focusedCrossingCount > 0
          ? `${focusedCrossingCount} ${focusedCrossingCount === 1 ? "crossing" : "crossings"} this week`
          : "Crossing this week",
        artists: [artist],
        canOpenCrossings: true,
        rank: 3,
      };
    }
    if (focused) {
      return {
        kind: "current-set",
        lead: "This set",
        artists: [artist],
        canOpenCrossings: false,
        rank: 2,
      };
    }
    if (recent) {
      return {
        kind: "recent-play",
        lead: "Played this week",
        artists: [artist],
        canOpenCrossings: false,
        rank: 1,
      };
    }
    return { kind: "none", lead: "", artists: [], canOpenCrossings: false, rank: 0 };
  }

  if (hasPersonalTaste && weekly.count > 0) {
    return {
      kind: "crossings",
      lead: `${weekly.count} ${weekly.count === 1 ? "crossing" : "crossings"} this week`,
      artists: weekly.artists.map((name) => ({ name, artistMbid: null })),
      canOpenCrossings: true,
      rank: 3,
    };
  }
  if (current.length > 0) {
    return {
      kind: "current-set",
      lead: "This set",
      artists: current,
      canOpenCrossings: false,
      rank: 2,
    };
  }
  return { kind: "none", lead: "", artists: [], canOpenCrossings: false, rank: 0 };
}