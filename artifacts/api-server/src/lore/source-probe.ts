import {
  db,
  stationsTable,
  radioBrowserStationsTable,
  stationSourceProbesTable,
  type Station,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  fetchIcyMetadata,
  resolveStreamUrl,
  parseStreamTitle,
  type IcyFetchResult,
} from "./icy.js";
import { clearIcyErrorBackoff } from "./adapters.js";
import { enrollStationPoller, hasHealthyStationWatcher } from "./poller.js";
import {
  getSourceCoverageLedger,
  type SourceProbeOutcome,
} from "./source-coverage.js";
import {
  classifyMetadataQuality,
  recordMetadataQuality,
  sourceCapabilityFor,
  type MetadataQualityOutcome,
} from "./metadata-quality.js";
import { STATION_NETWORK_USER_AGENT } from "./network-policy.js";

/**
 * Bounded, redirect-aware probes of a station's FREE public metadata
 * surfaces, plus a single-flight background run that probes every non-healthy
 * roster station and repairs the configurations a probe verifies.
 *
 * Design rules (mirroring the task contract):
 *
 *  - A probe records what the source ACTUALLY supplies. Reachable audio or
 *    an ICY header alone is never "usable" — only a real artist+title pair
 *    is. Blank, junk, or show-only values classify as `blank_metadata`;
 *    a surface with no track metadata at all is `unsupported`; network
 *    failures are `unreachable` (transient — never a permanent verdict).
 *  - Repairs are conservative: only stations whose probe verified a usable
 *    pair are touched, healthy configurations are never re-written, hidden
 *    stations are left for the documented manual restore procedure, and an
 *    operator can pin any station's config with
 *    `nowPlayingConfig.sourceLocked: true`.
 *  - Repaired stations feed the ordinary radio_browser_icy / radiojar
 *    adapters, so recovered metadata flows through the existing raw-spin +
 *    strong-identifier-first resolution ladder unchanged — with the usual
 *    honest unresolved states when MusicBrainz/Spotify can't place a track.
 */

const PROBE_GAP_MS = 5_000;
/** Hard cap on stations probed in one run — bounds total run time. */
const MAX_PROBES_PER_RUN = 150;
const FETCH_TIMEOUT_MS = 8_000;
/**
 * Overall per-station probe budget. The individual network layers each carry
 * their own timeouts (ICY connect/read, redirect HEAD probes, platform JSON
 * fetch), but pre-socket phases (DNS resolution, redirect resolution) have
 * windows those timers do not cover — a single hung await must never stall
 * the sequential run. A station that exceeds the budget is recorded
 * `unreachable` (transient by definition) and the run moves on.
 */
const PROBE_BUDGET_MS = 30_000;

// ---- Probe ----------------------------------------------------------------

export interface ProbeResult {
  kind: "icy" | "radiojar";
  outcome: SourceProbeOutcome;
  /** Canonical quality vocabulary shared with ordinary polling. */
  qualityOutcome?: MetadataQualityOutcome;
  /** Human-readable detail (error message, what was observed). */
  detail?: string;
  /** Direct stream URL after redirect resolution (usable_pair only). */
  resolvedUrl?: string;
  /** The artist/title pair observed at probe time (evidence, not a spin). */
  sampleArtist?: string;
  sampleTitle?: string;
}

/** Injectable seams so tests never touch the network. */
export interface ProbeDeps {
  fetchIcy: (url: string) => Promise<IcyFetchResult>;
  resolveUrl: (url: string) => Promise<string>;
  fetchJson: (url: string) => Promise<unknown>;
  /** Overall per-probe budget in ms; defaults to PROBE_BUDGET_MS. */
  budgetMs?: number;
}

async function defaultFetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": STATION_NETWORK_USER_AGENT,
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

const defaultDeps: ProbeDeps = {
  fetchIcy: fetchIcyMetadata,
  resolveUrl: resolveStreamUrl,
  fetchJson: defaultFetchJson,
};

type ProbeStation = Pick<
  Station,
  "id" | "slug" | "streamUrl" | "nowPlayingSource" | "nowPlayingConfig"
>;

/**
 * The Radiojar stream id for a station, from config (`streamId`) or derived
 * from a radiojar.com stream URL (`https://stream.radiojar.com/<id>`).
 * Null when the station is not a Radiojar station.
 */
