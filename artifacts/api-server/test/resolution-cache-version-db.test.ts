// @vitest-environment node

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, resolutionCacheTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import {
  normalizeKey,
  normalizeMetadataPair,
} from "../src/lore/resolve.js";

const artist = `Cache Version Artist ${randomUUID()}`;
const title = "Repaired Metadata";
const legacyKey = normalizeMetadataPair(artist, title);
const currentKey = normalizeKey(artist, title);
let dbAvailable = true;

describe("resolution cache version boundary", () => {
  beforeAll(async () => {
    try {
      await db.insert(resolutionCacheTable).values([
        { key: legacyKey, mbid: null, confidence: "unresolved" },
        { key: currentKey, mbid: null, confidence: "deferred" },
      ]);
    } catch {
      dbAvailable = false;
    }
  });

  afterAll(async () => {
    if (!dbAvailable) return;
    await db
      .delete(resolutionCacheTable)
      .where(inArray(resolutionCacheTable.key, [legacyKey, currentKey]));
  });

  it("retains legacy audit rows beside the active version", async () => {
    if (!dbAvailable) return;
    const rows = await db
      .select({
        key: resolutionCacheTable.key,
        confidence: resolutionCacheTable.confidence,
      })
      .from(resolutionCacheTable)
      .where(inArray(resolutionCacheTable.key, [legacyKey, currentKey]));

    expect(new Map(rows.map((row) => [row.key, row.confidence]))).toEqual(
      new Map([
        [legacyKey, "unresolved"],
        [currentKey, "deferred"],
      ]),
    );
  });
});