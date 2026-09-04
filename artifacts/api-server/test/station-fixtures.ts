import { db, stationsTable, type Station } from "@workspace/db";
import {
  cleanupStationFixtures,
  hasStationFixtureEvidence,
} from "../src/lore/station-fixture-audit.js";

export function createStationFixtureTracker() {
  const ids = new Set<number>();

  return {
    async insert(
      values: typeof stationsTable.$inferInsert,
    ): Promise<Station> {
      if (
        !hasStationFixtureEvidence({
          slug: values.slug,
          streamUrl: values.streamUrl,
          homepageUrl: values.homepageUrl,
        })
      ) {
        throw new Error(
          "Station fixture needs an approved fixture slug and reserved placeholder URL",
        );
      }
      const [row] = await db.insert(stationsTable).values(values).returning();
      if (!row) throw new Error("Station fixture insert returned no row");
      ids.add(row.id);
      return row;
    },
    track(id: number): void {
      ids.add(id);
    },
    async cleanup(): Promise<number> {
      const deleted = await cleanupStationFixtures([...ids]);
      ids.clear();
      return deleted;
    },
  };
}
