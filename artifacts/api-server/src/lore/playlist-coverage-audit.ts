import { historySourceContract } from "./adapters.js";
import { isTestLikeStation } from "./source-coverage.js";
import type { SourceProbeOutcome } from "./source-coverage.js";

export type AuditExclusion =
  | "test"
  | "duplicate"
  | "inactive"
  | "hidden"
  | "unsupported";
export type PlaylistEvidence =
  | "confirmed_history"
  | "confirmed_live"
  | "conservative_configured"
  | "potential_unprobed"
  | "unavailable_transient"
  | "unavailable_no_metadata"
  | "policy_rejected";

export interface PlaylistAuditStation {
  id: number;
  slug: string;
  name: string;
  org: string | null;
  country: string | null;
  city: string | null;
  streamUrl: string | null;
  homepageUrl: string | null;
  nowPlayingSource: string | null;
  nowPlayingConfig: Record<string, unknown> | null;
  active: boolean;
  hidden: boolean;
  tier: string;
  automaticCullReason: string | null;
  automaticCullCanonicalStationId: number | null;
  scheduleScrapedAt: Date | null;
  lastAliveAt: Date | null;
  lastUsableAt: Date | null;
  lastUsableArtist: string | null;
  lastUsableTitle: string | null;
  probeOutcome: SourceProbeOutcome | null;
  probeAt: Date | null;
}

export interface PriorAuditEvidence {
  stationId: number;
  observedAt: string;
  outcome: SourceProbeOutcome | "policy_rejected" | "not_probeable";
  phase?: "pilot" | "fleet";
  sampleArtist?: string;
  sampleTitle?: string;
  latencyMs?: number;
  requestCountUpperBound?: number;
  incrementalRequestCountUpperBound?: number;
  origin?: string;
  requestedOrigin?: string;
  pilotStratum?: string;
  reusedDailyEvidence?: boolean;
  mutationCount?: number;
}

export function reuseAuditEvidence(
  evidence: PriorAuditEvidence,
  observedAt: string,
  phase: "pilot" | "fleet",
  pilotStratum?: string,
): PriorAuditEvidence & {
  reusedDailyEvidence: true;
  incrementalRequestCountUpperBound: 0;
} {
  return {
    ...evidence,
    observedAt,
    phase,
    ...(pilotStratum ? { pilotStratum } : {}),
    reusedDailyEvidence: true,
    requestCountUpperBound: evidence.requestCountUpperBound ?? 0,
    incrementalRequestCountUpperBound: 0,
    mutationCount: 0,
  };
}

const DAY_MS = 86_400_000;

export function auditExclusion(station: PlaylistAuditStation): AuditExclusion | null {
  if (isTestLikeStation(station)) return "test";
  if (
    station.automaticCullReason === "duplicate_stream" ||
    station.automaticCullCanonicalStationId !== null
  ) return "duplicate";
  if (!station.active) return "inactive";
  if (station.hidden) return "hidden";
  if (!station.streamUrl && !station.nowPlayingSource) return "unsupported";
  return null;
}

export function safeOrigin(raw: string | null): string {
  if (!raw) return "none";
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.origin.toLowerCase()
      : "unsupported";
  } catch {
    return "invalid";
  }
}

export function classifyPlaylistEvidence(
  station: PlaylistAuditStation,
  latestAudit: PriorAuditEvidence | null,
): PlaylistEvidence {
  if (latestAudit?.outcome === "policy_rejected") return "policy_rejected";
  const outcome = latestAudit?.outcome ?? station.probeOutcome;
  const hasPair =
    outcome === "usable_pair" ||
    Boolean(
      station.lastUsableAt &&
      station.lastUsableArtist?.trim() &&
      station.lastUsableTitle?.trim(),
    );
  const history = historySourceContract(
    station.nowPlayingSource,
    station.nowPlayingConfig,
  );
  if (history?.supportsBackfill && hasPair) return "confirmed_history";
  if (hasPair) return "confirmed_live";
  if (outcome === "unreachable") return "unavailable_transient";
  if (outcome === "blank_metadata" || outcome === "unsupported") {
    return "unavailable_no_metadata";
  }
  if (station.nowPlayingSource) return "conservative_configured";
  return "potential_unprobed";
}

export function wasAuditedToday(
  evidence: PriorAuditEvidence | null,
  now: Date,
): boolean {
  if (!evidence) return false;
  const at = Date.parse(evidence.observedAt);
  return Number.isFinite(at) && now.getTime() - at < DAY_MS;
}

export function auditOutcome(
  outcome: SourceProbeOutcome | "not_probeable",
  detail: string | null | undefined,
): PriorAuditEvidence["outcome"] {
  if (
    outcome === "unreachable" &&
    /\b(?:unsafe|private|loopback|link-local|non-public|blocked address|redirect limit|unsupported protocol)\b/i.test(
      detail ?? "",
    )
  ) {
    return "policy_rejected";
  }
  return outcome;
}

export function wilsonInterval(successes: number, total: number): {
  low: number;
  high: number;
} {
  if (total <= 0) return { low: 0, high: 0 };
  const z = 1.959963984540054;
  const p = successes / total;
  const z2 = z * z;
  const denominator = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denominator;
  const margin =
    (z / denominator) *
    Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total));
  return { low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
}

export function playlistPilotStratum(station: PlaylistAuditStation): string {
  const history = historySourceContract(
    station.nowPlayingSource,
    station.nowPlayingConfig,
  );
  return [
    history?.supportsBackfill ? "history" : station.nowPlayingSource ?? "none",
    station.country ?? "unknown",
    station.scheduleScrapedAt ? "schedule" : "no_schedule",
    station.probeOutcome ?? "unprobed",
  ].join("|");
}

function stablePilotHash(stationId: number): number {
  let hash = 2166136261;
  for (const char of `lore-playlist-pilot-v1:${stationId}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function stratifiedPilot<T extends PlaylistAuditStation>(
  stations: T[],
  target: number,
): T[] {
  const groups = new Map<string, T[]>();
  for (const station of stations) {
    const key = playlistPilotStratum(station);
    const rows = groups.get(key) ?? [];
    rows.push(station);
    groups.set(key, rows);
  }
  const desired = Math.min(target, stations.length);
  const allocations = [...groups.entries()].map(([key, rows]) => {
    const exact = (rows.length / stations.length) * desired;
    return {
      key,
      rows: rows.sort(
        (a, b) => stablePilotHash(a.id) - stablePilotHash(b.id) || a.id - b.id,
      ),
      count: Math.floor(exact),
      remainder: exact % 1,
    };
  });
  let remaining = desired - allocations.reduce((sum, group) => sum + group.count, 0);
  allocations.sort(
    (a, b) => b.remainder - a.remainder || a.key.localeCompare(b.key),
  );
  for (const group of allocations) {
    if (remaining <= 0) break;
    if (group.count < group.rows.length) {
      group.count++;
      remaining--;
    }
  }
  const selected = allocations.flatMap((group) =>
    group.rows.slice(0, group.count),
  );
  return selected.sort((a, b) => a.id - b.id);
}