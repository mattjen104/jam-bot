import { Router, type IRouter } from "express";
import stationsRouter from "./stations.js";
import recordingsRouter from "./recordings.js";
import pickersRouter from "./pickers.js";
import archiveRouter from "./archive.js";
import adminRouter from "./admin.js";

const router: IRouter = Router();

router.use(stationsRouter);
router.use(recordingsRouter);
router.use(pickersRouter);
router.use(archiveRouter);
router.use(adminRouter);

export default router;
