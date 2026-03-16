import type { App } from "@slack/bolt";
import { getUserBySlackId, getAllConnectedUsers } from "../../spotify/client";
import { refreshAllUsersData } from "../../spotify/data";
import { buildTasteDNA, buildGroupTasteComparison } from "../../services/taste-analysis";
import {
  headerBlock, markdownBlock, dividerBlock,
  footerBlock, errorBlocks, audioProfileBlock, contextBlock,
} from "../format";

export function registerTasteDNACommand(app: App) {
  app.command("/tunepool-taste", async ({ command, ack, respond }) => {
    await ack();

    const arg = command.text?.trim().toLowerCase();
    const isGroup = arg === "group" || arg === "compare";

    try {
      if (isGroup) {
        const users = await getAllConnectedUsers();
        if (users.length < 2) {
          await respond({ response_type: "ephemeral", blocks: errorBlocks("Need at least 2 connected users for group comparison.") });
          return;
        }

        await respond({
          response_type: "in_channel",
          blocks: [markdownBlock(":hourglass_flowing_sand: Analyzing everyone's taste DNA...")],
        });

        await refreshAllUsersData(users);
        const { profiles, groupInsights } = await buildGroupTasteComparison(users);

        const blocks: any[] = [
          headerBlock("Group Taste DNA"),
          markdownBlock(":dna: *How does everyone's music taste stack up?*"),
          dividerBlock(),
        ];

        for (const profile of profiles) {
          const bar = (val: number) => {
            const filled = Math.round(val * 10);
            return "█".repeat(filled) + "░".repeat(10 - filled);
          };

          blocks.push(
            markdownBlock(
              `*${profile.userName}* — _${profile.vibeLabel}_\n` +
              `Energy: ${bar(profile.avgEnergy)} ${Math.round(profile.avgEnergy * 100)}% | ` +
              `Dance: ${bar(profile.avgDanceability)} ${Math.round(profile.avgDanceability * 100)}% | ` +
              `Mood: ${bar(profile.avgValence)} ${Math.round(profile.avgValence * 100)}%\n` +
              `Top genres: ${profile.topGenres.slice(0, 4).join(", ") || "N/A"}\n` +
              `${profile.totalTracks} tracks · ${profile.totalArtists} artists · ${Math.round(profile.eclecticScore * 100)}% eclectic`
            )
          );
          blocks.push(dividerBlock());
        }

        if (groupInsights.length > 0) {
          blocks.push(markdownBlock("*Group Insights*\n" + groupInsights.map((i) => `• ${i}`).join("\n")));
        }

        blocks.push(footerBlock());
        await respond({ response_type: "in_channel", blocks });
      } else {
        const user = await getUserBySlackId(command.user_id);
        if (!user?.spotifyAccessToken) {
          await respond({ response_type: "ephemeral", blocks: errorBlocks("Connect your Spotify first with `/tunepool-connect`!") });
          return;
        }

        await respond({
          response_type: "ephemeral",
          blocks: [markdownBlock(":hourglass_flowing_sand: Analyzing your taste DNA...")],
        });

        await refreshAllUsersData([user]);
        const profile = await buildTasteDNA(user);

        const blocks: any[] = [
          headerBlock(`${profile.userName}'s Taste DNA`),
          markdownBlock(`:dna: *${profile.vibeLabel}*`),
          audioProfileBlock({
            energy: profile.avgEnergy,
            danceability: profile.avgDanceability,
            valence: profile.avgValence,
            tempo: profile.avgTempo,
            acousticness: profile.avgAcousticness,
          }),
          dividerBlock(),
          markdownBlock(
            `*Top Genres:* ${profile.topGenres.join(", ") || "Not enough data yet"}\n` +
            `*Tracks in library:* ${profile.totalTracks}\n` +
            `*Artists:* ${profile.totalArtists}\n` +
            `*Eclectic Score:* ${Math.round(profile.eclecticScore * 100)}% genre diversity`
          ),
          contextBlock("_Use `/tunepool-taste group` to compare with everyone_"),
          footerBlock(),
        ];

        await respond({ response_type: "ephemeral", blocks });
      }
    } catch (err) {
      console.error("Taste DNA error:", err);
      await respond({ response_type: "ephemeral", blocks: errorBlocks("Something went wrong analyzing taste.") });
    }
  });
}
