import { db, stationsTable } from "@workspace/db";
import { and, eq, isNotNull, lt, or, isNull } from "drizzle-orm";

/**
 * Lightweight background job that validates each station's donate_url is still
 * live by sending a HEAD request. Runs on the same 30-day cadence as the
 * homepage scraper so a full pass over all stations is gentle and unhurried.
 *
 * Policy:
 *  - Only stations with a non-null donate_url are visited.
 *  - A confirmed 4xx/5xx clears donate_url so a broken link never reaches a
 *    listener. Network errors and timeouts leave the URL intact — they could
 *    be transient — but still advance donateCheckedAt so the URL is retried
 *    on the next 30-day cycle rather than every tick.
 *  - Manually-curated URLs (never scraped) are treated identically to scraped
 *    ones: the checker covers all non-null rows regardless of origin.
 *  - donateCheckedAt is always written, so resetting it to null forces an
 *    immediate re-check on the next tick.
 */

const FETCH_TIMEOUT_MS = 10_000;
// Same 30-day cadence as homepage scraping so a single loop covers both jobs.
const RECHECK_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
const BATCH_SIZE = 5;
const TICK_MS = 20_000;
// Wait for boot-time work to settle before the first check.
const WARMUP_MS = 120_000;

interface CheckTarget {
  id: number;
  slug: string;
  donateUrl: string;
}

async function loadStaleTargets(limit: number): Promise<CheckTarget[]> {
  const cutoff = new Date(Date.now() - RECHECK_AFTER_MS);
  const rows = await db
    .select({
      id: stationsTable.id,
      slug: stationsTable.slug,
      donateUrl: stationsTable.donateUrl,
    })
    .from(stationsTable)
    .where(
      and(
        eq(stationsTable.active, true),
        eq(stationsTable.hidden, false),
        isNotNull(stationsTable.donateUrl),
        or(
          isNull(stationsTable.donateCheckedAt),
          lt(stationsTable.donateCheckedAt, cutoff),
        ),
      ),
    )
    .orderBy(stationsTable.donateCheckedAt)
    .limit(limit);

  return rows
    .filter((r): r is CheckTarget => Boolean(r.donateUrl))
    .map((r) => ({ id: r.id, slug: r.slug, donateUrl: r.donateUrl! }));
}

/**
 * HTTP status classifications for donate-URL health checking.
 *
 * We only clear a donate_url on strong, unambiguous "this page is gone"
 * signals. Anything that could be a transient failure, a bot gate, or a
 * server-side HEAD restriction leaves the URL intact and just advances
 * donateCheckedAt so the URL is retried on the next 30-day cycle.
 *
 * Strong dead signals (clear donate_url):
 *   404 Not Found, 410 Gone — the resource definitively does not exist.
 *
 * Ambiguous / keep URL:
 *   401, 403  — bot gate or auth wall; the page may be live for real users.
 *   405       — server doesn't support HEAD; we retry with GET below.
 *   429       — rate limited; transient.
 *   5xx       — server error; transient.
 *   network / timeout — transient outage; never punish a live URL for it.
 */
function isDefinitelyDead(status: number): boolean {
  return status === 404 || status === 410;
}

/**
 * Probe a URL using the given method.  Returns the HTTP status, or null on
 * network/timeout errors.  We pass `Range: bytes=0-0` on GET probes so a
 * compliant server sends back only the status + headers with no body
 * (equivalent to HEAD for our purposes, cheaper on bandwidth).
 */
async function probe(
  url: string,
  method: "HEAD" | "GET",
  fetchFn: typeof fetch,
): Promise<number | null> {
  try {
    const headers: Record<string, string> = {
      "User-Agent": "Lore-Discovery-Bot/1.0",
    };
    if (method === "GET") {
      headers["Range"] = "bytes=0-0";
    }
    const res = await fetchFn(url, {
      method,
      headers,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "follow",
    });
    return res.status;
  } catch {
    return null;
  }
}

