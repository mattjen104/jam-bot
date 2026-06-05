import { Router, type IRouter } from "express";
import healthRouter from "./health";
import spotifyAuthRouter from "./spotify-auth";
import songRouter from "./song";

const router: IRouter = Router();

router.use(healthRouter);
router.use(spotifyAuthRouter);
router.use(songRouter);

export default router;
