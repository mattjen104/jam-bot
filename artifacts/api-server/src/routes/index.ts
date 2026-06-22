import { Router, type IRouter } from "express";
import healthRouter from "./health";
import songRouter from "./song";

const router: IRouter = Router();

router.use(healthRouter);
router.use(songRouter);

export default router;
