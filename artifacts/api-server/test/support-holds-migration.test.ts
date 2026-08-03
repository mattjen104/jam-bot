import { beforeEach, describe, expect, it, vi } from "vitest";
import { applySupportHoldsMigration } from "../src/lore/support-holds-migration.js";

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return { ...actual, db: { execute: vi.fn().mockResolvedValue(undefined) } };
});

describe("applySupportHoldsMigration", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is additive and idempotent", async () => {
    await applySupportHoldsMigration();
    await expect(applySupportHoldsMigration()).resolves.not.toThrow();
    const { db } = await import("@workspace/db");
    const calls = (db.execute as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(14);
    expect(calls.every(([statement]) => statement && typeof statement === "object")).toBe(true);
  });
});