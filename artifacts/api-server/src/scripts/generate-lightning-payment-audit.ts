/* eslint-disable no-console -- command-line research report generator */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  normalizeAuditArtist,
  percent,
  validateReviewedPaymentEvidence,
  type ReviewedPaymentEvidence,
  type ValidatedPaymentEvidence,
} from "../lore/lightning-payment-audit.js";

const ROOT = resolve(import.meta.dirname, "../../../../");
const DEFAULT_EVIDENCE = resolve(ROOT, "research/lore-lightning-payment-evidence.json");
const DEFAULT_CANDIDATES = resolve(ROOT, "research/lore-lightning-payment-candidates.json");
const DEFAULT_TOP_ARTIST_REVIEW = resolve(
  ROOT,
  "research/lore-lightning-top-artist-review.json",
);
const DEFAULT_JSON = resolve(ROOT, "reports/lore-lightning-payment-audit.json");
const DEFAULT_MD = resolve(ROOT, "reports/lore-lightning-payment-audit.md");
const TOP_ARTIST_COHORT_SIZE = 25;

type PopulationRow = {
  playedAt: Date;
  rawArtist: string | null;
  canonicalArtist: string | null;
  artistMbid: string | null;
  stationId: number;
};

type StationRow = {
  id: number;
  slug: string;
  name: string;
  homepageUrl: string | null;
  donateUrl: string | null;
  active: boolean;
  hidden: boolean;
  streamUrl: string;
  spinCount: number;
};

type TopArtistReview = {
  schemaVersion: number;
  reviewedAt: string;
  cohortSize: number;
  selectionRule: string;
  reviews: Array<{
    canonicalId: string;
    artist: string;
    snapshotSpins: number;
    reviewedAt: string;
    outcome:
      | "verified_destination"
      | "unresolved_name_only"
      | "unresolved_ownership_conflict"
      | "unresolved_no_verified_destination";
    musicBrainzUrl: string;
    officialUrlsChecked: string[];
    wavlakeUrl: string;
    nostrProfileIndexUrl: string;
    reason: string;
  }>;
};

function arg(name: string, fallback: string): string {
  const value = process.argv.slice(2).find((item) => item.startsWith(`--${name}=`));
  return resolve(value?.slice(name.length + 3) ?? fallback);
}