export function radiojarStreamId(station: ProbeStation): string | null {
  const cfg = (station.nowPlayingConfig ?? {}) as Record<string, unknown>;
  const configured = cfg["streamId"];
  if (typeof configured === "string" && configured.trim()) {
    return configured.trim();
  }
  try {
    const url = new URL(station.streamUrl);
    if (!url.hostname.toLowerCase().endsWith("radiojar.com")) return null;
    const first = url.pathname.split("/").filter(Boolean)[0];
    return first ?? null;
  } catch {
    return null;
  }
}

/**
 * True when a probe result demonstrates a usable artist+title pair — the ONLY
 * outcome that counts as "the station publishes track metadata". A title-only
 * or artist-only value is incomplete (often show-level metadata standing in),
 * so it does NOT qualify.
 */
function usablePair(
  rawArtist: string | undefined,
  rawTitle: string | undefined,
): { artist: string; title: string } | null {
  const artist = rawArtist?.trim() ?? "";
  const title = rawTitle?.trim() ?? "";
  if (classifyMetadataQuality(artist, title).outcome !== "usable_pair") {
    return null;
  }
  return { artist, title };
}

/**
 * Probe one station's free public metadata surfaces. Bounded: one ICY
 * connection attempt (internally redirect-aware, ≤3 hops, socket timeouts) or
 * one platform JSON fetch (8s timeout), all inside an overall per-probe
 * budget so no single station can stall the sequential run. Never throws.
 * Returns null when the station has nothing to probe (no stream URL, no
 * supported platform).
 */
export async function probeStationPublicMetadata(
  station: ProbeStation,
  deps: ProbeDeps = defaultDeps,
): Promise<ProbeResult | null> {
  if (hasHealthyStationWatcher(station.id)) return null;
  return probeStationPublicMetadataWithoutRuntimeState(station, deps);
}

/**
 * Read-only audit seam. Unlike the operational probe, this deliberately does
 * not consult watcher state: the audit must measure the selected station
 * consistently without touching pollers, health ledgers, or configuration.
 * Callers are responsible for daily probe limits and append-only evidence.
 */
export async function probeStationPublicMetadataForAudit(
  station: ProbeStation,
  deps: ProbeDeps = defaultDeps,
): Promise<ProbeResult | null> {
  return probeStationPublicMetadataWithoutRuntimeState(station, {
    ...deps,
    // fetchIcyMetadata already performs one bounded, public-IP-pinned redirect
    // resolution. Operational repair needs the direct URL and resolves again;
    // the read-only audit does not, avoiding up to three redundant requests.
    resolveUrl: async (url) => url,
  });
}

