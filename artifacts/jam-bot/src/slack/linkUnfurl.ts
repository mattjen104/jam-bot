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

interface ShareResponse {
  mbid: string;
  redirectPath: string;
  card: {
    title: string;
    subtitle: string;
    artworkUrl?: string | null;
  };
  song: {
    links: LoreLink[];
    liveStation: { name: string; slug: string } | null;
    ghostRun: { stationName: string; runId: number; playedAt: string } | null;
  };
}

async function fetchSharePayload(params: {
  spotifyTrackId?: string;
  artist?: string;
  title?: string;
}): Promise<ShareResponse | null> {
  const qs = new URLSearchParams();
  if (params.spotifyTrackId) qs.set("spotifyId", params.spotifyTrackId);
  if (params.artist) qs.set("artist", params.artist);
  if (params.title) qs.set("title", params.title);
  if (!qs.toString()) return null;

  try {
    // /share/resolve/song avoids the :mbid param-shadow bug in Express
    const res = await fetch(`${config.LORE_API_BASE}/share/resolve/song?${qs}`, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as ShareResponse;
  } catch {
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
function loreLine(payload: ShareResponse, publicUrl: string): string {
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
  thumbnailUrl?: string,
): unknown[] {
  const { card, song } = payload;
  const artworkUrl = card.artworkUrl ?? thumbnailUrl ?? null;

  // Prefer exact links; cap at 5 for context row readability.
  const exact = song.links.filter((l) => l.kind === "exact");
  const displayLinks = (exact.length > 0 ? exact : song.links).slice(0, 5);

  const blocks: unknown[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${card.title}*  ·  ${card.subtitle}`,
      },
      ...(artworkUrl
        ? {
            accessory: {
              type: "image",
              image_url: artworkUrl,
              alt_text: card.title,
            },
          }
        : {}),
    },
  ];

  if (publicUrl) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: loreLine(payload, publicUrl) },
    });
  }

  if (displayLinks.length > 0) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: displayLinks.map((l) => `<${l.url}|${l.name}>`).join("  ·  "),
        },
      ],
    });
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
        if (!resolved) return;

        const payload = await fetchSharePayload({
          spotifyTrackId: resolved.spotifyTrackId,
          artist: resolved.artist,
          title: resolved.title,
        });
        if (!payload) return;

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

  if (Object.keys(unfurls).length === 0) return;

  try {
    // unfurls is {[url]: MessageAttachment}; Bolt's WebClient types it as
    // LinkUnfurls which is assignable — cast through unknown to satisfy TS.
    await client.chat.unfurl({
      channel: event.channel,
      ts: event.message_ts,
      unfurls,
    });
  } catch (err) {
    logger.warn("[linkUnfurl] chat.unfurl failed", { error: String(err) });
  }
}
