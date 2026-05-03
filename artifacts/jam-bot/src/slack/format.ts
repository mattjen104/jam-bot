import type { KnownBlock } from "@slack/types";
import type { CurrentlyPlaying } from "../spotify/client.js";
import type { PlayedTrack } from "../db.js";
import type { WrappedStats } from "../wrapped.js";
import type { DnaStats, CompatStats } from "../dna.js";

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

// ---- Jam Memory blocks --------------------------------------------------

const PODIUM = [":first_place_medal:", ":second_place_medal:", ":third_place_medal:"];

export function wrappedBlocks(
  stats: WrappedStats,
  narration: string,
): KnownBlock[] {
  const days = Math.round(
    (stats.end.getTime() - stats.start.getTime()) / (24 * 3600 * 1000),
  );
  const header: KnownBlock = {
    type: "header",
    text: {
      type: "plain_text",
      text: `Jam Wrapped — last ${days} days`,
      emoji: true,
    },
  };
  const summary: KnownBlock = {
    type: "section",
    text: {
      type: "mrkdwn",
      text:
        `*${stats.totalPlays}* plays  •  *${stats.topArtists.length}* artists in the top list  •  ` +
        `*${stats.lateNightPlays}* late-night vs *${stats.daytimePlays}* daytime plays (UTC).`,
    },
  };
  const blocks: KnownBlock[] = [header, summary];

  if (stats.topTracks.length) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "*:trophy: Top tracks*" },
    });
    stats.topTracks.slice(0, 3).forEach((t, i) => {
      const link = t.spotify_url ? `<${t.spotify_url}|${t.title}>` : t.title;
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${PODIUM[i]} *${link}* — ${t.artist}  _(${t.plays} plays)_`,
        },
      });
    });
    const rest = stats.topTracks.slice(3);
    if (rest.length) {
      const lines = rest.map((t) => {
        const link = t.spotify_url ? `<${t.spotify_url}|${t.title}>` : t.title;
        return `• ${link} — ${t.artist} _(${t.plays})_`;
      });
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: lines.join("\n") },
      });
    }
  }

  if (stats.perUser.length) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "*:bust_in_silhouette: Per person*" },
    });
    const lines = stats.perUser.slice(0, 8).map((u) => {
      if (u.optedOut) {
        return `• <@${u.slackUser}> — ${u.plays} plays  _(opted out of stats)_`;
      }
      const bits: string[] = [];
      if (u.topTrack) bits.push(`top: _${u.topTrack}_`);
      if (u.topArtist) bits.push(`fav artist: *${u.topArtist}*`);
      if (u.discoveries > 0) {
        bits.push(`introduced *${u.discoveries}* new ${u.discoveries === 1 ? "track" : "tracks"}`);
      }
      return `• <@${u.slackUser}> — ${u.plays} plays  ·  ${bits.join("  ·  ")}`;
    });
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: lines.join("\n") },
    });
  }

  blocks.push({ type: "divider" });
  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: `:speech_balloon: ${narration}` },
  });
  return blocks;
}

export function dnaBlocks(stats: DnaStats, narration: string): KnownBlock[] {
  if (stats.totalPlays === 0) {
    return [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `:dna: <@${stats.slackUser}> hasn't requested any tracks in the Jam yet.`,
        },
      },
    ];
  }
  const artistLine = stats.topArtists.length
    ? stats.topArtists
        .map((a) => `*${a.artist}* _(${a.plays})_`)
        .join("  ·  ")
    : "_no clear favorites yet_";
  const blocks: KnownBlock[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `Taste DNA`,
        emoji: true,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `:dna: <@${stats.slackUser}> — *${stats.totalPlays}* total plays  ·  ` +
          `*${Math.round(stats.discoveryRate * 100)}%* discovery rate ` +
          `(${stats.discoveryCount} tracks introduced to the channel).`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Top artists:* ${artistLine}`,
      },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `:speech_balloon: ${narration}` },
    },
  ];
  return blocks;
}

export function compatBlocks(stats: CompatStats, narration: string): KnownBlock[] {
  if (stats.totalA === 0 || stats.totalB === 0) {
    const empty = stats.totalA === 0 ? stats.userA : stats.userB;
    return [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `:link: Can't compute compatibility — <@${empty}> hasn't requested any tracks yet.`,
        },
      },
    ];
  }
  const sharedArtistsLine = stats.sharedArtists.length
    ? stats.sharedArtists.map((a) => `*${a}*`).join(", ")
    : "_no overlap yet_";
  const recA = stats.recommendForA[0];
  const recB = stats.recommendForB[0];
  const recLines: string[] = [];
  if (recA) {
    const link = recA.spotify_url ? `<${recA.spotify_url}|${recA.title}>` : recA.title;
    recLines.push(
      `• <@${stats.userA}> should try ${link} by ${recA.artist} — <@${stats.userB}> has played it ${recA.plays}×.`,
    );
  }
  if (recB) {
    const link = recB.spotify_url ? `<${recB.spotify_url}|${recB.title}>` : recB.title;
    recLines.push(
      `• <@${stats.userB}> should try ${link} by ${recB.artist} — <@${stats.userA}> has played it ${recB.plays}×.`,
    );
  }
  const blocks: KnownBlock[] = [
    {
      type: "header",
      text: { type: "plain_text", text: "Taste compatibility", emoji: true },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `:link: <@${stats.userA}> ↔ <@${stats.userB}> — *${stats.score}/100*  ` +
          `(${stats.sharedTracks} shared tracks, ${stats.sharedArtists.length} shared artists)`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Shared artists:* ${sharedArtistsLine}`,
      },
    },
  ];
  if (recLines.length) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: recLines.join("\n") },
    });
  }
  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: `:speech_balloon: ${narration}` },
  });
  return blocks;
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
