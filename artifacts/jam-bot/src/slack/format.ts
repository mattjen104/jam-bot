import type { KnownBlock } from "@slack/types";
import type { CurrentlyPlaying } from "../spotify/client.js";
import type { PlayedTrack } from "../db.js";

function fmtMs(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export const VOTE_SKIP_ACTION_ID = "jam_vote_skip";

export interface VoteSkipState {
  count: number;
  threshold: number;
}

export function nowPlayingBlocks(
  track: NonNullable<CurrentlyPlaying["track"]>,
  requestedBy: string | null,
  requestedQuery: string | null,
  voteSkip?: VoteSkipState,
): KnownBlock[] {
  const requesterLine = requestedBy
    ? `\n_Requested by <@${requestedBy}>${requestedQuery ? ` — "${requestedQuery}"` : ""}_`
    : "";
  const blocks: KnownBlock[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:notes: *Now playing*\n*<${track.spotifyUrl}|${track.title}>*\n${track.artist}\n_${track.album}_  •  ${fmtMs(track.durationMs)}${requesterLine}`,
      },
      ...(track.albumImageUrl
        ? {
            accessory: {
              type: "image",
              image_url: track.albumImageUrl,
              alt_text: track.album,
            },
          }
        : {}),
    },
  ];
  if (voteSkip) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          action_id: VOTE_SKIP_ACTION_ID,
          text: {
            type: "plain_text",
            text: `:next_track: Vote skip (${voteSkip.count}/${voteSkip.threshold})`,
            emoji: true,
          },
          value: track.id,
        },
      ],
    });
  }
  return blocks;
}

export function historyBlocks(rows: PlayedTrack[]): KnownBlock[] {
  if (!rows.length) {
    return [
      {
        type: "section",
        text: { type: "mrkdwn", text: "_No tracks have played yet._" },
      },
    ];
  }
  const lines = rows.slice(0, 15).map((r) => {
    const when = r.played_at;
    const req = r.requested_by_slack_user
      ? ` — <@${r.requested_by_slack_user}>`
      : "";
    const link = r.spotify_url
      ? `<${r.spotify_url}|${r.title}>`
      : r.title;
    return `• \`${when}\` ${link} — ${r.artist}${req}`;
  });
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:clock3: *Recent Jam history*\n${lines.join("\n")}`,
      },
    },
  ];
}

export function noDeviceBlocks(
  deviceName: string,
  hostVisible = false,
): KnownBlock[] {
  const status = hostVisible
    ? `The Jam host (\`${deviceName}\`) is online but inactive — playback isn't running.`
    : `The Jam host (\`${deviceName}\`) is offline or no Jam is running.`;
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `:warning: *No active Spotify playback.* ${status}\n\n` +
          `To restart: open Spotify on your phone, tap the device picker, pick *${deviceName}*, and hit play (or start a Jam from there).`,
      },
    },
  ];
}
