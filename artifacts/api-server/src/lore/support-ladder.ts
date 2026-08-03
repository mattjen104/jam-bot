import {
  and,
  asc,
  desc,
  eq,
} from "drizzle-orm";
import { isIP } from "node:net";
import {
  db,
  embedLinkTable,
  recordingSupportFactsTable,
  recordingsTable,
  spinsTable,
  stationsTable,
  supportHoldsTable,
  type RecordingSupportFact,
} from "@workspace/db";
import { effectiveEmbedOutcome } from "./embed-resolution.js";

export const SUPPORT_KINDS = [
  "artist",
  "bandcamp",
  "label",
  "station",
  "discogs",
] as const;
export type SupportKind = (typeof SUPPORT_KINDS)[number];

export type SupportTier = 1 | 2 | 3 | 4 | 5;
export type PaidTo = "artist" | "artist_and_label" | "label" | "station" | "seller";
export type SupportScope = "release" | "catalog" | "door";

export type SupportLink = {
  kind: SupportKind;
  tier: SupportTier;
  paidTo: PaidTo;
  scope: SupportScope;
  url: string;
  releaseMbid: string | null;
  releaseGroupMbid: string | null;
  providerId: string | null;
  detail: string;
  note: string | null;
  verification: "exact" | "trusted";
  sourceUrl: string | null;
  attribution: string | null;
  fetchedAt: string;
  expiresAt: string | null;
};

export type BandcampFriday = {
  eligible: boolean;
  date: string;
};

export type SupportLadder = {
  mbid: string;
  state: "linkable_release" | "no_linkable_release";
  emptyMessage: string | null;
  links: SupportLink[];
  bandcampFriday: BandcampFriday;
  held: boolean;
  heldForDate: string | null;
};

const BLOCKED_HOSTS = new Set(["localhost", "localhost.localdomain"]);

function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) {
    return false;
  }
  const [a, b] = parts.map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b! >= 16 && b! <= 31) ||
    (a === 192 && b === 168)
  );
}

function isPrivateIpv6(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (isIP(normalized) !== 6) return false;
  const mappedIpv4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb") ||
    (mappedIpv4 != null && isPrivateIpv4(mappedIpv4[1]!))
  );
}

/** Validate a persisted support URL without doing request-time fetching. */
export function isSafeSupportUrl(value: string, kind?: SupportKind): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !host ||
      BLOCKED_HOSTS.has(host) ||
      isPrivateIpv4(host) ||
      isPrivateIpv6(host) ||
      host.endsWith(".localhost") ||
      host.endsWith(".internal") ||
      host.endsWith(".local")
    ) {
      return false;
    }
    if (kind === "bandcamp" && !/(^|\.)bandcamp\.com$/i.test(host)) return false;
    if (kind === "discogs" && !/(^|\.)discogs\.com$/i.test(host)) return false;
    return host.includes(".");
  } catch {
    return false;
  }
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function firstFriday(year: number, month: number): Date {
  const first = new Date(Date.UTC(year, month, 1));
  const offset = (5 - first.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(year, month, 1 + offset));
}

/** Canonical Bandcamp Friday rule: the first Friday of the month in UTC. */
export function bandcampFridayInfo(now = new Date()): BandcampFriday {
  const current = dateOnly(now);
  let candidate = firstFriday(now.getUTCFullYear(), now.getUTCMonth());
  if (dateOnly(candidate) < current) {
    candidate = firstFriday(
      now.getUTCMonth() === 11 ? now.getUTCFullYear() + 1 : now.getUTCFullYear(),
      (now.getUTCMonth() + 1) % 12,
    );
  }
  return { eligible: dateOnly(candidate) === current, date: dateOnly(candidate) };
}

function identityFromFact(fact: RecordingSupportFact): {
  releaseMbid: string | null;
  releaseGroupMbid: string | null;
  providerId: string | null;
} {
  return {
    releaseMbid: fact.releaseMbid ?? null,
    releaseGroupMbid: fact.releaseGroupMbid ?? null,
    providerId: fact.providerId ?? null,
  };
}

function validFreshness(fact: RecordingSupportFact, now: Date): boolean {
  return fact.expiresAt == null || fact.expiresAt.getTime() > now.getTime();
}

