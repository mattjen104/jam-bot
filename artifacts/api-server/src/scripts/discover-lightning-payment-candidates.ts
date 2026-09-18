/* eslint-disable no-console -- command-line research discovery */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  normalizeAuditArtist,
  type ReviewedPaymentEvidence,
} from "../lore/lightning-payment-audit.js";
import { readPinnedHttpsHtml } from "../lore/artist-merch.js";

const ROOT = resolve(import.meta.dirname, "../../../../");
const DEFAULT_CATALOG = "/tmp/wavlake-catalog.json";
const DEFAULT_EVIDENCE = resolve(ROOT, "research/lore-lightning-payment-evidence.json");
const DEFAULT_CANDIDATES = resolve(ROOT, "research/lore-lightning-payment-candidates.json");

type WavlakeTrack = {
  id: string;
  title: string;
  artist: string;
  artistId: string;
  artistNpub?: string | null;
  duration?: number | null;
  url: string;
};

type LoreRecording = {
  artistMbid: string;
  artist: string;
  title: string;
  durationMs: number | null;
  spins: number;
};

type StationPage = {
  slug: string;
  name: string;
  homepageUrl: string | null;
  donateUrl: string | null;
};

const LIGHTNING_ADDRESS_GLOBAL =
  /\b[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+\b/gi;
const LNURL_GLOBAL = /\blnurl1[02-9ac-hj-np-z]{20,}\b/gi;
const NPUB_GLOBAL = /\bnpub1[02-9ac-hj-np-z]{20,}\b/gi;
const LIGHTNING_WORDS = /\b(lightning address|lightning network|lnurl|nostr|zaps?)\b/i;

function lightningAddressesFromHtml(html: string): string[] {
  return [...html.matchAll(LIGHTNING_ADDRESS_GLOBAL)]
    .filter((match) => {
      const start = Math.max(0, (match.index ?? 0) - 160);
      const end = Math.min(html.length, (match.index ?? 0) + match[0].length + 160);
      return LIGHTNING_WORDS.test(html.slice(start, end));
    })
    .map((match) => match[0]);
}

async function mapLimited<T, R>(
  values: T[],
  limit: number,
  fn: (value: T) => Promise<R>,
): Promise<R[]> {
  const output = new Array<R>(values.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (next < values.length) {
      const index = next++;
      output[index] = await fn(values[index]!);
    }
  }));
  return output;
}

function value(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  return resolve(process.argv.slice(2).find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? fallback);
}

function recordingKey(artist: string, title: string): string {
  return `${normalizeAuditArtist(artist)}\u0000${normalizeAuditArtist(title)}`;
}

