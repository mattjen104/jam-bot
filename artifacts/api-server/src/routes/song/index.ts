import { Router, type IRouter } from "express";
import {
  ResolveSongQueryParams,
  ResolveSongResponse,
  GetSongContextParams,
  GetSongContextResponse,
  GetOembedQueryParams,
  GetOembedResponse,
} from "@workspace/api-zod";
import {
  searchTrack,
  getTrackById,
  fetchOEmbed,
  spotifyAppConfigured,
  type SpotifyTrackRaw,
} from "../../spotify/appClient.js";
import { buildSongContext } from "../../song/enrichment.js";

const router: IRouter = Router();

/** Shape a raw Spotify track into the public ResolvedSong, with oEmbed HTML. */
async function toResolvedSong(track: SpotifyTrackRaw) {
  const oembed = await fetchOEmbed(track.spotifyUrl);
  return {
    id: track.id,
    name: track.name,
    artists: track.artists.map((a) => a.name),
    album: track.album,
    imageUrl: track.imageUrl,
    spotifyUrl: track.spotifyUrl,
    oEmbedHtml: oembed?.html ?? null,
  };
}

// GET /api/song/resolve?q=...
router.get("/song/resolve", async (req, res) => {
  // The generated schema uses `coerce.string()`, which turns a missing param
  // into "undefined" rather than failing, so guard presence explicitly first.
  const rawQ = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (!rawQ) {
    return res.status(400).json({ error: "A non-empty 'q' query is required" });
  }
  const parsed = ResolveSongQueryParams.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "A non-empty 'q' query is required" });
  }
  if (!spotifyAppConfigured()) {
    return res
      .status(503)
      .json({ error: "Spotify is not configured (set SPOTIFY_CLIENT_ID/SECRET)" });
  }
  try {
    const track = await searchTrack(parsed.data.q);
    if (!track) {
      return res.status(404).json({ error: "No matching track found" });
    }
    const data = ResolveSongResponse.parse(await toResolvedSong(track));
    return res.json(data);
  } catch (err) {
    console.error("[song] resolve failed", err);
    return res.status(503).json({ error: "Spotify lookup failed" });
  }
});

// GET /api/song/oembed?url=...  (public, no credentials)
router.get("/song/oembed", async (req, res) => {
  const rawUrl = typeof req.query.url === "string" ? req.query.url.trim() : "";
  if (!rawUrl) {
    return res.status(400).json({ error: "A non-empty 'url' query is required" });
  }
  const parsed = GetOembedQueryParams.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "A non-empty 'url' query is required" });
  }
  const oembed = await fetchOEmbed(parsed.data.url);
  if (!oembed) {
    return res.status(400).json({ error: "Could not fetch oEmbed for that URL" });
  }
  const data = GetOembedResponse.parse(oembed);
  return res.json(data);
});

// GET /api/song/:trackId/context
router.get("/song/:trackId/context", async (req, res) => {
  const parsed = GetSongContextParams.safeParse(req.params);
  if (!parsed.success) {
    return res.status(404).json({ error: "Track not found" });
  }
  if (!spotifyAppConfigured()) {
    return res
      .status(503)
      .json({ error: "Spotify is not configured (set SPOTIFY_CLIENT_ID/SECRET)" });
  }
  try {
    const track = await getTrackById(parsed.data.trackId);
    if (!track) {
      return res.status(404).json({ error: "Track not found" });
    }
    const [resolved, ctx] = await Promise.all([
      toResolvedSong(track),
      buildSongContext(track),
    ]);
    const data = GetSongContextResponse.parse({
      track: resolved,
      knowledge: ctx.knowledge,
      context: ctx.context,
      catalogue: ctx.catalogue,
      links: ctx.links,
      insights: ctx.insights,
    });
    return res.json(data);
  } catch (err) {
    console.error("[song] context failed", err);
    return res.status(503).json({ error: "Song context lookup failed" });
  }
});

export default router;
