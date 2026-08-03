import {
  db,
  embedLinkTable,
  embedResolutionMetricsTable,
  embedResolutionQueueTable,
  recordingsTable,
  spinsTable,
  type EmbedLink,
  type EmbedResolutionQueueJob,
} from "@workspace/db";
import { and, asc, eq, lte, or, sql } from "drizzle-orm";
import {
  fetchRecordingEmbedRelationships,
  type RecordingEmbedRelationships,
} from "@workspace/song-enrichment";

export type { EmbedLink, EmbedResolutionQueueJob };

export const EMBED_PROVIDERS = ["bandcamp", "youtube"] as const;
export type EmbedProvider = (typeof EMBED_PROVIDERS)[number];

export const EMBED_ROLES = ["provenance", "control"] as const;
export type EmbedRole = (typeof EMBED_ROLES)[number];

export const EMBED_OUTCOMES = [
  "embedded",
  "link_out",
  "no_link",
  "expired",
  "transient_failure",
] as const;
export type EmbedOutcome = (typeof EMBED_OUTCOMES)[number];

export const EMBED_CONFIDENCES = ["exact", "gated", "none"] as const;
export type EmbedConfidence = (typeof EMBED_CONFIDENCES)[number];

export const EMBED_RESOLUTION_METHODS = [
  "mb-url-rel",
  "page-extract",
  "yt-search",
  "cache",
] as const;
export type EmbedResolutionMethod = (typeof EMBED_RESOLUTION_METHODS)[number];

/** Ladder values are deliberately numeric so lower values are stronger. */
export type EmbedRung = 1 | 2 | 3 | 4 | 5 | 6;

export const EMBED_TTL_MS = {
  bandcamp: 90 * 24 * 60 * 60 * 1000,
  youtube: 14 * 24 * 60 * 60 * 1000,
  durableMiss: 30 * 24 * 60 * 60 * 1000,
  transientFailure: 7 * 24 * 60 * 60 * 1000,
} as const;

export type EmbedResolutionInput = {
  recordingMbid: string;
  provider: EmbedProvider;
  role: EmbedRole;
  rung: EmbedRung;
  outcome: EmbedOutcome;
  releaseMbid?: string | null;
  providerReleaseId?: string | null;
  providerTrackId?: string | null;
  sourceUrl?: string | null;
  resolvedVia: EmbedResolutionMethod;
  confidence: EmbedConfidence;
  reason: string;
  fetchedAt?: Date;
  expiresAt?: Date;
};

export type EmbedResolutionState = EmbedLink & {
  /** Effective state after applying TTL to a persisted positive result. */
  effectiveOutcome: EmbedOutcome;
};

function assertInput(input: EmbedResolutionInput): void {
  if (!input.recordingMbid.trim()) throw new Error("recordingMbid is required");
  if (!EMBED_PROVIDERS.includes(input.provider))
    throw new Error("invalid embed provider");
  if (!EMBED_ROLES.includes(input.role)) throw new Error("invalid embed role");
  if (input.rung < 1 || input.rung > 6)
    throw new Error("embed rung must be 1 through 6");
  if (!input.reason.trim()) throw new Error("embed reason is required");
  if (input.outcome === "embedded" && input.rung > 4) {
    throw new Error("embedded results must be on rung 1 through 4");
  }
  if (input.outcome === "link_out" && input.rung !== 5) {
    throw new Error("link-out results must be rung 5");
  }
  if (input.outcome === "no_link" && input.rung !== 6) {
    throw new Error("no-link results must be rung 6");
  }
}

function ttlFor(
  input: Pick<EmbedResolutionInput, "provider" | "outcome">,
): number {
  if (input.outcome === "transient_failure")
    return EMBED_TTL_MS.transientFailure;
  if (input.outcome === "no_link") return EMBED_TTL_MS.durableMiss;
  return EMBED_TTL_MS[input.provider];
}

export function embedExpiresAt(
  input: Pick<EmbedResolutionInput, "provider" | "outcome">,
  fetchedAt = new Date(),
): Date {
  return new Date(fetchedAt.getTime() + ttlFor(input));
}

export function isEmbedResolutionExpired(
  row: Pick<EmbedLink, "expiresAt">,
  now = new Date(),
): boolean {
  return row.expiresAt.getTime() <= now.getTime();
}

/**
 * Apply TTL without erasing the stored facts. Expiry is a state transition for
 * callers, not a reason to pretend the provider never resolved.
 */
