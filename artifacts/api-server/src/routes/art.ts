/**
 * Art proxy — GET /art?src=<encoded-url>
 *
 * On cache HIT: stream the blob from Object Storage with immutable headers.
 * On cache MISS: validate src with the SSRF guard, fetch from origin, store,
 *   then stream the bytes back.
 * On any error (SSRF rejection, origin 4xx/5xx, storage failure): 302
 *   redirect to the original src so the browser still loads the image.
 *
 * Cache-Control: public, max-age=31536000, immutable — the browser never
 * re-fetches after the first hit.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { isSafeArtworkUrl } from "../lore/share.js";
import { artGet, artPut } from "../lib/artStorage.js";

const router: IRouter = Router();

const IMMUTABLE = "public, max-age=31536000, immutable";

async function fetchFromOrigin(
  src: string,
): Promise<{ data: Buffer; contentType: string } | null> {
  let current = src;
  for (let hop = 0; hop < 4; hop++) {
    if (!(await isSafeArtworkUrl(current))) return null;
    let res: Response & { arrayBuffer(): Promise<ArrayBuffer>; headers: Headers };
    try {
      res = (await fetch(current, {
        signal: AbortSignal.timeout(8_000),
        redirect: "manual",
        headers: { Accept: "image/*,*/*;q=0.8" },
      })) as typeof res;
    } catch {
      return null;
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return null;
      current = new URL(loc, current).toString();
      continue;
    }
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "image/jpeg";
    if (!ct.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > 8_000_000) return null;
    return { data: buf, contentType: ct };
  }
  return null;
}

router.get("/art", async (req: Request, res: Response) => {
  const src =
    typeof req.query.src === "string" && req.query.src ? req.query.src : null;

  if (!src) {
    res.status(400).json({ error: "src is required" });
    return;
  }

  // --- Cache hit ---
  try {
    const cached = await artGet(src);
    if (cached) {
      res
        .set("Content-Type", cached.contentType)
        .set("Cache-Control", IMMUTABLE)
        .set("X-Art-Proxy", "hit")
        .send(cached.data);
      return;
    }
  } catch {
    // storage read failure — fall through to origin fetch
  }

  // --- Cache miss: SSRF guard then fetch from origin ---
  if (!(await isSafeArtworkUrl(src))) {
    // Unsafe URL — fallback redirect so the browser can try the original
    res.redirect(302, src);
    return;
  }

  const fetched = await fetchFromOrigin(src);
  if (!fetched) {
    res.redirect(302, src);
    return;
  }

  // Store in the background — respond immediately
  void artPut(src, fetched.data, fetched.contentType);

  res
    .set("Content-Type", fetched.contentType)
    .set("Cache-Control", IMMUTABLE)
    .set("X-Art-Proxy", "miss")
    .send(fetched.data);
});

export default router;
