/**
 * Unit tests for the Dial's two-mode context state machine (src/dial/dialContext.ts):
 * transitions (tune / push / pop / dial / temporal) and the URL round-trip.
 */
import { describe, expect, it } from "vitest";
import {
  type DialSurfaceState,
  contextStationSlug,
  dialState,
  enterContext,
  popFrame,
  pushFrame,
  readContextParams,
  sameTemporal,
  setTemporal,
  toDial,
  tuneToStation,
  writeContextParams,
} from "../src/dial/dialContext";

function roundTrip(state: DialSurfaceState, existing = ""): DialSurfaceState {
  const params = new URLSearchParams(existing);
  writeContextParams(params, state);
  return readContextParams(new URLSearchParams(params.toString()));
}

describe("dialContext transitions", () => {
  it("starts in dial mode with no context", () => {
    const s = dialState();
    expect(s.mode).toBe("dial");
    expect(s.ctx).toBeNull();
  });

  it("tuneToStation commits a single station frame at live", () => {
    const s = tuneToStation("kexp", "KEXP");
    expect(s.mode).toBe("context");
    expect(s.ctx?.source).toBe("radio");
    expect(s.ctx?.stack).toEqual([{ kind: "station", id: "kexp", label: "KEXP" }]);
    expect(s.ctx?.temporal).toEqual({ kind: "live" });
    expect(contextStationSlug(s)).toBe("kexp");
  });

  it("a scan landing is the same committing transition as a row click", () => {
    // The state machine has exactly one entry into context mode — scan land
    // and first row click both call tuneToStation.
    expect(tuneToStation("wfmu")).toEqual(tuneToStation("wfmu"));
  });

  it("tuning to a different station is a deliberate reset of stack and temporal", () => {
    let s = tuneToStation("kexp");
    s = pushFrame(s, { kind: "artist", id: "mbid-1" });
    s = setTemporal(s, { kind: "past", runId: 42 });
    const next = tuneToStation("wfmu");
    expect(next.ctx?.stack).toEqual([{ kind: "station", id: "wfmu" }]);
    expect(next.ctx?.temporal).toEqual({ kind: "live" });
  });

  it("push adds a lens level; back pops one level and preserves temporal", () => {
    let s = tuneToStation("kexp");
    s = setTemporal(s, { kind: "past", runId: 7 });
    s = pushFrame(s, { kind: "artist", id: "mbid-1" });
    s = pushFrame(s, { kind: "album", id: "mbid-2" });
    expect(s.ctx?.stack.map((f) => f.kind)).toEqual(["station", "artist", "album"]);

    s = popFrame(s);
    expect(s.ctx?.stack.map((f) => f.kind)).toEqual(["station", "artist"]);
    // Back preserves the temporal position — only Dial / station-change reset it.
    expect(s.ctx?.temporal).toEqual({ kind: "past", runId: 7 });
  });

  it("popping the root frame returns to dial mode", () => {
    const s = popFrame(tuneToStation("kexp"));
    expect(s.mode).toBe("dial");
  });

  it("toDial returns to station selection and clears the context", () => {
    const s = toDial();
    expect(s).toEqual(dialState());
  });

  it("setTemporal is identity-stable when the position is unchanged", () => {
    const s = setTemporal(tuneToStation("kexp"), { kind: "past", runId: 3 });
    expect(setTemporal(s, { kind: "past", runId: 3 })).toBe(s);
    expect(sameTemporal({ kind: "live" }, { kind: "live" })).toBe(true);
    expect(sameTemporal({ kind: "past", runId: 1 }, { kind: "past", runId: 2 })).toBe(false);
  });

  it("push/pop/temporal are no-ops in dial mode", () => {
    const s = dialState();
    expect(pushFrame(s, { kind: "artist", id: "x" })).toBe(s);
    expect(popFrame(s)).toBe(s);
    expect(setTemporal(s, { kind: "past", runId: 1 })).toBe(s);
  });
});

describe("URL round-trip", () => {
  it("dial mode serializes to no context params", () => {
    const params = new URLSearchParams("library=connected");
    writeContextParams(params, dialState());
    expect(params.toString()).toBe("library=connected");
  });

  it("station context round-trips (labels are rebuilt from data, not the URL)", () => {
    const restored = roundTrip(tuneToStation("kexp", "KEXP"));
    expect(restored.mode).toBe("context");
    expect(restored.ctx?.stack).toEqual([{ kind: "station", id: "kexp" }]);
    expect(restored.ctx?.temporal).toEqual({ kind: "live" });
  });

  it("full stack + past position round-trips exactly", () => {
    let s = tuneToStation("kexp");
    s = pushFrame(s, { kind: "artist", id: "b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d" });
    s = pushFrame(s, { kind: "album", id: "mbid-album" });
    s = setTemporal(s, { kind: "past", runId: 123 });

    const params = new URLSearchParams();
    writeContextParams(params, s);
    expect(params.get("ctx")).toBe("station:kexp");
    expect(params.getAll("lens")).toEqual([
      "artist:b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d",
      "album:mbid-album",
    ]);
    expect(params.get("at")).toBe("run:123");

    const restored = roundTrip(s);
    expect(restored.mode).toBe("context");
    expect(restored.ctx?.stack.map((f) => `${f.kind}:${f.id}`)).toEqual([
      "station:kexp",
      "artist:b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d",
      "album:mbid-album",
    ]);
    expect(restored.ctx?.temporal).toEqual({ kind: "past", runId: 123 });
  });

  it("non-radio sources round-trip via the src param", () => {
    const s = enterContext({
      source: "review",
      stack: [{ kind: "review", id: "weekly-2026-08-02" }],
      temporal: { kind: "live" },
    });
    const restored = roundTrip(s);
    expect(restored.ctx?.source).toBe("review");
    expect(restored.ctx?.stack).toEqual([{ kind: "review", id: "weekly-2026-08-02" }]);
  });

  it("preserves unrelated query params", () => {
    const params = new URLSearchParams("library=connected&foo=bar");
    writeContextParams(params, tuneToStation("kexp"));
    expect(params.get("library")).toBe("connected");
    expect(params.get("foo")).toBe("bar");
    expect(params.get("ctx")).toBe("station:kexp");
    // And clearing removes only context keys.
    writeContextParams(params, dialState());
    expect(params.toString()).toBe("library=connected&foo=bar");
  });

  it("malformed ctx / at values degrade to safe states, never throw", () => {
    expect(readContextParams(new URLSearchParams("ctx=nonsense")).mode).toBe("dial");
    expect(readContextParams(new URLSearchParams("ctx=:")).mode).toBe("dial");
    expect(readContextParams(new URLSearchParams("")).mode).toBe("dial");
    const junkAt = readContextParams(new URLSearchParams("ctx=station:kexp&at=run:NaN"));
    expect(junkAt.ctx?.temporal).toEqual({ kind: "live" });
    const junkLens = readContextParams(new URLSearchParams("ctx=station:kexp&lens=broken"));
    expect(junkLens.ctx?.stack).toHaveLength(1);
  });

  it("ids with reserved characters survive the round-trip", () => {
    let s = tuneToStation("kexp");
    s = pushFrame(s, { kind: "artist", id: "a&b=c d" });
    const restored = roundTrip(s);
    expect(restored.ctx?.stack[1]).toEqual({ kind: "artist", id: "a&b=c d" });
  });
});
