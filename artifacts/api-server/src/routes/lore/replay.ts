import { Router, type IRouter } from "express";
import {
  db,
  serviceTrackMapTable,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import {
  GetReplayManifestParams,
  GetReplayManifestResponse,
  StartReplayResolutionParams,
  ReplayResolutionJobResponse,
} from "@workspace/api-zod";
import { getReplayManifest } from "../../lore/replay.js";
import {
  guidedServiceLabel,
  materializeGuidedReplayQueue,
} from "../../lore/guided-replay-queue.js";
import {
  getReplayResolutionJob,
  replayResolutionEvents,
  startReplayResolutionJob,
  type ReplayResolutionProgress,
} from "../../lore/replay-resolution.js";
import { getAppleMusicClientConfig } from "../../lore/appleMusic.js";
import { getUserFromSession } from "../../lore/userSession.js";
import { acquire as sseAcquire, release as sseRelease } from "../../lore/sseConnectionTracker.js";
import { h } from "../../middlewares/asyncHandler.js";
import {
  buildReplayExport,
  isReplayExportFormat,
  materializeReplayExport,
  REPLAY_EXPORT_CONTENT_TYPES,
  type ReplayExportFormat,
} from "../../lore/replay-export.js";

const router: IRouter = Router();
const REPLAY_EXPORT_MAX_ENTRIES = 50_000;

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

// GET /api/replay/:id/guided-queue — an ordered, honest link-out queue.
// This is intentionally separate from PlayerProvider: opening a native app
// must never claim that Lore is playing or advance the live/player queue.
router.get("/replay/:id/guided-queue", h(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(404).json({ error: "Replay not found" });
  }
  const manifest = await getReplayManifest(id);
  if (!manifest) return res.status(404).json({ error: "Replay not found" });

  const requestedService = typeof req.query.service === "string"
    ? req.query.service.trim().toLowerCase()
    : "";
  const mbids = manifest.entries.flatMap((entry) =>
    entry.recording?.mbid ? [entry.recording.mbid] : [],
  );
  const maps = mbids.length
    ? await db
        .select({
          recordingMbid: serviceTrackMapTable.recordingMbid,
          service: serviceTrackMapTable.service,
          externalId: serviceTrackMapTable.externalId,
          url: serviceTrackMapTable.url,
          confidence: serviceTrackMapTable.confidence,
          deadLink: serviceTrackMapTable.deadLink,
        })
        .from(serviceTrackMapTable)
        .where(inArray(serviceTrackMapTable.recordingMbid, mbids))
    : [];
  const services = [...new Set(maps.map((map) => map.service))].sort();
  const service = requestedService || services[0] || "spotify";
  const queue = materializeGuidedReplayQueue({
    manifest,
    service,
    maps: maps
      .filter((map) => map.recordingMbid)
      .map((map) => ({
        recordingMbid: map.recordingMbid,
        service: map.service,
        externalId: map.externalId,
        url: map.url,
        confidence: map.confidence,
        deadLink: map.deadLink,
      })),
  });

  const serviceSummaries = services.map((serviceName) => {
    const serviceQueue = materializeGuidedReplayQueue({
      manifest,
      service: serviceName,
      maps: maps
        .filter((map) => map.service === serviceName)
        .map((map) => ({
          recordingMbid: map.recordingMbid,
          service: map.service,
          externalId: map.externalId,
          url: map.url,
          confidence: map.confidence,
          deadLink: map.deadLink,
        })),
    });
    return {
      service: serviceName,
      label: guidedServiceLabel(serviceName),
      available: serviceQueue.coverage.available,
      total: serviceQueue.coverage.total,
    };
  });

  return res.json({
    ...queue,
    services: serviceSummaries,
  });
}));

// GET /api/replay/:id — canonical Ghost Replay manifest. Keep this generic
// parameter route after nested replay routes so it cannot shadow them.
router.get("/replay/:id", h(async (req, res) => {
  const parsed = GetReplayManifestParams.safeParse(req.params);
  if (!parsed.success) return res.status(404).json({ error: "Replay not found" });

  const manifest = await getReplayManifest(parsed.data.id);
  if (!manifest) return res.status(404).json({ error: "Replay not found" });

  return res.json(GetReplayManifestResponse.parse(manifest));
}));

