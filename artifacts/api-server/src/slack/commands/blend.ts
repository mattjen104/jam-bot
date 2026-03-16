import type { App } from "@slack/bolt";
import { getAllConnectedUsers, getUserBySlackId } from "../../spotify/client";
import { refreshAllUsersData } from "../../spotify/data";
import { buildGroupBlend, createSpotifyPlaylist, getAvailableMoods, buildMoodMix } from "../../services/blend";
import {
  headerBlock, markdownBlock, trackBlock, dividerBlock,
  buttonBlock, footerBlock, errorBlocks, contextBlock,
} from "../format";

export function registerBlendCommand(app: App) {
  app.command("/tunepool-blend", async ({ command, ack, respond }) => {
    await ack();

    try {
      const users = await getAllConnectedUsers();
      if (users.length < 2) {
        await respond({ response_type: "ephemeral", blocks: errorBlocks("Need at least 2 connected users. Ask everyone to run `/tunepool-connect`!") });
        return;
      }

      await respond({
        response_type: "in_channel",
        blocks: [markdownBlock(":hourglass_flowing_sand: Mixing everyone's taste... hang tight!")],
      });

      await refreshAllUsersData(users);
      const blend = await buildGroupBlend(users);

      if (blend.length === 0) {
        await respond({ response_type: "in_channel", blocks: errorBlocks("Couldn't find enough tracks to blend. Everyone needs more listening history!") });
        return;
      }

      const blocks: any[] = [
        headerBlock("Group Blend"),
        markdownBlock(
          `:control_knobs: *${users.length} people's taste, one playlist.*\nTracks ranked by how well they match the group's collective vibe.\n\n` +
          `_${users.map((u) => u.spotifyDisplayName || u.slackDisplayName).join(", ")}_`
        ),
        dividerBlock(),
      ];

      for (const track of blend.slice(0, 10)) {
        const sharedLabel = track.sharedBy.length > 1
          ? `:people_holding_hands: ${track.sharedBy.join(", ")}`
          : `:bust_in_silhouette: ${track.sharedBy[0]}`;
        blocks.push(trackBlock(track.trackName, track.artistNames, track.albumImageUrl, sharedLabel));
      }

      if (blend.length > 10) {
        blocks.push(contextBlock(`_...and ${blend.length - 10} more tracks in the full blend_`));
      }

      blocks.push(dividerBlock());
      blocks.push(
        buttonBlock([
          {
            text: "Create Playlist",
            actionId: "create_blend_playlist",
            value: JSON.stringify({ trackIds: blend.map((t) => t.spotifyTrackId), type: "blend" }),
            style: "primary",
          },
        ])
      );
      blocks.push(footerBlock());

      await respond({ response_type: "in_channel", blocks });
    } catch (err) {
      console.error("Blend error:", err);
      await respond({ response_type: "ephemeral", blocks: errorBlocks("Something went wrong building the blend. Try again!") });
    }
  });

  app.command("/tunepool-mood", async ({ command, ack, respond }) => {
    await ack();

    const mood = command.text?.trim().toLowerCase();
    const moods = getAvailableMoods();

    if (!mood || !moods.includes(mood)) {
      await respond({
        response_type: "ephemeral",
        blocks: [
          markdownBlock(
            `:art: *Mood Mixer* — Pick a vibe and I'll build a playlist from everyone's music.\n\nAvailable moods: ${moods.map((m) => `\`${m}\``).join(", ")}\n\nUsage: \`/tunepool-mood chill\``
          ),
          footerBlock(),
        ],
      });
      return;
    }

    try {
      const users = await getAllConnectedUsers();
      if (users.length < 2) {
        await respond({ response_type: "ephemeral", blocks: errorBlocks("Need at least 2 connected users!") });
        return;
      }

      await respond({
        response_type: "in_channel",
        blocks: [markdownBlock(`:hourglass_flowing_sand: Finding ${mood} tracks from everyone's libraries...`)],
      });

      await refreshAllUsersData(users);
      const mix = await buildMoodMix(users, mood);

      if (mix.length === 0) {
        await respond({
          response_type: "in_channel",
          blocks: errorBlocks(`No tracks matched the *${mood}* mood. Try a different vibe!`),
        });
        return;
      }

      const moodEmoji: Record<string, string> = {
        chill: ":relieved:", hype: ":fire:", melancholy: ":cloud_with_rain:",
        driving: ":racing_car:", feel_good: ":sun_with_face:", focus: ":brain:",
        party: ":tada:",
      };

      const blocks: any[] = [
        headerBlock(`${mood.charAt(0).toUpperCase() + mood.slice(1)} Mix`),
        markdownBlock(
          `${moodEmoji[mood] || ":musical_note:"} *${mix.length} tracks from the group that match the ${mood} vibe*`
        ),
        dividerBlock(),
      ];

      for (const track of mix.slice(0, 10)) {
        blocks.push(trackBlock(track.trackName, track.artistNames, track.albumImageUrl,
          track.sharedBy.length > 1 ? `:people_holding_hands: ${track.sharedBy.join(", ")}` : `:bust_in_silhouette: ${track.sharedBy[0]}`
        ));
      }

      blocks.push(dividerBlock());
      blocks.push(
        buttonBlock([
          {
            text: "Create Playlist",
            actionId: "create_blend_playlist",
            value: JSON.stringify({ trackIds: mix.map((t) => t.spotifyTrackId), type: `${mood}_mix` }),
            style: "primary",
          },
        ])
      );
      blocks.push(footerBlock());

      await respond({ response_type: "in_channel", blocks });
    } catch (err) {
      console.error("Mood mix error:", err);
      await respond({ response_type: "ephemeral", blocks: errorBlocks("Something went wrong with the mood mix.") });
    }
  });

  app.action("create_blend_playlist", async ({ action, ack, respond, body }) => {
    await ack();

    try {
      const payload = JSON.parse((action as any).value);
      const user = await getUserBySlackId(body.user.id);

      if (!user?.spotifyAccessToken) {
        await respond({ response_type: "ephemeral", blocks: errorBlocks("Connect your Spotify first with `/tunepool-connect`") });
        return;
      }

      const playlistName = payload.type === "blend"
        ? `TunePool Group Blend — ${new Date().toLocaleDateString()}`
        : `TunePool ${payload.type.replace("_", " ")} — ${new Date().toLocaleDateString()}`;

      const result = await createSpotifyPlaylist(user, playlistName, payload.trackIds);

      await respond({
        response_type: "in_channel",
        blocks: [
          markdownBlock(
            `:white_check_mark: *Playlist created!*\n\n<${result.playlistUrl}|Open in Spotify>\n\nCreated by <@${body.user.id}> — ${payload.trackIds.length} tracks`
          ),
          footerBlock(),
        ],
      });
    } catch (err) {
      console.error("Playlist creation error:", err);
      await respond({ response_type: "ephemeral", blocks: errorBlocks("Failed to create playlist. Make sure your Spotify is still connected.") });
    }
  });
}
