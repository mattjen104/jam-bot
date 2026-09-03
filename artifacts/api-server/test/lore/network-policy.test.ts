import { describe, expect, it } from "vitest";
import { StationNetworkPolicy } from "../../src/lore/network-policy.js";

describe("StationNetworkPolicy", () => {
  it("serializes overlapping callers for the same origin", async () => {
    const policy = new StationNetworkPolicy({ minSpacingMs: 0 });
    let active = 0;
    let peak = 0;
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = policy.run("https://radio.example/live", async () => {
      active += 1;
      peak = Math.max(peak, active);
      await firstGate;
      active -= 1;
      return "first";
    });
    const second = policy.run("https://radio.example/status", async () => {
      active += 1;
      peak = Math.max(peak, active);
      active -= 1;
      return "second";
    });

    await Promise.resolve();
    expect(active).toBe(1);
    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toEqual([
      "first",
      "second",
    ]);
    expect(peak).toBe(1);
  });

  it("keeps unrelated station origins independent", async () => {
    const policy = new StationNetworkPolicy({ minSpacingMs: 0 });
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let otherStarted = false;

    const first = policy.run("https://one.example/live", () => firstGate);
    const other = policy.run("https://two.example/live", async () => {
      otherStarted = true;
    });

    await other;
    expect(otherStarted).toBe(true);
    releaseFirst();
    await first;
  });

  it("honors Retry-After before retrying an origin", async () => {
    let now = 1_000;
    const sleeps: number[] = [];
    const policy = new StationNetworkPolicy({
      minSpacingMs: 0,
      now: () => now,
      sleep: async (ms) => {
        sleeps.push(ms);
        now += ms;
      },
    });

    await policy.run("https://radio.example/live", async () =>
      new Response(null, {
        status: 429,
        headers: { "Retry-After": "12" },
      }),
    );
    await policy.run("https://radio.example/status", async () => "retried");

    expect(sleeps).toEqual([12_000]);
  });

  it("enters a long cooldown after repeated 403 responses", async () => {
    let now = 5_000;
    const sleeps: number[] = [];
    const policy = new StationNetworkPolicy({
      minSpacingMs: 0,
      forbiddenCooldownMs: 60_000,
      now: () => now,
      sleep: async (ms) => {
        sleeps.push(ms);
        now += ms;
      },
    });

    const forbidden = () => Promise.resolve(new Response(null, { status: 403 }));
    await policy.run("https://radio.example/one", forbidden);
    await policy.run("https://radio.example/two", forbidden);
    await policy.run("https://radio.example/three", async () => "retried");

    expect(sleeps).toEqual([60_000]);
  });
});