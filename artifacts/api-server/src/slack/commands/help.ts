import type { App } from "@slack/bolt";
import { markdownBlock, headerBlock, dividerBlock, footerBlock } from "../format";

export function registerHelpCommand(app: App) {
  app.command("/tunepool-help", async ({ command, ack, respond }) => {
    await ack();

    await respond({
      response_type: "ephemeral",
      blocks: [
        headerBlock("TunePool Commands"),
        markdownBlock(
          `:wave: *Getting Started*\n` +
          `\`/tunepool-connect\` — Connect your Spotify account\n` +
          `Or DM me and say "connect"`
        ),
        dividerBlock(),
        markdownBlock(
          `:control_knobs: *DJ Blend*\n` +
          `\`/tunepool-blend\` — Group blend playlist from everyone's taste\n` +
          `\`/tunepool-mood <mood>\` — Mood-filtered mix (chill, hype, melancholy, driving, feel_good, focus, party)\n` +
          `\`/tunepool-pair @user\` — Taste compatibility & blend with someone`
        ),
        dividerBlock(),
        markdownBlock(
          `:mag: *Music Intel*\n` +
          `\`/tunepool-dive <song>\` — Deep dive on any track (audio profile, fun facts, who has it)\n` +
          `\`/tunepool-connections\` — Map artist connections across the group`
        ),
        dividerBlock(),
        markdownBlock(
          `:dna: *Taste Analysis*\n` +
          `\`/tunepool-taste\` — Your personal taste DNA\n` +
          `\`/tunepool-taste group\` — Compare everyone's taste side by side`
        ),
        dividerBlock(),
        markdownBlock(
          `:gem: *Discovery*\n` +
          `\`/tunepool-gems\` — Hidden gems from each person's library\n` +
          `\`/tunepool-whofirst\` — Who discovered shared tracks first?`
        ),
        footerBlock(),
      ],
    });
  });
}
