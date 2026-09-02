import { Router, type IRouter, type Request } from "express";
import rateLimit from "express-rate-limit";
import { h } from "../../middlewares/asyncHandler.js";
import { acquire as sseAcquire, release as sseRelease } from "../../lore/sseConnectionTracker.js";
import {
  JAM_CODE_RE,
  applyFingerprintState,
  authenticateHelper,
  commitRecordAnchor,
  createJam,
  getJamActor,
  getJamView,
  issueHelperToken,
  joinJam,
  leaveJam,
  listEventsAfter,
  requestRecordResync,
  refreshJamExpiry,
  stopRecordFollowing,
  switchJamMode,
  updateRecordSource,
  updateTransport,
} from "../../lore/apple-music-jams.js";
import {
  acrCredentials,
  identifyRecordClip,
  resolveExactAppleTrack,
} from "../../lore/apple-music-jam-fingerprint.js";
import type { MatchStreakState } from "../../lore/apple-music-jam-timing.js";

const router: IRouter = Router();
const mutationLimit = rateLimit({ windowMs: 60_000, limit: 90, standardHeaders: true, legacyHeaders: false });
const helperLimit = rateLimit({ windowMs: 60_000, limit: 12, standardHeaders: true, legacyHeaders: false });
const MAX_CLIP_BYTES = 5 * 1024 * 1024;
const streaks = new Map<string, MatchStreakState>();

function codeFrom(req: Request): string | null {
  const code = String(req.params.code ?? "").trim().toUpperCase();
  return JAM_CODE_RE.test(code) ? code : null;
}

