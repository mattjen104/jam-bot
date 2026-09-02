import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import {
  appleMusicJamEventsTable,
  appleMusicJamHelpersTable,
  appleMusicJamMembersTable,
  appleMusicJamsTable,
  db,
  type AppleJamQueueEntry,
  type AppleJamSnapshot,
  type AppleMusicJam,
} from "@workspace/db";
import { getOrCreateAnonymousUser, getUserFromSession } from "./userSession.js";
import { cookieSidOpts, SID_COOKIE } from "./userSession.js";
import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import {
  observeMatch,
  type FingerprintObservation,
  type MatchStreakState,
} from "./apple-music-jam-timing.js";

export const JAM_TTL_MS = 2 * 60 * 60 * 1000;
export const JAM_MAX_MEMBERS = 12;
export const JAM_CODE_RE = /^[A-Z2-9]{6}$/;

export type JamMode = "queue" | "record";
export type JamEventType = "created" | "presence" | "transport" | "mode" | "source" | "ended";

export interface JamView {
  code: string;
  inviteToken?: string;
  status: "active" | "ended" | "expired";
  revision: number;
  expiresAt: string;
  mode: JamMode;
  queue: AppleJamQueueEntry[];
  transport: AppleJamSnapshot["transport"];
  source: AppleJamSnapshot["source"];
  members: number;
  role: "host" | "listener";
}

export interface JamActor {
  id: number;
  role: "host" | "listener";
}

function emptySnapshot(mode: JamMode, queue: AppleJamQueueEntry[] = []): AppleJamSnapshot {
  return {
    mode,
    queue,
    transport: {
      state: "idle",
      index: 0,
      positionMs: 0,
      effectiveAt: null,
      track: queue[0] ?? null,
    },
    source: {
      status: "idle",
      message: mode === "record" ? "Pair a helper to follow a record." : null,
      matchedAt: null,
      confidence: null,
      track: null,
    },
  };
}

function cleanQueue(input: unknown): AppleJamQueueEntry[] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 500).flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const value = raw as Record<string, unknown>;
    const title = typeof value.title === "string" ? value.title.trim().slice(0, 300) : "";
    const artist = typeof value.artist === "string" ? value.artist.trim().slice(0, 300) : "";
    if (!title || !artist) return [];
    const entry: AppleJamQueueEntry = {
      title,
      artist,
      mbid: typeof value.mbid === "string" ? value.mbid.slice(0, 80) : null,
      artworkUrl: typeof value.artworkUrl === "string" ? value.artworkUrl.slice(0, 1000) : null,
      appleMusicId: typeof value.appleMusicId === "string" ? value.appleMusicId.slice(0, 80) : null,
      isrc: typeof value.isrc === "string" ? value.isrc.slice(0, 32) : null,
      durationMs: typeof value.durationMs === "number" && Number.isFinite(value.durationMs)
        ? Math.max(0, Math.min(86_400_000, Math.round(value.durationMs)))
        : null,
    };
    return [entry];
  });
}

function validMode(value: unknown): value is JamMode {
  return value === "queue" || value === "record";
}

function clampPosition(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(86_400_000, Math.round(value)))
    : 0;
}

function newCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(6);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

async function actorFor(req: Request, res: Response, provision = true): Promise<JamActor | null> {
  let user = await getUserFromSession(req);
  if (!user && provision) {
    const deviceKey = randomUUID();
    user = await getOrCreateAnonymousUser(deviceKey);
    res.cookie(SID_COOKIE, deviceKey, cookieSidOpts());
  }
  if (!user) {
    res.status(401).json({ error: "A Lore listener session is required." });
    return null;
  }
  return { id: user.id, role: "listener" };
}

async function findJam(code: string): Promise<AppleMusicJam | null> {
  const [jam] = await db
    .select()
    .from(appleMusicJamsTable)
    .where(eq(appleMusicJamsTable.code, code.toUpperCase()))
    .limit(1);
  return jam ?? null;
}

async function expireIfNeeded(jam: AppleMusicJam): Promise<AppleMusicJam> {
  if (jam.status === "active" && jam.expiresAt.getTime() <= Date.now()) {
    await endJam(jam, "expired");
    return (await findJamById(jam.id)) ?? { ...jam, status: "expired" };
  }
  return jam;
}

