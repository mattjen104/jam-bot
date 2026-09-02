import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createServer } from "node:http";
import express from "express";
import { eq, inArray, sql } from "drizzle-orm";
import { criCandidatesTable, db, stationsTable } from "@workspace/db";
import { applyCriCandidatesMigration } from "../src/lore/cri-candidates-migration.js";

vi.mock("../src/lore/icy.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lore/icy.js")>();
  return {
    ...actual,
    fetchIcyMetadata: vi.fn(),
  };
});

vi.mock("../src/lore/poller.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lore/poller.js")>();
  return { ...actual, enrollStationPoller: vi.fn() };
});

const ADMIN_TOKEN = `test-cri-reprobe-${randomUUID().slice(0, 8)}`;
process.env.LORE_ADMIN_TOKEN = ADMIN_TOKEN;

const run = randomUUID().slice(0, 8);
const CRI_SLUG = `reviewed-${run}`;
const LEGACY_SLUG = `legacy-${run}`;
const VERIFIED_SLUG = `verified-${run}`;
const STREAM_URL = `https://stream.example.com/cri-${run}`;

let dbAvailable = false;
const candidateIds: number[] = [];
let server: ReturnType<typeof createServer> | null = null;
let serverUrl = "";

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    await applyCriCandidatesMigration();
    dbAvailable = true;
  } catch {
    return;
  }

  const candidates = await db
    .insert(criCandidatesTable)
    .values([
      {
        criSlug: CRI_SLUG,
        name: `Reviewed CRI ${run}`,
        streamUrl: STREAM_URL,
        icyStatus: "no",
        stationLabel: "Old archive label",
        alreadyInLore: true,
      },
      {
        criSlug: LEGACY_SLUG,
        name: `Legacy CRI ${run}`,
        streamUrl: `${STREAM_URL}/legacy`,
        icyStatus: "yes",
      },
      {
        criSlug: VERIFIED_SLUG,
        name: `Verified CRI ${run}`,
        streamUrl: `${STREAM_URL}/verified`,
        icyStatus: "yes",
        currentArtist: "Verified Artist",
        currentTitle: "Verified Track",
      },
    ])
    .returning({ id: criCandidatesTable.id });
  candidateIds.push(...candidates.map((candidate) => candidate.id));

  const icy = await import("../src/lore/icy.js");
  vi.mocked(icy.fetchIcyMetadata).mockResolvedValue({
    ok: true,
    streamTitle: "Broadcast - Fresh Track",
    icyMetaint: 16_000,
  });

  const { default: adminRouter } = await import("../src/routes/lore/admin.js");
  const app = express();
  app.use(express.json());
  app.use(adminRouter);
  server = createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  serverUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  server?.close();
  if (!dbAvailable) return;
  await db
    .delete(stationsTable)
    .where(inArray(stationsTable.slug, [`cri-${LEGACY_SLUG}`, `cri-${VERIFIED_SLUG}`]));
  if (candidateIds.length > 0) {
    await db.delete(criCandidatesTable).where(inArray(criCandidatesTable.id, candidateIds));
  }
});

describe("POST /admin/cri/candidates/:slug/reprobe", () => {
  it("updates an already-reviewed candidate from a fresh metadata block", async () => {
    if (!dbAvailable) return;

    const response = await fetch(
      `${serverUrl}/admin/cri/candidates/${encodeURIComponent(CRI_SLUG)}/reprobe`,
      {
        method: "POST",
        headers: { "x-admin-token": ADMIN_TOKEN },
      },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      candidate: {
        criSlug: CRI_SLUG,
        icyStatus: "yes",
        currentArtist: "Broadcast",
        currentTitle: "Fresh Track",
        stationLabel: null,
        alreadyInLore: true,
      },
    });

    const [stored] = await db
      .select({
        icyStatus: criCandidatesTable.icyStatus,
        currentArtist: criCandidatesTable.currentArtist,
        currentTitle: criCandidatesTable.currentTitle,
        stationLabel: criCandidatesTable.stationLabel,
      })
      .from(criCandidatesTable)
      .where(eq(criCandidatesTable.criSlug, CRI_SLUG));

    expect(stored).toEqual({
      icyStatus: "yes",
      currentArtist: "Broadcast",
      currentTitle: "Fresh Track",
      stationLabel: null,
    });
  });
});

describe("POST /admin/cri/candidates/:slug/promote", () => {
  it("rejects a legacy header-only yes row without artist/title evidence", async () => {
    if (!dbAvailable) return;

    const response = await fetch(
      `${serverUrl}/admin/cri/candidates/${encodeURIComponent(LEGACY_SLUG)}/promote`,
      {
        method: "POST",
        headers: { "x-admin-token": ADMIN_TOKEN },
      },
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("re-probe first"),
    });
  });

  it("promotes a candidate with persisted artist/title evidence", async () => {
    if (!dbAvailable) return;

    const response = await fetch(
      `${serverUrl}/admin/cri/candidates/${encodeURIComponent(VERIFIED_SLUG)}/promote`,
      {
        method: "POST",
        headers: { "x-admin-token": ADMIN_TOKEN },
      },
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      stationSlug: `cri-${VERIFIED_SLUG}`,
      name: `Verified CRI ${run}`,
    });
  });
});