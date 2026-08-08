import {
  db,
  importedSetsTable,
  importedSetEntriesTable,
  recordingsTable,
  type ImportedSet,
  type ImportedSetEntry,
} from "@workspace/db";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { resolveToMbid, upsertRecording } from "./resolve.js";
import type { ImportedSetManifest } from "./imported-set-parser.js";

/**
 * Progressive resolution for imported portable sets.
 *
 * Priority ladder (recorded honestly per entry as `resolutionBasis`):
 *   1. lore_mbid / mbid — a claimed recording MBID that already exists on the
 *      local spine. A claimed MBID we have never seen is NOT trusted: a
 *      user-editable file must not be able to plant arbitrary spine rows, so
 *      unknown claims fall through to ISRC/text resolution.
 *   2. isrc — cold MusicBrainz ISRC lookup through the existing serialized
 *      limiter (inside resolveToMbid / song-enrichment).
 *   3. text — scored artist+title search (also serialized), with the
 *      spotify synthetic fallback that the rest of Lore already uses.
 *
 * Isolation: this module writes only imported_set(_entries) and the shared
 * recordings metadata spine (via the same upsertRecording every resolver
 * uses). It never touches spins or any radio-derived analytics.
 */

/** Per-set in-flight guard so double-clicks don't run competing workers. */
const activeSets = new Set<number>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type ImportedResolutionBasis =
  | "lore_mbid"
  | "mbid"
  | "isrc"
  | "text"
  | "spotify";

async function localRecordingExists(mbid: string): Promise<boolean> {
  const [row] = await db
    .select({ mbid: recordingsTable.mbid })
    .from(recordingsTable)
    .where(eq(recordingsTable.mbid, mbid))
    .limit(1);
  return !!row;
}

async function refreshSetCounters(setId: number): Promise<void> {
  const [counts] = await db
    .select({
      resolved: sql<number>`count(*) filter (where ${importedSetEntriesTable.resolutionStatus} = 'resolved')::int`,
      unresolved: sql<number>`count(*) filter (where ${importedSetEntriesTable.resolutionStatus} = 'unresolved')::int`,
      pending: sql<number>`count(*) filter (where ${importedSetEntriesTable.resolutionStatus} = 'pending')::int`,
    })
    .from(importedSetEntriesTable)
    .where(eq(importedSetEntriesTable.setId, setId));
  await db
    .update(importedSetsTable)
    .set({
      resolvedCount: counts?.resolved ?? 0,
      unresolvedCount: counts?.unresolved ?? 0,
      status: (counts?.pending ?? 0) > 0 ? "resolving" : "done",
      updatedAt: new Date(),
    })
    .where(eq(importedSetsTable.id, setId));
}

/** Resolve every pending entry of a set, updating rows incrementally. */
export async function runImportedSetResolution(setId: number): Promise<void> {
  if (activeSets.has(setId)) return;
  activeSets.add(setId);
  try {
    const pending = await db
      .select()
      .from(importedSetEntriesTable)
      .where(
        and(
          eq(importedSetEntriesTable.setId, setId),
          eq(importedSetEntriesTable.resolutionStatus, "pending"),
        ),
      )
      .orderBy(asc(importedSetEntriesTable.position));

    for (const entry of pending) {
      try {
        const outcome = await resolveImportedEntry(entry);
        await db
          .update(importedSetEntriesTable)
          .set({ ...outcome, updatedAt: new Date() })
          .where(eq(importedSetEntriesTable.id, entry.id));
      } catch (err) {
        console.error(`[lore] imported-set entry ${entry.id} resolution failed`, err);
        await db
          .update(importedSetEntriesTable)
          .set({
            resolutionStatus: "unresolved",
            unresolvedReason: "resolver_error",
            updatedAt: new Date(),
          })
          .where(eq(importedSetEntriesTable.id, entry.id));
      }
      // Progressive: counters advance entry by entry so the client can begin
      // playback without waiting for the slowest lookup.
      await refreshSetCounters(setId);
    }
  } finally {
    activeSets.delete(setId);
  }
}

