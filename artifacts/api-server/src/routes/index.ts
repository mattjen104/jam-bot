import { Router, type IRouter } from "express";
import healthRouter from "./health";
import spotifyAuthRouter from "./spotify-auth";

const router: IRouter = Router();

router.use(healthRouter);
router.use(spotifyAuthRouter);

export default router;