async function markDisconnectedSource(jam: AppleMusicJam): Promise<AppleMusicJam> {
  if (
    jam.snapshot.mode !== "record" ||
    !["capturing", "identifying", "matched"].includes(jam.snapshot.source.status)
  ) return jam;
  const [helper] = await db.select({ lastSeenAt: appleMusicJamHelpersTable.lastSeenAt })
    .from(appleMusicJamHelpersTable)
    .where(and(
      eq(appleMusicJamHelpersTable.jamId, jam.id),
      isNull(appleMusicJamHelpersTable.revokedAt),
      gt(appleMusicJamHelpersTable.expiresAt, new Date()),
    ))
    .orderBy(desc(appleMusicJamHelpersTable.createdAt))
    .limit(1);
  if (helper?.lastSeenAt && Date.now() - helper.lastSeenAt.getTime() <= 45_000) return jam;
  const snapshot = structuredClone(jam.snapshot);
  snapshot.source.status = "offline";
  snapshot.source.message = "Record source offline; current playback was left alone.";
  return appendEvent(jam, "source", snapshot);
}

export async function getJamActor(
  req: Request,
  res: Response,
  code: string,
): Promise<{ jam: AppleMusicJam; actor: JamActor } | null> {
  const actor = await actorFor(req, res);
  if (!actor) return null;
  const found = await findJam(code);
  if (!found) {
    res.status(404).json({ error: "Jam not found." });
    return null;
  }
  let jam = await expireIfNeeded(found);
  if (jam.status !== "active") {
    res.status(410).json({ error: "This jam has ended or expired." });
    return null;
  }
  const [member] = await db
    .select({ role: appleMusicJamMembersTable.role })
    .from(appleMusicJamMembersTable)
    .where(and(
      eq(appleMusicJamMembersTable.jamId, jam.id),
      eq(appleMusicJamMembersTable.userId, actor.id),
    ))
    .limit(1);
  if (!member) {
    res.status(403).json({ error: "Join this jam before using it." });
    return null;
  }
  jam = await markDisconnectedSource(jam);
  actor.role = member.role === "host" ? "host" : "listener";
  void db.update(appleMusicJamMembersTable)
    .set({ lastSeenAt: new Date() })
    .where(and(
      eq(appleMusicJamMembersTable.jamId, jam.id),
      eq(appleMusicJamMembersTable.userId, actor.id),
    ));
  return { jam, actor };
}

export async function createJam(
  req: Request,
  res: Response,
  mode: JamMode,
  queueInput: unknown,
): Promise<JamView | null> {
  const actor = await actorFor(req, res);
  if (!actor) return null;
  const queue = cleanQueue(queueInput);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = newCode();
    const inviteToken = randomBytes(24).toString("base64url");
    try {
      const [jam] = await db.insert(appleMusicJamsTable).values({
        code,
        inviteToken,
        hostUserId: actor.id,
        snapshot: emptySnapshot(mode, queue),
        expiresAt: new Date(Date.now() + JAM_TTL_MS),
      }).returning();
      if (!jam) continue;
      await db.insert(appleMusicJamMembersTable).values({
        jamId: jam.id,
        userId: actor.id,
        role: "host",
      });
      await db.insert(appleMusicJamEventsTable).values({
        jamId: jam.id,
        revision: 0,
        type: "created",
        payload: jam.snapshot,
      });
      return toView(jam, "host", 1);
    } catch (error) {
      if (attempt === 4) throw error;
    }
  }
  return null;
}

export async function joinJam(req: Request, res: Response, code: string): Promise<JamView | null> {
  const actor = await actorFor(req, res);
  if (!actor) return null;
  const found = await findJam(code);
  if (!found) {
    res.status(404).json({ error: "Jam not found." });
    return null;
  }
  const jam = await expireIfNeeded(found);
  if (jam.status !== "active") {
    res.status(410).json({ error: "This jam has ended or expired." });
    return null;
  }
  const [existing] = await db.select({ role: appleMusicJamMembersTable.role })
    .from(appleMusicJamMembersTable)
    .where(and(eq(appleMusicJamMembersTable.jamId, jam.id), eq(appleMusicJamMembersTable.userId, actor.id)))
    .limit(1);
  if (!existing) {
    const members = await db.select({ id: appleMusicJamMembersTable.id })
      .from(appleMusicJamMembersTable)
      .where(eq(appleMusicJamMembersTable.jamId, jam.id));
    if (members.length >= JAM_MAX_MEMBERS) {
      res.status(409).json({ error: "This jam is full." });
      return null;
    }
    await db.insert(appleMusicJamMembersTable).values({ jamId: jam.id, userId: actor.id });
    await appendEvent(jam, "presence", jam.snapshot);
  } else {
    await db.update(appleMusicJamMembersTable)
      .set({ lastSeenAt: new Date() })
      .where(and(eq(appleMusicJamMembersTable.jamId, jam.id), eq(appleMusicJamMembersTable.userId, actor.id)));
  }
  return getJamView(jam, existing?.role === "host" ? "host" : "listener");
}

