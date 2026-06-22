import SpotifyWebApi from "spotify-web-api-node";

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || "";
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || "";

/**
 * Create a Spotify client configured with the app's client credentials.
 *
 * This is used by the client-credentials app client (`appClient.ts`) that
 * powers the public song-resolution and enrichment routes. There is no user
 * OAuth / redirect flow here.
 */
export function createSpotifyClient(): SpotifyWebApi {
  return new SpotifyWebApi({
    clientId: SPOTIFY_CLIENT_ID,
    clientSecret: SPOTIFY_CLIENT_SECRET,
  });
}
