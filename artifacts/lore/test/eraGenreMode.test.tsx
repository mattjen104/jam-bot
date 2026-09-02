// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { memoryLocation } from "wouter/memory-location";
import { Router } from "wouter";
import {
  recordWordmarkPressStart,
  recordWordmarkPressEnd,
  setEraGenreEnabled,
  useEraGenreMode,
  ERA_GENRE_LONGPRESS_MS,
  _testOnly_resetEraGenre,
} from "../src/lib/eraGenreMode";
import {
  setSleepEnabled,
  useSleepMode,
  _testOnly_resetTaps,
} from "../src/lib/sleepMode";
import { SlimSectionNav } from "../src/components/SlimSectionNav";

/**
 * Era/Genre mode — hidden long-press gesture on the [lore] wordmark, the vinyl
 * indicator that deactivates the mode, and mutual exclusion with Sleep Radio.
 */

beforeEach(() => {
  localStorage.clear();
  _testOnly_resetEraGenre();
  _testOnly_resetTaps();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  _testOnly_resetEraGenre();
  _testOnly_resetTaps();
});

// ---------------------------------------------------------------------------
// long-press gesture state machine
// ---------------------------------------------------------------------------

describe("recordWordmarkPress long-press", () => {
  it("toggles era/genre mode on when the press lasts long enough", () => {
    const t0 = 1_000_000;
    recordWordmarkPressStart(t0);
    expect(recordWordmarkPressEnd(t0 + ERA_GENRE_LONGPRESS_MS)).toBe(true);
    expect(localStorage.getItem("lore:eraGenre:enabled")).toBe("true");
  });

  it("a short press never activates the mode", () => {
    const t0 = 1_000_000;
    recordWordmarkPressStart(t0);
    expect(recordWordmarkPressEnd(t0 + 200)).toBe(false);
    expect(localStorage.getItem("lore:eraGenre:enabled")).not.toBe("true");
  });

  it("a release without a start is a no-op", () => {
    expect(recordWordmarkPressEnd(5_000)).toBe(false);
  });

  it("toggles the mode off again with a second long press", () => {
    const t0 = 2_000_000;
    recordWordmarkPressStart(t0);
    recordWordmarkPressEnd(t0 + ERA_GENRE_LONGPRESS_MS);
    expect(localStorage.getItem("lore:eraGenre:enabled")).toBe("true");
    recordWordmarkPressStart(t0 + 10_000);
    recordWordmarkPressEnd(t0 + 10_000 + ERA_GENRE_LONGPRESS_MS);
    expect(localStorage.getItem("lore:eraGenre:enabled")).toBe("false");
  });
});

// ---------------------------------------------------------------------------
// mutual exclusion with sleep mode
// ---------------------------------------------------------------------------

describe("mutual exclusion", () => {
  it("activating era/genre turns sleep off", () => {
    setSleepEnabled(true);
    expect(localStorage.getItem("lore:sleep:enabled")).toBe("true");
    setEraGenreEnabled(true);
    expect(localStorage.getItem("lore:sleep:enabled")).toBe("false");
    expect(localStorage.getItem("lore:eraGenre:enabled")).toBe("true");
  });

  it("activating sleep turns era/genre off", () => {
    setEraGenreEnabled(true);
    expect(localStorage.getItem("lore:eraGenre:enabled")).toBe("true");
    setSleepEnabled(true);
    expect(localStorage.getItem("lore:eraGenre:enabled")).toBe("false");
    expect(localStorage.getItem("lore:sleep:enabled")).toBe("true");
  });
});

// ---------------------------------------------------------------------------
// useEraGenreMode — persisted local-first state
// ---------------------------------------------------------------------------

function Probe() {
  const era = useEraGenreMode();
  const sleep = useSleepMode();
  return (
    <div>
      <button data-testid="era" onClick={era.toggle}>
        {era.enabled ? "era-on" : "era-off"}
      </button>
      <span data-testid="sleep">{sleep.enabled ? "sleep-on" : "sleep-off"}</span>
    </div>
  );
}

describe("useEraGenreMode", () => {
  it("reads the persisted flag and toggles it", () => {
    setEraGenreEnabled(true);
    render(<Probe />);
    const probe = screen.getByTestId("era");
    expect(probe.textContent).toBe("era-on");
    fireEvent.click(probe);
    expect(probe.textContent).toBe("era-off");
    expect(localStorage.getItem("lore:eraGenre:enabled")).toBe("false");
  });

  it("reflects mutual exclusion in the live hooks", () => {
    setSleepEnabled(true);
    render(<Probe />);
    expect(screen.getByTestId("sleep").textContent).toBe("sleep-on");
    fireEvent.click(screen.getByTestId("era"));
    expect(screen.getByTestId("era").textContent).toBe("era-on");
    expect(screen.getByTestId("sleep").textContent).toBe("sleep-off");
  });
});

// ---------------------------------------------------------------------------
// SlimSectionNav — legacy listener gesture is retired
// ---------------------------------------------------------------------------

function renderNav(variant?: "corner" | "bottom") {
  const { hook } = memoryLocation({ path: "/" });
  return render(
    <Router hook={hook}>
      <SlimSectionNav variant={variant} />
    </Router>,
  );
}

describe("SlimSectionNav Specialist visibility", () => {
  it.each([undefined, "bottom"] as const)(
    "does not expose the retired era/genre gesture in the %s variant",
    (variant) => {
      setEraGenreEnabled(true);
      renderNav(variant);
      const feed = screen.getByText("Feed");
      fireEvent.pointerDown(feed);
      fireEvent.pointerUp(feed);
      expect(screen.queryByTestId("era-genre-vinyl")).toBeNull();
      expect(feed.getAttribute("title")).toBeNull();
    },
  );

  it("does not advertise the retired feature while inactive", () => {
    renderNav();
    expect(screen.queryByTestId("era-genre-vinyl")).toBeNull();
    expect(screen.queryByText(/era|genre/i)).toBeNull();
  });
});
