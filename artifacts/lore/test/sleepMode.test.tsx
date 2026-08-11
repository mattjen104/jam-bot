// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { memoryLocation } from "wouter/memory-location";
import { Router } from "wouter";
import {
  recordWordmarkTap,
  setSleepEnabled,
  useSleepMode,
  SLEEP_TAP_COUNT,
  SLEEP_TAP_WINDOW_MS,
  _testOnly_resetTaps,
} from "../src/lib/sleepMode";
import { SlimSectionNav } from "../src/components/SlimSectionNav";

/**
 * Sleep Radio mode — hidden five-tap gesture on the [lore] wordmark plus
 * the moon indicator that deactivates the mode.
 */

beforeEach(() => {
  localStorage.clear();
  _testOnly_resetTaps();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  _testOnly_resetTaps();
});

// ---------------------------------------------------------------------------
// recordWordmarkTap — gesture state machine
// ---------------------------------------------------------------------------

describe("recordWordmarkTap", () => {
  it("toggles sleep mode on after five taps inside the three-second window", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < SLEEP_TAP_COUNT - 1; i++) {
      expect(recordWordmarkTap(t0 + i * 100)).toBe(false);
    }
    expect(recordWordmarkTap(t0 + (SLEEP_TAP_COUNT - 1) * 100)).toBe(true);
    expect(localStorage.getItem("lore:sleep:enabled")).toBe("true");
  });

  it("ignores taps that fall outside the rolling window", () => {
    const t0 = 1_000_000;
    // Four taps early…
    for (let i = 0; i < 4; i++) recordWordmarkTap(t0 + i * 100);
    // …fifth tap after the window has closed: earlier taps age out.
    expect(recordWordmarkTap(t0 + SLEEP_TAP_WINDOW_MS + 500)).toBe(false);
    expect(localStorage.getItem("lore:sleep:enabled")).not.toBe("true");
  });

  it("toggles the mode off again with a second complete gesture", () => {
    const t0 = 2_000_000;
    for (let i = 0; i < SLEEP_TAP_COUNT; i++) recordWordmarkTap(t0 + i * 10);
    expect(localStorage.getItem("lore:sleep:enabled")).toBe("true");
    for (let i = 0; i < SLEEP_TAP_COUNT; i++) recordWordmarkTap(t0 + 10_000 + i * 10);
    expect(localStorage.getItem("lore:sleep:enabled")).toBe("false");
  });

  it("resets the tap counter after a successful toggle (no immediate re-toggle)", () => {
    const t0 = 3_000_000;
    for (let i = 0; i < SLEEP_TAP_COUNT; i++) recordWordmarkTap(t0 + i * 10);
    // One more tap right after — must NOT count as a fresh completed gesture.
    expect(recordWordmarkTap(t0 + SLEEP_TAP_COUNT * 10)).toBe(false);
    expect(localStorage.getItem("lore:sleep:enabled")).toBe("true");
  });
});

// ---------------------------------------------------------------------------
// useSleepMode — persisted local-first state
// ---------------------------------------------------------------------------

function Probe() {
  const { enabled, toggle } = useSleepMode();
  return (
    <button data-testid="probe" onClick={toggle}>
      {enabled ? "on" : "off"}
    </button>
  );
}

describe("useSleepMode", () => {
  it("reads the persisted flag and toggles it", () => {
    setSleepEnabled(true);
    render(<Probe />);
    const probe = screen.getByTestId("probe");
    expect(probe.textContent).toBe("on");
    fireEvent.click(probe);
    expect(probe.textContent).toBe("off");
    expect(localStorage.getItem("lore:sleep:enabled")).toBe("false");
  });
});

// ---------------------------------------------------------------------------
// SlimSectionNav — wordmark gesture wiring + moon indicator
// ---------------------------------------------------------------------------

function renderNav(variant?: "corner" | "bottom") {
  const { hook } = memoryLocation({ path: "/" });
  return render(
    <Router hook={hook}>
      <SlimSectionNav variant={variant} />
    </Router>,
  );
}

describe("SlimSectionNav sleep gesture", () => {
  it("five rapid taps on [lore] activate sleep mode and show the moon", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-11T00:00:00Z"));
    try {
      renderNav();
      const loreLink = screen.getByText("[lore]");
      expect(screen.queryByTestId("sleep-moon")).toBeNull();
      for (let i = 0; i < SLEEP_TAP_COUNT; i++) {
        fireEvent.click(loreLink);
        vi.advanceTimersByTime(100);
      }
      expect(screen.getByTestId("sleep-moon")).toBeTruthy();
      expect(localStorage.getItem("lore:sleep:enabled")).toBe("true");
    } finally {
      vi.useRealTimers();
    }
  });

  it("slow taps never activate the mode — no moon appears", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-11T00:00:00Z"));
    try {
      renderNav();
      const loreLink = screen.getByText("[lore]");
      for (let i = 0; i < SLEEP_TAP_COUNT; i++) {
        fireEvent.click(loreLink);
        vi.advanceTimersByTime(SLEEP_TAP_WINDOW_MS); // each tap ages out the last
      }
      expect(screen.queryByTestId("sleep-moon")).toBeNull();
      expect(localStorage.getItem("lore:sleep:enabled")).not.toBe("true");
    } finally {
      vi.useRealTimers();
    }
  });

  it("tapping the moon deactivates sleep mode", () => {
    setSleepEnabled(true);
    renderNav();
    const moon = screen.getByTestId("sleep-moon");
    fireEvent.click(moon);
    expect(screen.queryByTestId("sleep-moon")).toBeNull();
    expect(localStorage.getItem("lore:sleep:enabled")).toBe("false");
  });

  it("the bottom (phone) variant carries the same gesture and moon", () => {
    setSleepEnabled(true);
    renderNav("bottom");
    expect(screen.getByTestId("sleep-moon")).toBeTruthy();
  });

  it("does not advertise the feature while inactive", () => {
    renderNav();
    expect(screen.queryByTestId("sleep-moon")).toBeNull();
    expect(screen.queryByText(/sleep/i)).toBeNull();
  });
});