export async function leaveJam(req: Request, res: Response, code: string): Promise<void> {
  const membership = await getJamActor(req, res, code);
  if (!membership) return;
  if (membership.actor.role === "host") {
    await endJam(membership.jam, "ended");
  } else {
    await db.delete(appleMusicJamMembersTable).where(and(
      eq(appleMusicJamMembersTable.jamId, membership.jam.id),
      eq(appleMusicJamMembersTable.userId, membership.actor.id),
    ));
    await appendEvent(membership.jam, "presence", membership.jam.snapshot);
  }
  res.status(204).send();
}

export async function getJamView(jam: AppleMusicJam, role: "host" | "listener"): Promise<JamView> {
  const rows = await db.select({ id: appleMusicJamMembersTable.id })
    .from(appleMusicJamMembersTable)
    .where(eq(appleMusicJamMembersTable.jamId, jam.id));
  return toView(jam, role, rows.length);
}

function toView(jam: AppleMusicJam, role: "host" | "listener", members: number): JamView {
  const snapshot = jam.snapshot;
  return {
    code: jam.code,
    ...(role === "host" ? { inviteToken: jam.inviteToken } : {}),
    status: jam.status as JamView["status"],
    revision: jam.revision,
    expiresAt: jam.expiresAt.toISOString(),
    mode: snapshot.mode,
    queue: snapshot.queue,
    transport: snapshot.transport,
    source: snapshot.source,
    members,
    role,
  };
}

async function appendEvent(jam: AppleMusicJam, type: JamEventType, snapshot: AppleJamSnapshot): Promise<AppleMusicJam> {
  return db.transaction(async (tx) => {
    const [locked] = await tx.select().from(appleMusicJamsTable)
      .where(eq(appleMusicJamsTable.id, jam.id))
      .for("update")
      .limit(1);
    if (!locked || locked.revision !== jam.revision || locked.status !== "active") {
      throw new Error("Jam changed; retry the command.");
    }
    const nextRevision = locked.revision + 1;
    const [updated] = await tx.update(appleMusicJamsTable)
      .set({ snapshot, revision: nextRevision, updatedAt: new Date() })
      .where(eq(appleMusicJamsTable.id, jam.id))
      .returning();
    if (!updated) throw new Error("Jam changed; retry the command.");
    await tx.insert(appleMusicJamEventsTable).values({
      jamId: jam.id,
      revision: nextRevision,
      type,
      payload: snapshot,
    });
    return updated;
  });
}

function hostOnly(res: Response, actor: JamActor): boolean {
  if (actor.role !== "host") {
    res.status(403).json({ error: "Only the jam host can do that." });
    return false;
  }
  return true;
}

export async function updateTransport(
  req: Request,
  res: Response,
  code: string,
): Promise<JamView | null> {
  const membership = await getJamActor(req, res, code);
  if (!membership || !hostOnly(res, membership.actor)) return null;
  const action = typeof req.body?.action === "string" ? req.body.action : "";
  const allowed = new Set(["play", "pause", "seek", "next", "previous", "stop"]);
  if (!allowed.has(action)) {
    res.status(400).json({ error: "Unknown transport action." });
    return null;
  }
  const snapshot = structuredClone(membership.jam.snapshot);
  const current = snapshot.transport;
  const now = Date.now();
  const effectiveAt = new Date(now + 250).toISOString();
  if (action === "play") {
    current.state = "playing";
    current.effectiveAt = effectiveAt;
  } else if (action === "pause") {
    current.positionMs = clampPosition(req.body?.positionMs ?? current.positionMs);
    current.state = "paused";
    current.effectiveAt = effectiveAt;
  } else if (action === "seek") {
    current.positionMs = clampPosition(req.body?.positionMs);
    current.effectiveAt = effectiveAt;
  } else if (action === "stop") {
    current.state = "ended";
    current.positionMs = 0;
    current.effectiveAt = effectiveAt;
  } else {
    const delta = action === "next" ? 1 : -1;
    const nextIndex = Math.max(0, Math.min(snapshot.queue.length - 1, current.index + delta));
    current.index = nextIndex;
    current.track = snapshot.queue[nextIndex] ?? null;
    current.positionMs = 0;
    current.state = current.track ? "playing" : "ended";
    current.effectiveAt = effectiveAt;
  }
  const updated = await appendEvent(membership.jam, "transport", snapshot);
  return getJamView(updated, "host");
}

