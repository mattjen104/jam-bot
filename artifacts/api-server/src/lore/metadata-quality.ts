import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { isJunkMetadata } from "./icy.js";

export const METADATA_QUALITY_OUTCOMES = [
  "response_error",
  "empty_metadata",
  "junk_metadata",
  "incomplete_pair",
  "usable_pair",
  "written_spin",
  "unsupported",
  "invalid_row",
  "future_dated",
  "duplicate",
  "ambiguous_row",
] as const;

export type MetadataQualityOutcome =
  (typeof METADATA_QUALITY_OUTCOMES)[number];

export type SourceCapability =
  | "complete_history"
  | "current_track_api"
  | "persistent_icy_watcher"
  | "multiplexed_metadata"
  | "interval_only_stream"
  | "unsupported";

export type MetadataOutcomeCounts = Record<MetadataQualityOutcome, number>;

export interface MetadataQualityResult {
  outcome: Exclude<
    MetadataQualityOutcome,
    | "response_error"
    | "written_spin"
    | "unsupported"
    | "invalid_row"
    | "future_dated"
    | "duplicate"
    | "ambiguous_row"
  >;
  artist: string | null;
  title: string | null;
  detail: string;
}

const ROLLING_WINDOW_MS = 30 * 24 * 60 * 60_000;

export function emptyMetadataOutcomeCounts(): MetadataOutcomeCounts {
  return {
    response_error: 0,
    empty_metadata: 0,
    junk_metadata: 0,
    incomplete_pair: 0,
    usable_pair: 0,
    written_spin: 0,
    unsupported: 0,
    invalid_row: 0,
    future_dated: 0,
    duplicate: 0,
    ambiguous_row: 0,
  };
}

