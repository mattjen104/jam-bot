import { Router, type IRouter } from "express";
import stationsRouter from "./stations.js";
import recordingsRouter from "./recordings.js";
import pickersRouter from "./pickers.js";
import selectorsRouter from "./selectors.js";
import archiveRouter from "./archive.js";
import artistRouter from "./artist.js";
import albumRouter from "./album.js";
import adminRouter from "./admin.js";
import replayRouter from "./replay.js";

const router: IRouter = Router();

router.use(stationsRouter);
router.use(recordingsRouter);
router.use(pickersRouter);
router.use(selectorsRouter);
router.use(archiveRouter);
router.use(artistRouter);
router.use(albumRouter);
router.use(replayRouter);
router.use((req, res, next) => {
  if (req.path === "/admin" || req.path.startsWith("/admin/")) {
    return adminRouter(req, res, next);
  }
  return next();
});

export default router;
