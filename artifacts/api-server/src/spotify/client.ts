import SpotifyWebApi from "spotify-web-api-node";
import { db } from "@workspace/db";
import { usersTable, type User } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { createSpotifyClient } from "./auth";

export async function getAuthenticatedClient(user: User): Promise<SpotifyWebApi> {
  const client = createSpotifyClient();

  if (!user.spotifyAccessToken || !user.spotifyRefreshToken) {
    throw new Error("User has not connected Spotify");
  }

  client.setAccessToken(user.spotifyAccessToken);
  client.setRefreshToken(user.spotifyRefreshToken);

  if (user.spotifyTokenExpiresAt && new Date() >= user.spotifyTokenExpiresAt) {
    const refreshed = await client.refreshAccessToken();
    const newExpiresAt = new Date(Date.now() + refreshed.body.expires_in * 1000);

    await db
      .update(usersTable)
      .set({
        spotifyAccessToken: refreshed.body.access_token,
        spotifyTokenExpiresAt: newExpiresAt,
        updatedAt: new Date(),
      })
      .where(eq(usersTable.id, user.id));

    client.setAccessToken(refreshed.body.access_token);
  }

  return client;
}

export async function getUserBySlackId(slackUserId: string): Promise<User | null> {
  const results = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.slackUserId, slackUserId))
    .limit(1);
  return results[0] || null;
}

export async function getAllConnectedUsers(): Promise<User[]> {
  const results = await db
    .select()
    .from(usersTable);
  return results.filter((u) => u.spotifyAccessToken && u.spotifyRefreshToken);
}