async function main(): Promise<void> {
  const catalogPath = value("catalog", DEFAULT_CATALOG);
  const evidencePath = value("evidence", DEFAULT_EVIDENCE);
  const candidatesPath = value("candidates", DEFAULT_CANDIDATES);
  const catalog = JSON.parse(await readFile(catalogPath, "utf8")) as {
    fetchedAt: string;
    tracks: WavlakeTrack[];
  };
  const result = await db.execute(sql`
    SELECT r.artist_mbid AS "artistMbid", r.artist, r.title,
      r.duration_ms AS "durationMs", count(s.id)::int AS spins
    FROM recordings r INNER JOIN spins s ON s.mbid = r.mbid
    WHERE r.artist_mbid IS NOT NULL
    GROUP BY r.artist_mbid, r.artist, r.title, r.duration_ms
  `);
  const stationResult = await db.execute(sql`
    SELECT slug, name, homepage_url AS "homepageUrl", donate_url AS "donateUrl"
    FROM stations
    WHERE active = true AND hidden = false AND NULLIF(btrim(stream_url), '') IS NOT NULL
    ORDER BY id
  `);
  const lore = result.rows as LoreRecording[];
  const loreByKey = new Map<string, LoreRecording[]>();
  for (const row of lore) {
    const key = recordingKey(row.artist, row.title);
    loreByKey.set(key, [...(loreByKey.get(key) ?? []), row]);
  }

  const matches = catalog.tracks.flatMap((track) => {
    const possible = loreByKey.get(recordingKey(track.artist, track.title)) ?? [];
    return possible.filter((row) =>
      row.durationMs == null || track.duration == null ||
      Math.abs(row.durationMs - track.duration * 1_000) <= 3_000)
      .map((row) => ({ track, row }));
  });
  const byWavlakeArtist = new Map<string, typeof matches>();
  const artistIdsByNpub = new Map<string, Set<string>>();
  for (const track of catalog.tracks) {
    const npub = track.artistNpub?.trim();
    if (!npub) continue;
    const ids = artistIdsByNpub.get(npub) ?? new Set<string>();
    ids.add(track.artistId);
    artistIdsByNpub.set(npub, ids);
  }
  for (const match of matches) {
    byWavlakeArtist.set(match.track.artistId, [
      ...(byWavlakeArtist.get(match.track.artistId) ?? []),
      match,
    ]);
  }

  const candidates = [...byWavlakeArtist.entries()].map(([artistId, artistMatches]) => {
    const mbids = [...new Set(artistMatches.map((match) => match.row.artistMbid))];
    const trackIds = [...new Set(artistMatches.map((match) => match.track.id))];
    const titles = [...new Set(artistMatches.map((match) => match.track.title))];
    const representative = artistMatches[0]!;
    const npub = representative.track.artistNpub?.trim() ?? "";
    const sharedNpubArtistCount = npub ? (artistIdsByNpub.get(npub)?.size ?? 0) : 0;
    const strong = mbids.length === 1 && trackIds.length >= 2 && Boolean(npub) &&
      sharedNpubArtistCount === 1;
    return {
      artistId,
      artist: representative.track.artist,
      artistNpub: representative.track.artistNpub ?? null,
      sharedNpubArtistCount,
      musicBrainzArtistIds: mbids,
      matchedTrackCount: trackIds.length,
      matchedTitles: titles.sort(),
      loreSpinCount: artistMatches.reduce((sum, match) => sum + match.row.spins, 0),
      evidenceUrls: [...new Set(artistMatches.map((match) => match.track.url))].sort(),
      status: strong
        ? "verified_catalog_recording"
        : mbids.length > 1 || sharedNpubArtistCount > 1
          ? "conflicting_identity"
          : "single_recording_candidate",
      reason: strong
        ? "Unique Wavlake artist ID and Nostr key matched at least two canonical Lore recordings by artist, title, and duration."
        : mbids.length > 1
          ? "One Wavlake artist ID matched more than one MusicBrainz artist identity."
          : sharedNpubArtistCount > 1
            ? `The Wavlake Nostr key is shared by ${sharedNpubArtistCount} artist IDs, so recipient ownership is unclear.`
            : !npub
              ? "The recordings match, but Wavlake exposes no artist Nostr key; recipient ownership and direct payment reach remain unclear."
          : "Only one recording matched; insufficient to rule out a name collision or unauthorized upload.",
    };
  }).sort((a, b) => b.loreSpinCount - a.loreSpinCount || a.artist.localeCompare(b.artist));

  const artistEvidence: ReviewedPaymentEvidence[] = candidates
    .filter((candidate) => candidate.status === "verified_catalog_recording")
    .map((candidate) => ({
      subjectKind: "artist",
      recipient: candidate.artist,
      canonicalId: candidate.musicBrainzArtistIds[0]!,
      mechanism: "other_lightning",
      destination: candidate.evidenceUrls[0]!,
      evidenceUrl: candidate.evidenceUrls[0]!,
      identityEvidenceUrl:
        `https://musicbrainz.org/artist/${candidate.musicBrainzArtistIds[0]}`,
      confidence: "verified_catalog_recording",
      verifiedAt: catalog.fetchedAt,
      provenance:
        `Wavlake public catalog: unique artistId ${candidate.artistId}, artistNpub ${candidate.artistNpub}, ` +
        `${candidate.matchedTrackCount} exact artist/title/duration recording matches`,
    }));
  const stationPages = (stationResult.rows as StationPage[]).flatMap((station) =>
    [...new Set([station.homepageUrl, station.donateUrl].filter(
      (url): url is string => Boolean(url?.startsWith("https://")),
    ))].map((url) => ({ station, url })));
  const stationCandidates = await mapLimited(stationPages, 8, async ({ station, url }) => {
    try {
      const { html } = await readPinnedHttpsHtml(url, { timeoutMs: 8_000 });
      const lightningAddresses = [...new Set(lightningAddressesFromHtml(html))];
      const lnurls = [...new Set(html.match(LNURL_GLOBAL) ?? [])];
      const npubs = [...new Set(html.match(NPUB_GLOBAL) ?? [])];
      return {
        station: station.name,
        slug: station.slug,
        url,
        lightningAddresses,
        lnurls,
        npubs,
        mentionsLightning: LIGHTNING_WORDS.test(html),
        status: lightningAddresses.length || lnurls.length
          ? "direct_candidate"
          : npubs.length || LIGHTNING_WORDS.test(html)
            ? "nostr_or_lightning_mention"
            : "no_evidence",
      };
    } catch (error) {
      return {
        station: station.name,
        slug: station.slug,
        url,
        lightningAddresses: [],
        lnurls: [],
        npubs: [],
        mentionsLightning: false,
        status: "unreachable",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
  const stationEvidence: ReviewedPaymentEvidence[] = stationCandidates.flatMap((candidate) => {
    const destination = candidate.lnurls[0] ?? candidate.lightningAddresses[0];
    if (!destination) return [];
    return [{
      subjectKind: "station",
      recipient: candidate.station,
      canonicalId: candidate.slug,
      mechanism: candidate.lnurls.length ? "lnurl_pay" : "lightning_address",
      destination,
      evidenceUrl: candidate.url,
      identityEvidenceUrl: candidate.url,
      confidence: "verified_official",
      verifiedAt: catalog.fetchedAt,
      provenance: "Direct destination found on the station's configured official homepage or support page.",
    }];
  });
  const evidence = [...artistEvidence, ...stationEvidence];
  await writeFile(candidatesPath, `${JSON.stringify({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    wavlakeCatalogFetchedAt: catalog.fetchedAt,
    method: "exact normalized artist + title; duration within 3 seconds; unique artist ID to MBID; at least two tracks",
    candidates,
    stationPages: {
      examined: stationPages.length,
      directCandidates: stationCandidates.filter((row) => row.status === "direct_candidate"),
      unresolvedMentions: stationCandidates.filter((row) => row.status === "nostr_or_lightning_mention"),
      unreachableCount: stationCandidates.filter((row) => row.status === "unreachable").length,
    },
  }, null, 2)}\n`);
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.info(`Found ${candidates.length} cross-catalog candidate(s); accepted ${evidence.length}.`);
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});