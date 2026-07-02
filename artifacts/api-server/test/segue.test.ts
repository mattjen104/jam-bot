import { describe, it, expect } from "vitest";
import {
  deriveEdges,
  stationClassWeight,
  SEGUE_GAP_MS,
  type SpinForSegue,
} from "../src/lore/segue.js";

const t = (iso: string) => new Date(iso);

describe("deriveEdges", () => {
  it("links consecutive resolved spins within the gap on one station/show", () => {
    const spins: SpinForSegue[] = [
      { mbid: "a", playedAt: t("2026-07-01T10:00:00Z"), stationId: 1, showId: 1 },
      { mbid: "b", playedAt: t("2026-07-01T10:04:00Z"), stationId: 1, showId: 1 },
      { mbid: "c", playedAt: t("2026-07-01T10:08:00Z"), stationId: 1, showId: 1 },
    ];
    const edges = deriveEdges(spins);
    expect(edges.map((e) => [e.fromMbid, e.toMbid])).toEqual([
      ["a", "b"],
      ["b", "c"],
    ]);
    expect(edges[0]).toMatchObject({ stationId: 1, showId: 1 });
  });

  it("does not bridge a gap larger than the threshold", () => {
    const spins: SpinForSegue[] = [
      { mbid: "a", playedAt: t("2026-07-01T10:00:00Z"), stationId: 1, showId: 1 },
      { mbid: "b", playedAt: t("2026-07-01T10:20:00Z"), stationId: 1, showId: 1 },
    ];
    expect(deriveEdges(spins, SEGUE_GAP_MS)).toHaveLength(0);
  });

  it("never bridges across an unresolved spin", () => {
    const spins: SpinForSegue[] = [
      { mbid: "a", playedAt: t("2026-07-01T10:00:00Z"), stationId: 1, showId: 1 },
      { mbid: null, playedAt: t("2026-07-01T10:03:00Z"), stationId: 1, showId: 1 },
      { mbid: "c", playedAt: t("2026-07-01T10:06:00Z"), stationId: 1, showId: 1 },
    ];
    // a->null and null->c are both dropped; no a->c bridge is invented.
    expect(deriveEdges(spins)).toHaveLength(0);
  });

  it("does not link across different stations or shows", () => {
    const spins: SpinForSegue[] = [
      { mbid: "a", playedAt: t("2026-07-01T10:00:00Z"), stationId: 1, showId: 1 },
      { mbid: "b", playedAt: t("2026-07-01T10:02:00Z"), stationId: 2, showId: 1 },
      { mbid: "c", playedAt: t("2026-07-01T10:03:00Z"), stationId: 1, showId: 2 },
    ];
    expect(deriveEdges(spins)).toHaveLength(0);
  });

  it("drops self-loops (same track twice in a row)", () => {
    const spins: SpinForSegue[] = [
      { mbid: "a", playedAt: t("2026-07-01T10:00:00Z"), stationId: 1, showId: 1 },
      { mbid: "a", playedAt: t("2026-07-01T10:04:00Z"), stationId: 1, showId: 1 },
    ];
    expect(deriveEdges(spins)).toHaveLength(0);
  });

  it("sorts by time before pairing (input order independent)", () => {
    const spins: SpinForSegue[] = [
      { mbid: "b", playedAt: t("2026-07-01T10:04:00Z"), stationId: 1, showId: 1 },
      { mbid: "a", playedAt: t("2026-07-01T10:00:00Z"), stationId: 1, showId: 1 },
    ];
    const edges = deriveEdges(spins);
    expect(edges.map((e) => [e.fromMbid, e.toMbid])).toEqual([["a", "b"]]);
  });
});

describe("stationClassWeight", () => {
  it("ranks curated/community above commercial", () => {
    expect(stationClassWeight("curated")).toBeGreaterThan(
      stationClassWeight("commercial"),
    );
    expect(stationClassWeight("community")).toBeGreaterThan(
      stationClassWeight("commercial"),
    );
  });

  it("defaults unknown classes to the curated weight", () => {
    expect(stationClassWeight(null)).toBe(stationClassWeight("curated"));
    expect(stationClassWeight("whatever")).toBe(stationClassWeight("curated"));
  });
});