function mapFact(
  fact: RecordingSupportFact,
  now: Date,
): SupportLink | null {
  const isDiscogs = fact.kind === "discogs";
  if (
    !["artist_direct", "label", "discogs"].includes(fact.kind) ||
    !["release", "catalog", "door"].includes(fact.scope) ||
    !validFreshness(fact, now) ||
    !isSafeSupportUrl(fact.url, isDiscogs ? "discogs" : undefined)
  ) {
    return null;
  }
  const identity = identityFromFact(fact);
  // A recording-release-group bridge identifies a release group, not a
  // release. Never manufacture a release identity from that bridge.
  const releaseGroupMbid = identity.releaseGroupMbid;
  const supportingFact =
    fact.detail?.trim() ||
    fact.providerId?.trim() ||
    identity.releaseMbid ||
    identity.releaseGroupMbid;
  if (!supportingFact) return null;
  if (
    fact.sourceUrl &&
    !isSafeSupportUrl(fact.sourceUrl, isDiscogs ? "discogs" : undefined)
  ) {
    return null;
  }
  if (isDiscogs && !fact.sourceUrl) return null;
  const kind: SupportKind =
    fact.kind === "artist_direct"
      ? "artist"
      : fact.kind === "label"
        ? "label"
        : "discogs";
  return {
    kind,
    tier: kind === "artist" ? 1 : kind === "label" ? 3 : 5,
    paidTo: kind === "artist" ? "artist" : kind === "label" ? "label" : "seller",
    scope: fact.scope as SupportScope,
    url: new URL(fact.url).toString(),
    releaseMbid: identity.releaseMbid,
    releaseGroupMbid,
    providerId: identity.providerId,
    detail: fact.detail?.trim() || supportingFact,
    note: fact.note ?? (kind === "discogs" ? "Secondhand; artist unpaid." : null),
    verification: fact.verification === "exact" ? "exact" : "trusted",
    sourceUrl: fact.sourceUrl ?? null,
    attribution: kind === "discogs" ? "Data provided by Discogs" : null,
    fetchedAt: fact.fetchedAt.toISOString(),
    expiresAt: fact.expiresAt?.toISOString() ?? null,
  };
}

function sortLinks(links: SupportLink[]): SupportLink[] {
  return links
    .map((link, index) => ({ link, index }))
    .sort((a, b) =>
      a.link.tier - b.link.tier ||
      a.link.kind.localeCompare(b.link.kind) ||
      a.link.url.localeCompare(b.link.url) ||
      a.index - b.index,
    )
    .map(({ link }) => link);
}

export type SupportLadderInput = {
  recordingMbid: string;
  facts: RecordingSupportFact[];
  bandcamp: {
    sourceUrl: string;
    releaseMbid: string | null;
    releaseGroupMbid: string | null;
    providerReleaseId: string | null;
    providerTrackId: string | null;
    fetchedAt: Date;
    expiresAt: Date;
  } | null;
  station: {
    name: string;
    url: string;
    updatedAt: Date;
  } | null;
  now?: Date;
  held?: boolean;
};

/** Pure mapper used by the API and domain tests. */
export function mapSupportLadder(input: SupportLadderInput): SupportLadder {
  const now = input.now ?? new Date();
  const links: SupportLink[] = input.facts
    .map((fact) => mapFact(fact, now))
    .filter((link): link is SupportLink => link != null);

  if (
    input.bandcamp &&
    input.bandcamp.expiresAt.getTime() > now.getTime()
  ) {
    const bandcamp = input.bandcamp;
    if (isSafeSupportUrl(bandcamp.sourceUrl, "bandcamp") &&
        bandcamp.releaseMbid &&
        (bandcamp.providerReleaseId || bandcamp.providerTrackId)) {
      links.push({
        kind: "bandcamp",
        tier: 2,
        paidTo: "artist",
        scope: "release",
        url: new URL(bandcamp.sourceUrl).toString(),
        releaseMbid: bandcamp.releaseMbid,
        releaseGroupMbid: bandcamp.releaseGroupMbid ?? null,
        providerId: bandcamp.providerTrackId ?? bandcamp.providerReleaseId,
        detail: bandcamp.providerTrackId
          ? "Exact Bandcamp track"
          : "Bandcamp release",
        note: "Buy direct from the artist.",
        verification: "exact",
        sourceUrl: bandcamp.sourceUrl,
        attribution: null,
        fetchedAt: bandcamp.fetchedAt.toISOString(),
        expiresAt: bandcamp.expiresAt.toISOString(),
      });
    }
  }

  if (input.station && isSafeSupportUrl(input.station.url)) {
    links.push({
      kind: "station",
      tier: 4,
      paidTo: "station",
      scope: "door",
      url: new URL(input.station.url).toString(),
      releaseMbid: null,
      releaseGroupMbid: null,
      providerId: null,
      detail: `${input.station.name} support`,
      note: "Support the station that aired this recording.",
      verification: "trusted",
      sourceUrl: null,
      attribution: null,
      fetchedAt: input.station.updatedAt.toISOString(),
      expiresAt: null,
    });
  }

  return {
    mbid: input.recordingMbid,
    state: links.length ? "linkable_release" : "no_linkable_release",
    emptyMessage: links.length ? null : "No linkable release found.",
    links: sortLinks(links),
    bandcampFriday: bandcampFridayInfo(now),
    held: input.held ?? false,
    heldForDate: input.held ? bandcampFridayInfo(now).date : null,
  };
}

