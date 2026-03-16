import type { App } from "@slack/bolt";
import { getAllConnectedUsers } from "../../spotify/client";
import { refreshAllUsersData } from "../../spotify/data";
import { findHiddenGems } from "../../services/discovery";
import { whobroughtItFirst } from "../../services/discovery";
import { createSpotifyPlaylist } from "../../services/blend";
import { getUserBySlackId } from "../../spotify/client";
import {
  headerBlock, markdownBlock, trackBlock, dividerBlock,
  buttonBlock, footerBlock, errorBlocks, contextBlock,
} from "../format";

export function registerHiddenGemsCommand(app: App) {
  app.command("/tunepool-gems", async ({ command, ack, respond }) => {
    await ack();

    try {
      const users = await getAllConnectedUsers();
      if (users.length < 2) {
        await respond({ response_type: "ephemeral", blocks: errorBlocks("Need at least 2 connected users!") });
        return;
      }

      await respond({
        response_type: "in_channel",
        blocks: [markdownBlock(":hourglass_flowing_sand: Digging for hidden gems...")],
      });

      await refreshAllUsersData(users);
      const gems = await findHiddenGems(users);

      if (gems.length === 0) {
        await respond({ response_type: "in_channel", blocks: errorBlocks("No unique gems found. Your taste might be more similar than you think!") });
        return;
      }

      const blocks: any[] = [
        headerBlock("Hidden Gems"),
        markdownBlock(`:gem: *Tracks that only one person knows about — recommendations from each other's libraries*`),
        dividerBlock(),
      ];

      for (const gem of gems.slice(0, 12)) {
        blocks.push(
          trackBlock(gem.trackName, gem.artistNames, gem.albumImageUrl,
            `:bust_in_silhouette: From ${gem.ownedBy}'s collection`
          )
        );
      }

      blocks.push(dividerBlock());
      blocks.push(
        buttonBlock([
          {
            text: "Create Gems Playlist",
            actionId: "create_blend_playlist",
            value: JSON.stringify({ trackIds: gems.map((g) => g.spotifyTrackId), type: "hidden_gems" }),
            style: "primary",
          },
        ])
      );
      blocks.push(footerBlock());

      await respond({ response_type: "in_channel", blocks });
    } catch (err) {
      console.error("Hidden gems error:", err);
      await respond({ response_type: "ephemeral", blocks: errorBlocks("Something went wrong finding gems.") });
    }
  });

  app.command("/tunepool-whofirst", async ({ command, ack, respond }) => {
    await ack();

    try {
      const users = await getAllConnectedUsers();
      if (users.length < 2) {
        await respond({ response_type: "ephemeral", blocks: errorBlocks("Need at least 2 connected users!") });
        return;
      }

      await respond({
        response_type: "in_channel",
        blocks: [markdownBlock(":hourglass_flowing_sand: Tracing who discovered what first...")],
      });

      await refreshAllUsersData(users);
      const shared = await whobroughtItFirst(users);

      if (shared.length === 0) {
        await respond({ response_type: "in_channel", blocks: errorBlocks("No shared tracks found to trace. Keep listening!") });
        return;
      }

      const blocks: any[] = [
        headerBlock("Who Brought It First?"),
        markdownBlock(`:detective: *Tracks shared across the group — who discovered them earliest?*`),
        dividerBlock(),
      ];

      for (const track of shared.slice(0, 10)) {
        blocks.push(
          trackBlock(track.trackName, track.artistNames, track.albumImageUrl,
            track.sharedBy.map((s, i) => `${i === 0 ? ":first_place_medal:" : `:${i + 1}:`} ${s}`).join("\n")
          )
        );
      }

      blocks.push(footerBlock());
      await respond({ response_type: "in_channel", blocks });
    } catch (err) {
      console.error("Who first error:", err);
      await respond({ response_type: "ephemeral", blocks: errorBlocks("Something went wrong tracing tracks.") });
    }
  });
}
