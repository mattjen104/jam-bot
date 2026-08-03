import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, embedLinkTable, recordingsTable } from "@workspace/db";
import {
  EMBED_TTL_MS,
  embedExpiresAt,
  embedIdentity,
  effectiveEmbedOutcome,
  getEmbedResolution,
  listEmbedResolutions,
  upsertEmbedResolution,
  type EmbedResolutionInput,
} from "../src/lore/embed-resolution.js";
import { applyReplayResolutionMigration } from "../src/lore/replay-resolution-migration.js";

const run = randomUUID().slice(0, 8);
const mbid = `test-embed-resolution-${run}`;
let dbAvailable = false;

function input(
  overrides: Partial<EmbedResolutionInput> = {},
): EmbedResolutionInput {
  return {
    recordingMbid: mbid,
    provider: "bandcamp",
    role: "provenance",
    rung: 1,
    outcome: "embedded",
    providerReleaseId: "album-123",
    providerTrackId: "track-456",
    sourceUrl: "https://artist.bandcamp.com/album/release",
    resolvedVia: "mb-url-rel",
    confidence: "exact",
    reason: "trusted release relationship",
    ...overrides,
  };
}

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    await applyReplayResolutionMigration();
    await db.insert(recordingsTable).values({
      mbid,
      title: "Embed Resolution Track",
      artist: "Embed Resolution Artist",
    });
    dbAvailable = true;
  } catch {
    // Database-backed suites are allowed to skip when DATABASE_URL is absent.
  }
});

afterAll(async () => {
  if (!dbAvailable) return;
  await db.delete(embedLinkTable).where(eq(embedLinkTable.recordingMbid, mbid));
  await db.delete(recordingsTable).where(eq(recordingsTable.mbid, mbid));
});

