import { Router, type IRouter } from "express";
import { db, loreUsersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { h } from "../../middlewares/asyncHandler.js";
import { type AuthedRequest } from "./auth.js";

const router: IRouter = Router();

/**
 * Site-presence heartbeat. The Dial sends this while open, whether or not
 * audio is playing. The three-minute expiry is also used by the anonymous
 * station-presence read model, so a closed tab ages out quickly.
 */
router.post("/me/presence/heartbeat", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  const { socialEnabled } = req.body as { socialEnabled?: unknown };
  if (typeof socialEnabled !== "boolean") {
    return res.status(400).json({ error: "socialEnabled must be a boolean" });
  }

  await db
    .update(loreUsersTable)
    .set({
      lastSeenAt: new Date(),
      socialParticipation: socialEnabled,
    })
    .where(eq(loreUsersTable.id, user.id));

  return res.json({ ok: true });
}));

export default router;