function readAudio(req: Request): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_CLIP_BYTES) {
        reject(new Error("clip too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

router.post("/jams", mutationLimit, h(async (req, res) => {
  const mode = req.body?.mode === "record" ? "record" : req.body?.mode === "queue" ? "queue" : null;
  if (!mode) return res.status(400).json({ error: "Mode must be queue or record." });
  const view = await createJam(req, res, mode, req.body?.queue);
  if (view) return res.status(201).json(view);
  return;
}));

router.post("/jams/:code/join", mutationLimit, h(async (req, res) => {
  const code = codeFrom(req);
  if (!code) return res.status(404).json({ error: "Jam not found." });
  const view = await joinJam(req, res, code);
  if (view) return res.json(view);
  return;
}));

router.get("/jams/:code", h(async (req, res) => {
  const code = codeFrom(req);
  if (!code) return res.status(404).json({ error: "Jam not found." });
  const membership = await getJamActor(req, res, code);
  if (!membership) return;
  return res.json(await getJamView(membership.jam, membership.actor.role));
}));

router.post("/jams/:code/leave", mutationLimit, h(async (req, res) => {
  const code = codeFrom(req);
  if (!code) return res.status(404).json({ error: "Jam not found." });
  return leaveJam(req, res, code);
}));

router.post("/jams/:code/mode", mutationLimit, h(async (req, res) => {
  const code = codeFrom(req);
  if (!code) return res.status(404).json({ error: "Jam not found." });
  const view = await switchJamMode(req, res, code);
  if (view) return res.json(view);
  return;
}));

router.post("/jams/:code/transport", mutationLimit, h(async (req, res) => {
  const code = codeFrom(req);
  if (!code) return res.status(404).json({ error: "Jam not found." });
  const view = await updateTransport(req, res, code);
  if (view) return res.json(view);
  return;
}));

router.post("/jams/:code/helper-token", mutationLimit, h(async (req, res) => {
  const code = codeFrom(req);
  if (!code) return res.status(404).json({ error: "Jam not found." });
  streaks.delete(code);
  return issueHelperToken(req, res, code);
}));

router.post("/jams/:code/record/resync", mutationLimit, h(async (req, res) => {
  const code = codeFrom(req);
  if (!code) return res.status(404).json({ error: "Jam not found." });
  const view = await requestRecordResync(req, res, code);
  if (view) streaks.delete(code);
  if (view) return res.json(view);
  return;
}));

router.post("/jams/:code/record/stop", mutationLimit, h(async (req, res) => {
  const code = codeFrom(req);
  if (!code) return res.status(404).json({ error: "Jam not found." });
  const view = await stopRecordFollowing(req, res, code);
  if (view) return res.json(view);
  return;
}));

// Four-timestamp exchange: t0 belongs to the browser; t1/t2 are server times.
router.get("/jams/:code/clock", h(async (req, res) => {
  const code = codeFrom(req);
  if (!code) return res.status(404).json({ error: "Jam not found." });
  const t1 = Date.now();
  const membership = await getJamActor(req, res, code);
  if (!membership) return;
  return res.json({ clientSentAt: Number(req.query.clientSentAt) || 0, serverReceivedAt: t1, serverSentAt: Date.now() });
}));

// Durable snapshot first, then ordered revision events. Reconnects resume with
// Last-Event-ID and never depend on an in-memory broadcast.
router.get("/jams/:code/events", h(async (req, res) => {
  const code = codeFrom(req);
  if (!code) return res.status(404).json({ error: "Jam not found." });
  const membership = await getJamActor(req, res, code);
  if (!membership) return;
  const clientIp = req.ip ?? "unknown";
  if (!sseAcquire(clientIp)) return res.status(429).json({ error: "Too many live room connections." });
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-store");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  let revision = Number(req.headers["last-event-id"]) || membership.jam.revision;
  const snapshot = await getJamView(membership.jam, membership.actor.role);
  res.write(`id: ${snapshot.revision}\nevent: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  const poll = async () => {
    try {
      await refreshJamExpiry(membership.jam.id);
      const events = await listEventsAfter(membership.jam.id, revision);
      for (const event of events) {
        revision = event.revision;
        if (res.writableEnded) return;
        const view = await getJamView({
          ...membership.jam,
          snapshot: event.payload,
          revision: event.revision,
          status: event.type === "ended" ? "ended" : membership.jam.status,
        }, membership.actor.role);
        res.write(`id: ${event.revision}\nevent: ${event.type}\ndata: ${JSON.stringify(view)}\n\n`);
        if (event.type === "ended") {
          closed = true;
          res.end();
          return;
        }
      }
      res.write(": keepalive\n\n");
    } catch {
      if (!res.writableEnded) res.write("event: reconnecting\ndata: {}\n\n");
    }
    if (!closed && !res.writableEnded) timer = setTimeout(() => void poll(), 1_000);
  };
  timer = setTimeout(() => void poll(), 1_000);
  req.on("close", () => {
    closed = true;
    if (timer) clearTimeout(timer);
    sseRelease(clientIp);
  });
  return;
}));

router.post("/jams/ingest", helperLimit, h(async (req, res) => {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : String(req.headers["x-jam-helper-token"] ?? "");
  const jam = token ? await authenticateHelper(token) : null;
  if (!jam) return res.status(401).json({ error: "Helper credential is invalid or expired." });
  if (!acrCredentials()) return res.status(503).json({ error: "Record identification is not configured." });
  let clip: Buffer;
  try {
    clip = await readAudio(req);
  } catch {
    return res.status(413).json({ error: "Audio clips must be 5 MB or smaller." });
  }
  if (!clip.length) return res.status(400).json({ error: "Audio clip is empty." });
  await updateRecordSource(jam, { status: "identifying", message: "Identifying this sample…" });
  const observation = await identifyRecordClip(clip);
  const state = streaks.get(jam.code) ?? { confirmedKey: null, candidateKey: null, candidateCount: 0 };
  streaks.set(jam.code, state);
  const decision = applyFingerprintState(state, observation);
  if (decision.kind === "miss" || decision.kind === "low-confidence") {
    const refreshed = await authenticateHelper(token);
    if (refreshed) {
      await updateRecordSource(refreshed, {
        status: "capturing",
        message: decision.kind === "miss" ? "No confident match; current playback was left alone." : "Match confidence was too low; current playback was left alone.",
      });
    }
    return res.json({ accepted: true, matched: false, decision: decision.kind });
  }
  if (decision.kind === "pending") {
    const refreshed = await authenticateHelper(token);
    if (refreshed) await updateRecordSource(refreshed, { status: "capturing", message: "One match received; waiting for confirmation." });
    return res.json({ accepted: true, matched: true, decision: "pending" });
  }
  const track = await resolveExactAppleTrack(decision.observation);
  const refreshed = await authenticateHelper(token);
  if (!refreshed) return res.status(401).json({ error: "Helper credential expired." });
  if (!track) {
    await updateRecordSource(refreshed, {
      status: "unavailable",
      message: "The record was identified, but no exact Apple Music recording is available.",
      observation: decision.observation,
    });
    return res.json({ accepted: true, matched: true, decision: "unavailable" });
  }
  const clipDuration = Math.max(0, Math.min(60_000, Number(req.headers["x-clip-duration-ms"]) || 0));
  await commitRecordAnchor(refreshed, decision.observation, track, decision.observation.playOffsetMs + clipDuration);
  return res.json({ accepted: true, matched: true, decision: decision.kind, track: { title: track.title, artist: track.artist } });
}));

export default router;