export function effectiveEmbedOutcome(
  row: Pick<EmbedLink, "outcome" | "expiresAt">,
  now = new Date(),
): EmbedOutcome {
  if (
    (row.outcome === "embedded" || row.outcome === "link_out") &&
    isEmbedResolutionExpired(row, now)
  ) {
    return "expired";
  }
  return row.outcome as EmbedOutcome;
}

export function embedIdentity(
  input: Pick<EmbedResolutionInput, "recordingMbid" | "provider" | "role">,
): string {
  return `${input.recordingMbid}\u001f${input.provider}\u001f${input.role}`;
}

function confidenceRank(confidence: string): number {
  return confidence === "exact" ? 3 : confidence === "gated" ? 2 : 1;
}

function isPositive(outcome: string): boolean {
  return outcome === "embedded" || outcome === "link_out";
}

/**
 * Persist one provider/role decision without allowing a weaker result or a
 * transient outage to erase a still-valid stronger result.
 */
export async function upsertEmbedResolution(
  input: EmbedResolutionInput,
): Promise<EmbedLink> {
  assertInput(input);
  const fetchedAt = input.fetchedAt ?? new Date();
  const expiresAt = input.expiresAt ?? embedExpiresAt(input, fetchedAt);
  const identity = embedIdentity(input);

  return db.transaction(async (tx) => {
    // Serialize writers for this identity before reading it. This closes the
    // read-then-write race where a weaker concurrent result could otherwise
    // observe the same stale row and overwrite a stronger result.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${identity}))`);
    const [existing] = await tx
      .select()
      .from(embedLinkTable)
      .where(
        and(
          eq(embedLinkTable.recordingMbid, input.recordingMbid),
          eq(embedLinkTable.provider, input.provider),
          eq(embedLinkTable.role, input.role),
        ),
      )
      .limit(1)
      .for("update");

    if (existing) {
      const existingOutcome = effectiveEmbedOutcome(existing, fetchedAt);
      const existingIsFresh = !isEmbedResolutionExpired(existing, fetchedAt);
      const incomingWouldDowngrade =
        isPositive(existingOutcome) &&
        (!isPositive(input.outcome) ||
          existing.rung < input.rung ||
          (existing.rung === input.rung &&
            confidenceRank(existing.confidence) >
              confidenceRank(input.confidence)));

      if (existingIsFresh && incomingWouldDowngrade) {
        return existing;
      }

      const releaseChanged =
        existing.releaseMbid != null &&
        input.releaseMbid != null &&
        existing.releaseMbid !== input.releaseMbid;
      const [updated] = await tx
        .update(embedLinkTable)
        .set({
          rung: input.rung,
          outcome: input.outcome,
          releaseMbid: input.releaseMbid ?? null,
          providerReleaseId: input.providerReleaseId ?? null,
          providerTrackId: input.providerTrackId ?? null,
          sourceUrl: input.sourceUrl ?? null,
          resolvedVia: input.resolvedVia,
          confidence: input.confidence,
          reason: input.reason,
          ...(releaseChanged
            ? {
                previousReleaseMbid: existing.releaseMbid,
                releaseChangedAt: fetchedAt,
              }
            : {}),
          fetchedAt,
          expiresAt,
          updatedAt: fetchedAt,
        })
        .where(eq(embedLinkTable.id, existing.id))
        .returning();
      if (!updated)
        throw new Error(`embed resolution update lost: ${identity}`);
      return updated;
    }

    const [created] = await tx
      .insert(embedLinkTable)
      .values({
        recordingMbid: input.recordingMbid,
        provider: input.provider,
        role: input.role,
        rung: input.rung,
        outcome: input.outcome,
        releaseMbid: input.releaseMbid ?? null,
        providerReleaseId: input.providerReleaseId ?? null,
        providerTrackId: input.providerTrackId ?? null,
        sourceUrl: input.sourceUrl ?? null,
        resolvedVia: input.resolvedVia,
        confidence: input.confidence,
        reason: input.reason,
        fetchedAt,
        expiresAt,
        updatedAt: fetchedAt,
      })
      .returning();
    if (!created)
      throw new Error(`embed resolution insert failed: ${identity}`);
    return created;
  });
}