// GET /api/replay/:id/export?format=jspf|xspf|m3u8|csv — public, account-free
// download of the same ordered manifest shown on the replay page.
router.get("/replay/:id/export", h(async (req, res) => {
  const parsed = GetReplayManifestParams.safeParse(req.params);
  if (!parsed.success) return res.status(404).json({ error: "Replay not found" });

  const rawFormat = typeof req.query.format === "string" ? req.query.format : "";
  if (!isReplayExportFormat(rawFormat)) {
    return res.status(400).json({
      error: "format must be one of jspf, xspf, m3u8, csv",
    });
  }

  const manifest = await getReplayManifest(parsed.data.id);
  if (!manifest) return res.status(404).json({ error: "Replay not found" });
  if (manifest.entries.length > REPLAY_EXPORT_MAX_ENTRIES) {
    return res.status(413).json({
      error: `Replay is too large to export (maximum ${REPLAY_EXPORT_MAX_ENTRIES} broadcast entries)`,
    });
  }

  const mbids = [
    ...new Set(
      manifest.entries
        .map((entry) => entry.recording?.mbid)
        .filter((mbid): mbid is string => !!mbid),
    ),
  ];
  const mappings = mbids.length
    ? await db
        .select({
          recordingMbid: serviceTrackMapTable.recordingMbid,
          service: serviceTrackMapTable.service,
          url: serviceTrackMapTable.url,
          deadLink: serviceTrackMapTable.deadLink,
          confidence: serviceTrackMapTable.confidence,
        })
        .from(serviceTrackMapTable)
        .where(inArray(serviceTrackMapTable.recordingMbid, mbids))
    : [];
  const mappingsByMbid = new Map<
    string,
    Array<{ service: string; url: string; deadLink: boolean; confidence: string }>
  >();
  for (const mapping of mappings) {
    const current = mappingsByMbid.get(mapping.recordingMbid) ?? [];
    current.push({
      service: mapping.service,
      url: mapping.url,
      deadLink: mapping.deadLink,
      confidence: mapping.confidence,
    });
    mappingsByMbid.set(mapping.recordingMbid, current);
  }

  const body = buildReplayExport(
    rawFormat as ReplayExportFormat,
    materializeReplayExport(manifest, mappingsByMbid),
  );
  const safeStation =
    manifest.station.slug.replace(/[^a-z0-9_-]+/gi, "-").slice(0, 48) || "station";
  const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(manifest.bounds.date)
    ? manifest.bounds.date
    : "replay";
  const filename = `ghost-replay-${safeStation}-${safeDate}.${rawFormat}`;
  res.setHeader("Content-Type", REPLAY_EXPORT_CONTENT_TYPES[rawFormat]);
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.send(body);
}));

// GET /api/replay/:id/apple-music — Apple MusicKit configuration plus a
// read-only, manifest-order materialization receipt. The manifest itself is
// never changed by this lookup.
router.get("/replay/:id/apple-music", h(async (req, res) => {
  const parsed = GetReplayManifestParams.safeParse(req.params);
  if (!parsed.success) return res.status(404).json({ error: "Replay not found" });
  const manifest = await getReplayManifest(parsed.data.id);
  if (!manifest) return res.status(404).json({ error: "Replay not found" });

  const mbids = manifest.entries
    .map((entry) => entry.recording?.mbid)
    .filter((mbid): mbid is string => !!mbid);
  const maps = mbids.length
    ? await db
      .select({
        recordingMbid: serviceTrackMapTable.recordingMbid,
        externalId: serviceTrackMapTable.externalId,
        url: serviceTrackMapTable.url,
        deadLink: serviceTrackMapTable.deadLink,
      })
      .from(serviceTrackMapTable)
      .where(and(
        eq(serviceTrackMapTable.service, "apple_music"),
        inArray(serviceTrackMapTable.recordingMbid, mbids),
      ))
    : [];
  const byMbid = new Map(maps.map((map) => [map.recordingMbid, map]));
  const entries = manifest.entries.map((entry) => {
    const recordingMbid = entry.recording?.mbid ?? null;
    const map = recordingMbid ? byMbid.get(recordingMbid) : undefined;
    const status = !recordingMbid
      ? "unresolved"
      : !map
        ? "unavailable"
        : map.deadLink
          ? "dead"
          : map.externalId
            ? "available"
            : "unavailable";
    return {
      position: entry.position,
      spinId: entry.spinId,
      recordingMbid,
      rawArtist: entry.rawArtist,
      rawTitle: entry.rawTitle,
      title: entry.recording?.title ?? entry.rawTitle,
      artist: entry.recording?.artist ?? entry.rawArtist,
      appleMusicId: status === "available" ? map?.externalId ?? null : null,
      url: map?.url ?? null,
      status,
      reason: status === "available" ? null : status === "dead" ? "dead_link" : status,
    };
  });
  const config = getAppleMusicClientConfig();
  return res.json({
    ...config,
    replayId: manifest.replayId,
    entries,
    coverage: {
      total: entries.length,
      available: entries.filter((entry) => entry.status === "available").length,
      unavailable: entries.filter((entry) => entry.status === "unavailable").length,
      unresolved: entries.filter((entry) => entry.status === "unresolved").length,
      dead: entries.filter((entry) => entry.status === "dead").length,
    },
  });
}));

export default router;