function clean(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * One deterministic classifier used by source probes, interval polls, history
 * polls, and persistent watcher dispatch. It deliberately runs before identity
 * resolution: this describes what the station supplied, not whether a provider
 * could identify it.
 */
export function classifyMetadataQuality(
  rawArtist: unknown,
  rawTitle: unknown,
): MetadataQualityResult {
  const artist = clean(rawArtist);
  const title = clean(rawTitle);
  if (!artist && !title) {
    return {
      outcome: "empty_metadata",
      artist: null,
      title: null,
      detail: "Source responded without artist or title metadata.",
    };
  }
  if (!artist || !title) {
    if (isJunkMetadata(artist ?? "", title ?? "")) {
      return {
        outcome: "junk_metadata",
        artist,
        title,
        detail: "Source returned station, show, ad, or placeholder metadata.",
      };
    }
    return {
      outcome: "incomplete_pair",
      artist,
      title,
      detail: artist
        ? "Source returned an artist without a title."
        : "Source returned a title without an artist.",
    };
  }
  if (
    artist.localeCompare(title, undefined, { sensitivity: "accent" }) === 0 ||
    isJunkMetadata(artist, title)
  ) {
    return {
      outcome: "junk_metadata",
      artist,
      title,
      detail: "Source returned station, show, ad, or placeholder metadata.",
    };
  }
  return {
    outcome: "usable_pair",
    artist,
    title,
    detail: "Source returned a usable artist/title pair.",
  };
}

const COMPLETE_HISTORY_SOURCES = new Set([
  "spinitron",
  "kexp_api",
  "bbc_api",
  "somafm",
  "station_history_json",
  "station_history_rss",
  "station_history_jsonld",
]);

export function sourceCapabilityFor(
  source: string | null | undefined,
  transport: "poll" | "watcher" | "multiplex" = "poll",
): SourceCapability {
  if (!source) return "unsupported";
  if (COMPLETE_HISTORY_SOURCES.has(source)) return "complete_history";
  if (source === "radio_browser_icy") {
    if (transport === "watcher") return "persistent_icy_watcher";
    if (transport === "multiplex") return "multiplexed_metadata";
    return "interval_only_stream";
  }
  return "current_track_api";
}

export interface RecordMetadataQualityInput {
  stationId: number;
  source: string;
  capability: SourceCapability;
  outcomes: MetadataQualityOutcome[];
  responded: boolean;
  artist?: string | null;
  title?: string | null;
  detail?: string | null;
  at?: Date;
}

/**
 * Persist one source attempt. Failures are loud but non-fatal: observability
 * must never prevent a station's spin from reaching the archive.
 *
 * The single INSERT ... ON CONFLICT statement is intentionally atomic. A
 * station can have a watcher, host multiplexer, interval fallback, and probe
 * completing close together; a read/modify/write update would lose counts.
 */
export async function recordMetadataQuality(
  input: RecordMetadataQualityInput,
): Promise<void> {
  if (!input.outcomes.length) return;
  try {
    const now = input.at ?? new Date();
    const counts = emptyMetadataOutcomeCounts();
    for (const outcome of input.outcomes) counts[outcome] += 1;

    const hasUsable = input.outcomes.some(
      (outcome) => outcome === "usable_pair" || outcome === "written_spin",
    );
    const artist = clean(input.artist);
    const title = clean(input.title);
    const lastOutcome = input.outcomes[input.outcomes.length - 1]!;
    const usableAt = hasUsable && artist && title ? now : null;
    await db.execute(sql`
      INSERT INTO station_source_quality (
        station_id, source, capability, last_outcome, last_detail,
        last_attempt_at, last_response_at, last_usable_at,
        last_usable_artist, last_usable_title, window_started_at,
        outcome_counts, updated_at
      ) VALUES (
        ${input.stationId}, ${input.source}, ${input.capability},
        ${lastOutcome}, ${input.detail ?? null}, ${now},
        ${input.responded ? now : null}, ${usableAt},
        ${usableAt ? artist : null}, ${usableAt ? title : null},
        ${now}, ${JSON.stringify(counts)}::jsonb, ${now}
      )
      ON CONFLICT (station_id, source) DO UPDATE SET
        capability = CASE
          WHEN EXCLUDED.last_attempt_at >= station_source_quality.last_attempt_at
          THEN EXCLUDED.capability
          ELSE station_source_quality.capability
        END,
        last_outcome = CASE
          WHEN EXCLUDED.last_attempt_at >= station_source_quality.last_attempt_at
          THEN EXCLUDED.last_outcome
          ELSE station_source_quality.last_outcome
        END,
        last_detail = CASE
          WHEN EXCLUDED.last_attempt_at >= station_source_quality.last_attempt_at
          THEN EXCLUDED.last_detail
          ELSE station_source_quality.last_detail
        END,
        last_attempt_at = greatest(
          station_source_quality.last_attempt_at,
          EXCLUDED.last_attempt_at
        ),
        last_response_at = greatest(
          station_source_quality.last_response_at,
          EXCLUDED.last_response_at
        ),
        last_usable_at = greatest(
          station_source_quality.last_usable_at,
          EXCLUDED.last_usable_at
        ),
        last_usable_artist = CASE
          WHEN EXCLUDED.last_usable_at IS NOT NULL
            AND (
              station_source_quality.last_usable_at IS NULL
              OR EXCLUDED.last_usable_at >= station_source_quality.last_usable_at
            )
          THEN EXCLUDED.last_usable_artist
          ELSE station_source_quality.last_usable_artist
        END,
        last_usable_title = CASE
          WHEN EXCLUDED.last_usable_at IS NOT NULL
            AND (
              station_source_quality.last_usable_at IS NULL
              OR EXCLUDED.last_usable_at >= station_source_quality.last_usable_at
            )
          THEN EXCLUDED.last_usable_title
          ELSE station_source_quality.last_usable_title
        END,
        window_started_at = CASE
          WHEN EXCLUDED.last_attempt_at - station_source_quality.window_started_at
            >= ${ROLLING_WINDOW_MS} * interval '1 millisecond'
          THEN EXCLUDED.window_started_at
          ELSE station_source_quality.window_started_at
        END,
        outcome_counts = CASE
          WHEN EXCLUDED.last_attempt_at - station_source_quality.window_started_at
            >= ${ROLLING_WINDOW_MS} * interval '1 millisecond'
          THEN EXCLUDED.outcome_counts
          ELSE (
            SELECT jsonb_object_agg(
              outcome,
              coalesce(
                (station_source_quality.outcome_counts ->> outcome)::integer,
                0
              ) + coalesce((EXCLUDED.outcome_counts ->> outcome)::integer, 0)
            )
            FROM unnest(ARRAY[
              'response_error', 'empty_metadata', 'junk_metadata',
              'incomplete_pair', 'usable_pair', 'written_spin', 'unsupported',
              'invalid_row', 'future_dated', 'duplicate', 'ambiguous_row'
            ]::text[]) AS outcome
          )
        END,
        updated_at = greatest(station_source_quality.updated_at, EXCLUDED.updated_at)
    `);
  } catch (err) {
    console.error("[lore] metadata-quality persist failed", {
      stationId: input.stationId,
      source: input.source,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}