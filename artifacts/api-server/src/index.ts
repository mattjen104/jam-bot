import app from "./app";
import { startSlackBot } from "./slack/bot";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});

startSlackBot().then((bot) => {
  if (bot) {
    console.log("TunePool Slack bot is running!");
  } else {
    console.log("Slack bot not started — missing credentials. Set SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET, and SLACK_APP_TOKEN.");
  }
}).catch((err) => {
  console.error("Failed to start Slack bot:", err);
});
