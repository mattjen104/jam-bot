import { Router, type IRouter } from "express";
import healthRouter from "./health";
import songRouter from "./song";
import loreRouter from "./lore";

const router: IRouter = Router();

router.use(healthRouter);
router.use(songRouter);
router.use(loreRouter);

export default router;
