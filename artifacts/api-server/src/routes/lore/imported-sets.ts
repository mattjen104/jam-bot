import { Router, type IRouter } from "express";
import type { AuthedRequest } from "../me/auth.js";
import { getUserFromSession } from "../../lore/userSession.js";
import { h } from "../../middlewares/asyncHandler.js";
import {
  IMPORTED_SET_MAX_BYTES,
  parseImportedSet,
} from "../../lore/imported-set-parser.js";
import {
  createImportedSet,
  deleteImportedSet,
  getImportedSetView,
  listImportedSets,
  resumeImportedSetResolution,
  runImportedSetResolution,
} from "../../lore/imported-sets.js";

/**
 * Imported portable sets (XSPF/JSPF uploads). User-owned, session-scoped,
 * and structurally separate from the radio archive: nothing here can create
 * a spin or touch radio-derived analytics.
 */
const router: IRouter = Router();

async function importedSetUserId(
  req: Parameters<typeof getUserFromSession>[0],
  res: import("express").Response,
): Promise<number | null> {
  // requireUserMiddleware (mounted upstream for all /me/* paths) attaches the
  // auto-provisioned device identity; fall back to the cookie for safety.
  const user = (req as AuthedRequest).loreUser ?? (await getUserFromSession(req));
  if (!user) {
    res.status(401).json({ error: "A listener session is required for imported sets" });
    return null;
  }
  return user.id;
}

// POST /api/me/imported-sets — upload one XSPF/JSPF file as JSON
// { filename, content }. Limits are enforced before parsing.
router.post("/me/imported-sets", h(async (req, res) => {
  const userId = await importedSetUserId(req, res);
  if (!userId) return;
  const filename =
    typeof req.body?.filename === "string" ? req.body.filename.trim().slice(0, 256) : "";
  const content = typeof req.body?.content === "string" ? req.body.content : "";
  if (!filename || !content) {
    return res.status(400).json({ error: "filename and content are required" });
  }
  if (Buffer.byteLength(content, "utf8") > IMPORTED_SET_MAX_BYTES) {
    return res.status(413).json({ error: "Playlist files larger than 1 MB cannot be imported." });
  }
  const parsed = parseImportedSet(content, filename);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });

  const set = await createImportedSet(userId, parsed.manifest, filename);
  void runImportedSetResolution(set.id);
  const view = await getImportedSetView(userId, set.id);
  return res.status(201).json(view);
}));

router.get("/me/imported-sets", h(async (req, res) => {
  const userId = await importedSetUserId(req, res);
  if (!userId) return;
  return res.json({ sets: await listImportedSets(userId) });
}));

router.get("/me/imported-sets/:id", h(async (req, res) => {
  const userId = await importedSetUserId(req, res);
  if (!userId) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(404).json({ error: "Imported set not found" });
  }
  const view = await getImportedSetView(userId, id);
  if (!view) return res.status(404).json({ error: "Imported set not found" });
  return res.json(view);
}));

// POST /api/me/imported-sets/:id/resolve — resume resolution of pending
// entries (e.g. after a server restart interrupted the worker).
router.post("/me/imported-sets/:id/resolve", h(async (req, res) => {
  const userId = await importedSetUserId(req, res);
  if (!userId) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(404).json({ error: "Imported set not found" });
  }
  const ok = await resumeImportedSetResolution(userId, id);
  if (!ok) return res.status(404).json({ error: "Imported set not found" });
  return res.status(202).json({ started: true });
}));

router.delete("/me/imported-sets/:id", h(async (req, res) => {
  const userId = await importedSetUserId(req, res);
  if (!userId) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(404).json({ error: "Imported set not found" });
  }
  const ok = await deleteImportedSet(userId, id);
  if (!ok) return res.status(404).json({ error: "Imported set not found" });
  return res.status(204).end();
}));

export default router;
