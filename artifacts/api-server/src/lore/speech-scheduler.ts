/**
 * Policy-only admission control for speech capture. Persistence/DB writes are
 * intentionally left to callers; a reservation key makes repeated delivery of
 * the same station/window idempotent within this scheduler instance.
 */
export type SpeechSkipReason =
  | "disabled"
  | "staged_mode"
  | "station_quota"
  | "window_quota"
  | "already_reserved"
  | "no_mount";

export type SpeechAdmission =
  | { kind: "sampled"; reason: "admitted" | "idempotent"; reservation: SpeechReservation }
  | { kind: "skipped"; reason: SpeechSkipReason };

export interface SpeechReservation {
  id: string;
  stationId: number;
  windowStart: Date;
  mountUrl: string;
  estimatedCost: number;
}

export interface SpeechMount {
  url: string;
  /** Relative cost; lower is preferred. */
  estimatedCost: number;
  enabled?: boolean;
}

export interface SpeechQuotaPolicy {
  enabled: boolean;
  /** staged mode admits only these station ids; absent means normal operation. */
  stagedStationIds?: readonly number[];
  maxCapturesPerStation: number;
  maxCapturesPerWindow: number;
  windowMs: number;
}

export class SpeechQuotaScheduler {
  private readonly reservations = new Map<string, SpeechReservation>();
  private readonly stationCounts = new Map<string, number>();
  private readonly windowCounts = new Map<number, number>();

  constructor(private readonly policy: SpeechQuotaPolicy) {}

  reserve(stationId: number, at: Date, mounts: readonly SpeechMount[]): SpeechAdmission {
    if (!this.policy.enabled) return { kind: "skipped", reason: "disabled" };
    if (this.policy.stagedStationIds && !this.policy.stagedStationIds.includes(stationId)) {
      return { kind: "skipped", reason: "staged_mode" };
    }
    const windowMs = Math.max(1, this.policy.windowMs);
    const bucket = Math.floor(at.getTime() / windowMs);
    const stationKey = `${stationId}:${bucket}`;
    const id = `speech:${stationKey}`;
    const existing = this.reservations.get(id);
    if (existing) return { kind: "sampled", reason: "idempotent", reservation: existing };
    const mount = selectCheapestMount(mounts);
    if (!mount) return { kind: "skipped", reason: "no_mount" };
    if ((this.stationCounts.get(stationKey) ?? 0) >= this.policy.maxCapturesPerStation) {
      return { kind: "skipped", reason: "station_quota" };
    }
    if ((this.windowCounts.get(bucket) ?? 0) >= this.policy.maxCapturesPerWindow) {
      return { kind: "skipped", reason: "window_quota" };
    }
    const reservation = {
      id, stationId, mountUrl: mount.url, estimatedCost: mount.estimatedCost,
      windowStart: new Date(bucket * windowMs),
    };
    this.reservations.set(id, reservation);
    this.stationCounts.set(stationKey, (this.stationCounts.get(stationKey) ?? 0) + 1);
    this.windowCounts.set(bucket, (this.windowCounts.get(bucket) ?? 0) + 1);
    return { kind: "sampled", reason: "admitted", reservation };
  }
}

export function selectCheapestMount(mounts: readonly SpeechMount[]): SpeechMount | null {
  return mounts
    .filter((mount) => mount.enabled !== false && !!mount.url && Number.isFinite(mount.estimatedCost))
    .reduce<SpeechMount | null>((best, mount) =>
      !best || mount.estimatedCost < best.estimatedCost ||
      (mount.estimatedCost === best.estimatedCost && mount.url < best.url) ? mount : best, null);
}