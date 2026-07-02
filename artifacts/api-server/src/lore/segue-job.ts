import { runSegueDerivation } from "./segue.js";

/**
 * Nightly segue-derivation scheduler. Like the poller, this is the smallest
 * thing that works: an in-process daily interval, kept off the request path.
 * The derivation itself is idempotent, so an extra run only fills gaps — safe to
 * run once shortly after boot (to warm a fresh DB) and then daily.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
// Warm-up delay so boot (seed + poller backfill) settles before the first run.
const WARMUP_MS = 5 * 60 * 1000;

let started = false;
const timers: NodeJS.Timeout[] = [];

/** Start the nightly segue job. Idempotent — safe to call once at boot. */
export function startSegueJob(): void {
  if (started) return;
  started = true;

  const warmup = setTimeout(() => {
    void runSegueDerivation();
    const daily = setInterval(() => void runSegueDerivation(), DAY_MS);
    timers.push(daily);
  }, WARMUP_MS);
  timers.push(warmup);

  console.info("[lore] segue derivation job scheduled (daily)");
}

/** Stop the segue job (tests / graceful shutdown). */
export function stopSegueJob(): void {
  for (const t of timers) clearTimeout(t);
  timers.length = 0;
  started = false;
}
