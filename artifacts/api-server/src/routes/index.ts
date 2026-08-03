import { Router, type IRouter } from "express";
import healthRouter from "./health";
import configRouter from "./config.js";
import songRouter from "./song";
import loreRouter from "./lore";
import spotifyRouter from "./spotify";
import shareRouter from "./share";
import meRouter from "./me/index.js";
import playerRouter from "./player.js";
import bottlesRouter from "./lore/bottles.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(configRouter);
router.use(songRouter);
router.use(meRouter);
router.use(playerRouter);
router.use(shareRouter);
router.use(spotifyRouter);
// Bottles must be before loreRouter — loreRouter has a rate-limit + auth
// catch-all that intercepts /api/* paths it doesn't own.
router.use(bottlesRouter);
router.use(loreRouter);

export default router;
