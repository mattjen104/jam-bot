// @vitest-environment node
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import {
  db,
  recordingsTable,
  recordingReleaseGroupsTable,
} from "@workspace/db";
import app from "../src/app.js";
import { __setAlbumTracklistFetcherForTests } from "../src/lore/album-track-order.js";

const mbids = [randomUUID(), randomUUID(), randomUUID()];
const releaseGroupMbid = randomUUID();
let dbAvailable = false;
let server: Server | undefined;
let baseUrl = "";

beforeAll(async () => {
  try {
    await db.execute("SELECT 1");
    dbAvailable = true;
  } catch {
    return;
  }

  await db.insert(recordingsTable).values(
    mbids.map((mbid, index) => ({
      mbid,
      title: `Canonical track ${index + 1}`,
      artist: "Canonical Artist",
    })),
  );
  // Deliberately insert bridge rows in 2, 1, 3 order. Serial bridge IDs must
  // not influence the queue returned to the player.
  await db.insert(recordingReleaseGroupsTable).values([
    {
      recordingMbid: mbids[1]!,
      releaseGroupMbid,
      isPrimary: true,
      title: "Canonical Album",
      primaryType: "Album",
    },
    {
      recordingMbid: mbids[0]!,
      releaseGroupMbid,
      isPrimary: false,
      title: "Canonical Album",
      primaryType: "Album",
    },
    {
      recordingMbid: mbids[2]!,
      releaseGroupMbid,
      isPrimary: false,
      title: "Canonical Album",
      primaryType: "Album",
    },
  ]);

  __setAlbumTracklistFetcherForTests(async () => ({
    releaseId: randomUUID(),
    releaseTitle: "Canonical Album",
    tracks: mbids.map((recordingId, index) => ({
      position: index + 1,
      recordingId,
      title: `Canonical track ${index + 1}`,
      artist: "Canonical Artist",
    })),
  }));

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const address = server.address();
  if (typeof address === "object" && address) {
    baseUrl = `http://127.0.0.1:${address.port}`;
  }
});

afterAll(async () => {
  __setAlbumTracklistFetcherForTests(null);
  if (dbAvailable) {
    await db
      .delete(recordingReleaseGroupsTable)
      .where(inArray(recordingReleaseGroupsTable.recordingMbid, mbids));
    await db.delete(recordingsTable).where(inArray(recordingsTable.mbid, mbids));
  }
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

describe("GET /api/recordings/:mbid/album-tracks canonical ordering", () => {
  it("returns MusicBrainz order even when bridge rows were inserted out of order", async () => {
    if (!dbAvailable) return;
    const response = await fetch(
      `${baseUrl}/api/recordings/${mbids[1]}/album-tracks?canonicalOrder=true`,
    );
    expect(response.status).toBe(200);
    const body = await response.json() as {
      tracks: Array<{ mbid: string; position: number }>;
    };
    expect(body.tracks.map((track) => track.mbid)).toEqual(mbids);
    expect(body.tracks.map((track) => track.position)).toEqual([1, 2, 3]);
  });
});