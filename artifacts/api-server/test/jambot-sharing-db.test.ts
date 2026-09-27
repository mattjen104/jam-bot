// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import {
  db,
  libraryItemsTable,
  loreSharingGrantsTable,
  loreSharingHandoffsTable,
  loreUsersTable,
  recordingsTable,
  spinsTable,
  spotifyLibraryItemsTable,
  stationsTable,
  tasteSeedsTable,
} from "@workspace/db";
import app from "../src/app.js";
import { applyLoreSharingMigration } from "../src/lore/lore-sharing-migration.js";

const run = randomUUID().replaceAll("-", "").slice(0, 12);
const secret = `test-secret-${run}`;
const channel = `C_SHARE_${run}`;
const workspace = `T_SHARE_${run}`;
const sidA = `share-user-a-${run}`;
const sidB = `share-user-b-${run}`;
const sidC = `share-user-c-${run}`;
const mbid = `share-mbid-${run}`;
const noMatchMbid = `share-no-match-${run}`;
const inactiveMbid = `share-inactive-${run}`;
const stationSlugs = [`share-current-${run}`, `share-order-${run}`, `share-inactive-${run}`];

let dbAvailable = false;
let server: ReturnType<typeof app.listen> | undefined;
let baseUrl = "";
let userA: number | null = null;
let userB: number | null = null;
let userC: number | null = null;
const previousSecret = process.env.SESSION_SECRET;
const previousChannel = process.env.SLACK_CHANNEL_ID;

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }
  process.env.SESSION_SECRET = secret;
  process.env.SLACK_CHANNEL_ID = channel;
  await applyLoreSharingMigration();
  const [recording] = await db.insert(recordingsTable).values({
    mbid,
    title: "Private test title",
    artist: "Private test artist",
  }).returning({ mbid: recordingsTable.mbid });
  await db.insert(recordingsTable).values([
    { mbid: noMatchMbid, title: "Newer unrelated title", artist: "Unrelated artist", artistMbid: `artist-${run}` },
    { mbid: inactiveMbid, title: "Inactive station title", artist: "Private test artist" },
  ]);
  const [a] = await db.insert(loreUsersTable).values({ deviceKey: sidA }).returning({ id: loreUsersTable.id });
  const [b] = await db.insert(loreUsersTable).values({ deviceKey: sidB }).returning({ id: loreUsersTable.id });
  const [c] = await db.insert(loreUsersTable).values({ deviceKey: sidC }).returning({ id: loreUsersTable.id });
  userA = a!.id;
  userB = b!.id;
  userC = c!.id;
  // A taste seed may drive personal discovery, but it is not a saved library
  // item and must never become a shared-channel artist crossing.
  await db.insert(tasteSeedsTable).values({ userId: userA, artistName: "Unrelated artist" });
  await db.insert(spotifyLibraryItemsTable).values({
    userId: userA,
    spotifyId: "a".repeat(22),
    title: "Private test title",
    artist: "Private test artist",
    mbid: recording!.mbid,
  });
  await db.insert(spotifyLibraryItemsTable).values({
    userId: userC,
    spotifyId: "c".repeat(22),
    title: "Removed only title",
    artist: "Removed only artist",
    mbid: recording!.mbid,
    removedAt: new Date(),
  });
  await db.insert(libraryItemsTable).values({
    userId: userB,
    mbid: recording!.mbid,
    provenance: { kind: "import", service: "test" },
  });
  const [activeStation, orderingStation, inactiveStation] = await db.insert(stationsTable).values([
    { slug: stationSlugs[0]!, name: "Sharing current fixture", streamUrl: "https://example.test/current" },
    { slug: stationSlugs[1]!, name: "Sharing order fixture", streamUrl: "https://example.test/order" },
    { slug: stationSlugs[2]!, name: "Sharing inactive fixture", streamUrl: "https://example.test/inactive", active: false },
  ]).returning({ id: stationsTable.id });
  const now = Date.now();
  await db.insert(spinsTable).values([
    {
      stationId: activeStation!.id,
      mbid: recording!.mbid,
      source: "radio_paradise",
      playedAt: new Date(now - 30_000),
      observedAt: new Date(now - 5_000),
    },
    {
      stationId: orderingStation!.id,
      mbid: recording!.mbid,
      source: "radio_paradise",
      playedAt: new Date(now - 120_000),
      observedAt: new Date(now - 1_000),
    },
    {
      stationId: orderingStation!.id,
      mbid: noMatchMbid,
      source: "radio_paradise",
      playedAt: new Date(now - 30_000),
      observedAt: new Date(now - 60_000),
    },
    {
      stationId: inactiveStation!.id,
      mbid: inactiveMbid,
      source: "radio_paradise",
      playedAt: new Date(now - 30_000),
      observedAt: new Date(now - 5_000),
    },
  ]);
  server = app.listen(0);
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const addr = server.address();
  if (addr && typeof addr === "object") baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  if (previousSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = previousSecret;
  if (previousChannel === undefined) delete process.env.SLACK_CHANNEL_ID;
  else process.env.SLACK_CHANNEL_ID = previousChannel;
  if (!dbAvailable) return;
  await db.delete(loreSharingGrantsTable).where(eq(loreSharingGrantsTable.workspaceId, workspace));
  await db.delete(loreSharingHandoffsTable).where(eq(loreSharingHandoffsTable.workspaceId, workspace));
  const fixtureStations = await db.select({ id: stationsTable.id })
    .from(stationsTable)
    .where(inArray(stationsTable.slug, stationSlugs));
  if (fixtureStations.length) {
    await db.delete(spinsTable).where(inArray(spinsTable.stationId, fixtureStations.map((row) => row.id)));
  }
  await db.delete(stationsTable).where(inArray(stationsTable.slug, stationSlugs));
  if (userA !== null) await db.delete(libraryItemsTable).where(eq(libraryItemsTable.userId, userA));
  if (userB !== null) await db.delete(libraryItemsTable).where(eq(libraryItemsTable.userId, userB));
  const fixtureUsers = [userA, userB, userC].filter((id): id is number => id !== null);
  if (fixtureUsers.length) {
    await db.delete(tasteSeedsTable).where(inArray(tasteSeedsTable.userId, fixtureUsers));
    await db.delete(spotifyLibraryItemsTable).where(inArray(spotifyLibraryItemsTable.userId, fixtureUsers));
  }
  await db.delete(recordingsTable).where(inArray(recordingsTable.mbid, [mbid, noMatchMbid, inactiveMbid]));
  if (userA !== null) await db.delete(loreUsersTable).where(eq(loreUsersTable.id, userA));
  if (userB !== null) await db.delete(loreUsersTable).where(eq(loreUsersTable.id, userB));
  if (userC !== null) await db.delete(loreUsersTable).where(eq(loreUsersTable.id, userC));
});

