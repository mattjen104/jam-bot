import { logger } from "../logger.js";
import { config } from "../config.js";
import { resolveAnyUrl } from "../turntable/odesli.js";

/**
 * Lore link unfurler for the jam-bot.
 *
 * When someone pastes a music service URL (Spotify, Apple Music, Bandcamp,
 * etc.) in Slack, the `link_shared` event fires here. We:
 *   1. Resolve the URL via Odesli → artist / title / Spotify track ID.
 *   2. Look up the Lore recording via the API server's /share/resolve/song.
 *   3. Build a Block Kit card (artwork, song info, live/ghost Lore link,
 *      service buttons) and call chat.unfurl to replace Slack's default preview.
 *
 * Rules:
 *   - Live station always trumps ghost radio — only one Lore option is shown.
 *   - If Odesli or the Lore API can't resolve the link, we silently skip
 *     (Slack falls back to its own unfurl for that URL).
 *   - Never throws — all errors are logged at warn level.
 */

/** Streaming service domains we intercept. */
const MUSIC_DOMAINS = new Set([
  "open.spotify.com",
  "music.apple.com",
  "music.youtube.com",
  "bandcamp.com",
  "soundcloud.com",
  "tidal.com",
]);

interface LoreLink {
  name: string;
  url: string;
  kind: "exact" | "search";
}

interface ShareCard {
  title: string;
  subtitle: string;
  artworkUrl?: string | null;
}

interface ShareSong {
  links: LoreLink[];
  liveStation: { name: string; slug: string } | null;
  ghostRun: { stationName: string; runId: number; playedAt: string } | null;
}

/**
 * The API returns one of two shapes, distinguished by `kind`:
 *   - "lore": the song has a real Lore page (already in the library or it aired
 *     on a station) — carries mbid + redirectPath + live/ghost context.
 *   - "links-only": the song has no Lore presence — just cross-service links
 *     (incl. Qobuz), no story link, and it is NOT persisted server-side.
 */
type ShareResponse =
  | ({ kind: "lore"; mbid: string; redirectPath: string; card: ShareCard; song: ShareSong })
  | { kind: "links-only"; card: ShareCard; song: ShareSong };

async function fetchSharePayload(params: {
  spotifyTrackId?: string;
  isrc?: string;
  artist?: string;
  title?: string;
  thumbnailUrl?: string;
  /** Exact platform links already resolved by the bot's Odesli call — passed
   *  through so the API server skips its own second Odesli round-trip. */
  platforms?: Array<{ name: string; url: string }>;
}): Promise<ShareResponse | null> {
  // Need at least one strong identifier to resolve on: artist+title, a Spotify
  // track id, or an ISRC. (A Spotify id alone still yields cross-service links.)
  const hasText = Boolean(params.artist && params.title);
  if (!hasText && !params.spotifyTrackId && !params.isrc) return null;

  try {
    // /share/resolve/song avoids the :mbid param-shadow bug in Express.
    // POST is read-only w.r.t. the library: it never writes a pasted song
    // (aired songs are already persisted, so they resolve as existing records).
    const res = await fetch(`${config.LORE_API_BASE}/share/resolve/song`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        spotifyTrackId: params.spotifyTrackId,
        isrc: params.isrc,
        artist: params.artist,
        title: params.title,
        thumbnailUrl: params.thumbnailUrl,
        ...(params.platforms?.length ? { platforms: params.platforms } : {}),
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      let body = "";
      try { body = await res.text(); } catch { /* ignore */ }
      logger.warn("[linkUnfurl] share API non-OK", {
        status: res.status,
        url: `${config.LORE_API_BASE}/share/resolve/song`,
        body: body.slice(0, 300),
      });
      return null;
    }
    return (await res.json()) as ShareResponse;
  } catch (err) {
    const cause = (err instanceof Error && (err as NodeJS.ErrnoException).cause)
      ? String((err as NodeJS.ErrnoException).cause)
      : undefined;
    logger.warn("[linkUnfurl] share API fetch threw", {
      error: String(err),
      cause,
      url: `${config.LORE_API_BASE}/share/resolve/song`,
    });
    return null;
  }
}

/** Lore public base URL — prefers explicit config, falls back to REPLIT_DEV_DOMAIN. */
function getLorePublicUrl(): string | null {
  if (config.LORE_PUBLIC_URL) return config.LORE_PUBLIC_URL;
  const dev = process.env.REPLIT_DEV_DOMAIN;
  return dev ? `https://${dev}` : null;
}

/** Build the single Lore mrkdwn line: live station > ghost run > story link. */
function loreLine(
  payload: Extract<ShareResponse, { kind: "lore" }>,
  publicUrl: string,
): string {
  const { liveStation, ghostRun } = payload.song;
  const storyUrl = `${publicUrl}${payload.redirectPath}`;

  if (liveStation) {
    const url = `${publicUrl}/lore/archive/stations/${liveStation.slug}`;
    return `🟢 *Live on ${liveStation.name} right now* — <${url}|tune in>`;
  }
  if (ghostRun) {
    const url = `${publicUrl}/lore/archive/station-runs/${ghostRun.runId}?play=1&from=${encodeURIComponent(payload.mbid)}`;
    const date = new Date(ghostRun.playedAt).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
    return `⬡ Last played on ${ghostRun.stationName} · ${date} — <${url}|listen to that broadcast>`;
  }
  return `<${storyUrl}|View full story on Lore →>`;
}

