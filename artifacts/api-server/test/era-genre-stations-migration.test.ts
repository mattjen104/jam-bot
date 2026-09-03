import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyEraGenreStationsMigration } from "../src/lore/era-genre-stations-migration.js";
import {
  ERA_GENRE_ERA_PATTERNS,
  ERA_GENRE_GENRE_PATTERNS,
  ERA_GENRE_FIP_SLUGS,
  RADIO_BROWSER_NAME_BLOCKLIST,
} from "../src/lore/radio-browser.js";

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...actual,
    db: {
      execute: vi.fn().mockResolvedValue({ rowCount: 7 }),
    },
  };
});

describe("applyEraGenreStationsMigration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("adds the era_genre_mode column and classifies matching rows", async () => {
    await expect(applyEraGenreStationsMigration()).resolves.toBeUndefined();

    const { db } = await import("@workspace/db");
    const execute = db.execute as ReturnType<typeof vi.fn>;
    expect(execute).toHaveBeenCalledTimes(5);

    // Step 1 — idempotent DDL.
    const ddl: string = JSON.stringify(execute.mock.calls[0]?.[0]);
    expect(ddl).toContain("ADD COLUMN IF NOT EXISTS era_genre_mode");

    // Step 2 — name-pattern UPDATE must reference every shared pattern (they
    // are compiled into the alternation regex) and exclude each FIP slug.
    const update: string = JSON.stringify(execute.mock.calls[1]?.[0]);
    for (const pattern of [...ERA_GENRE_ERA_PATTERNS, ...ERA_GENRE_GENRE_PATTERNS]) {
      expect(update).toContain(pattern);
    }
    for (const slug of ERA_GENRE_FIP_SLUGS) {
      expect(update).toContain(slug);
    }
    // Sets both flags.
    expect(update).toContain("era_genre_mode = true");
    expect(update).toContain("hidden");
    // Precedence + idempotency: only touches currently-visible, non-sleep rows.
    expect(update).toContain("hidden = false");
    expect(update).toContain("sleep_mode");
    // Blocklist precedence: the UPDATE must explicitly exclude every permanent
    // blocklist substring (this migration runs BEFORE the blocklist hide
    // migration at boot, so the hidden=false gate alone is not enough — a
    // still-visible "Lofi Hip Hop Radio" would otherwise be era-flagged and
    // leak through ?mode=era-genre).
    expect(update).toContain("NOT LIKE ALL");
    for (const blocked of RADIO_BROWSER_NAME_BLOCKLIST) {
      expect(update).toContain(blocked);
    }

    // Step 2b — repair: clears the era flag from blocklisted rows an earlier
    // revision misclassified, without unhiding them.
    const repair: string = JSON.stringify(execute.mock.calls[2]?.[0]);
    expect(repair).toContain("era_genre_mode = false");
    expect(repair).toContain("LIKE ANY");
    for (const blocked of RADIO_BROWSER_NAME_BLOCKLIST) {
      expect(repair).toContain(blocked);
    }

    // Step 2c — restore valid Specialist rows hidden by the retired mode.
    const restore: string = JSON.stringify(execute.mock.calls[3]?.[0]);
    expect(restore).toContain("SET hidden = false");
    expect(restore).toContain("era_genre_mode = true");
    expect(restore).toContain("NOT LIKE ALL");

    // Step 3 — FIP sub-channels get the mode flag but stay UN-hidden so their
    // pollers keep running (hidden = soft-hide + poll stop) and spin ingestion
    // for crossing history continues. Gated on era_genre_mode = false so an
    // admin's later deliberate hide is not reverted on restart.
    const fipUpdate: string = JSON.stringify(execute.mock.calls[4]?.[0]);
    for (const slug of ERA_GENRE_FIP_SLUGS) {
      expect(fipUpdate).toContain(slug);
    }
    expect(fipUpdate).toContain("era_genre_mode = true");
    expect(fipUpdate).toContain("hidden         = false");
    expect(fipUpdate).toContain("era_genre_mode = false");
  });

  it("is idempotent — a second run issues the same statements without error", async () => {
    await applyEraGenreStationsMigration();
    await applyEraGenreStationsMigration();

    const { db } = await import("@workspace/db");
    const execute = db.execute as ReturnType<typeof vi.fn>;
    expect(execute).toHaveBeenCalledTimes(10);
    const firstUpdate = JSON.stringify(execute.mock.calls[1]?.[0]);
    const secondUpdate = JSON.stringify(execute.mock.calls[6]?.[0]);
    expect(secondUpdate).toBe(firstUpdate);
  });

  it("propagates database errors", async () => {
    const { db } = await import("@workspace/db");
    (db.execute as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("database unavailable"),
    );
    await expect(applyEraGenreStationsMigration()).rejects.toThrow(
      "database unavailable",
    );
  });
});
