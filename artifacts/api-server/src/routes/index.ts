import { Router, type IRouter } from "express";
import healthRouter from "./health";
import songRouter from "./song";
import loreRouter from "./lore";
import spotifyRouter from "./spotify";
import shareRouter from "./share";

const router: IRouter = Router();

router.use(healthRouter);
router.use(songRouter);
router.use(loreRouter);
router.use(spotifyRouter);
router.use(shareRouter);

export default router;
