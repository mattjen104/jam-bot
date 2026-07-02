import { Router, type IRouter } from "express";
import healthRouter from "./health";
import songRouter from "./song";
import loreRouter from "./lore";
import spotifyRouter from "./spotify";

const router: IRouter = Router();

router.use(healthRouter);
router.use(songRouter);
router.use(loreRouter);
router.use(spotifyRouter);

export default router;
