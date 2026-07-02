import type { NowPlayingAdapter, NowPlayingRaw } from "./types.js";

/**
 * Per-source now-playing adapter registry. Each station names its
 * `nowPlayingSource`; the poller looks the adapter up here. Adding a new source
 * (FIP, community stations, ...) is a matter of writing one adapter and
 * registering it — nothing else in the pipeline changes.
 *
 * Every adapter reads the station's *own* published now-playing feed. We never
 * fingerprint audio or touch the stream itself; we only cross-reference what the
 * broadcaster says is on air against the MusicBrainz spine.
 */

const FETCH_TIMEOUT_MS = 8000;

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/**
 * Radio Paradise — a single JSON now-playing endpoint per channel. Gives
 * artist/title/album/cover but no MBID or ISRC, so these resolve via text search.
 * Config: `{ chan: "0" }` (0=Main, 1=Mellow, 2=Rock, ...).
 */
const radioParadise: NowPlayingAdapter = async (config) => {
  const chan = str(config.chan) ?? "0";
  const body = (await getJson(
    `https://api.radioparadise.com/api/now_playing?chan=${encodeURIComponent(chan)}`,
  )) as Record<string, unknown>;
  const rawArtist = str(body.artist);
  const rawTitle = str(body.title);
  if (!rawArtist || !rawTitle) return null;
  const out: NowPlayingRaw = { rawArtist, rawTitle };
  const album = str(body.album);
  if (album) out.album = album;
  const artwork = str(body.cover);
  if (artwork) out.artworkUrl = artwork;
  return out;
};

/**
 * KEXP (Seattle) — the v2 plays feed. Crucially it already carries a MusicBrainz
 * `recording_id`, so these land on the spine with no resolution step. `airbreak`
 * / non-trackplay entries are skipped.
 */
const kexp: NowPlayingAdapter = async () => {
  const body = (await getJson(
    "https://api.kexp.org/v2/plays/?format=json&limit=1",
  )) as { results?: Array<Record<string, unknown>> };
  const play = body.results?.[0];
  if (!play) return null;
  if (str(play.play_type) && play.play_type !== "trackplay") return null;
  const rawArtist = str(play.artist);
  const rawTitle = str(play.song);
  if (!rawArtist || !rawTitle) return null;
  const out: NowPlayingRaw = { rawArtist, rawTitle };
  const album = str(play.album);
  if (album) out.album = album;
  const artwork = str(play.image_uri) ?? str(play.thumbnail_uri);
  if (artwork) out.artworkUrl = artwork;
  const recordingId = str(play.recording_id);
  if (recordingId) out.recordingId = recordingId;
  return out;
};

const ADAPTERS: Record<string, NowPlayingAdapter> = {
  radio_paradise: radioParadise,
  kexp,
};

/** Look up a now-playing adapter by source key, or null when unknown. */
export function getAdapter(source: string | null | undefined): NowPlayingAdapter | null {
  if (!source) return null;
  return ADAPTERS[source] ?? null;
}
