import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  _testOnly_listenerCaptureQuery,
  _testOnly_listenerResumptionQuery,
} from "../../src/lore/listener-broadcast-advisory.js";

const HISTORY_ROWS = 25_000;
const ABSENT_STATION_IDS = [-2_147_483_648, -2_147_483_647];

type PlanNode = {
  "Node Type"?: string;
  "Index Name"?: string;
  Plans?: PlanNode[];
};

function planNodes(node: PlanNode): PlanNode[] {
  return [node, ...(node.Plans ?? []).flatMap(planNodes)];
}

async function explainListenerQuery(query: { getSQL(): ReturnType<typeof sql> }) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local enable_seqscan = off`);
    const result = await tx.execute<{ "QUERY PLAN": PlanNode[] }>(
      sql`explain (format json, costs off) ${query.getSQL()}`,
    );
    const root = result.rows[0]?.["QUERY PLAN"]?.[0]?.Plan;
    expect(root).toBeDefined();
    return planNodes(root!);
  });
}

describe("listener broadcast advisory query plans", () => {
  it("keeps large speech and resumption histories on their bounded partial indexes", async () => {
    await db.execute(sql`
      insert into capture_outcomes (
        station_id,
        idempotency_key,
        occurred_at,
        producer_version,
        outcome,
        feature_snapshot,
        provenance
      )
      select
        null,
        'listener-plan-history:capture:' || n,
        now() - interval '2 days' - n * interval '1 second',
        'listener-plan-test.v1',
        case when n % 3 = 0 then 'speech' else 'music' end,
        '{}'::jsonb,
        '{}'::jsonb
      from generate_series(1, ${HISTORY_ROWS}) n
      on conflict (idempotency_key) do nothing
    `);
    await db.execute(sql`
      insert into broadcast_timeline_events (
        station_id,
        idempotency_key,
        event_type,
        occurred_at,
        producer_version,
        outcome,
        feature_snapshot,
        provenance
      )
      select
        null,
        'listener-plan-history:timeline:' || n,
        case
          when n % 3 = 0 then 'speech_ends_then_sustained_music'
          else 'confirmed_spin_transition'
        end,
        now() - interval '2 days' - n * interval '1 second',
        'listener-plan-test.v1',
        'observed',
        '{}'::jsonb,
        '{}'::jsonb
      from generate_series(1, ${HISTORY_ROWS}) n
      on conflict (idempotency_key) do nothing
    `);
    await db.execute(sql`analyze capture_outcomes`);
    await db.execute(sql`analyze broadcast_timeline_events`);

    const cutoff = new Date(Date.now() - 90_000);
    const captureNodes = await explainListenerQuery(
      _testOnly_listenerCaptureQuery(ABSENT_STATION_IDS, cutoff),
    );
    const resumptionNodes = await explainListenerQuery(
      _testOnly_listenerResumptionQuery(ABSENT_STATION_IDS, cutoff),
    );

    expect(captureNodes.map((node) => node["Index Name"])).toContain(
      "capture_outcomes_listener_speech_idx",
    );
    expect(resumptionNodes.map((node) => node["Index Name"])).toContain(
      "broadcast_timeline_listener_resumption_idx",
    );
    for (const nodes of [captureNodes, resumptionNodes]) {
      expect(nodes.map((node) => node["Node Type"])).not.toContain("Seq Scan");
      expect(nodes.map((node) => node["Node Type"])).not.toContain("Sort");
    }
  });
});