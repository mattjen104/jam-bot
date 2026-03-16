import type { KnownBlock } from "@slack/types";

const APP_NAME = "TunePool";

export function headerBlock(text: string): KnownBlock {
  return {
    type: "header",
    text: { type: "plain_text", text, emoji: true },
  };
}

export function markdownBlock(text: string): KnownBlock {
  return {
    type: "section",
    text: { type: "mrkdwn", text },
  };
}

export function dividerBlock(): KnownBlock {
  return { type: "divider" };
}

export function trackBlock(
  trackName: string,
  artistNames: string[],
  albumImageUrl: string | null,
  extra?: string
): KnownBlock {
  const text = `*${trackName}*\n${artistNames.join(", ")}${extra ? `\n${extra}` : ""}`;

  if (albumImageUrl) {
    return {
      type: "section",
      text: { type: "mrkdwn", text },
      accessory: {
        type: "image",
        image_url: albumImageUrl,
        alt_text: trackName,
      },
    };
  }

  return {
    type: "section",
    text: { type: "mrkdwn", text },
  };
}

export function audioProfileBlock(profile: {
  energy: number;
  danceability: number;
  valence: number;
  tempo: number;
  acousticness: number;
}): KnownBlock {
  const bar = (val: number) => {
    const filled = Math.round(val * 10);
    return "█".repeat(filled) + "░".repeat(10 - filled);
  };

  return markdownBlock(
    `*Audio Profile*\n` +
    `Energy:       ${bar(profile.energy)} ${Math.round(profile.energy * 100)}%\n` +
    `Danceability: ${bar(profile.danceability)} ${Math.round(profile.danceability * 100)}%\n` +
    `Mood:         ${bar(profile.valence)} ${Math.round(profile.valence * 100)}%\n` +
    `Acousticness: ${bar(profile.acousticness)} ${Math.round(profile.acousticness * 100)}%\n` +
    `Tempo: ${Math.round(profile.tempo)} BPM`
  );
}

export function buttonBlock(
  buttons: Array<{ text: string; actionId: string; value: string; style?: "primary" | "danger" }>
): KnownBlock {
  return {
    type: "actions",
    elements: buttons.map((b) => ({
      type: "button" as const,
      text: { type: "plain_text" as const, text: b.text, emoji: true },
      action_id: b.actionId,
      value: b.value,
      ...(b.style ? { style: b.style } : {}),
    })),
  };
}

export function contextBlock(text: string): KnownBlock {
  return {
    type: "context",
    elements: [{ type: "mrkdwn", text }],
  };
}

export function errorBlocks(message: string): KnownBlock[] {
  return [
    markdownBlock(`:warning: ${message}`),
    contextBlock(`_${APP_NAME} — something went wrong_`),
  ];
}

export function footerBlock(): KnownBlock {
  return contextBlock(`_${APP_NAME} — group music discovery_`);
}