/**
 * Check one donate URL.
 * Returns "ok" | "dead" | "error":
 *   "ok"    — URL appears live (2xx/3xx, or 206 partial, or ambiguous 4xx
 *             that could be a bot gate — we give it the benefit of the doubt).
 *   "dead"  — URL is definitively gone (404/410 confirmed via HEAD + GET
 *             fallback, or non-http scheme, or malformed).  donate_url cleared.
 *   "error" — Network/timeout error or transient server error.  URL kept,
 *             donateCheckedAt advanced so it retries next cycle.
 */
export async function checkDonateUrl(
  target: CheckTarget,
  opts: { fetchFn?: typeof fetch } = {},
): Promise<"ok" | "dead" | "error"> {
  const fetchFn = opts.fetchFn ?? fetch;

  // ── 1. Validate URL structure before hitting the network ─────────────────
  try {
    const parsed = new URL(target.donateUrl);
    if (!/^https?:$/i.test(parsed.protocol)) {
      await db
        .update(stationsTable)
        .set({ donateUrl: null, donateCheckedAt: new Date() })
        .where(eq(stationsTable.id, target.id));
      console.info(
        `[donate-checker] non-http URL cleared for ${target.slug}: ${target.donateUrl}`,
      );
      return "dead";
    }
  } catch {
    await db
      .update(stationsTable)
      .set({ donateUrl: null, donateCheckedAt: new Date() })
      .where(eq(stationsTable.id, target.id));
    console.info(
      `[donate-checker] malformed URL cleared for ${target.slug}: ${target.donateUrl}`,
    );
    return "dead";
  }

  // ── 2. HEAD probe ─────────────────────────────────────────────────────────
  const headStatus = await probe(target.donateUrl, "HEAD", fetchFn);

  if (headStatus === null) {
    // Network/timeout — leave URL intact, advance timestamp.
    console.warn(
      `[donate-checker] network error for ${target.slug} (URL kept): ${target.donateUrl}`,
    );
    await db
      .update(stationsTable)
      .set({ donateCheckedAt: new Date() })
      .where(eq(stationsTable.id, target.id));
    return "error";
  }

  // 405 Method Not Allowed — server doesn't support HEAD; fall back to GET.
  const effectiveStatus =
    headStatus === 405
      ? (await probe(target.donateUrl, "GET", fetchFn)) ?? headStatus
      : headStatus;

  // ── 3. Classify result ────────────────────────────────────────────────────
  if (isDefinitelyDead(effectiveStatus)) {
    await db
      .update(stationsTable)
      .set({ donateUrl: null, donateCheckedAt: new Date() })
      .where(eq(stationsTable.id, target.id));
    console.info(
      `[donate-checker] dead link cleared for ${target.slug} (HTTP ${effectiveStatus}): ${target.donateUrl}`,
    );
    return "dead";
  }

  // Everything else (2xx, 3xx, 4xx bot gates, 5xx transient) — keep the URL,
  // just advance the timestamp.
  await db
    .update(stationsTable)
    .set({ donateCheckedAt: new Date() })
    .where(eq(stationsTable.id, target.id));

  if (effectiveStatus >= 500) {
    console.warn(
      `[donate-checker] server error ${effectiveStatus} for ${target.slug} (URL kept): ${target.donateUrl}`,
    );
    return "error";
  }

  return "ok";
}

let started = false;
let timer: NodeJS.Timeout | null = null;

/**
 * OPERATOR NOTE — force an immediate donate-URL health-check pass:
 *
 * Reset donateCheckedAt to null for every station with a non-null donate_url:
 *
 *   UPDATE stations
 *   SET    donate_checked_at = NULL
 *   WHERE  donate_url IS NOT NULL
 *     AND  active = true
 *     AND  hidden = false;
 *
 * The checker loop will visit them in batches of 5 every 20 s.
 */

/** Start the donate-URL checker loop. Idempotent — safe to call once at boot. */
export function startDonateChecker(): void {
  if (started) return;
  started = true;

  const tick = async () => {
    try {
      const targets = await loadStaleTargets(BATCH_SIZE);
      for (const target of targets) {
        await checkDonateUrl(target);
      }
    } catch (err) {
      console.error("[lore] donate checker tick failed", err);
    }
    timer = setTimeout(tick, TICK_MS);
  };
  timer = setTimeout(tick, WARMUP_MS);
}

/** Stop the donate checker (tests / graceful shutdown). */
export function stopDonateChecker(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  started = false;
}
