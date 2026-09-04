import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSelect, mockInsert, insertedValues, conflictUpdates } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockInsert: vi.fn(),
  insertedValues: [] as unknown[],
  conflictUpdates: [] as unknown[],
}));

vi.mock("@workspace/db", () => ({
  db: { select: mockSelect, insert: mockInsert },
  stationsTable: {},
  spinsTable: {},
  stationQualityTable: {},
}));

import { recomputeAllQualityScores } from "../src/lore/quality.js";

function selectWhere(result: unknown) {
  return { from: () => ({ where: () => result }) };
}

beforeEach(() => {
  mockSelect.mockReset();
  mockInsert.mockReset();
  insertedValues.length = 0;
  conflictUpdates.length = 0;
  mockInsert.mockImplementation(() => ({
    values: (values: unknown) => {
      insertedValues.push(values);
      return {
        onConflictDoUpdate: (update: unknown) => {
          conflictUpdates.push(update);
          return Promise.resolve();
        },
      };
    },
  }));
});

describe("quality recompute durability", () => {
  it("retries once and persists a null first-failure score rather than defaults", async () => {
    mockSelect
      .mockImplementationOnce(() => selectWhere(Promise.resolve([{ id: 7 }])))
      .mockImplementationOnce(() => selectWhere(Promise.reject(new Error("pool unavailable"))))
      .mockImplementationOnce(() => selectWhere(Promise.reject(new Error("pool unavailable"))));

    const summary = await recomputeAllQualityScores();

    expect(summary.failures).toEqual([{ stationId: 7, error: "pool unavailable" }]);
    expect(mockSelect).toHaveBeenCalledTimes(3);
    expect(insertedValues).toHaveLength(1);
    expect(insertedValues[0]).toMatchObject({
      stationId: 7, metadataYield: null, trackShaped: null,
      mbidResolutionRate: null, musicShare: null, sampleCount: null,
      qualityTier: null, computedAt: null, recomputeStatus: "failed",
    });
    // Conflict updates intentionally do not overwrite a prior successful score.
    expect(conflictUpdates[0]).toMatchObject({
      set: { recomputeStatus: "failed" },
    });
    expect((conflictUpdates[0] as { set: object }).set).not.toHaveProperty("qualityTier");
  });

  it("retries a transient scoring failure and clears durable failure status on success", async () => {
    mockSelect
      .mockImplementationOnce(() => selectWhere(Promise.resolve([{ id: 8 }])))
      .mockImplementationOnce(() => selectWhere(Promise.reject(new Error("temporary"))))
      .mockImplementationOnce(() => selectWhere(Promise.resolve([])));

    await expect(recomputeAllQualityScores()).resolves.toMatchObject({ unscored: 1, failures: [] });
    expect(mockSelect).toHaveBeenCalledTimes(3);
    expect(insertedValues[0]).toMatchObject({
      stationId: 8, sampleCount: 0, qualityTier: "unscored",
      recomputeStatus: "ok", recomputeError: null, recomputeFailedAt: null,
    });
  });

  it("propagates a station-list load failure instead of returning a zero summary", async () => {
    mockSelect.mockImplementationOnce(() => selectWhere(Promise.reject(new Error("stations unavailable"))));
    await expect(recomputeAllQualityScores()).rejects.toThrow("stations unavailable");
    expect(mockInsert).not.toHaveBeenCalled();
  });
});