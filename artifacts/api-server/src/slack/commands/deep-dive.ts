import type { App } from "@slack/bolt";
import { getUserBySlackId } from "../../spotify/client";
import { trackDeepDive, findArtistConnections } from "../../services/artist-intel";
import { getAllConnectedUsers } from "../../spotify/client";
import { refreshAllUsersData } from "../../spotify/data";
import {
  headerBlock, markdownBlock, trackBlock, dividerBlock,
  audioProfileBlock, footerBlock, errorBlocks, contextBlock,
} from "../format";

export function registerDeepDiveCommand(app: App) {
  app.command("/tunepool-dive", async ({ command, ack, respond }) => {
    await ack();

    const query = command.text?.trim();
    if (!query) {
      await respond({
        response_type: "ephemeral",
        blocks: [
          markdownBlock(
            `:mag: *Track Deep Dive* — Get the full breakdown on any song.\n\nUsage: \`/tunepool-dive song name\`\nExample: \`/tunepool-dive Redbone Childish Gambino\``
          ),
          footerBlock(),
        ],
      });
      return;
    }

    try {
      const user = await getUserBySlackId(command.user_id);
      if (!user?.spotifyAccessToken) {
        await respond({ response_type: "ephemeral", blocks: errorBlocks("Connect your Spotify first with `/tunepool-connect`!") });
        return;
      }

      await respond({
        response_type: "in_channel",
        blocks: [markdownBlock(`:mag: Diving deep into *${query}*...`)],
      });

      const dive = await trackDeepDive(user, query);
      if (!dive) {
        await respond({ response_type: "in_channel", blocks: errorBlocks(`Couldn't find a track matching "${query}". Try a more specific search!`) });
        return;
      }

      const blocks: any[] = [
        headerBlock("Track Deep Dive"),
        trackBlock(dive.trackName, dive.artistNames, dive.albumImageUrl,
          `_${dive.albumName}_ · ${dive.releaseDate || "Unknown"} · ${dive.durationFormatted}`
        ),
        dividerBlock(),
      ];

      if (dive.audioProfile) {
        blocks.push(
          markdownBlock(`*Vibe:* ${dive.energyLabel} · ${dive.moodLabel}`)
        );
        blocks.push(audioProfileBlock(dive.audioProfile));
        blocks.push(dividerBlock());
      }

      if (dive.funFacts.length > 0) {
        blocks.push(
          markdownBlock(
            `:bulb: *Did You Know?*\n${dive.funFacts.map((f) => `• ${f}`).join("\n")}`
          )
        );
        blocks.push(dividerBlock());
      }

      if (dive.artistGenres.length > 0) {
        blocks.push(
          markdownBlock(`*Artist Genres:* ${dive.artistGenres.slice(0, 6).join(", ")}`)
        );
      }

      if (dive.whoHasIt.length > 0) {
        blocks.push(
          markdownBlock(`:eyes: *Who has this track:* ${dive.whoHasIt.join(", ")}`)
        );
      } else {
        blocks.push(
          markdownBlock(`:new: *Nobody in the group has this one yet!*`)
        );
      }

      blocks.push(
        contextBlock(`Popularity: ${dive.popularity}/100 · ${dive.artistNames[0]} has ${dive.artistPopularity}/100 artist popularity`)
      );
      blocks.push(footerBlock());

      await respond({ response_type: "in_channel", blocks });
    } catch (err) {
      console.error("Deep dive error:", err);
      await respond({ response_type: "ephemeral", blocks: errorBlocks("Something went wrong with the deep dive.") });
    }
  });

  app.command("/tunepool-connections", async ({ command, ack, respond }) => {
    await ack();

    try {
      const users = await getAllConnectedUsers();
      if (users.length < 2) {
        await respond({ response_type: "ephemeral", blocks: errorBlocks("Need at least 2 connected users!") });
        return;
      }

      await respond({
        response_type: "in_channel",
        blocks: [markdownBlock(":hourglass_flowing_sand: Mapping artist connections across the group...")],
      });

      await refreshAllUsersData(users);
      const connections = await findArtistConnections(users);

      if (connections.length === 0) {
        await respond({
          response_type: "in_channel",
          blocks: errorBlocks("No artist connections found yet. The group needs more diverse listening history!"),
        });
        return;
      }

      const blocks: any[] = [
        headerBlock("Artist Connection Map"),
        markdownBlock(`:spider_web: *How your artists connect across the group*`),
        dividerBlock(),
      ];

      for (const conn of connections.slice(0, 12)) {
        blocks.push(
          markdownBlock(
            `*${conn.artist1}* (${conn.artist1Owner}) :left_right_arrow: *${conn.artist2}* (${conn.artist2Owner})\n_${conn.connectionType}_`
          )
        );
      }

      if (connections.length > 12) {
        blocks.push(contextBlock(`_...and ${connections.length - 12} more connections_`));
      }

      blocks.push(footerBlock());
      await respond({ response_type: "in_channel", blocks });
    } catch (err) {
      console.error("Connections error:", err);
      await respond({ response_type: "ephemeral", blocks: errorBlocks("Something went wrong mapping connections.") });
    }
  });
}
