// @vitest-environment jsdom
/**
 * Confirms that the art-proxy retry mechanism in onArtError:
 *  1. Shows RUMOURS immediately on the first failure (existing fallback preserved).
 *  2. Re-attempts the real cover after an exponential back-off delay.
 *  3. Restores the real cover once the proxy recovers (retry succeeds).
 *  4. Stops retrying after MAX_RETRIES exhaustion and stays on RUMOURS.
 *  5. Does not enter an infinite loop when RUMOURS itself fires an error.
 */

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { RUMOURS, onArtError } from "../src/lib/rumours";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PROXY_URL = "http://localhost:3000/api/art?src=https%3A%2F%2Fexample.com%2Fart.jpg";

/** Render a bare <img> with the proxy URL and the onError handler. */
function renderImg(src: string = PROXY_URL) {
  const { container } = render(
    <img src={src} alt="" onError={onArtError} />,
  );
  return container.querySelector("img") as HTMLImageElement;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.clearAllMocks();
});

// ===========================================================================
// Immediate fallback — must stay compatible with existing onError tests
// ===========================================================================

describe("onArtError — immediate RUMOURS fallback", () => {
  it("swaps src to RUMOURS synchronously on the first error", () => {
    const img = renderImg();
    fireEvent.error(img);
    expect(img.src).toBe(RUMOURS);
  });

  it("stays on RUMOURS when a second error fires (already showing RUMOURS)", () => {
    const img = renderImg();
    fireEvent.error(img); // first: proxy → RUMOURS
    fireEvent.error(img); // second: RUMOURS → should bail, still RUMOURS
    expect(img.src).toBe(RUMOURS);
  });
});

// ===========================================================================
// Retry scheduling
// ===========================================================================

describe("onArtError — retry scheduling after proxy failure", () => {
  it("schedules a retry after 2 s when the proxy first fails", () => {
    const img = renderImg();
    fireEvent.error(img);
    expect(img.src).toBe(RUMOURS);

    // Before 2 s — no retry yet
    vi.advanceTimersByTime(1_999);
    expect(img.src).toBe(RUMOURS);

    // At 2 s — retry fires; src should include the original proxy URL
    vi.advanceTimersByTime(1);
    expect(img.src).toContain("/api/art?src=");
    expect(img.src).toContain("_r=1");
  });

  it("schedules a second retry after 4 s when retry 1 also fails", () => {
    const img = renderImg();

    // Failure 1 → RUMOURS → retry scheduled at 2 s
    fireEvent.error(img);
    expect(img.src).toBe(RUMOURS);

    // Retry 1 fires
    vi.advanceTimersByTime(2_000);
    expect(img.src).toContain("_r=1");

    // Simulate retry 1 also failing
    fireEvent.error(img);
    expect(img.src).toBe(RUMOURS);

    // Before the second retry (4 s from this error) — still RUMOURS
    vi.advanceTimersByTime(3_999);
    expect(img.src).toBe(RUMOURS);

    // Second retry fires
    vi.advanceTimersByTime(1);
    expect(img.src).toContain("_r=2");
  });

  it("stays on RUMOURS after both retries are exhausted", () => {
    const img = renderImg();

    // Failure 1 → retry 1
    fireEvent.error(img);
    vi.advanceTimersByTime(2_000);
    expect(img.src).toContain("_r=1");

    // Retry 1 fails → retry 2
    fireEvent.error(img);
    vi.advanceTimersByTime(4_000);
    expect(img.src).toContain("_r=2");

    // Retry 2 also fails — MAX_RETRIES (2) reached, no more retries
    fireEvent.error(img);
    expect(img.src).toBe(RUMOURS);

    // Advance time significantly — no further retry should fire
    vi.advanceTimersByTime(60_000);
    expect(img.src).toBe(RUMOURS);
  });
});

// ===========================================================================
// Recovery path — proxy comes back before retries are exhausted
// ===========================================================================

describe("onArtError — silent recovery when proxy comes back", () => {
  it("restores the real cover when retry 1 succeeds (no error fires)", () => {
    const img = renderImg();

    // Initial proxy failure → RUMOURS
    fireEvent.error(img);
    expect(img.src).toBe(RUMOURS);

    // Retry 1 fires after 2 s and sets the proxy URL (with _r=1)
    vi.advanceTimersByTime(2_000);
    const retrySrc = img.src;
    expect(retrySrc).toContain("_r=1");

    // The browser successfully loads the retried URL — no onError fires.
    // The cover is now showing the real art; RUMOURS is gone.
    expect(img.src).not.toBe(RUMOURS);
  });

  it("skips the stale retry if the img src was already replaced externally", () => {
    const img = renderImg();

    // Proxy failure → RUMOURS
    fireEvent.error(img);
    expect(img.src).toBe(RUMOURS);

    // Something else (e.g. a React re-render) sets a brand-new URL before the
    // retry timer fires.
    const newUrl = "https://another-cdn.example.com/art2.jpg";
    img.src = newUrl;

    // Retry timer fires — but the src is no longer RUMOURS, so it must skip.
    vi.advanceTimersByTime(2_000);
    expect(img.src).toBe(newUrl);
  });
});