export async function switchJamMode(req: Request, res: Response, code: string): Promise<JamView | null> {
  const membership = await getJamActor(req, res, code);
  if (!membership || !hostOnly(res, membership.actor)) return null;
  const mode = req.body?.mode;
  if (!validMode(mode)) {
    res.status(400).json({ error: "Mode must be queue or record." });
    return null;
  }
  const snapshot = structuredClone(membership.jam.snapshot);
  snapshot.mode = mode;
  snapshot.source = {
    status: mode === "record" ? "idle" : "idle",
    message: mode === "record" ? "Pair a helper to follow a record." : null,
    matchedAt: null,
    confidence: null,
    track: null,
  };
  if (mode === "record") {
    snapshot.transport = { ...snapshot.transport, state: "idle", positionMs: 0, effectiveAt: null };
  }
  const updated = await appendEvent(membership.jam, "mode", snapshot);
  return getJamView(updated, "host");
}

export async function endJam(jam: AppleMusicJam, status: "ended" | "expired" = "ended"): Promise<void> {
  await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(appleMusicJamsTable)
      .where(eq(appleMusicJamsTable.id, jam.id))
      .for("update")
      .limit(1);
    if (!locked || locked.status !== "active") return;
    const snapshot = { ...locked.snapshot, transport: { ...locked.snapshot.transport, state: "ended" as const } };
    const nextRevision = locked.revision + 1;
    await tx.update(appleMusicJamsTable)
      .set({ status, snapshot, revision: nextRevision, updatedAt: new Date() })
      .where(eq(appleMusicJamsTable.id, jam.id));
    await tx.insert(appleMusicJamEventsTable).values({
      jamId: jam.id,
      revision: nextRevision,
      type: "ended",
      payload: snapshot,
    });
  });
}