async function readEvidence(path: string): Promise<ReviewedPaymentEvidence[]> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (!Array.isArray(parsed)) throw new Error("evidence must be a JSON array");
    return parsed as ReviewedPaymentEvidence[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function main(): Promise<void> {
  const evidencePath = arg("evidence", DEFAULT_EVIDENCE);
  const jsonPath = arg("json", DEFAULT_JSON);
  const markdownPath = arg("markdown", DEFAULT_MD);
  const candidatesPath = arg("candidates", DEFAULT_CANDIDATES);
  const topArtistReviewPath = arg("top-artist-review", DEFAULT_TOP_ARTIST_REVIEW);
  const generatedAt = new Date();
  const boundsResult = await db.execute(sql`
    SELECT min(played_at) AS "historyStart", max(played_at) AS "historyEnd"
    FROM spins
  `);
  const spinResult = await db.execute(sql`
    SELECT s.played_at AS "playedAt", s.raw_artist AS "rawArtist",
      r.artist AS "canonicalArtist", r.artist_mbid AS "artistMbid",
      s.station_id AS "stationId"
    FROM spins s LEFT JOIN recordings r ON r.mbid = s.mbid
    ORDER BY s.id
  `);
  const stationResult = await db.execute(sql`
    SELECT st.id, st.slug, st.name, st.homepage_url AS "homepageUrl",
      st.donate_url AS "donateUrl", st.active, st.hidden, st.stream_url AS "streamUrl",
      count(sp.id)::int AS "spinCount"
    FROM stations st LEFT JOIN spins sp ON sp.station_id = st.id
    GROUP BY st.id ORDER BY st.id
  `);
  const spins = spinResult.rows as PopulationRow[];
  const stations = stationResult.rows as StationRow[];
  const bounds = boundsResult.rows[0] as {
    historyStart: Date | string | null;
    historyEnd: Date | string | null;
  };

  const normalizedArtists = new Map<string, number>();
  const canonicalArtists = new Map<string, { name: string; spins: number }>();
  for (const spin of spins) {
    const name = spin.canonicalArtist || spin.rawArtist;
    const normalized = normalizeAuditArtist(name);
    if (normalized) normalizedArtists.set(normalized, (normalizedArtists.get(normalized) ?? 0) + 1);
    if (spin.artistMbid) {
      const current = canonicalArtists.get(spin.artistMbid);
      canonicalArtists.set(spin.artistMbid, {
        name: spin.canonicalArtist || spin.rawArtist || spin.artistMbid,
        spins: (current?.spins ?? 0) + 1,
      });
    }
  }

  const accepted: ValidatedPaymentEvidence[] = [];
  const rejected: Array<{ row: ReviewedPaymentEvidence; reason: string }> = [];
  for (const row of await readEvidence(evidencePath)) {
    const result = validateReviewedPaymentEvidence(row, generatedAt);
    if (result.evidence) accepted.push(result.evidence);
    else rejected.push({ row, reason: result.reason ?? "unknown" });
  }
  const discovered = JSON.parse(await readFile(candidatesPath, "utf8")) as {
    wavlakeCatalogFetchedAt: string;
    candidates: Array<{ status: string }>;
    stationPages: {
      examined: number;
      directCandidates: unknown[];
      unresolvedMentions: unknown[];
      unreachableCount: number;
    };
  };
  const reviewedTopArtists = JSON.parse(
    await readFile(topArtistReviewPath, "utf8"),
  ) as TopArtistReview;
  const topArtistCohort = [...canonicalArtists.entries()]
    .map(([canonicalId, row]) => ({ canonicalId, artist: row.name, spins: row.spins }))
    .sort(
      (a, b) =>
        b.spins - a.spins ||
        (a.canonicalId < b.canonicalId ? -1 : a.canonicalId > b.canonicalId ? 1 : 0),
    )
    .slice(0, TOP_ARTIST_COHORT_SIZE);
  const topArtistReviewById = new Map(
    reviewedTopArtists.reviews.map((row) => [row.canonicalId, row]),
  );
  const topArtistReview = topArtistCohort.map((artist) => {
    const review = topArtistReviewById.get(artist.canonicalId);
    if (
      !review ||
      review.snapshotSpins !== artist.spins ||
      review.artist !== artist.artist
    ) {
      return {
        ...artist,
        outcome: "not_reviewed" as const,
        reviewedAt: null,
        reason: "The deterministic snapshot row has no matching reviewed record.",
      };
    }
    return {
      ...artist,
      outcome: review.outcome,
      reviewedAt: review.reviewedAt,
      reason: review.reason,
      musicBrainzUrl: review.musicBrainzUrl,
      officialUrlsChecked: review.officialUrlsChecked,
      wavlakeUrl: review.wavlakeUrl,
      nostrProfileIndexUrl: review.nostrProfileIndexUrl,
    };
  });
  const artistEvidence = accepted.filter((row) =>
    row.subjectKind === "artist" && row.canonicalId && canonicalArtists.has(row.canonicalId));
  const stationBySlug = new Map(stations.map((station) => [station.slug, station]));
  const stationEvidence = accepted.filter((row) =>
    row.subjectKind === "station" && row.canonicalId && stationBySlug.has(row.canonicalId));
  const paidArtistIds = new Set(artistEvidence.map((row) => row.canonicalId!));
  const paidArtistSpins = [...paidArtistIds].reduce(
    (sum, id) => sum + (canonicalArtists.get(id)?.spins ?? 0), 0,
  );
  const eligibleStations = stations.filter((station) =>
    station.active && !station.hidden && Boolean(station.streamUrl.trim()));
  const spinActiveStations = eligibleStations.filter((station) => station.spinCount > 0);
  const paidStationSlugs = new Set(stationEvidence.map((row) => row.canonicalId!));
  const fiatOnly = eligibleStations.filter((station) =>
    Boolean(station.donateUrl) && !paidStationSlugs.has(station.slug));
  const mechanismCounts = (rows: ValidatedPaymentEvidence[]) =>
    Object.fromEntries(["lightning_address", "lnurl_pay", "nostr_zap", "other_lightning"]
      .map((kind) => [kind, rows.filter((row) => row.mechanism === kind).length]));

  const report = {
    schemaVersion: 1,
    generatedAt: generatedAt.toISOString(),
    population: {
      historyStart: bounds.historyStart ?? null,
      historyEnd: bounds.historyEnd ?? null,
      totalSpins: spins.length,
      distinctNormalizedArtists: normalizedArtists.size,
      distinctMusicBrainzArtists: canonicalArtists.size,
      musicBrainzIdentifiedSpins: [...canonicalArtists.values()].reduce((n, row) => n + row.spins, 0),
      catalogStations: eligibleStations.length,
      spinActiveCatalogStations: spinActiveStations.length,
      catalogRule: "active=true, hidden=false, non-empty stream_url",
    },
    artistCoverage: {
      verifiedRecipients: paidArtistIds.size,
      distinctCanonicalPercent: percent(paidArtistIds.size, canonicalArtists.size),
      distinctNormalizedPercent: percent(paidArtistIds.size, normalizedArtists.size),
      verifiedRecipientSpins: paidArtistSpins,
      spinWeightedPercent: percent(paidArtistSpins, spins.length),
      byMechanism: mechanismCounts(artistEvidence),
      byConfidence: {
        verified_canonical: artistEvidence.filter((row) => row.confidence === "verified_canonical").length,
        verified_official: artistEvidence.filter((row) => row.confidence === "verified_official").length,
        verified_catalog_recording: artistEvidence.filter(
          (row) => row.confidence === "verified_catalog_recording",
        ).length,
      },
    },
    stationCoverage: {
      verifiedCatalogRecipients: paidStationSlugs.size,
      catalogPercent: percent(paidStationSlugs.size, eligibleStations.length),
      verifiedSpinActiveRecipients: spinActiveStations.filter((row) => paidStationSlugs.has(row.slug)).length,
      spinActivePercent: percent(
        spinActiveStations.filter((row) => paidStationSlugs.has(row.slug)).length,
        spinActiveStations.length,
      ),
      fiatOnlyDonationRoutes: fiatOnly.length,
      noPaymentEvidence: eligibleStations.length - paidStationSlugs.size - fiatOnly.length,
      byMechanism: mechanismCounts(stationEvidence),
    },
    evidence: accepted,
    rejectedEvidence: rejected,
    topArtistReview: {
      cohortSize: TOP_ARTIST_COHORT_SIZE,
      selectionRule:
        "Top 25 MusicBrainz-identified artists by snapshot spin count, ordered by spin count descending then artist MBID ascending.",
      ledgerReviewedAt: reviewedTopArtists.reviewedAt,
      reviewedRows: topArtistReview.filter((row) => row.outcome !== "not_reviewed").length,
      verifiedDestinations: topArtistReview.filter(
        (row) => row.outcome === "verified_destination",
      ).length,
      unresolvedRows: topArtistReview.filter((row) =>
        row.outcome.startsWith("unresolved_")).length,
      rows: topArtistReview,
    },
    discovery: {
      reviewedEvidenceRows: accepted.length + rejected.length,
      wavlakeCatalogTracks: 22_886,
      wavlakeCatalogFetchedAt: discovered.wavlakeCatalogFetchedAt,
      crossCatalogCandidates: discovered.candidates.length,
      verifiedCrossCatalogCandidates: discovered.candidates.filter(
        (row) => row.status === "verified_catalog_recording",
      ).length,
      conflictingCrossCatalogCandidates: discovered.candidates.filter(
        (row) => row.status === "conflicting_identity",
      ).length,
      singleRecordingCandidates: discovered.candidates.filter(
        (row) => row.status === "single_recording_candidate",
      ).length,
      stationPagesExamined: discovered.stationPages.examined,
      stationPagesUnreachable: discovered.stationPages.unreachableCount,
      sources: [
        "Lore canonical MusicBrainz recording and artist identities",
        "complete public Wavlake track catalog",
        "configured official station homepages and support pages",
        "top-spin artist MusicBrainz URL relations, official sites, Wavlake, and public Nostr profiles",
      ],
      limitation:
        "Public-index and web discovery was conservative and non-exhaustive; a candidate counted only after reviewed identity linkage was added to the evidence ledger.",
    },
    controls: [
      "Artist positives require a canonical MusicBrainz artist ID present in the snapshot.",
      "Station positives require an exact Lore station slug present in the eligible catalog.",
      "Evidence and identity links must be credential-free HTTPS URLs.",
      "Destinations must match the declared Lightning/Nostr mechanism.",
      "Bandcamp, merch, generic donation pages, search snippets, and name-only matches never count.",
      "A Nostr npub/profile alone is identity evidence, not a payment destination; NIP-57 still requires LNURL-pay metadata via lud16 or a zap tag.",
      "No payment or invoice request is sent by this audit.",
    ],
  };
  const md = `# Lore Lightning payment reach audit

Generated ${report.generatedAt}. Reproduce with \`pnpm --filter @workspace/api-server run audit:lightning-payments\`.

## Snapshot

- History: ${report.population.historyStart ?? "n/a"} through ${report.population.historyEnd ?? "n/a"}
- Spins: ${report.population.totalSpins.toLocaleString()}
- Distinct normalized artist names: ${report.population.distinctNormalizedArtists.toLocaleString()}
- MusicBrainz-identified artists: ${report.population.distinctMusicBrainzArtists.toLocaleString()} (${report.population.musicBrainzIdentifiedSpins.toLocaleString()} spins)
- Eligible stations examined: ${report.population.catalogStations} (${report.population.spinActiveCatalogStations} with spins)

## Results

Artists: **${report.artistCoverage.verifiedRecipients} verified recipients**; ${report.artistCoverage.distinctCanonicalPercent}% of canonical artists, ${report.artistCoverage.distinctNormalizedPercent}% of normalized artists, and ${report.artistCoverage.spinWeightedPercent}% of all spins. Mechanisms: ${JSON.stringify(report.artistCoverage.byMechanism)}.

Stations: **${report.stationCoverage.verifiedCatalogRecipients} verified recipients**; ${report.stationCoverage.catalogPercent}% catalog-wide and ${report.stationCoverage.spinActivePercent}% among spin-active stations. ${report.stationCoverage.fiatOnlyDonationRoutes} eligible stations have an existing fiat-only donation route; ${report.stationCoverage.noPaymentEvidence} have no accepted payment evidence.

## Interpretation and limitations

This is a conservative reach audit, not a claim that recipients without a match lack Lightning. Raw artist-name-only identities are measurable but deliberately unsearchable for positive matching. Search results, social-profile names, custodial pages with unclear ownership, generic donation pages, and commercial stores are not proof. A Nostr profile alone also does not prove payment reach: NIP-57 requires an LNURL-pay endpoint derived from a \`lud16\` Lightning address or an event \`zap\` tag; zap support additionally requires the endpoint to return \`allowsNostr: true\` and a valid \`nostrPubkey\`. The reviewed evidence ledger is finite and timestamped, so coverage is a lower bound and becomes stale.

Candidate discovery crawled all ${report.discovery.wavlakeCatalogTracks.toLocaleString()} public Wavlake tracks available at ${report.discovery.wavlakeCatalogFetchedAt} and crossmatched exact normalized artist/title plus compatible duration against canonical Lore recordings. It found ${report.discovery.crossCatalogCandidates} artist candidates: ${report.discovery.verifiedCrossCatalogCandidates} verified, ${report.discovery.conflictingCrossCatalogCandidates} with conflicting ownership evidence, and ${report.discovery.singleRecordingCandidates} supported by only one recording or lacking a usable Nostr recipient key. The station pass examined ${report.discovery.stationPagesExamined} configured official/support pages; ${report.discovery.stationPagesUnreachable} could not be fetched under the audit's HTTPS, DNS-pinning, redirect, timeout, and size controls. A public-index name match, shared recipient key, or single recording without an official/canonical backlink remained unresolved and did not enter the positive ledger. Full candidate reasons are in \`research/lore-lightning-payment-candidates.json\`.

## Deterministic top-artist review

The audit reviewed the top ${report.topArtistReview.cohortSize} canonical artists by spin count, with artist MBID ascending as the stable tie-breaker. ${report.topArtistReview.reviewedRows} rows have matching timestamped reviews; ${report.topArtistReview.verifiedDestinations} produced a verified destination and ${report.topArtistReview.unresolvedRows} remain unresolved. MusicBrainz URL relations, linked official sites, Wavlake, and public Nostr profiles were checked. Name-only matches and unclear ownership were retained as unresolved rather than counted.

${report.topArtistReview.rows.map((row) => `- ${row.artist} (${row.spins.toLocaleString()} spins; ${row.canonicalId}) — ${row.outcome}; ${row.reason}`).join("\n")}

## Safest integration boundary

Do not add a general payment button from these results alone. If Lore proceeds, keep a server-side, canonical-recipient registry keyed by artist MBID or station slug. Store mechanism, destination, identity evidence, provenance, verification status, and expiry separately. Revalidate Lightning-address/LNURL metadata and Nostr payment fields off the request path, never infer ownership from display names, and show the recipient plus evidence freshness before the listener confirms a handoff to their own wallet. Lore should not custody funds, create invoices, split payments, or silently choose among conflicting destinations.

## Accepted evidence

${accepted.length ? accepted.map((row) => `- ${row.recipient} — ${row.mechanism}; ${row.confidence}; verified ${row.verifiedAt}; [payment evidence](${row.evidenceUrl}); [identity evidence](${row.identityEvidenceUrl})`).join("\n") : "_No reviewed candidate passed every identity and destination gate._"}

## False-positive controls

${report.controls.map((control) => `- ${control}`).join("\n")}
`;
  await mkdir(resolve(jsonPath, ".."), { recursive: true });
  await mkdir(resolve(markdownPath, ".."), { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(markdownPath, md);
  console.info(`Wrote ${jsonPath} and ${markdownPath}`);
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});