type EntryOutcome = Partial<
  Pick<
    ImportedSetEntry,
    "resolutionStatus" | "resolutionBasis" | "resolvedMbid" | "unresolvedReason"
  >
>;

async function resolveImportedEntry(entry: ImportedSetEntry): Promise<EntryOutcome> {
  // 1. Claimed MBID that is already on the local spine — strongest, free.
  if (entry.claimedMbid && (await localRecordingExists(entry.claimedMbid))) {
    return {
      resolutionStatus: "resolved",
      resolutionBasis: entry.claimedMbidFromLore ? "lore_mbid" : "mbid",
      resolvedMbid: entry.claimedMbid,
      unresolvedReason: null,
    };
  }

  // 2/3. ISRC then title/creator, via the shared serialized resolver.
  const title = entry.title?.trim() ?? "";
  const creator = entry.creator?.trim() ?? "";
  if (!title && !creator && !entry.claimedIsrc) {
    return {
      resolutionStatus: "unresolved",
      unresolvedReason: "no_identifiers",
    };
  }
  const resolution = await resolveToMbid(
    creator,
    title,
    entry.durationMs ?? undefined,
    entry.claimedIsrc ? { isrc: entry.claimedIsrc } : undefined,
  );
  if (!resolution.fromCache) await sleep(1_100); // MB politeness gap
  if (!resolution.mbid) {
    return { resolutionStatus: "unresolved", unresolvedReason: "no_match" };
  }
  await upsertRecording(resolution);
  return {
    resolutionStatus: "resolved",
    resolutionBasis: resolution.confidence as ImportedResolutionBasis,
    resolvedMbid: resolution.mbid,
    unresolvedReason: null,
  };
}

// ---------------------------------------------------------------------------
// Persistence + read models
// ---------------------------------------------------------------------------

export async function createImportedSet(
  userId: number,
  manifest: ImportedSetManifest,
  sourceFilename: string,
): Promise<ImportedSet> {
  const [set] = await db
    .insert(importedSetsTable)
    .values({
      userId,
      name: manifest.title ?? sourceFilename,
      sourceFilename,
      format: manifest.format,
      trackCount: manifest.entries.length,
    })
    .returning();
  if (!set) throw new Error("imported set insert returned no row");
  await db.insert(importedSetEntriesTable).values(
    manifest.entries.map((entry) => ({
      setId: set.id,
      position: entry.position,
      title: entry.title,
      creator: entry.creator,
      album: entry.album,
      durationMs: entry.durationMs,
      claimedMbid: entry.claimedMbid,
      claimedMbidFromLore: entry.claimedMbidFromLore,
      claimedIsrc: entry.claimedIsrc,
    })),
  );
  return set;
}

export interface ImportedSetEntryView {
  position: number;
  title: string | null;
  creator: string | null;
  album: string | null;
  durationMs: number | null;
  claimedIsrc: string | null;
  resolutionStatus: string;
  resolutionBasis: string | null;
  unresolvedReason: string | null;
  recording: {
    mbid: string;
    title: string;
    artist: string;
    artworkUrl: string | null;
    links: Array<{ name: string; url: string; kind: "exact" | "search" }>;
  } | null;
}

export interface ImportedSetView {
  id: number;
  name: string;
  sourceFilename: string;
  /** Fixed imported-only citation grammar — never a picker/DJ claim. */
  citation: string;
  format: string;
  trackCount: number;
  resolvedCount: number;
  unresolvedCount: number;
  status: string;
  createdAt: string;
  entries?: ImportedSetEntryView[];
}

