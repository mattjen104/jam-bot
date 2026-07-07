import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import {
  db,
  recordingsTable,
  stationsTable,
  spinsTable,
} from "@workspace/db";
import type { RecordingLink } from "@workspace/db";

/**
 * DB-backed integration test for `resolveSongShareOrLinks` — the jam-bot link
 * unfurler's entry point. Covers the provenance rule from Task #222:
 *
 *   - A pasted song not already in the library returns a links-only card and is
 *     NOT written to `recordings`.
 *   - A song already in the library (with station history) returns a full Lore
 *     card carrying ghost-radio context.
 *   - A song already in the library, matched by external id, returns a Lore
 *     card via the DB-first fast path without resolving a fresh MBID.
 *
 * `spins.mbid` has a FK to `recordings.mbid`, so any song that has aired is
 * necessarily already in `recordings`; the paste path therefore never needs to
 * (and never does) write. The MusicBrainz resolve seam is mocked so the test is
 * deterministic and offline; the DB reads/writes are real. Self-skips when no
 * DB connection is available (mirrors the sibling DB tests).
 */

const run = randomUUID().slice(0, 8);
const MBID_ABSENT = `t222-absent-${run}`;
const MBID_AIRED = `t222-aired-${run}`;
const MBID_LIBRARY = `t222-lib-${run}`;
const SPOTIFY_TRACK = `t222track${run}`.slice(0, 22);
const STATION_SLUG = `t222-station-${run}`;

/** Distinct exact links per recording so the Spotify-id lookup is unambiguous. */
const LIBRARY_LINKS: RecordingLink[] = [
  {
    name: "Spotify",
    url: `https://open.spotify.com/track/${SPOTIFY_TRACK}`,
    kind: "exact",
  },
];
const AIRED_LINKS: RecordingLink[] = [
  {
    name: "Spotify",
    url: `https://open.spotify.com/track/aired${run}`.slice(0, 45),
    kind: "exact",
  },
];

// Mock only the MusicBrainz resolve seam so `resolveToMbid` is deterministic.
const resolveToMbidMock = vi.fn();
vi.mock("../src/lore/resolve.js", async (importActual) => {
  const actual =
    await importActual<typeof import("../src/lore/resolve.js")>();
  return {
    ...actual,
    resolveToMbid: (...args: unknown[]) => resolveToMbidMock(...args),
  };
});

// Imported AFTER vi.mock so the mocked seam is wired in.
const { resolveSongShareOrLinks } = await import("../src/lore/share.js");

let dbAvailable = false;
let stationId: number | undefined;

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }

  const [station] = await db
    .insert(stationsTable)
    .values({
      slug: STATION_SLUG,
      name: `T222 Station ${run}`,
      streamUrl: "https://example.test/stream",
    })
    .returning({ id: stationsTable.id });
  stationId = station?.id;

  // A song already in the library (with exact links so getSongShare skips
  // Odesli enrichment) that has aired — recording first, then a spin (the FK
  // requires the recording to exist).
  await db.insert(recordingsTable).values({
    mbid: MBID_AIRED,
    title: "Aired Title",
    artist: "Aired Artist",
    links: AIRED_LINKS,
  });
  await db.insert(spinsTable).values({
    stationId: stationId!,
    mbid: MBID_AIRED,
    rawArtist: "Aired Artist",
    rawTitle: "Aired Title",
    confidence: "text",
    playedAt: new Date(Date.now() - 60 * 60 * 1000),
  });

  // A song already in the library, matchable by its Spotify link.
  await db.insert(recordingsTable).values({
    mbid: MBID_LIBRARY,
    title: "Library Title",
    artist: "Library Artist",
    links: LIBRARY_LINKS,
  });
});

afterAll(async () => {
  if (!dbAvailable) return;
  if (stationId != null) {
    await db.delete(spinsTable).where(eq(spinsTable.stationId, stationId));
    await db.delete(stationsTable).where(eq(stationsTable.id, stationId));
  }
  await db.delete(recordingsTable).where(eq(recordingsTable.mbid, MBID_ABSENT));
  await db.delete(recordingsTable).where(eq(recordingsTable.mbid, MBID_AIRED));
  await db.delete(recordingsTable).where(eq(recordingsTable.mbid, MBID_LIBRARY));
});

describe("resolveSongShareOrLinks: provenance-gated card selection", () => {
  it("returns links-only WITHOUT persisting when the song is not in the library", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    resolveToMbidMock.mockResolvedValueOnce({
      mbid: MBID_ABSENT,
      confidence: "text",
      artist: "Nobody Special",
      title: "Never Played",
    });

    const result = await resolveSongShareOrLinks({
      artist: "Nobody Special",
      title: "Never Played",
    });

    expect(result.kind).toBe("links-only");
    if (result.kind !== "links-only") throw new Error("expected links-only");
    expect(result.song.liveStation).toBeNull();
    expect(result.song.ghostRun).toBeNull();
    // Search links cover every service, including Qobuz.
    expect(result.song.links.some((l) => /qobuz/i.test(l.url))).toBe(true);

    // Provenance rule: nothing written to the library.
    const [row] = await db
      .select({ mbid: recordingsTable.mbid })
      .from(recordingsTable)
      .where(eq(recordingsTable.mbid, MBID_ABSENT));
    expect(row).toBeUndefined();
  });

  it("returns a Lore card with ghost-radio context for a library song that has aired", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    resolveToMbidMock.mockResolvedValueOnce({
      mbid: MBID_AIRED,
      confidence: "text",
      artist: "Aired Artist",
      title: "Aired Title",
    });

    const result = await resolveSongShareOrLinks({
      artist: "Aired Artist",
      title: "Aired Title",
    });

    expect(result.kind).toBe("lore");
    if (result.kind !== "lore") throw new Error("expected lore");
    expect(result.mbid).toBe(MBID_AIRED);
    expect(result.song.ghostRun).not.toBeNull();
  });

  it("returns a Lore card from a bare Spotify id (no artist/title) via the DB-first fast path", async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    resolveToMbidMock.mockClear();

    // Relaxed contract: a strong identifier alone is enough — no text metadata.
    const result = await resolveSongShareOrLinks({
      spotifyTrackId: SPOTIFY_TRACK,
    });

    expect(result.kind).toBe("lore");
    if (result.kind !== "lore") throw new Error("expected lore");
    expect(result.mbid).toBe(MBID_LIBRARY);
    // Fast path short-circuits before any MusicBrainz resolution.
    expect(resolveToMbidMock).not.toHaveBeenCalled();
  });
});
