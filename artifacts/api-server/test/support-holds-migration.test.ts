import { describe, expect, it, vi } from "vitest";
import type { db } from "@workspace/db";
import { applySupportHoldsMigration } from "../src/lore/support-holds-migration.js";

function createDatabase() {
  const execute = vi.fn().mockResolvedValue(undefined);
  return {
    database: { execute } as unknown as Pick<typeof db, "execute">,
    execute,
  };
}

describe("applySupportHoldsMigration", () => {
  it("is additive and idempotent", async () => {
    const { database, execute } = createDatabase();
    await applySupportHoldsMigration(database);
    await expect(applySupportHoldsMigration(database)).resolves.not.toThrow();
    const calls = execute.mock.calls;
    expect(calls).toHaveLength(14);
    expect(calls.every(([statement]) => statement && typeof statement === "object")).toBe(true);
  });
});