import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { acrCredentials, identifyAudio } from "./acrcloud.js";
import { turntableSession } from "./session.js";

/**
 * Tiny HTTP ingest endpoint for the desktop capture helper.
 *
 * jam-bot otherwise talks to Slack over Socket Mode and has no inbound HTTP
 * surface, so this is its own minimal `node:http` server (no Express). The
 * helper POSTs short audio clips to `/turntable/identify`; we fingerprint
 * them via ACRCloud and feed each match into the turntable session, which
 * drives the host's Spotify account.
 *
 * Security: the helper must send `X-Turntable-Secret` matching
 * TURNTABLE_INGEST_SECRET. The raw audio is used only for the ACRCloud call
 * and then dropped — never written to disk or relayed.
 */

/** Whether the turntable feature is fully configured (creds + secret). */
export function turntableConfigured(): boolean {
  return !!acrCredentials() && !!config.TURNTABLE_INGEST_SECRET;
}

const MAX_CLIP_BYTES = 5 * 1024 * 1024; // 5 MB — a ~10s WAV is well under this.

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (c: Buffer) => {
      total += c.length;
      if (total > MAX_CLIP_BYTES) {
        reject(new Error("clip too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

/**
 * Build (but don't start) the ingest server. Exposed for tests; production
 * uses `startTurntableIngestServer`.
 */
export function createIngestServer(): Server {
  return createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/turntable/health") {
        sendJson(res, 200, {
          ok: true,
          active: turntableSession.isActive(),
        });
        return;
      }

      if (req.method !== "POST" || req.url !== "/turntable/identify") {
        sendJson(res, 404, { error: "not found" });
        return;
      }

      const secret = req.headers["x-turntable-secret"];
      if (
        !config.TURNTABLE_INGEST_SECRET ||
        secret !== config.TURNTABLE_INGEST_SECRET
      ) {
        sendJson(res, 401, { error: "unauthorized" });
        return;
      }

      // Skip ACRCloud entirely when turntable mode is off — saves quota and
      // means the helper can keep streaming clips harmlessly between sets.
      if (!turntableSession.isActive()) {
        // Drain the body so the socket can be reused, then reply.
        await readBody(req).catch(() => undefined);
        sendJson(res, 200, {
          accepted: false,
          reason: "turntable mode is not active",
        });
        return;
      }

      const creds = acrCredentials();
      if (!creds) {
        sendJson(res, 503, { error: "ACRCloud not configured" });
        return;
      }

      let clip: Buffer;
      try {
        clip = await readBody(req);
      } catch (err) {
        sendJson(res, 413, { error: String(err) });
        return;
      }
      if (!clip.length) {
        sendJson(res, 400, { error: "empty clip" });
        return;
      }

      let match;
      try {
        match = await identifyAudio(clip, creds);
      } catch (err) {
        logger.warn("Turntable ingest: ACRCloud identify failed", {
          error: String(err),
        });
        sendJson(res, 502, { error: "identify failed" });
        return;
      }

      // The helper tells us how long the submitted clip was so the engine can
      // compensate for the fact that ACRCloud's offset points at the clip's
      // START. Optional + bounds-checked; a bad/missing header just means no
      // clip-length compensation (the engine still applies its config slack).
      const rawDur = req.headers["x-clip-duration-ms"];
      const parsedDur = Number(Array.isArray(rawDur) ? rawDur[0] : rawDur);
      const clipDurationMs =
        Number.isFinite(parsedDur) && parsedDur >= 0 && parsedDur < 600_000
          ? parsedDur
          : undefined;

      const decision = await turntableSession.observe(match, { clipDurationMs });
      sendJson(res, 200, {
        accepted: true,
        matched: !!match,
        decision: decision.kind,
        track: match ? { title: match.title, artist: match.artist } : null,
      });
    } catch (err) {
      logger.error("Turntable ingest: unhandled error", {
        error: String(err),
      });
      try {
        sendJson(res, 500, { error: "internal error" });
      } catch {
        /* response already sent */
      }
    }
  });
}

let server: Server | null = null;

/**
 * Start the ingest server if (and only if) the feature is configured. Safe to
 * call unconditionally from index.ts — it no-ops when turntable sync is off.
 */
export function startTurntableIngestServer(): Server | null {
  if (!turntableConfigured()) {
    logger.info(
      "Turntable sync disabled (set ACRCLOUD_* and TURNTABLE_INGEST_SECRET to enable)",
    );
    return null;
  }
  if (server) return server;
  server = createIngestServer();
  server.listen(config.TURNTABLE_INGEST_PORT, () => {
    logger.info("Turntable ingest server listening", {
      port: config.TURNTABLE_INGEST_PORT,
    });
  });
  server.on("error", (err) => {
    logger.error("Turntable ingest server error", { error: String(err) });
  });
  return server;
}

export function stopTurntableIngestServer(): void {
  server?.close();
  server = null;
}
