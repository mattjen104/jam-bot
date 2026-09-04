import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/** Creates immutable, retry-safe operational evidence ledgers. */
export async function applyObservabilityMigration(): Promise<void> {
  await db.execute(sql`
    CREATE OR REPLACE FUNCTION lore_observability_append_only()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'observability evidence is append-only';
    END;
    $$
  `);
  const ledgers = [
    ["broadcast_timeline_events", "event_type text NOT NULL, occurred_at timestamptz NOT NULL", "occurred_at"],
    ["boundary_predictions", "predicted_at timestamptz NOT NULL, predicted_boundary_at timestamptz", "predicted_at"],
    ["boundary_evaluations", "prediction_idempotency_key text, evaluated_at timestamptz NOT NULL, error_ms integer", "evaluated_at"],
    ["capture_decisions", "decided_at timestamptz NOT NULL, decision text NOT NULL", "decided_at"],
    ["capture_outcomes", "decision_idempotency_key text, occurred_at timestamptz NOT NULL", "occurred_at"],
    ["transcript_segments", "captured_at timestamptz NOT NULL", "captured_at"],
    ["transcript_claims", "segment_idempotency_key text, claimed_at timestamptz NOT NULL", "claimed_at"],
    ["schedule_comparisons", "compared_at timestamptz NOT NULL", "compared_at"],
    ["operator_labels", "labeled_at timestamptz NOT NULL, label text NOT NULL", "labeled_at"],
  ] as const;

  for (const [table, specificColumns, timeColumn] of ledgers) {
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS ${table} (
        id serial PRIMARY KEY,
        station_id integer REFERENCES stations(id) ON DELETE SET NULL,
        idempotency_key text NOT NULL UNIQUE,
        ${specificColumns},
        producer_version text NOT NULL,
        outcome text NOT NULL DEFAULT 'unknown',
        feature_snapshot jsonb NOT NULL,
        provenance jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `));
    await db.execute(sql.raw(`
      CREATE INDEX IF NOT EXISTS ${table}_station_version_idx
      ON ${table} (station_id, producer_version, ${timeColumn})
    `));
    await db.execute(sql.raw(`DROP TRIGGER IF EXISTS ${table}_append_only ON ${table}`));
    await db.execute(sql.raw(`
      CREATE TRIGGER ${table}_append_only
      BEFORE UPDATE OR DELETE ON ${table}
      FOR EACH ROW EXECUTE FUNCTION lore_observability_append_only()
    `));
  }
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS capture_outcomes_listener_speech_idx
    ON capture_outcomes (station_id, occurred_at DESC)
    WHERE outcome IN ('speech', 'speech_over_music')
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS broadcast_timeline_listener_resumption_idx
    ON broadcast_timeline_events (station_id, occurred_at DESC)
    WHERE event_type = 'speech_ends_then_sustained_music'
  `);
}