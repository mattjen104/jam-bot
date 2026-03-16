import type { App } from "@slack/bolt";
import { getUserBySlackId, getAllConnectedUsers } from "../../spotify/client";
import { refreshAllUsersData } from "../../spotify/data";
import { buildPairBlend, createSpotifyPlaylist } from "../../services/blend";
import {
  headerBlock, markdownBlock, trackBlock, dividerBlock,
  buttonBlock, footerBlock, errorBlocks, contextBlock,
} from "../format";

export function registerPairBlendCommand(app: App) {
  app.command("/tunepool-pair", async ({ command, ack, respond }) => {
    await ack();

    const mentionedUser = command.text?.trim().replace(/<@([A-Z0-9]+)\|?[^>]*>/g, "$1");

    if (!mentionedUser) {
      await respond({
        response_type: "ephemeral",
        blocks: [
          markdownBlock(
            `:couple: *Pair Blend* — See your taste compatibility with someone.\n\nUsage: \`/tunepool-pair @username\``
          ),
          footerBlock(),
        ],
      });
      return;
    }

    try {
      const user1 = await getUserBySlackId(command.user_id);
      const user2 = await getUserBySlackId(mentionedUser);

      if (!user1?.spotifyAccessToken) {
        await respond({ response_type: "ephemeral", blocks: errorBlocks("You need to connect Spotify first! Run `/tunepool-connect`") });
        return;
      }
      if (!user2?.spotifyAccessToken) {
        await respond({ response_type: "ephemeral", blocks: errorBlocks("That person hasn't connected their Spotify yet!") });
        return;
      }

      await respond({
        response_type: "in_channel",
        blocks: [markdownBlock(`:hourglass_flowing_sand: Calculating taste compatibility...`)],
      });

      await refreshAllUsersData([user1, user2]);
      const result = await buildPairBlend(user1, user2);

      const compatEmoji = result.compatibility > 75 ? ":fire:" : result.compatibility > 50 ? ":handshake:" : ":thinking_face:";

      const blocks: any[] = [
        headerBlock(`${user1.spotifyDisplayName} × ${user2.spotifyDisplayName}`),
        markdownBlock(
          `${compatEmoji} *Taste Compatibility: ${result.compatibility}%*`
        ),
      ];

      if (result.insights.length > 0) {
        blocks.push(markdownBlock(result.insights.map((i) => `• ${i}`).join("\n")));
      }

      blocks.push(dividerBlock());
      blocks.push(markdownBlock("*Your Blend Tracks:*"));

      for (const track of result.tracks.slice(0, 8)) {
        const sharedLabel = track.sharedBy.length > 1
          ? `:people_holding_hands: Both`
          : `:bust_in_silhouette: ${track.sharedBy[0]}`;
        blocks.push(trackBlock(track.trackName, track.artistNames, track.albumImageUrl, sharedLabel));
      }

      blocks.push(dividerBlock());
      blocks.push(
        buttonBlock([
          {
            text: "Create Pair Playlist",
            actionId: "create_blend_playlist",
            value: JSON.stringify({ trackIds: result.tracks.map((t) => t.spotifyTrackId), type: "pair_blend" }),
            style: "primary",
          },
        ])
      );
      blocks.push(footerBlock());

      await respond({ response_type: "in_channel", blocks });
    } catch (err) {
      console.error("Pair blend error:", err);
      await respond({ response_type: "ephemeral", blocks: errorBlocks("Something went wrong with the pair blend.") });
    }
  });
}
