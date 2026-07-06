import { Router, type IRouter, type Request, type Response } from "express";
import {
  getSongShare,
  getStationShare,
  getStationRunShare,
  getPickerShare,
  getPickerRunShare,
  renderShareHtml,
  renderSongShareHtml,
  renderNotFoundHtml,
  renderShareCardPng,
  type SharePayload,
  type SongSharePayload,
} from "../../lore/share.js";

/**
 * Share routes: /api/share/... serves unfurl-ready HTML (OG tags + instant
 * redirect to the SPA) and the dynamic og:image PNG next to each page. These
 * intentionally live outside the OpenAPI spec — they emit HTML/PNG for bots
 * and browsers, not JSON for the SPA client.
 */

const router: IRouter = Router();

/** Public origin as seen through the proxy (falls back to direct host). */
function requestOrigin(req: Request): string {
  const proto =
    req.get("x-forwarded-proto")?.split(",")[0]?.trim() || req.protocol;
  const host =
    req.get("x-forwarded-host")?.split(",")[0]?.trim() || req.get("host") || "";
  return `${proto}://${host}`;
}

/** First value of a route param (express types allow string[]). */
function param(req: Request, name: string): string {
  const v = req.params[name];
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function sendShareHtml(
  req: Request,
  res: Response,
  payload: SharePayload | null,
  slugPath: string,
): void {
  if (!payload) {
    res
      .status(404)
      .set("Content-Type", "text/html; charset=utf-8")
      .send(renderNotFoundHtml());
    return;
  }
  const sharePath = `/api/share/${slugPath}`;
  const cardPath = `${sharePath}/card.png`;
  res
    .set("Content-Type", "text/html; charset=utf-8")
    .set("Cache-Control", "public, max-age=300")
    .send(renderShareHtml(payload, requestOrigin(req), sharePath, cardPath));
}

async function sendShareCard(
  res: Response,
  payload: SharePayload | null,
): Promise<void> {
  if (!payload) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const png = await renderShareCardPng(payload.card);
  res
    .set("Content-Type", "image/png")
    .set("Cache-Control", "public, max-age=3600")
    .send(png);
}

function handle(
  fn: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response) => void {
  return (req, res) => {
    fn(req, res).catch((err) => {
      console.error("[share] failed", req.path, err);
      if (!res.headersSent) res.status(500).json({ error: "Share failed" });
    });
  };
}

// ---- Songs ---------------------------------------------------------------

function sendSongShareHtml(
  req: Request,
  res: Response,
  payload: SongSharePayload | null,
  slugPath: string,
): void {
  if (!payload) {
    res
      .status(404)
      .set("Content-Type", "text/html; charset=utf-8")
      .send(renderNotFoundHtml());
    return;
  }
  const sharePath = `/api/share/${slugPath}`;
  const cardPath = `${sharePath}/card.png`;
  res
    .set("Content-Type", "text/html; charset=utf-8")
    .set("Cache-Control", "public, max-age=30") // shorter TTL — live status changes
    .send(renderSongShareHtml(payload, requestOrigin(req), sharePath, cardPath));
}

router.get(
  "/share/songs/:mbid",
  handle(async (req, res) => {
    const mbid = param(req, "mbid");
    const payload = await getSongShare(mbid);
    sendSongShareHtml(req, res, payload, `songs/${encodeURIComponent(mbid)}`);
  }),
);

router.get(
  "/share/songs/:mbid/card.png",
  handle(async (req, res) => {
    await sendShareCard(res, await getSongShare(param(req, "mbid")));
  }),
);

// ---- Stations --------------------------------------------------------------

router.get(
  "/share/stations/:slug",
  handle(async (req, res) => {
    const payload = await getStationShare(param(req, "slug"));
    sendShareHtml(
      req,
      res,
      payload,
      `stations/${encodeURIComponent(param(req, "slug"))}`,
    );
  }),
);

router.get(
  "/share/stations/:slug/card.png",
  handle(async (req, res) => {
    await sendShareCard(res, await getStationShare(param(req, "slug")));
  }),
);

// ---- Station runs ----------------------------------------------------------

router.get(
  "/share/station-runs/:runId",
  handle(async (req, res) => {
    const id = parseId(param(req, "runId"));
    const payload = id == null ? null : await getStationRunShare(id);
    sendShareHtml(req, res, payload, `station-runs/${param(req, "runId")}`);
  }),
);

router.get(
  "/share/station-runs/:runId/card.png",
  handle(async (req, res) => {
    const id = parseId(param(req, "runId"));
    await sendShareCard(res, id == null ? null : await getStationRunShare(id));
  }),
);

// ---- Pickers ---------------------------------------------------------------

router.get(
  "/share/pickers/:handle",
  handle(async (req, res) => {
    const payload = await getPickerShare(param(req, "handle"));
    sendShareHtml(
      req,
      res,
      payload,
      `pickers/${encodeURIComponent(param(req, "handle"))}`,
    );
  }),
);

router.get(
  "/share/pickers/:handle/card.png",
  handle(async (req, res) => {
    await sendShareCard(res, await getPickerShare(param(req, "handle")));
  }),
);

// ---- Picker runs -----------------------------------------------------------

router.get(
  "/share/picker-runs/:runId",
  handle(async (req, res) => {
    const id = parseId(param(req, "runId"));
    const payload = id == null ? null : await getPickerRunShare(id);
    sendShareHtml(req, res, payload, `picker-runs/${param(req, "runId")}`);
  }),
);

router.get(
  "/share/picker-runs/:runId/card.png",
  handle(async (req, res) => {
    const id = parseId(param(req, "runId"));
    await sendShareCard(res, id == null ? null : await getPickerRunShare(id));
  }),
);

export default router;