function toSetView(set: ImportedSet): ImportedSetView {
  return {
    id: set.id,
    name: set.name,
    sourceFilename: set.sourceFilename,
    citation: `IMPORTED · ${set.name}`,
    format: set.format,
    trackCount: set.trackCount,
    resolvedCount: set.resolvedCount,
    unresolvedCount: set.unresolvedCount,
    status: set.status,
    createdAt: set.createdAt.toISOString(),
  };
}

export async function listImportedSets(userId: number): Promise<ImportedSetView[]> {
  const rows = await db
    .select()
    .from(importedSetsTable)
    .where(eq(importedSetsTable.userId, userId))
    .orderBy(desc(importedSetsTable.createdAt));
  return rows.map(toSetView);
}

export async function getImportedSetView(
  userId: number,
  setId: number,
): Promise<ImportedSetView | null> {
  const [set] = await db
    .select()
    .from(importedSetsTable)
    .where(and(eq(importedSetsTable.id, setId), eq(importedSetsTable.userId, userId)))
    .limit(1);
  if (!set) return null;

  const entries = await db
    .select()
    .from(importedSetEntriesTable)
    .where(eq(importedSetEntriesTable.setId, setId))
    .orderBy(asc(importedSetEntriesTable.position));

  const mbids = [...new Set(entries.flatMap((e) => (e.resolvedMbid ? [e.resolvedMbid] : [])))];
  const recordings = mbids.length
    ? await db
        .select({
          mbid: recordingsTable.mbid,
          title: recordingsTable.title,
          artist: recordingsTable.artist,
          artworkUrl: recordingsTable.artworkUrl,
          links: recordingsTable.links,
        })
        .from(recordingsTable)
        .where(inArray(recordingsTable.mbid, mbids))
    : [];
  const byMbid = new Map(recordings.map((r) => [r.mbid, r]));

  return {
    ...toSetView(set),
    entries: entries.map((entry) => {
      const recording = entry.resolvedMbid ? byMbid.get(entry.resolvedMbid) : undefined;
      return {
        position: entry.position,
        title: entry.title,
        creator: entry.creator,
        album: entry.album,
        durationMs: entry.durationMs,
        claimedIsrc: entry.claimedIsrc,
        resolutionStatus: entry.resolutionStatus,
        resolutionBasis: entry.resolutionBasis,
        unresolvedReason: entry.unresolvedReason,
        recording: recording
          ? {
              mbid: recording.mbid,
              title: recording.title,
              artist: recording.artist,
              artworkUrl: recording.artworkUrl ?? null,
              links: recording.links ?? [],
            }
          : null,
      };
    }),
  };
}

export async function deleteImportedSet(userId: number, setId: number): Promise<boolean> {
  const deleted = await db
    .delete(importedSetsTable)
    .where(and(eq(importedSetsTable.id, setId), eq(importedSetsTable.userId, userId)))
    .returning({ id: importedSetsTable.id });
  return deleted.length > 0;
}

/**
 * Boot-time resume: restart resolution for every set left with pending
 * entries by a restart/deploy mid-import. Fire-and-forget per set; the
 * per-set in-flight guard prevents competing workers.
 */
export async function resumePendingImportedSets(): Promise<void> {
  const stalled = await db
    .selectDistinct({ setId: importedSetEntriesTable.setId })
    .from(importedSetEntriesTable)
    .where(eq(importedSetEntriesTable.resolutionStatus, "pending"));
  for (const { setId } of stalled) {
    console.log(`[lore] resuming imported-set resolution for set ${setId}`);
    void runImportedSetResolution(setId);
  }
}

/** Restart resolution for a user's set (e.g. after a server restart). */
export async function resumeImportedSetResolution(
  userId: number,
  setId: number,
): Promise<boolean> {
  const [set] = await db
    .select({ id: importedSetsTable.id })
    .from(importedSetsTable)
    .where(and(eq(importedSetsTable.id, setId), eq(importedSetsTable.userId, userId)))
    .limit(1);
  if (!set) return false;
  void runImportedSetResolution(setId);
  return true;
}