describe("role-aware embed resolution", () => {
  it("uses recording/provider/role as the deterministic identity", () => {
    expect(embedIdentity(input())).toBe(
      `${mbid}\u001fbandcamp\u001fprovenance`,
    );
    expect(embedIdentity(input({ provider: "youtube", role: "control" }))).toBe(
      `${mbid}\u001fyoutube\u001fcontrol`,
    );
  });

  it("keeps provenance and control providers independent", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    await upsertEmbedResolution(input());
    await upsertEmbedResolution(
      input({
        provider: "youtube",
        role: "control",
        rung: 3,
        providerReleaseId: null,
        providerTrackId: "video-789",
        sourceUrl: "https://www.youtube.com/watch?v=video-789",
        resolvedVia: "yt-search",
        confidence: "gated",
        reason: "topic channel and duration gate",
      }),
    );

    const rows = await listEmbedResolutions(mbid);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => `${row.provider}:${row.role}`)).toEqual([
      "bandcamp:provenance",
      "youtube:control",
    ]);
  });

  it("stores provider-scoped no-link results without blocking another provider", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const noLinkMbid = `${mbid}-miss`;
    await db.insert(recordingsTable).values({
      mbid: noLinkMbid,
      title: "Provider Scoped Miss",
      artist: "Embed Resolution Artist",
    });
    try {
      await upsertEmbedResolution(
        input({
          recordingMbid: noLinkMbid,
          provider: "bandcamp",
          role: "provenance",
          rung: 6,
          outcome: "no_link",
          providerReleaseId: null,
          providerTrackId: null,
          sourceUrl: null,
          resolvedVia: "cache",
          confidence: "none",
          reason: "no-mb-rel",
        }),
      );
      await upsertEmbedResolution(
        input({
          recordingMbid: noLinkMbid,
          provider: "youtube",
          role: "control",
          rung: 3,
          providerReleaseId: null,
          providerTrackId: "video-123",
          sourceUrl: "https://www.youtube.com/watch?v=video-123",
          resolvedVia: "mb-url-rel",
          confidence: "exact",
          reason: "recording stream relationship",
        }),
      );
      expect(await listEmbedResolutions(noLinkMbid)).toHaveLength(2);
    } finally {
      await db
        .delete(embedLinkTable)
        .where(eq(embedLinkTable.recordingMbid, noLinkMbid));
      await db
        .delete(recordingsTable)
        .where(eq(recordingsTable.mbid, noLinkMbid));
    }
  });

  it("preserves a fresh stronger result when a weaker or transient result arrives", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const first = await upsertEmbedResolution(input());
    const preserved = await upsertEmbedResolution(
      input({
        rung: 4,
        outcome: "embedded",
        providerTrackId: "weaker-video",
        resolvedVia: "yt-search",
        confidence: "gated",
        reason: "lower confidence candidate",
      }),
    );
    expect(preserved.id).toBe(first.id);
    expect(preserved.providerTrackId).toBe("track-456");

    const afterFailure = await upsertEmbedResolution(
      input({
        outcome: "transient_failure",
        reason: "provider timeout",
        resolvedVia: "cache",
        confidence: "none",
      }),
    );
    expect(afterFailure.id).toBe(first.id);
    expect(afterFailure.outcome).toBe("embedded");
  });

  it("keeps concurrent writers from downgrading the stronger result", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const strong = input({ fetchedAt: new Date(Date.now() - 1_000) });
    const weak = input({
      rung: 4,
      providerTrackId: "concurrent-weaker",
      resolvedVia: "yt-search",
      confidence: "gated",
      reason: "concurrent lower-confidence candidate",
    });
    await Promise.all([
      upsertEmbedResolution(weak),
      upsertEmbedResolution(strong),
    ]);
    const row = await getEmbedResolution(mbid, "bandcamp", "provenance");
    expect(row?.rung).toBe(1);
    expect(row?.providerTrackId).toBe("track-456");
  });

  it("replaces an expired result and records a changed release choice", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const stale = new Date(Date.now() - EMBED_TTL_MS.bandcamp - 1_000);
    await upsertEmbedResolution(
      input({
        releaseMbid: "release-old",
        fetchedAt: stale,
        expiresAt: new Date(stale.getTime() + EMBED_TTL_MS.bandcamp),
      }),
    );
    const refreshed = await upsertEmbedResolution(
      input({
        releaseMbid: "release-new",
        providerReleaseId: "album-new",
        fetchedAt: new Date(),
        reason: "deterministic release selection changed",
      }),
    );
    expect(refreshed.releaseMbid).toBe("release-new");
    expect(refreshed.previousReleaseMbid).toBe("release-old");
    expect(refreshed.releaseChangedAt).toBeInstanceOf(Date);
  });

  it("classifies TTL expiry without losing the persisted outcome", () => {
    const fetchedAt = new Date("2026-01-01T00:00:00.000Z");
    const expiresAt = embedExpiresAt(
      { provider: "youtube", outcome: "embedded" },
      fetchedAt,
    );
    expect(expiresAt.getTime() - fetchedAt.getTime()).toBe(
      EMBED_TTL_MS.youtube,
    );
    expect(
      effectiveEmbedOutcome(
        { outcome: "embedded", expiresAt },
        new Date(expiresAt.getTime() + 1),
      ),
    ).toBe("expired");
    expect(
      effectiveEmbedOutcome(
        { outcome: "embedded", expiresAt },
        new Date(expiresAt.getTime() - 1),
      ),
    ).toBe("embedded");
  });

  it("enforces uniqueness at the database boundary", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    // Running the additive boot migration twice must be harmless for both
    // existing deployments and fresh boots.
    await applyReplayResolutionMigration();
    const rows = await db
      .select({ id: embedLinkTable.id })
      .from(embedLinkTable)
      .where(
        and(
          eq(embedLinkTable.recordingMbid, mbid),
          eq(embedLinkTable.provider, "bandcamp"),
          eq(embedLinkTable.role, "provenance"),
        ),
      );
    expect(rows).toHaveLength(1);

    const existing = await getEmbedResolution(mbid, "bandcamp", "provenance");
    expect(existing).not.toBeNull();
    await expect(
      db.insert(embedLinkTable).values({
        recordingMbid: mbid,
        provider: "bandcamp",
        role: "provenance",
        rung: 1,
        outcome: "embedded",
        resolvedVia: "cache",
        confidence: "exact",
        reason: "duplicate identity probe",
        fetchedAt: new Date(),
        expiresAt: new Date(Date.now() + EMBED_TTL_MS.bandcamp),
      }),
    ).rejects.toThrow();

    await expect(
      db.insert(embedLinkTable).values({
        recordingMbid: mbid,
        provider: "youtube",
        role: "control",
        rung: 6,
        outcome: "embedded",
        resolvedVia: "cache",
        confidence: "none",
        reason: "invalid outcome/rung probe",
        fetchedAt: new Date(),
        expiresAt: new Date(Date.now() + EMBED_TTL_MS.youtube),
      }),
    ).rejects.toThrow();
  });
});
