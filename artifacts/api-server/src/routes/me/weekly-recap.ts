import { Router, type IRouter } from "express";
import { h } from "../../middlewares/asyncHandler.js";
import { type AuthedRequest } from "./auth.js";
import { getCompletedWeekWindow, getWeeklyRecap } from "../../lore/weekly-recap.js";

const router: IRouter = Router();

/**
 * GET /api/me/weekly-recap
 *
 * The default is the latest complete UTC Sunday-to-Saturday window. An older
 * Sunday start may be requested for a stable revisit; current and future
 * windows are rejected rather than presented as finished recaps.
 */
router.get("/me/weekly-recap", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  const requested = typeof req.query.weekStart === "string"
    ? req.query.weekStart
    : undefined;
  const window = getCompletedWeekWindow(new Date(), requested);
  if (!window) {
    return res.status(400).json({
      error: "weekStart must be a completed Sunday-to-Saturday week",
    });
  }

  return res.json(await getWeeklyRecap(user.id, window));
}));

export default router;