const createHandoff = async (slackUserId: string, channelId = channel) => {
  const response = await fetch(`${baseUrl}/api/me/jambot-sharing/internal/handoffs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-lore-internal-secret": secret,
    },
    body: JSON.stringify({
      workspaceId: workspace,
      channelId,
      slackUserId,
      ownerLabel: "Matt",
    }),
  });
  return { response, body: await response.json() as { handoffToken?: string; expiresAt?: string; error?: string } };
};

const sameOrigin = () => new URL(baseUrl).origin;
interface SharedCrossingsResponse {
  state: string;
  items: Array<{ station: string; title: string }>;
}
const claim = (token: string, sid: string) => fetch(`${baseUrl}/api/me/jambot-sharing/claim`, {
  method: "POST",
  headers: { "Content-Type": "application/json", cookie: `lore_sid=${sid}`, origin: sameOrigin() },
  body: JSON.stringify({ token }),
});

describe("JamBot Lore sharing safety", () => {
  it("keeps pairing behind an existing Lore session and never provisions on claim", async () => {
    if (!dbAvailable) return;
    const { response, body } = await createHandoff("U_verified");
    expect(response.status).toBe(201);
    const token = body.handoffToken!;
    expect(body.handoffToken).toBeTruthy();
    expect("handoffUrl" in body).toBe(false);
    const unauthenticated = await fetch(`${baseUrl}/api/me/jambot-sharing/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json", origin: sameOrigin() },
      body: JSON.stringify({ token }),
    });
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.headers.get("set-cookie")).toBeNull();
    const crossSiteClaim = await fetch(`${baseUrl}/api/me/jambot-sharing/claim`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `lore_sid=${sidA}`,
        origin: "https://attacker.invalid",
        "sec-fetch-site": "cross-site",
      },
      body: JSON.stringify({ token }),
    });
    expect(crossSiteClaim.status).toBe(403);
    const removedOnlyClaim = await claim(token, sidC);
    expect(removedOnlyClaim.status).toBe(409);
    const saved = await db.select({ tokenHash: loreSharingHandoffsTable.tokenHash })
      .from(loreSharingHandoffsTable)
      .where(eq(loreSharingHandoffsTable.workspaceId, workspace));
    expect(saved.some((row) => row.tokenHash === createHash("sha256").update(token).digest("hex"))).toBe(true);
    expect(saved.some((row) => row.tokenHash === token)).toBe(false);
  });

  it("binds configured channel and verified Slack identity, blocks active-owner relink, replay, and permits relink after revoke", async () => {
    if (!dbAvailable) return;
    const badChannel = await createHandoff("U_verified", `C_other_${run}`);
    expect(badChannel.response.status).toBe(403);

    const first = await createHandoff("U_verified");
    expect(first.response.status).toBe(201);
    const firstToken = first.body.handoffToken!;
    const initialClaim = await claim(firstToken, sidA);
    expect(initialClaim.status).toBe(201);
    const claimed = await initialClaim.json() as {
      grant: { id: number; ownerLabel: string; workspaceId: string; channelId: string };
    };
    expect(claimed.grant).toMatchObject({
      ownerLabel: "Matt",
      workspaceId: workspace,
      channelId: channel,
    });
    expect(JSON.stringify(claimed)).not.toMatch(/lore_sid|Private test artist|Private test title|journal|mbid/i);

    const crossingUrl = `${baseUrl}/api/me/jambot-sharing/internal/crossings?workspaceId=${workspace}&channelId=${channel}&slackUserId=U_verified`;
    let crossings: SharedCrossingsResponse | undefined;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const crossingResponse = await fetch(crossingUrl, {
        headers: { "x-lore-internal-secret": secret },
      });
      expect(crossingResponse.status).toBe(200);
      crossings = await crossingResponse.json() as SharedCrossingsResponse;
      if (crossings.state !== "computing") break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(crossings?.state).toBe("settled");
    expect(crossings?.items.map((item) => item.station)).toEqual([stationSlugs[0]]);
    expect(JSON.stringify(crossings)).not.toMatch(/mbid|userId|journal|lore_sid/i);

    const replay = await claim(firstToken, sidA);
    expect(replay.status).toBe(410);
    const nextOwner = await createHandoff("U_different_verified");
    expect(nextOwner.response.status).toBe(201);
    const blocked = await claim(nextOwner.body.handoffToken!, sidB);
    expect(blocked.status).toBe(409);

    const wrongOwnerRevoke = await fetch(`${baseUrl}/api/me/jambot-sharing/${claimed.grant.id}`, {
      method: "DELETE",
      headers: { cookie: `lore_sid=${sidB}`, origin: sameOrigin() },
    });
    expect(wrongOwnerRevoke.status).toBe(404);
    const crossSiteRevoke = await fetch(`${baseUrl}/api/me/jambot-sharing/${claimed.grant.id}`, {
      method: "DELETE",
      headers: {
        cookie: `lore_sid=${sidA}`,
        origin: "https://attacker.invalid",
        "sec-fetch-site": "cross-site",
      },
    });
    expect(crossSiteRevoke.status).toBe(403);
    const revoke = await fetch(`${baseUrl}/api/me/jambot-sharing/${claimed.grant.id}`, {
      method: "DELETE",
      headers: { cookie: `lore_sid=${sidA}`, origin: sameOrigin() },
    });
    expect(revoke.status).toBe(200);
    const relink = await claim(nextOwner.body.handoffToken!, sidB);
    expect(relink.status).toBe(201);
  });

  it("accepts bot-authenticated scopes when API channel pin is unset, without widening channel reads", async () => {
    if (!dbAvailable) return;
    const configured = process.env.SLACK_CHANNEL_ID;
    delete process.env.SLACK_CHANNEL_ID;
    const alternateChannel = `C_ALT_${run}`;
    let response: Response;
    let body: Awaited<ReturnType<typeof createHandoff>>["body"];
    try {
      ({ response, body } = await createHandoff("U_alt", alternateChannel));
    } finally {
      if (configured === undefined) delete process.env.SLACK_CHANNEL_ID;
      else process.env.SLACK_CHANNEL_ID = configured;
    }
    expect(response!.status).toBe(201);
    const paired = await claim(body!.handoffToken!, sidB);
    expect(paired.status).toBe(201);
    delete process.env.SLACK_CHANNEL_ID;
    let outOfScope: Response;
    try {
      outOfScope = await fetch(
        `${baseUrl}/api/me/jambot-sharing/internal/crossings?workspaceId=${workspace}&channelId=${alternateChannel}&slackUserId=U_not_granted`,
        { headers: { "x-lore-internal-secret": secret } },
      );
    } finally {
      if (configured === undefined) delete process.env.SLACK_CHANNEL_ID;
      else process.env.SLACK_CHANNEL_ID = configured;
    }
    expect(outOfScope!.status).toBe(404);
  });

  it("rejects bot reads after revocation and returns no user or library details", async () => {
    if (!dbAvailable) return;
    await db.update(loreSharingGrantsTable)
      .set({ revokedAt: new Date() })
      .where(eq(loreSharingGrantsTable.workspaceId, workspace));
    const response = await fetch(
      `${baseUrl}/api/me/jambot-sharing/internal/crossings?workspaceId=${workspace}&channelId=${channel}&slackUserId=U_verified`,
      { headers: { "x-lore-internal-secret": secret } },
    );
    expect(response.status).toBe(404);
    const body = await response.json() as Record<string, unknown>;
    expect(JSON.stringify(body)).not.toMatch(/lore_sid|Private test artist|Private test title|journal|mbid/i);
  });
});