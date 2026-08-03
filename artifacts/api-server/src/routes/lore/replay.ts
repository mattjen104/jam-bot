import { Router, type IRouter } from "express";
import {
  GetReplayManifestParams,
  GetReplayManifestResponse,
  StartReplayResolutionParams,
  ReplayResolutionJobResponse,
} from "@workspace/api-zod";
import { getReplayManifest } from "../../lore/replay.js";
import {
  getReplayResolutionJob,
  replayResolutionEvents,
  startReplayResolutionJob,
  type ReplayResolutionProgress,
} from "../../lore/replay-resolution.js";
import { getUserFromSession } from "../../lore/userSession.js";
import { acquire as sseAcquire, release as sseRelease } from "../../lore/sseConnectionTracker.js";
import { h } from "../../middlewares/asyncHandler.js";

const router: IRouter = Router();

async function replayUserId(req: Parameters<typeof getUserFromSession>[0], res: import("express").Response): Promise<number | null> {
  const user = await getUserFromSession(req);
  if (!user) {
    res.status(401).json({ error: "A listener session is required to resolve a replay" });
    return null;
  }
  return user.id;
}

// SSE is deliberately outside the OpenAPI client surface. The client always
// receives a persisted snapshot first, so reconnecting after a restart cannot
// lose its progress state.
router.get("/replay/jobs/:jobId/stream", h(async (req, res) => {
  const userId = await replayUserId(req, res);
  if (!userId) return;
  const jobId = Number(req.params.jobId);
  if (!Number.isInteger(jobId) || jobId < 1) {
    return res.status(400).json({ error: "Invalid resolution job id" });
  }

  const clientIp = req.ip ?? "unknown";
  if (!sseAcquire(clientIp)) {
    res.setHeader("Retry-After", "60");
    return res.status(429).json({ error: "Too many SSE connections from this IP" });
  }
  let released = false;
  const release = () => {
    if (!released) {
      released = true;
      sseRelease(clientIp);
    }
  };
  req.on("close", release);

  const snapshot = await getReplayResolutionJob(jobId, userId);
  if (!snapshot) {
    release();
    return res.status(404).json({ error: "Resolution job not found" });
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  const write = (progress: ReplayResolutionProgress) =>
    res.write(`data: ${JSON.stringify(progress)}\n\n`);
  res.write(":connected\n\n");
  write(snapshot);

  const onProgress = (progress: ReplayResolutionProgress) => {
    if (progress.id === jobId && !res.writableEnded) write(progress);
  };
  replayResolutionEvents.on("progress", onProgress);
  const ping = setInterval(() => res.write(":ping\n\n"), 30_000);
  req.on("close", () => {
    clearInterval(ping);
    replayResolutionEvents.off("progress", onProgress);
    release();
  });
  return;
}));

// POST /api/replay/:id/resolve — queue user-initiated materialization. This
// does not alter the run's derived manifest, even when a lookup cannot resolve.
router.post("/replay/:id/resolve", h(async (req, res) => {
  const userId = await replayUserId(req, res);
  if (!userId) return;
  const parsed = StartReplayResolutionParams.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ error: "Invalid replay id" });
  const job = await startReplayResolutionJob(userId, parsed.data.id);
  if (!job) return res.status(404).json({ error: "Replay not found" });
  return res.status(202).json(ReplayResolutionJobResponse.parse(job));
}));

router.get("/replay/jobs/:jobId", h(async (req, res) => {
  const userId = await replayUserId(req, res);
  if (!userId) return;
  const jobId = Number(req.params.jobId);
  if (!Number.isInteger(jobId) || jobId < 1) {
    return res.status(400).json({ error: "Invalid resolution job id" });
  }
  const job = await getReplayResolutionJob(jobId, userId);
  if (!job) return res.status(404).json({ error: "Resolution job not found" });
  return res.json(ReplayResolutionJobResponse.parse(job));
}));

// GET /api/replay/:id — canonical Ghost Replay manifest.
router.get("/replay/:id", h(async (req, res) => {
  const parsed = GetReplayManifestParams.safeParse(req.params);
  if (!parsed.success) return res.status(404).json({ error: "Replay not found" });

  const manifest = await getReplayManifest(parsed.data.id);
  if (!manifest) return res.status(404).json({ error: "Replay not found" });

  return res.json(GetReplayManifestResponse.parse(manifest));
}));

export default router;