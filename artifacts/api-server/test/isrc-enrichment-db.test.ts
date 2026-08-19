/**
 * @vitest-environment node
 *
 * DB-level tests for the ISRC enrichment batch. A definitive MusicBrainz
 * answer (including no ISRC) converges the row, while a transient failure must
 * leave it eligible for a later tick.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  db,
  libraryItemsTable,
  loreUsersTable,
  recordingsTable,
  spotifyConnectionsTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { enrichIsrcBatch } from "../src/lore/isrc-enrichment.js";

type FetchIsrc = (mbid: string, signal?: AbortSignal) => Promise<string | null>;
const { mockFetchIsrcByMbid } = vi.hoisted(() => ({
  mockFetchIsrcByMbid: vi.fn<FetchIsrc>(),
}));

vi.mock("@workspace/song-enrichment", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/song-enrichment")>();
  return {
    ...actual,
    musicbrainzEnabled: () => true,
    createMbResolver: () => ({
      fetchIsrcByMbid: mockFetchIsrcByMbid,
      fetchReleaseYear: vi.fn().mockResolvedValue(null),
      fetchReleaseDateInfo: vi.fn().mockResolvedValue(null),
      resolveByIsrc: vi.fn().mockResolvedValue(null),
      resolveByText: vi.fn().mockResolvedValue(null),
      resolveByTextWithScore: vi.fn().mockResolvedValue(null),
    }),
  };
});

let dbAvailable = false;
try {
  await db.execute(sql`SELECT 1`);
  dbAvailable = true;
} catch {
  dbAvailable = false;
}

const run = randomUUID().slice(0, 8);
const SID = `test-isrc-enrichment-sid-${run}`;
const userSpotifyId = `test-isrc-enrichment-user-${run}`;
const mbid = (tag: string) => `test-isrc-enrichment-${run}-${tag}`;
let userId: number | undefined;

async function insertRecording(id: string): Promise<void> {
  await db
    .insert(recordingsTable)
    .values({ mbid: id, title: "Test Track", artist: "Test Artist" });
}

async function addToLibrary(id: string): Promise<void> {
  await db.insert(libraryItemsTable).values({
    userId: userId!,
    mbid: id,
    provenance: { kind: "keep" },
  });
}

async function getRecording(id: string) {
  const [row] = await db
    .select({
      isrc: recordingsTable.isrc,
      isrcCheckedAt: recordingsTable.isrcCheckedAt,
    })
    .from(recordingsTable)
    .where(eq(recordingsTable.mbid, id));
  return row;
}

beforeAll(async () => {
  if (!dbAvailable) return;

  await db.insert(spotifyConnectionsTable).values({
    sid: SID,
    accessToken: "test",
    refreshToken: "test",
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  const [user] = await db
    .insert(loreUsersTable)
    .values({
      spotifyUserId: userSpotifyId,
      spotifyConnectionId: SID,
      deviceKey: SID,
    })
    .returning({ id: loreUsersTable.id });
  userId = user!.id;
});

beforeEach(() => {
  // The default models a definitive miss; individual tests override it for
  // hits and transient failures.
  mockFetchIsrcByMbid.mockReset();
  mockFetchIsrcByMbid.mockResolvedValue(null);
});

afterAll(async () => {
  if (!dbAvailable) return;
  if (userId != null) {
    await db.delete(libraryItemsTable).where(eq(libraryItemsTable.userId, userId));
    await db.delete(loreUsersTable).where(eq(loreUsersTable.id, userId));
  }
  await db.execute(
    sql`DELETE FROM recordings WHERE mbid LIKE ${`test-isrc-enrichment-${run}-%`}`,
  );
  await db.delete(spotifyConnectionsTable).where(eq(spotifyConnectionsTable.sid, SID));
});

describe("enrichIsrcBatch", () => {
  it.skipIf(!dbAvailable)("writes the ISRC and checked marker on a successful lookup", async () => {
    const id = mbid("hit");
    await insertRecording(id);
    await addToLibrary(id);
    mockFetchIsrcByMbid.mockImplementation(async (candidate) =>
      candidate === id ? "US-ABC-12-34567" : null,
    );

    await enrichIsrcBatch(25, [userId!]);

    const row = await getRecording(id);
    expect(row?.isrc).toBe("US-ABC-12-34567");
    expect(row?.isrcCheckedAt).not.toBeNull();
  });

  it.skipIf(!dbAvailable)("marks an ISRC miss checked without changing the ISRC", async () => {
    const id = mbid("miss");
    await insertRecording(id);
    await addToLibrary(id);

    await enrichIsrcBatch(25, [userId!]);

    const row = await getRecording(id);
    expect(row?.isrc).toBeNull();
    expect(row?.isrcCheckedAt).not.toBeNull();
  });

  it.skipIf(!dbAvailable)("leaves a transient MusicBrainz failure eligible for retry", async () => {
    const id = mbid("transient-error");
    await insertRecording(id);
    await addToLibrary(id);
    mockFetchIsrcByMbid.mockImplementation(async (candidate) => {
      if (candidate === id) throw new Error("MusicBrainz 503");
      return null;
    });

    await enrichIsrcBatch(25, [userId!]);

    const row = await getRecording(id);
    expect(row?.isrc).toBeNull();
    expect(row?.isrcCheckedAt).toBeNull();
  });

  it.skipIf(!dbAvailable)("does not re-fetch a recording that has already been checked", async () => {
    const id = mbid("already-checked");
    const checkedAt = new Date(Date.now() - 60_000);
    await insertRecording(id);
    await addToLibrary(id);
    await db
      .update(recordingsTable)
      .set({ isrcCheckedAt: checkedAt })
      .where(eq(recordingsTable.mbid, id));

    await enrichIsrcBatch(25, [userId!]);

    expect(mockFetchIsrcByMbid).not.toHaveBeenCalledWith(id, expect.anything());
    expect((await getRecording(id))?.isrcCheckedAt).toEqual(checkedAt);
  });

  it.skipIf(!dbAvailable)("excludes recordings that are not in any listener library", async () => {
    const id = mbid("not-in-library");
    await insertRecording(id);

    await enrichIsrcBatch(25, [userId!]);

    expect(mockFetchIsrcByMbid).not.toHaveBeenCalledWith(id, expect.anything());
    const row = await getRecording(id);
    expect(row?.isrc).toBeNull();
    expect(row?.isrcCheckedAt).toBeNull();
  });
});
