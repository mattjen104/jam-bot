import {
  db,
  pickersTable,
  picksTable,
  recordingsTable,
  type Picker,
  type InsertPicker,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { resolveToMbid, type MbidResolution } from "./resolve.js";

/**
 * Picker + pick persistence — the generalized, source-agnostic write path that
 * mirrors the spin ingestion helpers in `resolve.ts`. Adapters/workers (label,
 * blog, curator, collector, event) produce `PickInput`s; this module resolves
 * them to the MBID spine and logs them, ALWAYS (even unresolved), so the honesty
 * gradient stays visible and backfill converges later.
 */

/** The set of pick source tags. Kept in sync with the schema's documented set. */
export type PickSource =
  | "spin"
  | "label_release"
  | "blog_post"
  | "curator_list"
  | "discogs_list"
  | "event_lineup"
  | "series_episode"
  | "user_seed";

export type PickerType =
  | "dj"
  | "label"
  | "blog"
  | "curator"
  | "collector"
  | "event"
  | "series";

/** A slug-safe handle from arbitrary text (lowercase, hyphenated). */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export interface UpsertPickerInput {
  pickerType: PickerType;
  name: string;
  /** Explicit handle; derived from name when omitted. */
  handle?: string;
  homeUrl?: string;
  sourceRef?: Record<string, unknown>;
  trustTier?: number;
  description?: string;
}

/**
 * Create or update a picker, idempotent by handle. Mutable metadata (name,
 * home url, source ref, trust, description) is refreshed so a re-seed
 * propagates without clobbering the id — existing picks keep pointing at the
 * same picker. Returns the row. Throws only on a genuinely bad input.
 */
export async function upsertPicker(input: UpsertPickerInput): Promise<Picker> {
  const name = input.name.trim();
  if (!name) throw new Error("picker name is required");
  const handle = (input.handle?.trim() || slugify(name)) || slugify(name);
  if (!handle) throw new Error("could not derive a picker handle");

  const values: InsertPicker = {
    pickerType: input.pickerType,
    name,
    handle,
    homeUrl: input.homeUrl?.trim() || null,
    sourceRef: input.sourceRef ?? null,
    trustTier: input.trustTier ?? defaultTrustTier(input.pickerType),
    description: input.description?.trim() || null,
  };

  const [row] = await db
    .insert(pickersTable)
    .values(values)
    .onConflictDoUpdate({
      target: pickersTable.handle,
      set: {
        pickerType: values.pickerType,
        name: values.name,
        homeUrl: values.homeUrl ?? null,
        // Only clobber sourceRef when the caller actually supplied one —
        // adapters use it as durable sync state (e.g. a completion ledger),
        // which a plain re-seed on boot must not wipe.
        ...(input.sourceRef !== undefined
          ? { sourceRef: values.sourceRef ?? null }
          : {}),
        trustTier: values.trustTier ?? 2,
        description: values.description ?? null,
        updatedAt: sql`now()`,
      },
    })
    .returning();
  return row!;
}

/** Ladder-aligned default trust: label strongest, then blog/curator, then rest. */
export function defaultTrustTier(type: PickerType): number {
  switch (type) {
    case "label":
      return 1;
    case "blog":
    case "curator":
      return 2;
    default:
      return 3;
  }
}

/**
 * Insert a minimal recording node so a pick's FK is valid without paying for the
 * (network) link/artwork enrichment `upsertRecording` does. Never clobbers an
 * existing, richer row — a pick only needs the spine node to exist; links and
 * artwork converge later when the track is spun or enriched.
 */
async function upsertRecordingMinimal(r: {
  mbid: string;
  title: string;
  artist: string;
  artistMbid?: string;
}): Promise<void> {
  await db
    .insert(recordingsTable)
    .values({
      mbid: r.mbid,
      title: r.title,
      artist: r.artist,
      artistMbid: r.artistMbid ?? null,
    })
    .onConflictDoNothing({ target: recordingsTable.mbid });
}

/** One selection to log against a picker. */
export interface PickInput {
  pickerId: number;
  source: PickSource;
  rawArtist: string;
  rawTitle: string;
  /** Link back to the picker's own source (post/release/list/video). */
  sourceUrl?: string;
  context?: string;
  ordinal?: number;
  externalId?: string;
  pickedAt?: Date;
  /** Source-supplied identifiers that strengthen resolution. */
  recordingId?: string;
  isrc?: string;
  /** Known artist MBID (e.g. from a MusicBrainz label lookup). */
  artistMbid?: string;
  durationMs?: number;
}

/**
 * Resolve + log one pick. Returns whether a NEW row was written (the unique
 * (picker, externalId) index makes re-ingest idempotent for sources with a
 * stable id). Never throws — a single bad pick must not abort a batch.
 */
export async function persistPick(
  input: PickInput,
): Promise<{ logged: boolean; resolution: MbidResolution }> {
  const resolution = await resolveToMbid(
    input.rawArtist,
    input.rawTitle,
    input.durationMs,
    {
      ...(input.recordingId ? { recordingId: input.recordingId } : {}),
      ...(input.isrc ? { isrc: input.isrc } : {}),
    },
  );

  const artistMbid = input.artistMbid ?? resolution.artistMbid ?? null;

  try {
    if (resolution.mbid) {
      await upsertRecordingMinimal({
        mbid: resolution.mbid,
        title: resolution.title,
        artist: resolution.artist,
        ...(artistMbid ? { artistMbid } : {}),
      });
    }

    const inserted = await db
      .insert(picksTable)
      .values({
        pickerId: input.pickerId,
        mbid: resolution.mbid,
        artistMbid,
        rawArtist: input.rawArtist,
        rawTitle: input.rawTitle,
        source: input.source,
        context: input.context ?? null,
        sourceUrl: input.sourceUrl ?? null,
        ordinal: input.ordinal ?? null,
        externalId: input.externalId ?? null,
        pickedAt: input.pickedAt ?? null,
        confidence: resolution.confidence,
      })
      .onConflictDoNothing({
        target: [picksTable.pickerId, picksTable.externalId],
      })
      .returning({ id: picksTable.id });

    return { logged: inserted.length > 0, resolution };
  } catch (err) {
    console.error("[lore] persistPick failed", input.pickerId, input.source, err);
    return { logged: false, resolution };
  }
}

/** One entry in an ordered/unordered tracklist supplied by an admin. */
export interface TracklistEntry {
  artist: string;
  title: string;
  recordingId?: string;
  isrc?: string;
  sourceUrl?: string;
  context?: string;
  externalId?: string;
}

/**
 * Log a whole tracklist against a picker — the generic write path behind curator
 * lists and event lineups (admin-supplied). When `ordered` is true (a ranked
 * list, a set-list), each entry gets an incrementing `ordinal` so it forms
 * rideable edges; when false (an unordered bag of recommendations) ordinals are
 * left null and it is ridden as a set. Returns per-entry logged/resolved stats.
 */
export async function logTracklist(args: {
  pickerId: number;
  source: PickSource;
  entries: TracklistEntry[];
  ordered?: boolean;
  /** Fallback link/context for entries that supply none. */
  sourceUrl?: string;
  context?: string;
}): Promise<{ logged: number; resolved: number; total: number }> {
  let logged = 0;
  let resolved = 0;
  let ordinal = 0;
  for (const e of args.entries) {
    const { logged: wrote, resolution } = await persistPick({
      pickerId: args.pickerId,
      source: args.source,
      rawArtist: e.artist,
      rawTitle: e.title,
      ...(e.recordingId ? { recordingId: e.recordingId } : {}),
      ...(e.isrc ? { isrc: e.isrc } : {}),
      sourceUrl: e.sourceUrl ?? args.sourceUrl,
      context: e.context ?? args.context,
      ...(args.ordered ? { ordinal: ordinal++ } : {}),
      externalId: e.externalId,
    });
    if (wrote) logged++;
    if (resolution.mbid) resolved++;
  }
  return { logged, resolved, total: args.entries.length };
}

/** Look up a picker by handle, or null. */
export async function getPickerByHandle(
  handle: string,
): Promise<Picker | null> {
  const [row] = await db
    .select()
    .from(pickersTable)
    .where(eq(pickersTable.handle, handle))
    .limit(1);
  return row ?? null;
}
