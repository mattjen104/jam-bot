import { db, artistWikidataMetadataCacheTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  fetchArtistWikidataQid,
  type ArtistWikidataRelationStatus,
} from "@workspace/song-enrichment";

export type ArtistMetadataStatus = "success" | "not_found" | "error";

export interface ArtistMetadataLink {
  qid: string;
  url: string;
  label?: string;
}

export interface ArtistWikidataMetadata {
  aliases: string[];
  inceptionDate: string | null;
  formationPlace: ArtistMetadataLink | null;
  officialWebsite: string | null;
  recordLabels: ArtistMetadataLink[];
  groups: ArtistMetadataLink[];
  members: ArtistMetadataLink[];
}

export interface ArtistMetadataResult {
  mbid: string;
  status: ArtistMetadataStatus;
  qid: string | null;
  metadata: ArtistWikidataMetadata | null;
  fetchedAt: string;
  expiresAt: string;
}

const SUCCESS_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const NOT_FOUND_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ERROR_TTL_MS = 60 * 60 * 1000;
const MAX_ENTITY_BYTES = 512 * 1024;
const MAX_ALIASES = 30;
const MAX_RELATIONSHIPS = 20;
const MAX_LABEL_LOOKUPS = 50;

type WikidataClaim = {
  mainsnak?: {
    snaktype?: string;
    datavalue?: { value?: unknown };
  };
};

type WikidataEntity = {
  aliases?: Record<string, Array<{ language?: string; value?: string }>>;
  claims?: Record<string, WikidataClaim[]>;
};

function claimValues(entity: WikidataEntity, property: string): unknown[] {
  return (entity.claims?.[property] ?? [])
    .filter((claim) => claim.mainsnak?.snaktype === "value")
    .map((claim) => claim.mainsnak?.datavalue?.value)
    .filter((value) => value != null);
}

function qidLink(value: unknown): ArtistMetadataLink | null {
  if (typeof value !== "object" || value == null) return null;
  const id = (value as { "entity-type"?: unknown; id?: unknown }).id;
  return typeof id === "string" && /^Q[1-9][0-9]*$/i.test(id)
    ? { qid: id.toUpperCase(), url: `https://www.wikidata.org/wiki/${id.toUpperCase()}` }
    : null;
}

function dedupeLinks(values: unknown[]): ArtistMetadataLink[] {
  const seen = new Set<string>();
  const links: ArtistMetadataLink[] = [];
  for (const value of values) {
    const link = qidLink(value);
    if (!link || seen.has(link.qid)) continue;
    seen.add(link.qid);
    links.push(link);
    if (links.length >= MAX_RELATIONSHIPS) break;
  }
  return links;
}

function relatedLinks(metadata: ArtistWikidataMetadata): ArtistMetadataLink[] {
  return [
    ...(metadata.formationPlace ? [metadata.formationPlace] : []),
    ...metadata.recordLabels,
    ...metadata.groups,
    ...metadata.members,
  ];
}

async function addRelatedLabels(metadata: ArtistWikidataMetadata): Promise<ArtistWikidataMetadata> {
  const qids = Array.from(new Set(relatedLinks(metadata).map((link) => link.qid)))
    .slice(0, MAX_LABEL_LOOKUPS);
  if (qids.length === 0) return metadata;
  try {
    const response = await fetch(
      `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(qids.join("|"))}&props=labels&languages=en&format=json`,
      {
        headers: {
          Accept: "application/json",
          "User-Agent": "Lore artist metadata bridge (https://github.com/lore)",
        },
        signal: AbortSignal.timeout(8_000),
      },
    );
    if (!response.ok) return metadata;
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_ENTITY_BYTES) return metadata;
    const entities = (JSON.parse(text) as {
      entities?: Record<string, { labels?: { en?: { value?: unknown } } }>;
    }).entities ?? {};
    const labels = new Map<string, string>();
    for (const [qid, entity] of Object.entries(entities)) {
      const label = entity.labels?.en?.value;
      if (typeof label === "string" && label.trim()) labels.set(qid, label.trim());
    }
    const labelLink = (link: ArtistMetadataLink | null): ArtistMetadataLink | null =>
      link ? { ...link, ...(labels.get(link.qid) ? { label: labels.get(link.qid) } : {}) } : null;
    return {
      ...metadata,
      formationPlace: labelLink(metadata.formationPlace),
      recordLabels: metadata.recordLabels.map((link) => labelLink(link)!),
      groups: metadata.groups.map((link) => labelLink(link)!),
      members: metadata.members.map((link) => labelLink(link)!),
    };
  } catch {
    return metadata;
  }
}

function parseDate(value: unknown): string | null {
  if (typeof value !== "object" || value == null) return null;
  const time = (value as { time?: unknown }).time;
  if (typeof time !== "string") return null;
  const match = time.match(/^[+-]?(\d{1,6})-(\d{2})-(\d{2})T/);
  return match ? `${match[1].padStart(4, "0")}-${match[2]}-${match[3]}` : null;
}

