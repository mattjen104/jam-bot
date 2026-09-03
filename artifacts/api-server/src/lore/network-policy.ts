/**
 * Shared identity and pacing helpers for requests sent to station-owned
 * infrastructure. Keep the default honest and allow operators to add a public
 * contact URL without hard-coding a development or deployment hostname.
 */
export const STATION_NETWORK_USER_AGENT =
  process.env["LORE_NETWORK_USER_AGENT"]?.trim() ||
  "Lore-Radio/1.0 (public-stream metadata and health client)";

/** Add bounded jitter so fleet retries and recurring probes do not synchronize. */
export function withPoliteJitter(
  delayMs: number,
  fraction = 0.2,
  random = Math.random,
): number {
  const spread = Math.max(1, Math.floor(delayMs * fraction));
  return Math.max(1, delayMs + Math.floor((random() * 2 - 1) * spread));
}

const DEFAULT_MIN_SPACING_MS = 1_000;
const DEFAULT_FORBIDDEN_COOLDOWN_MS = 6 * 60 * 60 * 1_000;
const REPEATED_FORBIDDEN_THRESHOLD = 2;

interface OriginState {
  tail: Promise<void>;
  nextAllowedAt: number;
  consecutiveForbidden: number;
}

export interface StationNetworkPolicyOptions {
  minSpacingMs?: number;
  forbiddenCooldownMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

function retryAfterMs(value: string | null, now: number): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - now) : null;
}

/**
 * A deliberately opt-in scheduler for station-owned infrastructure. Platform
 * APIs must not use this class: their limits are global/provider-specific and
 * must not let one station origin stall unrelated stations.
 */
export class StationNetworkPolicy {
  private readonly states = new Map<string, OriginState>();
  private readonly minSpacingMs: number;
  private readonly forbiddenCooldownMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: StationNetworkPolicyOptions = {}) {
    this.minSpacingMs = opts.minSpacingMs ?? DEFAULT_MIN_SPACING_MS;
    this.forbiddenCooldownMs =
      opts.forbiddenCooldownMs ?? DEFAULT_FORBIDDEN_COOLDOWN_MS;
    this.now = opts.now ?? Date.now;
    this.sleep =
      opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async run<T>(url: string, operation: () => Promise<T>): Promise<T> {
    const origin = new URL(url).origin.toLowerCase();
    const state = this.states.get(origin) ?? {
      tail: Promise.resolve(),
      nextAllowedAt: 0,
      consecutiveForbidden: 0,
    };
    this.states.set(origin, state);

    const predecessor = state.tail;
    let release!: () => void;
    state.tail = new Promise<void>((resolve) => {
      release = resolve;
    });

    await predecessor;
    try {
      const waitMs = state.nextAllowedAt - this.now();
      if (waitMs > 0) await this.sleep(waitMs);
      const result = await operation();
      this.observeResult(url, result);
      return result;
    } finally {
      state.nextAllowedAt = Math.max(
        state.nextAllowedAt,
        this.now() + this.minSpacingMs,
      );
      release();
    }
  }

  observeResponse(url: string, status: number, retryAfter: string | null = null): void {
    this.observe(url, status, retryAfter);
  }

  private observeResult(url: string, result: unknown): void {
    if (!result || typeof result !== "object") return;
    const response = result as {
      status?: unknown;
      headers?: { get?: (name: string) => string | null };
    };
    if (typeof response.status !== "number") return;
    this.observe(
      url,
      response.status,
      response.headers?.get?.("retry-after") ?? null,
    );
  }

  private observe(url: string, status: number, retryAfter: string | null): void {
    const origin = new URL(url).origin.toLowerCase();
    const state = this.states.get(origin);
    if (!state) return;
    const now = this.now();
    if (status === 429) {
      state.consecutiveForbidden = 0;
      state.nextAllowedAt = Math.max(
        state.nextAllowedAt,
        now + (retryAfterMs(retryAfter, now) ?? this.minSpacingMs),
      );
      return;
    }
    if (status === 403) {
      state.consecutiveForbidden += 1;
      if (state.consecutiveForbidden >= REPEATED_FORBIDDEN_THRESHOLD) {
        state.nextAllowedAt = Math.max(
          state.nextAllowedAt,
          now + this.forbiddenCooldownMs,
        );
      }
      return;
    }
    state.consecutiveForbidden = 0;
  }
}

export const stationNetworkPolicy = new StationNetworkPolicy();

export function withStationOriginPolicy<T>(
  url: string,
  operation: () => Promise<T>,
): Promise<T> {
  return stationNetworkPolicy.run(url, operation);
}

export function observeStationOriginResponse(
  url: string,
  status: number,
  retryAfter: string | null = null,
): void {
  stationNetworkPolicy.observeResponse(url, status, retryAfter);
}