import SpotifyWebApi from "spotify-web-api-node";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import crypto from "crypto";

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || "";
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || "";
const SPOTIFY_SCOPES = [
  "user-top-read",
  "user-read-recently-played",
  "user-library-read",
  "playlist-modify-public",
  "playlist-modify-private",
  "playlist-read-collaborative",
].join(" ");

const pendingStates = new Map<string, { slackUserId: string; expiresAt: number }>();

function getRedirectUri(): string {
  const domains = process.env.REPLIT_DOMAINS || process.env.REPLIT_DEV_DOMAIN || "localhost";
  const domain = domains.split(",")[0];
  const protocol = domain.includes("localhost") ? "http" : "https";
  return `${protocol}://${domain}/api/spotify/callback`;
}

export function createSpotifyClient(): SpotifyWebApi {
  return new SpotifyWebApi({
    clientId: SPOTIFY_CLIENT_ID,
    clientSecret: SPOTIFY_CLIENT_SECRET,
    redirectUri: getRedirectUri(),
  });
}

export function generateAuthUrl(slackUserId: string): string {
  const state = crypto.randomBytes(16).toString("hex");
  pendingStates.set(state, {
    slackUserId,
    expiresAt: Date.now() + 10 * 60 * 1000,
  });

  const client = createSpotifyClient();
  return client.createAuthorizeURL(SPOTIFY_SCOPES.split(" "), state, true);
}

export function getStateData(state: string) {
  const data = pendingStates.get(state);
  if (!data) return null;
  if (Date.now() > data.expiresAt) {
    pendingStates.delete(state);
    return null;
  }
  pendingStates.delete(state);
  return data;
}

export async function handleCallback(code: string, state: string) {
  const stateData = getStateData(state);
  if (!stateData) {
    throw new Error("Invalid or expired state");
  }

  const client = createSpotifyClient();
  const tokenResponse = await client.authorizationCodeGrant(code);

  client.setAccessToken(tokenResponse.body.access_token);
  client.setRefreshToken(tokenResponse.body.refresh_token);

  const me = await client.getMe();

  const expiresAt = new Date(Date.now() + tokenResponse.body.expires_in * 1000);

  const existing = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.slackUserId, stateData.slackUserId))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(usersTable)
      .set({
        spotifyUserId: me.body.id,
        spotifyDisplayName: me.body.display_name || me.body.id,
        spotifyAccessToken: tokenResponse.body.access_token,
        spotifyRefreshToken: tokenResponse.body.refresh_token,
        spotifyTokenExpiresAt: expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(usersTable.slackUserId, stateData.slackUserId));
  } else {
    await db.insert(usersTable).values({
      slackUserId: stateData.slackUserId,
      spotifyUserId: me.body.id,
      spotifyDisplayName: me.body.display_name || me.body.id,
      spotifyAccessToken: tokenResponse.body.access_token,
      spotifyRefreshToken: tokenResponse.body.refresh_token,
      spotifyTokenExpiresAt: expiresAt,
    });
  }

  return {
    spotifyDisplayName: me.body.display_name || me.body.id,
    slackUserId: stateData.slackUserId,
  };
}

export function getPublicRedirectUri(): string {
  return getRedirectUri();
}
