import { App, LogLevel } from "@slack/bolt";
import { registerConnectCommand } from "./commands/connect";
import { registerBlendCommand } from "./commands/blend";
import { registerPairBlendCommand } from "./commands/pair-blend";
import { registerTasteDNACommand } from "./commands/taste-dna";
import { registerDeepDiveCommand } from "./commands/deep-dive";
import { registerHiddenGemsCommand } from "./commands/hidden-gems";
import { registerHelpCommand } from "./commands/help";

let slackApp: App | null = null;

export async function startSlackBot(): Promise<App | null> {
  const token = process.env.SLACK_BOT_TOKEN;
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  const appToken = process.env.SLACK_APP_TOKEN;

  if (!token || !signingSecret || !appToken) {
    console.warn(
      "Slack credentials not configured. Set SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET, and SLACK_APP_TOKEN to enable the Slack bot."
    );
    return null;
  }

  const app = new App({
    token,
    signingSecret,
    appToken,
    socketMode: true,
    logLevel: LogLevel.INFO,
  });

  registerConnectCommand(app);
  registerBlendCommand(app);
  registerPairBlendCommand(app);
  registerTasteDNACommand(app);
  registerDeepDiveCommand(app);
  registerHiddenGemsCommand(app);
  registerHelpCommand(app);

  await app.start();
  console.log("Slack bot started in Socket Mode");

  slackApp = app;
  return app;
}

export function getSlackApp(): App | null {
  return slackApp;
}
