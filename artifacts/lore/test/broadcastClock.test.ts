import { describe, expect, it } from "vitest";
import {
  BroadcastClockEstimator,
  CLOCK_SAMPLE_MAX_RTT_MS,
} from "../src/lib/broadcastClock";

describe("BroadcastClockEstimator", () => {
  it("aligns a wrong device clock using the request midpoint", () => {
    let wall = 1_000_000;
    let mono = 10_000;
    const clock = new BroadcastClockEstimator(() => wall, () => mono);
    const started = clock.mark();
    wall += 200;
    mono += 200;
    const received = clock.mark();
    expect(clock.addSample(5_000_000, started, received)).toEqual({
      accepted: true,
      uncertaintyMs: 100,
    });
    wall += 500;
    mono += 500;
    expect(clock.now()).toBe(5_000_600);
  });

  it("rejects high-latency samples without replacing a good estimate", () => {
    let wall = 10_000;
    let mono = 1_000;
    const clock = new BroadcastClockEstimator(() => wall, () => mono);
    const goodStart = clock.mark();
    wall += 100;
    mono += 100;
    clock.addSample(20_000, goodStart, clock.mark());

    const slowStart = clock.mark();
    wall += CLOCK_SAMPLE_MAX_RTT_MS + 1;
    mono += CLOCK_SAMPLE_MAX_RTT_MS + 1;
    expect(clock.addSample(999_999, slowStart, clock.mark()).accepted).toBe(false);
    expect(clock.uncertaintyMs()).toBe(50);
  });

  it("resets safely after a device-clock change", () => {
    let wall = 10_000;
    let mono = 1_000;
    const clock = new BroadcastClockEstimator(() => wall, () => mono);
    const started = clock.mark();
    wall += 100;
    mono += 100;
    clock.addSample(20_000, started, clock.mark());
    wall += 60_000;
    mono += 1_000;
    expect(clock.now()).toBeNull();
    expect(clock.uncertaintyMs()).toBeNull();
  });

  it("resets after a long suspended interval", () => {
    let wall = 10_000;
    let mono = 1_000;
    const clock = new BroadcastClockEstimator(() => wall, () => mono);
    const started = clock.mark();
    wall += 100;
    mono += 100;
    clock.addSample(20_000, started, clock.mark());
    wall += 61_000;
    mono += 61_000;
    expect(clock.now()).toBeNull();
  });
});