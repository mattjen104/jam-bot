import type { App } from "@slack/bolt";
import { getUserBySlackId } from "../../spotify/client";
import { generateAuthUrl, getPublicRedirectUri } from "../../spotify/auth";
import { markdownBlock, footerBlock, contextBlock } from "../format";

export function registerConnectCommand(app: App) {
  app.command("/tunepool-connect", async ({ command, ack, respond }) => {
    await ack();

    const existing = await getUserBySlackId(command.user_id);
    if (existing?.spotifyAccessToken) {
      await respond({
        response_type: "ephemeral",
        blocks: [
          markdownBlock(
            `:white_check_mark: You're already connected as *${existing.spotifyDisplayName}* on Spotify!\n\nTo reconnect, just click the link below to re-authorize.`
          ),
          markdownBlock(`<${generateAuthUrl(command.user_id)}|Reconnect Spotify>`),
          footerBlock(),
        ],
      });
      return;
    }

    const authUrl = generateAuthUrl(command.user_id);
    await respond({
      response_type: "ephemeral",
      blocks: [
        markdownBlock(
          `:musical_note: *Connect your Spotify account*\n\nClick the link below to authorize TunePool to read your listening history. This lets us build group blends and discover shared taste.\n\n<${authUrl}|Connect Spotify>`
        ),
        contextBlock(`Your data is only used within this group. The redirect URI is: \`${getPublicRedirectUri()}\` — add this to your Spotify app settings if you haven't already.`),
        footerBlock(),
      ],
    });
  });

  app.event("message", async ({ event, client }) => {
    if (!("channel_type" in event) || event.channel_type !== "im") return;
    if ("bot_id" in event && event.bot_id) return;
    if (!("user" in event) || !event.user) return;
    if (!("text" in event) || !event.text) return;

    const text = (event.text || "").toLowerCase().trim();
    if (text.includes("connect") || text.includes("spotify") || text.includes("login") || text.includes("start")) {
      const authUrl = generateAuthUrl(event.user);
      await client.chat.postMessage({
        channel: event.channel,
        blocks: [
          markdownBlock(
            `:wave: Hey! Click below to connect your Spotify account:\n\n<${authUrl}|Connect Spotify>`
          ),
          footerBlock(),
        ],
      });
    } else {
      await client.chat.postMessage({
        channel: event.channel,
        blocks: [
          markdownBlock(
            `Hey! I'm TunePool — your group's music DJ bot.\n\nSay *connect* to link your Spotify, or use \`/tunepool-help\` in any channel for all commands.`
          ),
          footerBlock(),
        ],
      });
    }
  });
}