/** Read a stored station membership pointer without trusting client context. */
function stationMembershipUrl(config: unknown): string | null {
  if (!config || typeof config !== "object" || Array.isArray(config)) return null;
  const value = (config as Record<string, unknown>).membershipUrl;
  return typeof value === "string" ? value : null;
}

export function mapBandcampEmbedSupport(
  row: {
    sourceUrl: string | null;
    releaseMbid: string | null;
    providerReleaseId: string | null;
    providerTrackId: string | null;
    fetchedAt: Date;
    expiresAt: Date;
    outcome: string;
  },
  now = new Date(),
): SupportLadderInput["bandcamp"] {
  const effective = effectiveEmbedOutcome(row, now);
  if (
    effective !== "embedded" &&
    effective !== "link_out"
  ) {
    return null;
  }
  return {
    sourceUrl: row.sourceUrl ?? "",
    releaseMbid: row.releaseMbid,
    releaseGroupMbid: null,
    providerReleaseId: row.providerReleaseId,
    providerTrackId: row.providerTrackId,
    fetchedAt: row.fetchedAt,
    expiresAt: row.expiresAt,
  };
}

export async function loadSupportLadder(
  recordingMbid: string,
  userId?: number,
  now = new Date(),
): Promise<SupportLadder | null> {
  const [recording] = await db
    .select({ mbid: recordingsTable.mbid })
    .from(recordingsTable)
    .where(eq(recordingsTable.mbid, recordingMbid))
    .limit(1);
  const [embed] = await db
    .select()
    .from(embedLinkTable)
    .where(
      and(
        eq(embedLinkTable.recordingMbid, recordingMbid),
        eq(embedLinkTable.provider, "bandcamp"),
        eq(embedLinkTable.role, "provenance"),
      ),
    )
    .limit(1);
  const [spin] = await db
    .select({
      stationName: stationsTable.name,
      donateUrl: stationsTable.donateUrl,
      stationConfig: stationsTable.nowPlayingConfig,
      updatedAt: stationsTable.updatedAt,
    })
    .from(spinsTable)
    .innerJoin(stationsTable, eq(spinsTable.stationId, stationsTable.id))
    .where(eq(spinsTable.mbid, recordingMbid))
    .orderBy(desc(spinsTable.playedAt), desc(spinsTable.id))
    .limit(1);
  const facts = await db
    .select()
    .from(recordingSupportFactsTable)
    .where(eq(recordingSupportFactsTable.recordingMbid, recordingMbid))
    .orderBy(asc(recordingSupportFactsTable.id));
  if (!recording) return null;
  const friday = bandcampFridayInfo(now);
  let held = false;
  if (userId != null) {
    const [hold] = await db
      .select({ id: supportHoldsTable.id })
      .from(supportHoldsTable)
      .where(
        and(
          eq(supportHoldsTable.userId, userId),
          eq(supportHoldsTable.recordingMbid, recordingMbid),
          eq(supportHoldsTable.bandcampFridayDate, friday.date),
        ),
      )
      .limit(1);
    held = hold != null;
  }
  return mapSupportLadder({
    recordingMbid,
    facts,
    bandcamp: embed ? mapBandcampEmbedSupport(embed, now) : null,
    station: spin
      ? {
          name: spin.stationName,
          url: (
            typeof spin.donateUrl === "string" && spin.donateUrl.trim()
              ? spin.donateUrl
              : stationMembershipUrl(spin.stationConfig)
          ) ?? "",
          updatedAt: spin.updatedAt,
        }
      : null,
    now,
    held,
  });
}