async function probeStationPublicMetadataWithoutRuntimeState(
  station: ProbeStation,
  deps: ProbeDeps,
): Promise<ProbeResult | null> {
  const budgetMs = deps.budgetMs ?? PROBE_BUDGET_MS;
  let timer: NodeJS.Timeout | undefined;
  const overBudget = new Promise<ProbeResult>((resolve) => {
    timer = setTimeout(() => {
      resolve({
        kind: radiojarStreamId(station) ? "radiojar" : "icy",
        outcome: "unreachable",
        qualityOutcome: "response_error",
        detail: `probe exceeded its ${Math.round(budgetMs / 1000)}s time budget`,
      });
    }, budgetMs);
  });
  try {
    return await Promise.race([
      probeStationPublicMetadataInner(station, deps),
      overBudget,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function probeStationPublicMetadataInner(
  station: ProbeStation,
  deps: ProbeDeps,
): Promise<ProbeResult | null> {
  const jarId = radiojarStreamId(station);

  // Radiojar: the audio stream hides behind per-request tokenized redirects
  // the raw-TCP ICY fetcher cannot follow, but the platform publishes an
  // unauthenticated now-playing JSON endpoint per stream id.
  if (jarId) {
    const url = `https://www.radiojar.com/api/stations/${encodeURIComponent(jarId)}/now_playing/`;
    let body: unknown;
    try {
      body = await deps.fetchJson(url);
    } catch (err) {
      return {
        kind: "radiojar",
        outcome: "unreachable",
        qualityOutcome: "response_error",
        detail: err instanceof Error ? err.message : String(err),
      };
    }
    const obj =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : {};
    const artist = typeof obj.artist === "string" ? obj.artist : undefined;
    const title = typeof obj.title === "string" ? obj.title : undefined;
    const quality = classifyMetadataQuality(artist, title);
    const pair = usablePair(artist, title);
    if (!pair) {
      return {
        kind: "radiojar",
        outcome: "blank_metadata",
        qualityOutcome: quality.outcome,
        detail: quality.detail,
      };
    }
    return {
      kind: "radiojar",
      outcome: "usable_pair",
      qualityOutcome: "usable_pair",
      sampleArtist: pair.artist,
      sampleTitle: pair.title,
    };
  }

  if (!station.streamUrl) return null;

  // ICY: raw stream metadata. fetchIcyMetadata resolves redirects first
  // (bounded, public-IP-pinned), so a redirecting stream is probed at its
  // direct URL — and that direct URL is what a repair persists.
  const result = await deps.fetchIcy(station.streamUrl);
  if (!result.ok) {
    if (result.kind === "icy_unsupported") {
      return {
        kind: "icy",
        outcome: "unsupported",
        qualityOutcome: "unsupported",
        detail:
          result.message ??
          "server does not honour Icy-MetaData (no icy-metaint header)",
      };
    }
    return {
      kind: "icy",
      outcome: "unreachable",
      qualityOutcome: "response_error",
      detail: result.message ?? "transient network failure",
    };
  }

  if (!result.streamTitle) {
    return {
      kind: "icy",
      outcome: "blank_metadata",
      qualityOutcome: "empty_metadata",
      detail: "ICY metadata block present but StreamTitle is empty",
    };
  }

  const parsed = parseStreamTitle(result.streamTitle);
  const quality = classifyMetadataQuality(
    parsed?.rawArtist,
    parsed?.rawTitle ?? result.streamTitle,
  );
  const pair = usablePair(parsed?.rawArtist, parsed?.rawTitle);
  if (!pair) {
    return {
      kind: "icy",
      outcome: "blank_metadata",
      qualityOutcome: quality.outcome,
      detail: quality.detail,
    };
  }

  // Verified usable — resolve the direct stream URL for the repair write.
  let resolvedUrl = station.streamUrl;
  try {
    resolvedUrl = await deps.resolveUrl(station.streamUrl);
  } catch {
    // Resolution failure is fine — keep the URL the probe just succeeded on.
  }
  return {
    kind: "icy",
    outcome: "usable_pair",
    qualityOutcome: "usable_pair",
    resolvedUrl,
    sampleArtist: pair.artist,
    sampleTitle: pair.title,
  };
}

/** Persist (upsert) a probe outcome into the source-coverage ledger table. */
export async function persistProbeResult(
  stationId: number,
  probe: ProbeResult,
): Promise<void> {
  const now = new Date();
  await db
    .insert(stationSourceProbesTable)
    .values({
      stationId,
      probeKind: probe.kind,
      outcome: probe.outcome,
      detail: probe.detail ?? null,
      resolvedUrl: probe.resolvedUrl ?? null,
      sampleArtist: probe.sampleArtist ?? null,
      sampleTitle: probe.sampleTitle ?? null,
      probedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: stationSourceProbesTable.stationId,
      set: {
        probeKind: probe.kind,
        outcome: probe.outcome,
        detail: probe.detail ?? null,
        resolvedUrl: probe.resolvedUrl ?? null,
        sampleArtist: probe.sampleArtist ?? null,
        sampleTitle: probe.sampleTitle ?? null,
        probedAt: now,
        updatedAt: now,
      },
    });
  const source = probe.kind === "icy" ? "radio_browser_icy" : "radiojar";
  const qualityOutcome =
    probe.qualityOutcome ??
    (probe.outcome === "usable_pair"
      ? "usable_pair"
      : probe.outcome === "unreachable"
        ? "response_error"
        : probe.outcome === "unsupported"
          ? "unsupported"
          : "empty_metadata");
  await recordMetadataQuality({
    stationId,
    source,
    capability: sourceCapabilityFor(source),
    outcomes: [qualityOutcome],
    responded: qualityOutcome !== "response_error",
    artist: probe.sampleArtist,
    title: probe.sampleTitle,
    detail: probe.detail,
    at: now,
  });
}

// ---- Verified repair --------------------------------------------------------

export type RepairOutcome =
  | "repaired"
  | "skipped-override"
  | "skipped-hidden"
  | "skipped-healthy-source";

export interface RepairDeps {
  /** Live poller enrollment; injectable so tests never start timers. */
  enroll: (station: Station) => void;
}

const defaultRepairDeps: RepairDeps = { enroll: enrollStationPoller };

/**
 * Apply a probe-verified configuration repair to one station:
 * point it at the free metadata source the probe just verified (direct
 * stream URL for ICY, platform endpoint for Radiojar), reset/ensure the ICY
 * health row, and enroll the live poller — no restart required.
 *
 * Conservative by contract:
 *  - `nowPlayingConfig.sourceLocked === true` → untouched (operator override).
 *  - Hidden stations → untouched (the documented manual restore procedure
 *    governs them; a hidden station must not silently restart polling).
 *  - Only `usable_pair` results repair; anything else is evidence, not a fix.
 */
export async function applyVerifiedRepair(
  station: Station,
  probe: ProbeResult,
  deps: RepairDeps = defaultRepairDeps,
): Promise<RepairOutcome> {
  if (probe.outcome !== "usable_pair") return "skipped-healthy-source";
  const cfg = (station.nowPlayingConfig ?? {}) as Record<string, unknown>;
  if (cfg["sourceLocked"] === true) return "skipped-override";
  if (station.hidden) return "skipped-hidden";

  const now = new Date();

  if (probe.kind === "icy") {
    const directUrl = probe.resolvedUrl ?? station.streamUrl;

    // Ensure an ICY health row exists for this station+stream. Prefer an
    // existing radio_browser_stations row already linked to the station;
    // otherwise create a synthetic `manual-<slug>` row (same pattern as
    // seed.ts ensureIcyHealthRows for non-radio-browser stations).
    const existing = await db
      .select()
      .from(radioBrowserStationsTable)
      .where(eq(radioBrowserStationsTable.stationId, station.id));
    const matching =
      existing.find((r) => r.streamUrl === directUrl) ?? existing[0] ?? null;

    let rbId: number;
    if (matching) {
      await db
        .update(radioBrowserStationsTable)
        .set({
          streamUrl: directUrl,
          name: station.name,
          icyStatus: "active",
          consecutiveErrors: 0,
          lastSuccessAt: now,
          ...(probe.sampleArtist || probe.sampleTitle
            ? {
                lastStreamTitle: `${probe.sampleArtist ?? ""} - ${probe.sampleTitle ?? ""}`,
              }
            : {}),
          updatedAt: now,
        })
        .where(eq(radioBrowserStationsTable.id, matching.id));
      rbId = matching.id;
    } else {
      const [row] = await db
        .insert(radioBrowserStationsTable)
        .values({
          radioBrowserUuid: `manual-${station.slug}`,
          streamUrl: directUrl,
          name: station.name,
          stationId: station.id,
          icyStatus: "active",
          consecutiveErrors: 0,
          lastSuccessAt: now,
        })
        .onConflictDoUpdate({
          target: radioBrowserStationsTable.radioBrowserUuid,
          set: {
            streamUrl: directUrl,
            name: station.name,
            stationId: station.id,
            icyStatus: "active",
            consecutiveErrors: 0,
            lastSuccessAt: now,
            updatedAt: now,
          },
        })
        .returning({ id: radioBrowserStationsTable.id });
      if (!row) throw new Error("failed to ensure ICY health row");
      rbId = row.id;
    }
    clearIcyErrorBackoff(rbId);

    await db
      .update(stationsTable)
      .set({
        // Direct-stream correction: persist the redirect-resolved URL the
        // probe actually succeeded on, keeping the old value for audit.
        streamUrl: directUrl,
        nowPlayingSource: "radio_browser_icy",
        nowPlayingConfig: {
          ...cfg,
          streamUrl: directUrl,
          radioBrowserId: rbId,
          repairedBy: "source-coverage-probe",
          repairedAt: now.toISOString(),
          ...(directUrl !== station.streamUrl
            ? { previousStreamUrl: station.streamUrl }
            : {}),
        },
        updatedAt: now,
      })
      .where(eq(stationsTable.id, station.id));
  } else {
    // radiojar — the stream URL stays as-is (browser playback only); the
    // platform's now-playing endpoint becomes the metadata source.
    const streamId = radiojarStreamId(station);
    if (!streamId) return "skipped-healthy-source";
    await db
      .update(stationsTable)
      .set({
        nowPlayingSource: "radiojar",
        nowPlayingConfig: {
          ...cfg,
          streamId,
          repairedBy: "source-coverage-probe",
          repairedAt: now.toISOString(),
        },
        updatedAt: now,
      })
      .where(eq(stationsTable.id, station.id));
  }

  const [fresh] = await db
    .select()
    .from(stationsTable)
    .where(eq(stationsTable.id, station.id))
    .limit(1);
  if (fresh) deps.enroll(fresh);
  return "repaired";
}

// ---- Single-flight background run -------------------------------------------

export interface SourceCoverageProbeStatus {
  running: boolean;
  total: number;
  probed: number;
  usable: number;
  blank: number;
  unsupported: number;
  unreachable: number;
  repaired: number;
  skippedHidden: number;
  skippedOverride: number;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}

const status: SourceCoverageProbeStatus = {
  running: false,
  total: 0,
  probed: 0,
  usable: 0,
  blank: 0,
  unsupported: 0,
  unreachable: 0,
  repaired: 0,
  skippedHidden: 0,
  skippedOverride: 0,
  startedAt: null,
  finishedAt: null,
  error: null,
};

/** Test seam: shrink the inter-probe delay. */
let probeGapMs = PROBE_GAP_MS;
export function _testOnly_setSourceProbeGapMs(ms: number): () => void {
  const prev = probeGapMs;
  probeGapMs = ms;
  return () => {
    probeGapMs = prev;
  };
}

/** Test seam: swap the probe implementation (avoids real network in tests). */
let probeImpl: typeof probeStationPublicMetadata = probeStationPublicMetadata;
export function _testOnly_setProbeImpl(
  impl: typeof probeStationPublicMetadata,
): () => void {
  const prev = probeImpl;
  probeImpl = impl;
  return () => {
    probeImpl = prev;
  };
}

export function getSourceCoverageProbeStatus(): SourceCoverageProbeStatus {
  return { ...status };
}

/**
 * Start a background probe-and-repair pass over every non-healthy real
 * roster station. Sequential and rate-limited; single-flight (returns false
 * when a run is already in flight). Probe outcomes are persisted to the
 * station_source_probes ledger; verified usable pairs are repaired live.
 */
export function startSourceCoverageProbeRun(): boolean {
  if (status.running) return false;
  status.running = true;
  status.total = 0;
  status.probed = 0;
  status.usable = 0;
  status.blank = 0;
  status.unsupported = 0;
  status.unreachable = 0;
  status.repaired = 0;
  status.skippedHidden = 0;
  status.skippedOverride = 0;
  status.startedAt = new Date().toISOString();
  status.finishedAt = null;
  status.error = null;

  void runProbePass()
    .catch((err) => {
      status.error = err instanceof Error ? err.message : String(err);
      console.error("[lore] source-coverage probe run failed:", err);
    })
    .finally(() => {
      status.running = false;
      status.finishedAt = new Date().toISOString();
      console.info(
        `[lore] source-coverage probe finished: probed=${status.probed} usable=${status.usable} repaired=${status.repaired} blank=${status.blank} unsupported=${status.unsupported} unreachable=${status.unreachable}`,
      );
    });
  return true;
}

async function runProbePass(): Promise<void> {
  // Candidates: every non-healthy real roster station with something to
  // probe. Healthy configurations are never probed or re-written — operator
  // trust in a working setup outranks re-verification.
  const ledger = await getSourceCoverageLedger();
  const candidates = ledger.stations
    .filter((s) => s.class !== "healthy")
    .slice(0, MAX_PROBES_PER_RUN);
  status.total = candidates.length;

  for (const entry of candidates) {
    const [station] = await db
      .select()
      .from(stationsTable)
      .where(eq(stationsTable.id, entry.id))
      .limit(1);
    if (!station) continue;

    const probe = await probeImpl(station);
    if (!probe) {
      // Nothing to probe (no stream URL, no supported platform) — the ledger
      // already classifies this as no_source; leave no probe row so a future
      // station config change isn't masked by a stale "nothing here" verdict.
      continue;
    }
    status.probed += 1;
    switch (probe.outcome) {
      case "usable_pair":
        status.usable += 1;
        break;
      case "blank_metadata":
        status.blank += 1;
        break;
      case "unsupported":
        status.unsupported += 1;
        break;
      case "unreachable":
        status.unreachable += 1;
        break;
    }

    try {
      await persistProbeResult(station.id, probe);
    } catch (err) {
      console.error(
        `[lore] source-coverage probe persist failed for ${station.slug}`,
        err,
      );
    }

    if (probe.outcome === "usable_pair") {
      try {
        const repair = await applyVerifiedRepair(station, probe);
        if (repair === "repaired") {
          status.repaired += 1;
          console.info(
            `[lore] source-coverage repaired ${station.slug}: ${probe.kind} source enrolled (${probe.sampleArtist} — ${probe.sampleTitle})`,
          );
        } else if (repair === "skipped-hidden") {
          status.skippedHidden += 1;
        } else if (repair === "skipped-override") {
          status.skippedOverride += 1;
        }
      } catch (err) {
        console.error(
          `[lore] source-coverage repair failed for ${station.slug}`,
          err,
        );
      }
    }

    // Rate limit — polite to streaming hosts and our own event loop.
    await new Promise((r) => setTimeout(r, probeGapMs));
  }
}