// ===========================================================================
// Original URL preservation across retries
// ===========================================================================

describe("onArtError — original URL is preserved across all retries", () => {
  it("every retry references the original proxy URL, not a retry URL", () => {
    const img = renderImg();

    // Failure 1
    fireEvent.error(img);
    vi.advanceTimersByTime(2_000);
    const retry1Src = img.src;
    expect(retry1Src).toContain("/api/art"); // proxy path present in retry URL

    // Failure 2 (retry 1 failed) — second retry must also use original base
    fireEvent.error(img);
    vi.advanceTimersByTime(4_000);
    const retry2Src = img.src;

    // Both retries should stem from the same original proxy URL
    // (not exponentially nested "_r=1&_r=2" garbage)
    expect(retry2Src.split("_r=").length).toBe(2); // exactly one _r param
    expect(retry2Src).toContain("_r=2");
  });
});

// ===========================================================================
// Source-change reset — same <img> element, different artwork
// ===========================================================================

describe("onArtError — retry budget resets when the source changes", () => {
  it("gives a fresh retry budget after the element src is updated to a different proxy URL", () => {
    const img = renderImg();

    // Exhaust the retry budget for the first proxy URL
    fireEvent.error(img); // 1st failure → retries=1
    vi.advanceTimersByTime(2_000); // retry 1 fires
    fireEvent.error(img); // retry 1 failure → retries=2
    vi.advanceTimersByTime(4_000); // retry 2 fires
    fireEvent.error(img); // retry 2 failure → exhausted
    expect(img.src).toBe(RUMOURS);

    // Now React updates the element with a different artwork URL
    const newProxyUrl =
      "http://localhost:3000/api/art?src=https%3A%2F%2Fother.example.com%2Fnew.jpg";
    img.src = newProxyUrl;

    // The new URL fails — should restart with a fresh budget
    fireEvent.error(img);
    expect(img.src).toBe(RUMOURS); // still shows RUMOURS immediately

    // Retry 1 for the new URL must fire after 2 s
    vi.advanceTimersByTime(2_000);
    expect(img.src).toContain("other.example.com");
    expect(img.src).toContain("_r=1");
  });

  it("uses only the new URL in retries after a source change — not the old one", () => {
    const img = renderImg(); // first proxy URL

    // One failure on the first URL
    fireEvent.error(img);
    expect(img.src).toBe(RUMOURS);

    // Element is updated to a completely different proxy URL before the retry fires
    const newProxyUrl =
      "http://localhost:3000/api/art?src=https%3A%2F%2Fdifferent.example.com%2Fart.jpg";
    img.src = newProxyUrl;

    // New URL fails
    fireEvent.error(img);
    expect(img.src).toBe(RUMOURS);

    // The stale retry for the first URL fires — it must be skipped because
    // src is still RUMOURS (the guard fires), then the new retry fires
    vi.advanceTimersByTime(2_000);
    // After both timers, the img should reference the new URL's retry, not the old one
    expect(img.src).toContain("different.example.com");
    expect(img.src).not.toContain(encodeURIComponent("example.com/art.jpg").replace(/%/g, "%25"));
  });
});

// ===========================================================================
// Non-proxy URL guard — no retries for direct CDN / data: / local paths
// ===========================================================================

describe("onArtError — non-proxy URLs get immediate RUMOURS, no retries", () => {
  it("does not schedule a retry for a direct CDN URL", () => {
    const img = renderImg("https://i.scdn.co/image/abc123");

    fireEvent.error(img);
    expect(img.src).toBe(RUMOURS);

    // No retry should fire — src stays RUMOURS after a long wait
    vi.advanceTimersByTime(60_000);
    expect(img.src).toBe(RUMOURS);
  });

  it("does not schedule a retry for a data: URI that fails", () => {
    const img = renderImg("data:image/png;base64,INVALID");

    fireEvent.error(img);
    expect(img.src).toBe(RUMOURS);

    vi.advanceTimersByTime(60_000);
    expect(img.src).toBe(RUMOURS);
  });
});
