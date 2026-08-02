/**
 * sseConnectionTracker.ts — lightweight in-process guard for SSE connections.
 *
 * Tracks concurrent SSE connections per IP and enforces a configurable cap.
 * Runs before any DB work so rejected connections cost only a map lookup.
 *
 * Cap is tunable via SSE_MAX_CONNECTIONS_PER_IP (default 10).
 */

const MAX_CONNECTIONS_PER_IP = (() => {
  const raw = process.env.SSE_MAX_CONNECTIONS_PER_IP;
  if (raw) {
    const parsed = parseInt(raw, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return 10;
})();

const counts = new Map<string, number>();

/**
 * Attempt to acquire a connection slot for the given IP.
 * Returns true when the slot is granted (count incremented).
 * Returns false when the IP is already at the cap — caller should respond 429.
 */
export function acquire(ip: string): boolean {
  const current = counts.get(ip) ?? 0;
  if (current >= MAX_CONNECTIONS_PER_IP) return false;
  counts.set(ip, current + 1);
  return true;
}

/**
 * Release a previously acquired connection slot for the given IP.
 * Safe to call even if no slot was held (no-op).
 */
export function release(ip: string): void {
  const current = counts.get(ip);
  if (current == null) return;
  if (current <= 1) {
    counts.delete(ip);
  } else {
    counts.set(ip, current - 1);
  }
}

/** Exposed for testing only — returns the current count for an IP. */
export function _testOnly_getCount(ip: string): number {
  return counts.get(ip) ?? 0;
}

/** Exposed for testing only — clears all tracking state. */
export function _testOnly_reset(): void {
  counts.clear();
}