export async function issueHelperToken(req: Request, res: Response, code: string): Promise<void> {
  const membership = await getJamActor(req, res, code);
  if (!membership || !hostOnly(res, membership.actor)) return;
  if (membership.jam.snapshot.mode !== "record") {
    res.status(409).json({ error: "Switch the jam to Follow a record first." });
    return;
  }
  const raw = randomBytes(32).toString("base64url");
  await db.update(appleMusicJamHelpersTable)
    .set({ revokedAt: new Date() })
    .where(and(eq(appleMusicJamHelpersTable.jamId, membership.jam.id), isNull(appleMusicJamHelpersTable.revokedAt)));
  await db.insert(appleMusicJamHelpersTable).values({
    jamId: membership.jam.id,
    tokenHash: hashToken(raw),
    expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    lastSeenAt: new Date(),
  });
  await updateRecordSource(membership.jam, {
    status: "capturing",
    message: "Helper paired; waiting for record samples.",
  });
  res.json({
    token: raw,
    expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    ingestPath: "/api/jams/ingest",
  });
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function authenticateHelper(token: string): Promise<AppleMusicJam | null> {
  const [helper] = await db.update(appleMusicJamHelpersTable)
    .set({ lastSeenAt: new Date() })
    .where(and(eq(appleMusicJamHelpersTable.tokenHash, hashToken(token)), isNull(appleMusicJamHelpersTable.revokedAt), gt(appleMusicJamHelpersTable.expiresAt, new Date())))
    .returning();
  if (!helper) return null;
  const jam = await findJamById(helper.jamId);
  if (!jam || jam.status !== "active" || jam.snapshot.mode !== "record") return null;
  return jam;
}

async function findJamById(id: number): Promise<AppleMusicJam | null> {
  const [jam] = await db.select().from(appleMusicJamsTable).where(eq(appleMusicJamsTable.id, id)).limit(1);
  return jam ?? null;
}

export async function refreshJamExpiry(id: number): Promise<AppleMusicJam | null> {
  const jam = await findJamById(id);
  return jam ? expireIfNeeded(jam) : null;
}

export async function updateRecordSource(
  jam: AppleMusicJam,
  input: { status: AppleJamSnapshot["source"]["status"]; message?: string | null; observation?: FingerprintObservation; track?: AppleJamQueueEntry | null },
): Promise<AppleMusicJam> {
  const snapshot = structuredClone(jam.snapshot);
  snapshot.source = {
    ...snapshot.source,
    status: input.status,
    message: input.message ?? null,
    confidence: input.observation?.score ?? snapshot.source.confidence,
    matchedAt: input.observation ? new Date().toISOString() : snapshot.source.matchedAt,
    track: input.track ?? snapshot.source.track,
  };
  return appendEvent(jam, "source", snapshot);
}

export async function commitRecordAnchor(
  jam: AppleMusicJam,
  observation: FingerprintObservation,
  track: AppleJamQueueEntry,
  positionMs: number,
): Promise<AppleMusicJam> {
  const snapshot = structuredClone(jam.snapshot);
  const now = new Date().toISOString();
  snapshot.transport = {
    state: "playing",
    index: 0,
    positionMs: clampPosition(positionMs),
    effectiveAt: now,
    track,
  };
  snapshot.source = {
    status: "matched",
    message: `${track.artist} — ${track.title}`,
    matchedAt: now,
    confidence: observation.score ?? null,
    track,
  };
  return appendEvent(jam, "source", snapshot);
}

export async function requestRecordResync(
  req: Request,
  res: Response,
  code: string,
): Promise<JamView | null> {
  const membership = await getJamActor(req, res, code);
  if (!membership || !hostOnly(res, membership.actor)) return null;
  const snapshot = structuredClone(membership.jam.snapshot);
  snapshot.source.status = "capturing";
  snapshot.source.message = "Manual resync requested; waiting for two confident samples.";
  snapshot.transport.effectiveAt = snapshot.transport.track ? new Date().toISOString() : null;
  const updated = await appendEvent(membership.jam, "source", snapshot);
  return getJamView(updated, "host");
}

export async function stopRecordFollowing(
  req: Request,
  res: Response,
  code: string,
): Promise<JamView | null> {
  const membership = await getJamActor(req, res, code);
  if (!membership || !hostOnly(res, membership.actor)) return null;
  await db.update(appleMusicJamHelpersTable)
    .set({ revokedAt: new Date() })
    .where(and(eq(appleMusicJamHelpersTable.jamId, membership.jam.id), isNull(appleMusicJamHelpersTable.revokedAt)));
  const snapshot = structuredClone(membership.jam.snapshot);
  snapshot.source.status = "offline";
  snapshot.source.message = "Record following stopped by the host.";
  snapshot.transport.state = snapshot.transport.track ? "paused" : "idle";
  snapshot.transport.effectiveAt = new Date().toISOString();
  const updated = await appendEvent(membership.jam, "source", snapshot);
  return getJamView(updated, "host");
}

export function applyFingerprintState(
  state: MatchStreakState,
  observation: FingerprintObservation | null,
): ReturnType<typeof observeMatch> {
  return observeMatch(state, observation);
}

export async function listEventsAfter(jamId: number, revision: number) {
  return db.select({
    revision: appleMusicJamEventsTable.revision,
    type: appleMusicJamEventsTable.type,
    payload: appleMusicJamEventsTable.payload,
  }).from(appleMusicJamEventsTable)
    .where(and(eq(appleMusicJamEventsTable.jamId, jamId), gt(appleMusicJamEventsTable.revision, revision)))
    .orderBy(appleMusicJamEventsTable.revision)
    .limit(50);
}

export async function latestJamForInvite(token: string): Promise<AppleMusicJam | null> {
  const [jam] = await db.select().from(appleMusicJamsTable)
    .where(eq(appleMusicJamsTable.inviteToken, token))
    .orderBy(desc(appleMusicJamsTable.createdAt))
    .limit(1);
  return jam ? expireIfNeeded(jam) : null;
}
