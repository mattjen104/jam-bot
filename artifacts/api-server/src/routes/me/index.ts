/**
 * /me router — mounts all user-scoped sub-routers.
 *
 * Mount order matters:
 *  1. authRouter    — OAuth start/callback routes that must come BEFORE auth middleware
 *  2. requireUserMiddleware — auto-provisions a device identity for all /me/* routes
 *  3. all remaining sub-routers (library, keep, overlaps, crossings, ledger)
 *
 * Named exports (startPhase3RetryScheduler, markOrphanedImportJobsAsError,
 * markOrphanedSyncJobsAsError) are re-exported from library.ts so that
 * src/index.ts can import them from this single entry point without change.
 */
import { Router, type IRouter } from "express";
import authRouter, { requireUserMiddleware, connectionsRouter } from "./auth.js";
import libraryRouter from "./library.js";
import keepRouter from "./keep.js";
import overlapsRouter from "./overlaps.js";
import crossingsRouter from "./crossings.js";
import ledgerRouter from "./ledger.js";
import pickerNamesRouter from "./picker-names.js";

export {
  startPhase3RetryScheduler,
  markOrphanedImportJobsAsError,
  markOrphanedSyncJobsAsError,
  runImportWorker,
  runManualImportWorker,
  runPhase3RetryPass,
  seedSpotifySoftRows,
  NULL_CACHE_MISS_MAX_AGE_MS,
} from "./library.js";

const router: IRouter = Router();

// OAuth routes intentionally BEFORE requireUserMiddleware so they work for
// first-time visitors with no session (see auth.ts for details).
router.use(authRouter);

// All routes below this line require an authenticated lore session.
// requireUserMiddleware auto-provisions a device identity when no sid cookie is
// present so every /me/* request gets a loreUser — no login wall.
router.use("/me", requireUserMiddleware);

router.use(connectionsRouter);
router.use(libraryRouter);
router.use(keepRouter);
router.use(overlapsRouter);
router.use(crossingsRouter);
router.use(ledgerRouter);
router.use(pickerNamesRouter);

export default router;