export async function getEmbedResolution(
  recordingMbid: string,
  provider: EmbedProvider,
  role: EmbedRole,
): Promise<EmbedResolutionState | null> {
  const [row] = await db
    .select()
    .from(embedLinkTable)
    .where(
      and(
        eq(embedLinkTable.recordingMbid, recordingMbid),
        eq(embedLinkTable.provider, provider),
        eq(embedLinkTable.role, role),
      ),
    )
    .limit(1);
  return row ? { ...row, effectiveOutcome: effectiveEmbedOutcome(row) } : null;
}

export async function listEmbedResolutions(
  recordingMbid: string,
): Promise<EmbedResolutionState[]> {
  const rows = await db
    .select()
    .from(embedLinkTable)
    .where(eq(embedLinkTable.recordingMbid, recordingMbid))
    .orderBy(asc(embedLinkTable.provider), asc(embedLinkTable.role));
  return rows.map((row) => ({
    ...row,
    effectiveOutcome: effectiveEmbedOutcome(row),
  }));
}

/** Make expiry explicit when a scheduler has observed an expired row. */
export async function markEmbedResolutionExpired(
  recordingMbid: string,
  provider: EmbedProvider,
  role: EmbedRole,
  now = new Date(),
): Promise<EmbedLink | null> {
  const [row] = await db
    .update(embedLinkTable)
    .set({ outcome: "expired", reason: "ttl_elapsed", updatedAt: now })
    .where(
      and(
        eq(embedLinkTable.recordingMbid, recordingMbid),
        eq(embedLinkTable.provider, provider),
        eq(embedLinkTable.role, role),
        lte(embedLinkTable.expiresAt, now),
      ),
    )
    .returning();
  return row ?? null;
}

// ---- Provider seams and pure provider adapters ---------------------------

export type BandcampTrack = {
  id?: string;
  title: string;
  position?: number;
};

export type BandcampReleasePage = {
  url: string;
  albumId?: string;
  title?: string;
  tracks: BandcampTrack[];
};

/** Pure: normalize provider/display text for matching, not for persistence. */
export function normalizeEmbedText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/\b(feat|ft|with)\.?\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function safeHttpsUrl(value: string, hosts: RegExp): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && hosts.test(url.hostname) ? url : null;
  } catch {
    return null;
  }
}

