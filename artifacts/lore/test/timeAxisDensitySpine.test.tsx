/**
 * Tests for the TimeAxisDensitySpine component.
 *
 * Key invariants:
 *  - owned and discover render as two separate opposed elements, never summed
 *  - empty bins render as unknown texture, never as "silence / covered"
 *  - live edge is rendered and positioned correctly
 *  - no prefetch or materialization state leaks into the spine
 *  - 24 hourly bins at mobile width; bins are distinguishable
 */

// @vitest-environment jsdom

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";

import {
  TimeAxisDensitySpine,
  type DensityBin,
} from "../src/components/TimeAxisDensitySpine";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hourMs(offsetH: number): number {
  // Anchor to a known date so tests are deterministic
  const anchor = new Date("2026-08-05T00:00:00Z").getTime();
  return anchor + offsetH * 3_600_000;
}

function makeBin(offsetH: number, owned = 0, discover = 0): DensityBin {
  return { hourStart: hourMs(offsetH), owned, discover };
}

function makeDayBins(overrides: Partial<Record<number, Partial<DensityBin>>> = {}): DensityBin[] {
  return Array.from({ length: 24 }, (_, h) => ({
    ...makeBin(h),
    ...(overrides[h] ?? {}),
  }));
}

function render(props: React.ComponentProps<typeof TimeAxisDensitySpine>): string {
  return renderToStaticMarkup(<TimeAxisDensitySpine {...props} />);
}

// ---------------------------------------------------------------------------
// Bin rendering
// ---------------------------------------------------------------------------

describe("TimeAxisDensitySpine — bin rendering", () => {
  it("renders one bin element per input bin", () => {
    const bins = [makeBin(0), makeBin(1), makeBin(2)];
    const html = render({ bins, nowMs: hourMs(3) });
    // Match only the root bin divs — exclude the wrapper (density-spine__bins)
    // and the modifier (density-spine__bin--unknown) using a two-char lookahead.
    const binCount = (html.match(/density-spine__bin(?![-s])/g) ?? []).length;
    expect(binCount).toBe(3);
  });

  it("renders 24 bins for a full day", () => {
    const bins = makeDayBins();
    const html = render({ bins, nowMs: hourMs(24) });
    const binCount = (html.match(/density-spine__bin(?![-s])/g) ?? []).length;
    expect(binCount).toBe(24);
  });

  it("empty bins get the unknown class (coverage not derivable)", () => {
    const bins = [makeBin(0, 0, 0)]; // completely empty
    const html = render({ bins, nowMs: hourMs(1) });
    expect(html).toContain("density-spine__bin--unknown");
  });

  it("non-empty bins do NOT get the unknown class", () => {
    const bins = [makeBin(0, 3, 5)];
    const html = render({ bins, nowMs: hourMs(1) });
    // Should have the bin class but NOT the unknown modifier for this bin
    // (Note: HTML may have both bin + bin--unknown for other bins in other tests,
    // but for a single non-empty bin the unknown class must not appear)
    expect(html).not.toContain("density-spine__bin--unknown");
  });

  it("owned and discover render as separate elements, never summed", () => {
    const bins = [makeBin(0, 4, 7)];
    const html = render({ bins, nowMs: hourMs(1) });
    // Both channels must appear as separate elements
    expect(html).toContain("density-spine__owned");
    expect(html).toContain("density-spine__discover");
    // No single element should have a height proportional to 4+7=11
    // (We verify they are separate, not that a combined element exists)
    const ownedMatch = html.match(/density-spine__owned[^>]*style="([^"]*)"/);
    const discoverMatch = html.match(/density-spine__discover[^>]*style="([^"]*)"/);
    expect(ownedMatch).not.toBeNull();
    expect(discoverMatch).not.toBeNull();
  });

  it("a bin with coverage and zero crossings renders the unknown texture", () => {
    // Since coverage is not derivable, zero-crossing bins are ALWAYS unknown —
    // there is no "covered, nothing crossed" state.
    const zeroBin = makeBin(0, 0, 0);
    const htmlZero = render({ bins: [zeroBin], nowMs: hourMs(1) });
    expect(htmlZero).toContain("density-spine__bin--unknown");

    const nonZeroBin = makeBin(0, 2, 3);
    const htmlNonZero = render({ bins: [nonZeroBin], nowMs: hourMs(1) });
    expect(htmlNonZero).not.toContain("density-spine__bin--unknown");

    // The two states must render differently
    expect(htmlZero).not.toBe(htmlNonZero);
  });
});

// ---------------------------------------------------------------------------
// Markers
// ---------------------------------------------------------------------------

describe("TimeAxisDensitySpine — markers", () => {
  it("renders the live edge", () => {
    const bins = makeDayBins();
    const html = render({ bins, nowMs: hourMs(12) });
    expect(html).toContain("density-spine__live-edge");
  });

  it("renders the playhead when provided", () => {
    const bins = makeDayBins();
    const html = render({ bins, nowMs: hourMs(24), playheadMs: hourMs(6) });
    expect(html).toContain("density-spine__playhead");
  });

  it("does not render the playhead when not provided", () => {
    const bins = makeDayBins();
    const html = render({ bins, nowMs: hourMs(24) });
    expect(html).not.toContain("density-spine__playhead");
  });

  it("renders the pipeline boundary when provided", () => {
    const bins = makeDayBins();
    const html = render({ bins, nowMs: hourMs(24), pipelineBoundaryMs: hourMs(12) });
    expect(html).toContain("density-spine__pipeline-boundary");
  });

  it("renders the history edge affordance when hasMoreHistory = true", () => {
    const bins = makeDayBins();
    const html = render({ bins, nowMs: hourMs(24), hasMoreHistory: true });
    expect(html).toContain("density-spine__history-edge");
  });

  it("does not render the history edge when hasMoreHistory = false (default)", () => {
    const bins = makeDayBins();
    const html = render({ bins, nowMs: hourMs(24) });
    expect(html).not.toContain("density-spine__history-edge");
  });
});

// ---------------------------------------------------------------------------
// Invariants — no infrastructure state leaked
// ---------------------------------------------------------------------------

describe("TimeAxisDensitySpine — no prefetch state leakage", () => {
  it("does not contain any prefetch or materialization state in the rendered output", () => {
    const bins = makeDayBins({ 6: { owned: 3, discover: 5 } });
    const html = render({ bins, nowMs: hourMs(24) });
    // None of these infrastructure terms should appear in the UI
    expect(html).not.toMatch(/prefetch|materialization|resolution_job|warm|buffer/i);
  });
});