/** Pure, allow-list mapper for a bounded Special:EntityData response. */
export function mapWikidataArtistEntity(body: unknown): ArtistWikidataMetadata | null {
  const entities = (body as { entities?: Record<string, WikidataEntity> } | null)?.entities;
  const entity = entities ? Object.values(entities)[0] : undefined;
  if (!entity) return null;

  const aliases: string[] = [];
  const seenAliases = new Set<string>();
  for (const languageAliases of Object.values(entity.aliases ?? {})) {
    for (const alias of languageAliases ?? []) {
      const value = alias.value?.trim();
      if (!value || seenAliases.has(value)) continue;
      seenAliases.add(value);
      aliases.push(value);
      if (aliases.length >= MAX_ALIASES) break;
    }
    if (aliases.length >= MAX_ALIASES) break;
  }
  const website = claimValues(entity, "P856")
    .find((value): value is string => typeof value === "string" && /^https?:\/\//i.test(value));

  return {
    aliases,
    // P571 is Wikidata's explicit inception/formation date property.
    inceptionDate: parseDate(claimValues(entity, "P571")[0]),
    // P740 is the explicit location where an organization/group was formed.
    formationPlace: qidLink(claimValues(entity, "P740")[0]),
    officialWebsite: website ?? null,
    recordLabels: dedupeLinks(claimValues(entity, "P264")),
    groups: dedupeLinks(claimValues(entity, "P463")),
    members: dedupeLinks(claimValues(entity, "P527")),
  };
}

async function fetchWikidataEntity(qid: string): Promise<ArtistWikidataMetadata> {
  const response = await fetch(
    `https://www.wikidata.org/wiki/Special:EntityData/${encodeURIComponent(qid)}.json`,
    {
      headers: {
        Accept: "application/json",
        "User-Agent": "Lore artist metadata bridge (https://github.com/lore)",
      },
      signal: AbortSignal.timeout(8_000),
    },
  );
  if (!response.ok) throw new Error(`Wikidata ${response.status}`);
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > MAX_ENTITY_BYTES) throw new Error("Wikidata entity payload too large");
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_ENTITY_BYTES) {
    throw new Error("Wikidata entity payload too large");
  }
  const metadata = mapWikidataArtistEntity(JSON.parse(text));
  if (!metadata) throw new Error("Wikidata entity missing");
  return addRelatedLabels(metadata);
}

export function artistMetadataTtlMs(status: ArtistMetadataStatus): number {
  return status === "success"
    ? SUCCESS_TTL_MS
    : status === "not_found" ? NOT_FOUND_TTL_MS : ERROR_TTL_MS;
}

function result(
  mbid: string,
  status: ArtistMetadataStatus,
  qid: string | null,
  metadata: ArtistWikidataMetadata | null,
  fetchedAt: Date,
  expiresAt: Date,
): ArtistMetadataResult {
  return {
    mbid,
    status,
    qid,
    metadata,
    fetchedAt: fetchedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
}

async function writeCache(
  mbid: string,
  status: ArtistMetadataStatus,
  qid: string | null,
  metadata: ArtistWikidataMetadata | null,
  error: string | null,
  fetchedAt = new Date(),
): Promise<ArtistMetadataResult> {
  const expiresAt = new Date(fetchedAt.getTime() + artistMetadataTtlMs(status));
  try {
    await db.insert(artistWikidataMetadataCacheTable).values({
      artistMbid: mbid,
      wikidataQid: qid,
      status,
      payload: metadata as Record<string, unknown> | null,
      fetchedAt,
      expiresAt,
      lastError: error,
    }).onConflictDoUpdate({
      target: artistWikidataMetadataCacheTable.artistMbid,
      set: {
        wikidataQid: qid,
        status,
        payload: metadata as Record<string, unknown> | null,
        fetchedAt,
        expiresAt,
        lastError: error,
      },
    });
  } catch {
    // A provider result is still useful when a rolling deploy has not run the
    // cache migration yet; the public route remains honest and non-fatal.
  }
  return result(mbid, status, qid, metadata, fetchedAt, expiresAt);
}

export async function getArtistWikidataMetadata(mbidInput: string): Promise<ArtistMetadataResult> {
  const mbid = mbidInput.trim();
  const now = new Date();
  try {
    const [cached] = await db
      .select()
      .from(artistWikidataMetadataCacheTable)
      .where(eq(artistWikidataMetadataCacheTable.artistMbid, mbid))
      .limit(1);
    if (cached && cached.expiresAt.getTime() > now.getTime()) {
      const status: ArtistMetadataStatus =
        cached.status === "success" || cached.status === "not_found" ? cached.status : "error";
      return result(
        mbid,
        status,
        cached.wikidataQid,
        status === "success" ? (cached.payload as ArtistWikidataMetadata | null) : null,
        cached.fetchedAt,
        cached.expiresAt,
      );
    }
  } catch {
    // Continue to the source lookup; persistence is best effort.
  }

  const relation: ArtistWikidataRelationStatus = await fetchArtistWikidataQid(mbid);
  if (relation.status === "error") return writeCache(mbid, "error", null, null, "MusicBrainz unavailable");
  if (relation.status === "not_found") return writeCache(mbid, "not_found", null, null, null);
  try {
    const metadata = await fetchWikidataEntity(relation.qid);
    return writeCache(mbid, "success", relation.qid, metadata, null);
  } catch (error) {
    if (error instanceof Error && error.message === "Wikidata 404") {
      return writeCache(mbid, "not_found", relation.qid, null, null);
    }
    return writeCache(
      mbid,
      "error",
      relation.qid,
      null,
      error instanceof Error ? error.message.slice(0, 200) : "Wikidata unavailable",
    );
  }
}