/** Pure: parse supported Bandcamp player/JSON-LD metadata without prose. */
export function parseBandcampReleasePage(
  html: string,
  sourceUrl: string,
): BandcampReleasePage | null {
  const safe = safeHttpsUrl(sourceUrl, /(^|\.)bandcamp\.com$/i);
  if (!safe) return null;
  const tracks: BandcampTrack[] = [];
  let albumId: string | undefined;
  let title: string | undefined;

  const addTrack = (raw: unknown): void => {
    if (!raw || typeof raw !== "object") return;
    const item = raw as Record<string, unknown>;
    const name =
      (typeof item.title === "string" && item.title.trim()) ||
      (typeof item.track_title === "string" && item.track_title.trim());
    if (!name) return;
    const id =
      typeof item.track_id === "string" || typeof item.track_id === "number"
        ? String(item.track_id)
        : typeof item.id === "string" || typeof item.id === "number"
          ? String(item.id)
          : undefined;
    const position =
      typeof item.track_num === "number"
        ? item.track_num
        : typeof item.position === "number"
          ? item.position
          : undefined;
    tracks.push({ title: name, ...(id ? { id } : {}), ...(position != null ? { position } : {}) });
  };

  // Bandcamp's embed payload has varied slightly over time. Only parse known
  // identifiers and track titles; never retain the surrounding provider prose.
  for (const match of html.matchAll(/data-tralbum=(["'])([\s\S]*?)\1/gi)) {
    try {
      const payload = JSON.parse(match[2]!.replace(/&quot;/g, '"')) as Record<string, unknown>;
      if (payload.id != null) albumId = String(payload.id);
      if (typeof payload.album_title === "string") title = payload.album_title.trim();
      if (Array.isArray(payload.trackinfo)) payload.trackinfo.forEach(addTrack);
    } catch {
      // Continue to the other supported metadata form.
    }
  }
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const payload = JSON.parse(match[1]!.trim()) as Record<string, unknown>;
      if (!title && typeof payload.name === "string") title = payload.name.trim();
      const album = payload["@type"] === "MusicAlbum" ? payload : null;
      if (album && Array.isArray(album.track)) album.track.forEach(addTrack);
      if (album?.producer && typeof album.producer === "object") {
        // Presence of JSON-LD confirms a supported page; no third-party prose
        // is copied into the database.
      }
    } catch {
      // Invalid JSON-LD is not a provider failure.
    }
  }
  for (const match of html.matchAll(/["'](?:track_id|trackId)["']\s*:\s*["']?(\d+)["']?[\s\S]{0,240}?["'](?:title|track_title)["']\s*:\s*["']([^"']+)["']/gi)) {
    addTrack({ id: match[1], title: match[2] });
  }
  const deduped = new Map<string, BandcampTrack>();
  for (const track of tracks) {
    const key = track.id ?? `${normalizeEmbedText(track.title)}|${track.position ?? ""}`;
    const existing = deduped.get(key);
    if (!existing || (existing.position == null && track.position != null)) {
      deduped.set(key, track);
    }
  }
  return {
    url: safe.toString(),
    ...(albumId ? { albumId } : {}),
    ...(title ? { title } : {}),
    tracks: [...deduped.values()],
  };
}

export type YouTubeVideo = {
  id: string;
  title: string;
  channelTitle?: string;
  durationMs?: number;
  url: string;
};

/** Pure: normalize YouTube search API or adapter results into safe metadata. */
export function parseYouTubeSearch(body: unknown): YouTubeVideo[] {
  const raw = Array.isArray(body)
    ? body
    : (body as { items?: unknown[] })?.items ?? [];
  const out: YouTubeVideo[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const value = item as Record<string, unknown>;
    const id =
      typeof value.id === "string"
        ? value.id
        : typeof (value.id as Record<string, unknown> | undefined)?.videoId === "string"
          ? String((value.id as Record<string, unknown>).videoId)
          : undefined;
    const snippet = (value.snippet ?? value) as Record<string, unknown>;
    const title = typeof snippet.title === "string" ? snippet.title.trim() : "";
    if (!id || !title || !/^[A-Za-z0-9_-]{6,}$/.test(id)) continue;
    const duration = value.durationMs ?? value.duration_ms;
    const durationMs =
      typeof duration === "number" && Number.isFinite(duration) ? duration : undefined;
    out.push({
      id,
      title,
      ...(typeof snippet.channelTitle === "string" ? { channelTitle: snippet.channelTitle.trim() } : {}),
      ...(durationMs != null ? { durationMs } : {}),
      url: `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`,
    });
  }
  return out;
}

export interface EmbedProviderClients {
  fetchBandcampPage(url: string): Promise<string>;
  searchYouTube?(
    artist: string,
    title: string,
  ): Promise<YouTubeVideo[]>;
}

const BANDCAMP_PAGE_GAP_MS = 2_000;
const BANDCAMP_TIMEOUT_MS = 12_000;
const MAX_ATTEMPTS = 3;
let providerClients: EmbedProviderClients = {
  async fetchBandcampPage(url) {
    const res = await fetch(url, {
      redirect: "error",
      headers: { Accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(BANDCAMP_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Bandcamp ${res.status}`);
    return res.text();
  },
};
let bandcampChain: Promise<unknown> = Promise.resolve();

/** Install test/host network boundaries without changing resolution policy. */
export function configureEmbedProviderClients(
  clients: Partial<EmbedProviderClients>,
): () => void {
  const previous = providerClients;
  providerClients = { ...providerClients, ...clients };
  return () => {
    providerClients = previous;
  };
}

function serializedBandcampPage(url: string): Promise<string> {
  const run = bandcampChain.then(async () => {
    await new Promise((resolve) => setTimeout(resolve, BANDCAMP_PAGE_GAP_MS));
    return providerClients.fetchBandcampPage(url);
  });
  bandcampChain = run.catch(() => undefined);
  return run;
}

export type EmbedResolutionDecision = EmbedResolutionInput & {
  stationId?: number | null;
  genreCluster?: string | null;
};

type ReleaseChoice = RecordingEmbedRelationships["releases"][number];

/** Pure, stable release choice. A supplied release wins, then primary-like data. */
export function chooseEmbedRelease(
  recording: RecordingEmbedRelationships,
  preferredReleaseMbid?: string | null,
): ReleaseChoice | null {
  const releases = recording.releases.filter((release) => release.mbid.trim());
  if (!releases.length) return null;
  const preferred = preferredReleaseMbid && releases.find((r) => r.mbid === preferredReleaseMbid);
  if (preferred) return preferred;
  return [...releases].sort((a, b) => {
    const status = (b.status === "Official" ? 1 : 0) - (a.status === "Official" ? 1 : 0);
    if (status) return status;
    const date = (a.date ?? "9999").localeCompare(b.date ?? "9999");
    if (date) return date;
    return a.mbid.localeCompare(b.mbid);
  })[0] ?? null;
}

function matchBandcampTrack(
  recording: RecordingEmbedRelationships,
  release: ReleaseChoice,
  page: BandcampReleasePage,
): BandcampTrack | null {
  const mbTrack = (release.media ?? []).flatMap((medium) =>
    medium.tracks.filter((track) => track.recordingId === recording.recordingId),
  )[0];
  if (mbTrack?.position != null) {
    const byPosition = page.tracks.filter((track) => track.position === mbTrack.position);
    if (byPosition.length === 1) return byPosition[0]!;
  }
  const title = normalizeEmbedText(recording.title ?? "");
  const byTitle = page.tracks.filter((track) => normalizeEmbedText(track.title) === title);
  return byTitle.length === 1 ? byTitle[0]! : null;
}

function youtubeDirectUrl(url: string): string | null {
  const safe = safeHttpsUrl(url, /(^|\.)youtube\.com$|(^|\.)youtu\.be$/i);
  if (!safe) return null;
  const id = safe.hostname === "youtu.be"
    ? safe.pathname.slice(1)
    : safe.searchParams.get("v");
  return id && /^[A-Za-z0-9_-]{6,}$/.test(id)
    ? `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`
    : null;
}

function isTopicOrOfficial(video: YouTubeVideo): boolean {
  return /(^|\s)(-\s*)?topic\b/i.test(video.channelTitle ?? "") ||
    /\b(vevo|official distributor|official audio|official music video)\b/i.test(video.channelTitle ?? "") ||
    /\b(official audio|official music video)\b/i.test(video.title);
}

export function gateYouTubeSearch(
  recording: Pick<RecordingEmbedRelationships, "title" | "artist" | "durationMs">,
  videos: YouTubeVideo[],
): YouTubeVideo | null {
  const title = normalizeEmbedText(recording.title ?? "");
  const artist = normalizeEmbedText(recording.artist ?? "");
  const topic = videos.find((video) =>
    isTopicOrOfficial(video) && normalizeEmbedText(video.title).includes(title),
  );
  if (topic) return topic;
  return videos.find((video) => {
    const normalized = normalizeEmbedText(video.title);
    const titleMatch = normalized.includes(title);
    const artistMatch = artist.length > 0 && normalized.includes(artist);
    const durationMatch =
      recording.durationMs != null &&
      video.durationMs != null &&
      Math.abs(recording.durationMs - video.durationMs) <= 5_000;
    return titleMatch && artistMatch && durationMatch;
  }) ?? null;
}

type QueueRequest = {
  recordingMbid: string;
  provider?: EmbedProvider;
  role?: EmbedRole;
  priority?: number;
  stationId?: number | null;
  genreCluster?: string | null;
  expiresAt?: Date | null;
};

const queueActive = new Set<number>();
let queueStarted = false;
let queueTimer: ReturnType<typeof setTimeout> | undefined;
const QUEUE_BATCH_SIZE = 4;
const QUEUE_TICK_MS = 15_000;
const QUEUE_RETRY_BASE_MS = 60_000;
const QUEUE_RETRY_MAX_MS = 6 * 60 * 60 * 1000;

function weekStart(date: Date): Date {
  const value = new Date(date);
  value.setUTCHours(0, 0, 0, 0);
  const day = value.getUTCDay();
  value.setUTCDate(value.getUTCDate() - (day === 0 ? 6 : day - 1));
  return value;
}

async function recordEmbedMetric(
  job: Pick<EmbedResolutionQueueJob, "stationId" | "genreCluster" | "provider" | "role">,
  decision: Pick<EmbedResolutionInput, "rung" | "outcome">,
  fetchedAt: Date,
): Promise<void> {
  const start = weekStart(fetchedAt);
  const stationId = job.stationId ?? 0;
  const genreCluster = job.genreCluster?.trim() || "unknown";
  await db.insert(embedResolutionMetricsTable).values({
    stationId,
    genreCluster,
    weekStart: start,
    provider: job.provider,
    role: job.role,
    rung: decision.rung,
    outcome: decision.outcome,
    count: 1,
    updatedAt: fetchedAt,
  }).onConflictDoUpdate({
    target: [
      embedResolutionMetricsTable.stationId,
      embedResolutionMetricsTable.genreCluster,
      embedResolutionMetricsTable.weekStart,
      embedResolutionMetricsTable.provider,
      embedResolutionMetricsTable.role,
      embedResolutionMetricsTable.rung,
      embedResolutionMetricsTable.outcome,
    ],
    set: {
      count: sql`${embedResolutionMetricsTable.count} + 1`,
      updatedAt: fetchedAt,
    },
  });
}

async function recordingContext(mbid: string): Promise<{
  title: string;
  artist: string;
  durationMs: number | null;
  genres: string[] | null;
  latestStationId: number | null;
} | null> {
  const [recording] = await db
    .select({
      title: recordingsTable.title,
      artist: recordingsTable.artist,
      durationMs: recordingsTable.durationMs,
      genres: recordingsTable.genres,
    })
    .from(recordingsTable)
    .where(eq(recordingsTable.mbid, mbid))
    .limit(1);
  if (!recording) return null;
  const [spin] = await db
    .select({ stationId: spinsTable.stationId })
    .from(spinsTable)
    .where(eq(spinsTable.mbid, mbid))
    .orderBy(sql`${spinsTable.playedAt} DESC`)
    .limit(1);
  return { ...recording, latestStationId: spin?.stationId ?? null };
}

function providerUrl(
  relationships: RecordingEmbedRelationships,
  provider: EmbedProvider,
): string | null {
  const match = relationships.urls.find((relationship) => {
    try {
      const host = new URL(relationship.url).hostname;
      if (provider === "bandcamp") {
        return /(^|\.)bandcamp\.com$/i.test(host);
      }
      return /(^|\.)youtube\.com$/i.test(host) || /(^|\.)youtu\.be$/i.test(host);
    } catch {
      return false;
    }
  });
  return match?.url ?? null;
}

function bandcampUrlForRelease(
  relationships: RecordingEmbedRelationships,
  releaseMbid: string,
): string | null {
  const related = relationships.urls.find(
    (relationship) =>
      relationship.releaseMbid === releaseMbid &&
      safeHttpsUrl(relationship.url, /(^|\.)bandcamp\.com$/i),
  );
  return related?.url ?? providerUrl(relationships, "bandcamp");
}

async function resolveBandcamp(
  job: EmbedResolutionQueueJob,
  context: NonNullable<Awaited<ReturnType<typeof recordingContext>>>,
  relationships: RecordingEmbedRelationships,
): Promise<EmbedResolutionInput> {
  const url = providerUrl(relationships, "bandcamp");
  if (!url) {
    return {
      recordingMbid: job.recordingMbid, provider: "bandcamp", role: job.role as EmbedRole,
      rung: 6, outcome: "no_link", resolvedVia: "cache", confidence: "none",
      reason: "no-trusted-bandcamp-relationship",
    };
  }
  const release = chooseEmbedRelease(relationships);
  if (!release) {
    return {
      recordingMbid: job.recordingMbid, provider: "bandcamp", role: job.role as EmbedRole,
      rung: 5, outcome: "link_out", sourceUrl: url, resolvedVia: "mb-url-rel",
      confidence: "exact", reason: "bandcamp-release-not-present",
    };
  }
  const releaseUrl = bandcampUrlForRelease(relationships, release.mbid) ?? url;
  const page = parseBandcampReleasePage(
    await serializedBandcampPage(releaseUrl),
    releaseUrl,
  );
  if (!page) {
    return {
      recordingMbid: job.recordingMbid, provider: "bandcamp", role: job.role as EmbedRole,
      rung: 5, outcome: "link_out", releaseMbid: release.mbid,
      providerReleaseId: releaseUrl, sourceUrl: releaseUrl, resolvedVia: "mb-url-rel",
      confidence: "exact", reason: "bandcamp-page-had-no-supported-metadata",
    };
  }
  const track = matchBandcampTrack(relationships, release, page);
  if (track) {
    return {
      recordingMbid: job.recordingMbid, provider: "bandcamp", role: job.role as EmbedRole,
      rung: 1, outcome: "embedded", releaseMbid: release.mbid,
      providerReleaseId: page.albumId ?? releaseUrl, providerTrackId: track.id,
      sourceUrl: releaseUrl, resolvedVia: "page-extract", confidence: "exact",
      reason: "bandcamp-track-position-or-title-match",
    };
  }
  return {
    recordingMbid: job.recordingMbid, provider: "bandcamp", role: job.role as EmbedRole,
    rung: 5, outcome: "link_out", releaseMbid: release.mbid,
    providerReleaseId: page.albumId ?? releaseUrl, sourceUrl: releaseUrl,
    resolvedVia: "page-extract", confidence: "exact",
    reason: context.title ? "bandcamp-track-match-ambiguous" : "bandcamp-album-only",
  };
}

async function resolveYouTube(
  job: EmbedResolutionQueueJob,
  context: NonNullable<Awaited<ReturnType<typeof recordingContext>>>,
  relationships: RecordingEmbedRelationships,
): Promise<EmbedResolutionInput> {
  const direct = relationships.urls
    .map((relationship) => youtubeDirectUrl(relationship.url))
    .find(Boolean);
  if (direct) {
    const directId = new URL(direct).searchParams.get("v");
    return {
      recordingMbid: job.recordingMbid, provider: "youtube", role: job.role as EmbedRole,
      rung: 1, outcome: "embedded", providerTrackId: directId ?? undefined,
      sourceUrl: direct, resolvedVia: "mb-url-rel", confidence: "exact",
      reason: "trusted-youtube-stream-relationship",
    };
  }
  if (process.env.EMBED_YOUTUBE_SEARCH_ENABLED === "false" || !providerClients.searchYouTube) {
    return {
      recordingMbid: job.recordingMbid, provider: "youtube", role: job.role as EmbedRole,
      rung: 6, outcome: "no_link", resolvedVia: "cache", confidence: "none",
      reason: "youtube-search-not-permitted",
    };
  }
  const videos = await providerClients.searchYouTube(context.artist, context.title);
  const selected = gateYouTubeSearch({
    title: context.title,
    artist: context.artist,
    durationMs: context.durationMs ?? undefined,
  }, videos);
  if (!selected) {
    return {
      recordingMbid: job.recordingMbid, provider: "youtube", role: job.role as EmbedRole,
      rung: 6, outcome: "no_link", resolvedVia: "yt-search", confidence: "none",
      reason: "youtube-search-gates-rejected-all-results",
    };
  }
  const gated = isTopicOrOfficial(selected);
  return {
    recordingMbid: job.recordingMbid, provider: "youtube", role: job.role as EmbedRole,
    rung: gated ? 3 : 4, outcome: "embedded", providerTrackId: selected.id,
    sourceUrl: selected.url, resolvedVia: "yt-search", confidence: "gated",
    reason: gated ? "youtube-topic-or-official-distributor" : "youtube-title-artist-duration-gate",
  };
}

async function resolveQueueJob(job: EmbedResolutionQueueJob): Promise<void> {
  const context = await recordingContext(job.recordingMbid);
  if (!context) throw new Error("recording-not-found");
  const relationships = await fetchRecordingEmbedRelationships(job.recordingMbid);
  if (!relationships) throw new Error("musicbrainz-relationship-fetch-failed");
  const decision = job.provider === "bandcamp"
    ? await resolveBandcamp(job, context, relationships)
    : await resolveYouTube(job, context, relationships);
  const fetchedAt = new Date();
  await upsertEmbedResolution({ ...decision, fetchedAt });
  await recordEmbedMetric(job, decision, fetchedAt);
}

/** Queue a provider/role demand. Safe for ingest and request paths to fire-and-forget. */
export async function enqueueEmbedResolution(request: QueueRequest): Promise<EmbedResolutionQueueJob | null> {
  const recordingMbid = request.recordingMbid.trim();
  if (!recordingMbid) return null;
  const provider = request.provider ?? "bandcamp";
  const role = request.role ?? (provider === "youtube" ? "control" : "provenance");
  const existingEmbed = await getEmbedResolution(recordingMbid, provider, role);
  if (existingEmbed && !isEmbedResolutionExpired(existingEmbed, new Date()) &&
      existingEmbed.outcome !== "transient_failure") return null;
  const values = {
    recordingMbid, provider, role,
    priority: request.priority ?? 50,
    stationId: request.stationId ?? undefined,
    genreCluster: request.genreCluster ?? undefined,
    expiresAt: request.expiresAt ?? null,
    status: "pending",
    nextAttemptAt: new Date(),
    updatedAt: new Date(),
  } as const;
  const [job] = await db
    .insert(embedResolutionQueueTable)
    .values(values)
    .onConflictDoUpdate({
      target: [
        embedResolutionQueueTable.recordingMbid,
        embedResolutionQueueTable.provider,
        embedResolutionQueueTable.role,
      ],
      set: {
        status: "pending",
        priority: sql`least(${embedResolutionQueueTable.priority}, ${values.priority})`,
        nextAttemptAt: new Date(),
        ...(values.stationId != null ? { stationId: values.stationId } : {}),
        ...(values.genreCluster != null ? { genreCluster: values.genreCluster } : {}),
        updatedAt: new Date(),
      },
    })
    .returning();
  return job ?? null;
}

/** Enqueue both the provenance and control demands for a newly visible recording. */
export async function enqueueRecordingEmbeds(
  recordingMbid: string,
  context: { stationId?: number | null; genreCluster?: string | null; priority?: number } = {},
): Promise<void> {
  await Promise.all([
    enqueueEmbedResolution({ recordingMbid, provider: "bandcamp", role: "provenance", ...context }),
    enqueueEmbedResolution({ recordingMbid, provider: "youtube", role: "control", ...context }),
  ]);
}

async function claimQueueJob(): Promise<EmbedResolutionQueueJob | null> {
  const [job] = await db
    .select()
    .from(embedResolutionQueueTable)
    .where(and(
      or(eq(embedResolutionQueueTable.status, "pending"), eq(embedResolutionQueueTable.status, "retry")),
      lte(embedResolutionQueueTable.nextAttemptAt, new Date()),
    ))
    .orderBy(asc(embedResolutionQueueTable.priority), asc(embedResolutionQueueTable.id))
    .limit(1);
  if (!job || queueActive.has(job.id)) return null;
  const [claimed] = await db
    .update(embedResolutionQueueTable)
    .set({ status: "running", lockedAt: new Date(), attempts: job.attempts + 1, updatedAt: new Date() })
    .where(and(
      eq(embedResolutionQueueTable.id, job.id),
      or(eq(embedResolutionQueueTable.status, "pending"), eq(embedResolutionQueueTable.status, "retry")),
    ))
    .returning();
  return claimed ?? null;
}

async function processEmbedQueue(): Promise<void> {
  for (let i = 0; i < QUEUE_BATCH_SIZE; i++) {
    const job = await claimQueueJob();
    if (!job) return;
    queueActive.add(job.id);
    try {
      await resolveQueueJob(job);
      await db.update(embedResolutionQueueTable)
        .set({ status: "done", lockedAt: null, lastError: null, updatedAt: new Date() })
        .where(eq(embedResolutionQueueTable.id, job.id));
    } catch (error) {
      const attempts = job.attempts;
      const terminal = attempts >= MAX_ATTEMPTS;
      const delay = Math.min(QUEUE_RETRY_MAX_MS, QUEUE_RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1));
      await db.update(embedResolutionQueueTable).set({
        status: terminal ? "done" : "retry",
        lockedAt: null,
        lastError: String(error),
        nextAttemptAt: new Date(Date.now() + delay),
        updatedAt: new Date(),
      }).where(eq(embedResolutionQueueTable.id, job.id));
      if (terminal) {
        const fetchedAt = new Date();
        const decision: EmbedResolutionInput = {
          recordingMbid: job.recordingMbid, provider: job.provider as EmbedProvider,
          role: job.role as EmbedRole, rung: 6, outcome: "transient_failure",
          resolvedVia: "cache", confidence: "none", reason: String(error), fetchedAt,
        };
        await upsertEmbedResolution(decision).catch(() => undefined);
        await recordEmbedMetric(job, decision, fetchedAt).catch(() => undefined);
      }
    } finally {
      queueActive.delete(job.id);
    }
  }
}

/** Resume pending/retry work after a server restart. */
export async function resumeEmbedResolutionJobs(): Promise<void> {
  await db.update(embedResolutionQueueTable)
    .set({ status: "retry", lockedAt: null, updatedAt: new Date() })
    .where(eq(embedResolutionQueueTable.status, "running"));
  await processEmbedQueue();
}

/** Start the bounded, self-rearming queue scheduler. */
export function startEmbedResolutionWorker(): void {
  if (queueStarted) return;
  queueStarted = true;
  const tick = (): void => {
    void processEmbedQueue().finally(() => {
      if (queueStarted) queueTimer = setTimeout(tick, QUEUE_TICK_MS);
    });
  };
  queueTimer = setTimeout(tick, QUEUE_TICK_MS);
}

export function stopEmbedResolutionWorker(): void {
  queueStarted = false;
  if (queueTimer) clearTimeout(queueTimer);
  queueTimer = undefined;
}
