import { Router, type IRouter } from "express";
import { handleCallback } from "../spotify/auth";
import { getSlackApp } from "../slack/bot";

const router: IRouter = Router();

router.get("/spotify/callback", async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    res.status(400).send(`
      <html>
        <body style="font-family: -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #1a1a2e; color: #eee;">
          <div style="text-align: center; max-width: 400px;">
            <h1>Connection Failed</h1>
            <p>Spotify authorization was denied or an error occurred.</p>
            <p style="color: #ff6b6b;">${error}</p>
            <p>Go back to Slack and try <code>/tunepool-connect</code> again.</p>
          </div>
        </body>
      </html>
    `);
    return;
  }

  if (!code || !state) {
    res.status(400).send("Missing code or state parameter");
    return;
  }

  try {
    const result = await handleCallback(code as string, state as string);

    const slackApp = getSlackApp();
    if (slackApp) {
      try {
        await slackApp.client.chat.postMessage({
          channel: result.slackUserId,
          text: `Your Spotify account (${result.spotifyDisplayName}) is now connected to TunePool! Use \`/tunepool-help\` to see what you can do.`,
        });
      } catch (e) {
        console.error("Failed to send Slack DM:", e);
      }
    }

    res.send(`
      <html>
        <body style="font-family: -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #1a1a2e; color: #eee;">
          <div style="text-align: center; max-width: 400px;">
            <h1 style="color: #1DB954;">Connected!</h1>
            <p>Welcome, <strong>${result.spotifyDisplayName}</strong>!</p>
            <p>Your Spotify account is now linked to TunePool. Head back to Slack — you're all set.</p>
            <p style="font-size: 48px; margin: 20px 0;">🎵</p>
          </div>
        </body>
      </html>
    `);
  } catch (err) {
    console.error("Spotify callback error:", err);
    res.status(500).send(`
      <html>
        <body style="font-family: -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #1a1a2e; color: #eee;">
          <div style="text-align: center; max-width: 400px;">
            <h1>Something went wrong</h1>
            <p>The authorization link may have expired. Go back to Slack and try <code>/tunepool-connect</code> again.</p>
          </div>
        </body>
      </html>
    `);
  }
});

export default router;