/** Build Block Kit blocks for a single resolved link. */
function buildBlocks(
  payload: ShareResponse,
  publicUrl: string | null,
  _thumbnailUrl?: string,
): unknown[] {
  const { card, song } = payload;

  // No artwork accessory — the source platform's own unfurl (e.g. Spotify)
  // already shows the cover art above us; duplicating it wastes space.
  const blocks: unknown[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${card.title}*  ·  ${card.subtitle}`,
      },
    },
  ];

  if (publicUrl && payload.kind === "lore") {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: loreLine(payload, publicUrl) },
    });
  }

  // Split into two tiers:
  //   exact  — deep-links resolved by Odesli; shown as plain service names
  //   search — fallback search URLs; prefixed with ↗ so the user knows it's
  //            a search, not a direct track link
  const exactLinks = song.links.filter((l) => l.kind === "exact");
  const searchLinks = song.links.filter((l) => l.kind === "search");

  const contextElements: unknown[] = [];

  if (exactLinks.length > 0) {
    contextElements.push({
      type: "mrkdwn",
      text: exactLinks.map((l) => `<${l.url}|${l.name}>`).join("  ·  "),
    });
  }

  if (searchLinks.length > 0) {
    contextElements.push({
      type: "mrkdwn",
      text:
        "↗  " +
        searchLinks.map((l) => `<${l.url}|${l.name}>`).join("  ·  "),
    });
  }

  if (contextElements.length > 0) {
    blocks.push({ type: "context", elements: contextElements });
  }

  return blocks;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySlackClient = any;

/**
 * Returns true if the channel should receive Lore unfurls.
 * Allowed: the configured jam channel, or any DM (channel id starts with "D").
 * Everything else (other public/private channels) is silently ignored so the
 * bot doesn't replace previews in channels it wasn't set up for.
 */
function isAllowedChannel(channel: string, jamChannelId: string): boolean {
  return channel === jamChannelId || channel.startsWith("D");
}

export async function handleLinkShared(
  event: {
    channel: string;
    message_ts: string;
    links: Array<{ domain: string; url: string }>;
    unfurl_id?: string;
    source?: string;
  },
  client: AnySlackClient,
  jamChannelId: string,
): Promise<void> {
  if (!isAllowedChannel(event.channel, jamChannelId)) return;

  const musicLinks = event.links.filter((l) => MUSIC_DOMAINS.has(l.domain));
  if (musicLinks.length === 0) return;

  const publicUrl = getLorePublicUrl();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const unfurls: Record<string, any> = {};

  await Promise.all(
    musicLinks.map(async ({ url }) => {
      try {
        const resolved = await resolveAnyUrl(url);
        if (!resolved) {
          logger.warn("[linkUnfurl] odesli returned null", { url });
          return;
        }
        logger.info("[linkUnfurl] odesli resolved", {
          url,
          spotifyTrackId: resolved.spotifyTrackId,
          artist: resolved.artist,
          title: resolved.title,
        });

        const payload = await fetchSharePayload({
          spotifyTrackId: resolved.spotifyTrackId,
          artist: resolved.artist,
          title: resolved.title,
          thumbnailUrl: resolved.thumbnailUrl,
          platforms: resolved.platforms,
        });
        if (!payload) {
          logger.warn("[linkUnfurl] fetchSharePayload returned null", {
            url,
            spotifyTrackId: resolved.spotifyTrackId,
          });
          return;
        }
        logger.info("[linkUnfurl] payload resolved", {
          kind: payload.kind,
          title: payload.card.title,
          linkCount: payload.song.links.length,
        });

        const blocks = buildBlocks(payload, publicUrl, resolved.thumbnailUrl);
        unfurls[url] = { blocks, color: "#2a2520" };
      } catch (err) {
        logger.warn("[linkUnfurl] resolution failed", {
          url,
          error: String(err),
        });
      }
    }),
  );

  if (Object.keys(unfurls).length === 0) {
    logger.warn("[linkUnfurl] no unfurls built, skipping chat.unfurl");
    return;
  }

  try {
    // Slack uses two different unfurl patterns:
    //   Channels: channel + ts  (old pattern, no unfurl_id)
    //   DMs/IMs:  unfurl_id + source  (new pattern, Slack sends these fields)
    // Using channel+ts in a DM silently fails — Slack ignores it.
    const unfurlArgs = event.unfurl_id && event.source
      ? { unfurl_id: event.unfurl_id, source: event.source, unfurls }
      : { channel: event.channel, ts: event.message_ts, unfurls };
    await client.chat.unfurl(unfurlArgs);
  } catch (err) {
    logger.warn("[linkUnfurl] chat.unfurl failed", { error: String(err) });
  }
}
