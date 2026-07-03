import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const router: IRouter = Router();

const startedAt = Date.now();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/health", async (_req, res) => {
  const uptimeSeconds = Math.floor((Date.now() - startedAt) / 1000);
  try {
    await db.execute(sql`SELECT 1`);
    res.json({ ok: true, db: "ok", uptimeSeconds });
  } catch {
    res.status(503).json({ ok: false, db: "error", uptimeSeconds });
  }
});

export default router;
