// @vitest-environment jsdom
/**
 * Component tests for the Shows lens UI.
 *
 * Covers:
 *   - DialLensBar: shows Radio | Press | Shows toggle with Shows as third option
 *   - ShowsFeedLane: city prompt renders and responds to input
 *   - ShowsFeedLane: "Looking up shows…" computing state
 *   - ShowsFeedLane: "No upcoming shows" settled-empty state
 *   - ShowsFeedLane: event rows render with correct artist sentence structure
 *   - ShowsFeedLane: Bandsintown attribution is shown when events present
 *   - dialLensState: readShowsCity / writeShowsCity round-trip
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";

import { DialLensBar } from "../src/components/dial/DialLensBar";
import { ShowsFeedLane } from "../src/components/dial/ShowsFeedLane";
import { parseDialLens, readShowsCity, writeShowsCity } from "../src/lib/dialLensState";
import type { ShowsEvent } from "../src/lib/meHooks";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  // Clear localStorage between tests
  try { localStorage.clear(); } catch { /* jsdom may not have it */ }
});

// ---------------------------------------------------------------------------
// DialLensBar — Shows option
// ---------------------------------------------------------------------------

describe("DialLensBar — Shows lens", () => {
  it("renders Radio | Press | Shows buttons", () => {
    const onSetLens = vi.fn();
    render(<DialLensBar lens="radio" onSetLens={onSetLens} />);
    expect(screen.getByText("Radio")).toBeTruthy();
    expect(screen.getByText("Press")).toBeTruthy();
    expect(screen.getByText("Shows")).toBeTruthy();
  });

  it("marks Shows as aria-pressed when active", () => {
    render(<DialLensBar lens="shows" onSetLens={vi.fn()} />);
    const showsBtn = screen.getByText("Shows").closest("button")!;
    expect(showsBtn.getAttribute("aria-pressed")).toBe("true");
    const radioBtn = screen.getByText("Radio").closest("button")!;
    expect(radioBtn.getAttribute("aria-pressed")).toBe("false");
  });

  it("calls onSetLens('shows') when Shows is clicked", () => {
    const onSetLens = vi.fn();
    render(<DialLensBar lens="radio" onSetLens={onSetLens} />);
    fireEvent.click(screen.getByText("Shows"));
    expect(onSetLens).toHaveBeenCalledWith("shows");
  });
});

// ---------------------------------------------------------------------------
// parseDialLens — "shows" is a valid lens
// ---------------------------------------------------------------------------

describe("parseDialLens", () => {
  it("returns 'shows' for the string 'shows'", () => {
    expect(parseDialLens("shows")).toBe("shows");
  });

  it("returns 'radio' for unknown values", () => {
    expect(parseDialLens("unknown")).toBe("radio");
    expect(parseDialLens(null)).toBe("radio");
    expect(parseDialLens("")).toBe("radio");
  });
});

// ---------------------------------------------------------------------------
// dialLensState — city persistence
// ---------------------------------------------------------------------------

describe("readShowsCity / writeShowsCity", () => {
  it("returns null when no city is stored", () => {
    expect(readShowsCity()).toBeNull();
  });

  it("round-trips a city string", () => {
    writeShowsCity("Portland, OR");
    expect(readShowsCity()).toBe("Portland, OR");
  });

  it("clears the city when null is passed", () => {
    writeShowsCity("Portland, OR");
    writeShowsCity(null);
    expect(readShowsCity()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ShowsFeedLane — computed / loading state
// ---------------------------------------------------------------------------

describe("ShowsFeedLane — loading state", () => {
  it("shows computing copy when isLoading and no events", () => {
    render(
      <ShowsFeedLane
        events={[]}
        isLoading={true}
        hasTaste={true}
        city={null}
        onSetCity={vi.fn()}
        onArtistClick={vi.fn()}
      />,
    );
    expect(screen.getByText(/Looking up shows/i)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// ShowsFeedLane — settled-empty state
// ---------------------------------------------------------------------------

describe("ShowsFeedLane — settled empty state", () => {
  it("shows 'No upcoming shows' when settled and no events", () => {
    render(
      <ShowsFeedLane
        events={[]}
        isLoading={false}
        hasTaste={true}
        city={null}
        onSetCity={vi.fn()}
        onArtistClick={vi.fn()}
      />,
    );
    expect(screen.getByText(/No upcoming shows/i)).toBeTruthy();
  });

  it("returns null when hasTaste is false (caller renders nudge)", () => {
    const { container } = render(
      <ShowsFeedLane
        events={[]}
        isLoading={false}
        hasTaste={false}
        city={null}
        onSetCity={vi.fn()}
        onArtistClick={vi.fn()}
      />,
    );
    // null render → container has no meaningful child
    expect(container.firstChild).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ShowsFeedLane — city prompt
// ---------------------------------------------------------------------------

describe("ShowsFeedLane — city prompt", () => {
  it("shows the prompt to enter a city when no city is set", () => {
    render(
      <ShowsFeedLane
        events={[]}
        isLoading={false}
        hasTaste={true}
        city={null}
        onSetCity={vi.fn()}
        onArtistClick={vi.fn()}
      />,
    );
    expect(screen.getByRole("textbox", { name: /your city/i })).toBeTruthy();
  });

  it("calls onSetCity when the user types and clicks Save", () => {
    const onSetCity = vi.fn();
    render(
      <ShowsFeedLane
        events={[]}
        isLoading={false}
        hasTaste={true}
        city={null}
        onSetCity={onSetCity}
        onArtistClick={vi.fn()}
      />,
    );
    const input = screen.getByRole("textbox", { name: /your city/i }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Portland, OR" } });
    fireEvent.click(screen.getByText("Save"));
    expect(onSetCity).toHaveBeenCalledWith("Portland, OR");
  });

  it("commits the city on Enter key", () => {
    const onSetCity = vi.fn();
    render(
      <ShowsFeedLane
        events={[]}
        isLoading={false}
        hasTaste={true}
        city={null}
        onSetCity={onSetCity}
        onArtistClick={vi.fn()}
      />,
    );
    const input = screen.getByRole("textbox", { name: /your city/i }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Seattle, WA" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSetCity).toHaveBeenCalledWith("Seattle, WA");
  });

  it("shows the saved city and a 'change' link when city is set", () => {
    render(
      <ShowsFeedLane
        events={[]}
        isLoading={false}
        hasTaste={true}
        city="Portland, OR"
        onSetCity={vi.fn()}
        onArtistClick={vi.fn()}
      />,
    );
    // City appears in both the prompt label and the empty-state copy.
    expect(screen.getAllByText(/Portland, OR/).length).toBeGreaterThan(0);
    expect(screen.getByText("change")).toBeTruthy();
  });

  it("opens the edit field when 'change' is clicked", () => {
    render(
      <ShowsFeedLane
        events={[]}
        isLoading={false}
        hasTaste={true}
        city="Portland, OR"
        onSetCity={vi.fn()}
        onArtistClick={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("change"));
    expect(screen.getByRole("textbox", { name: /your city/i })).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// ShowsFeedLane — event rows
// ---------------------------------------------------------------------------

/** A guaranteed-future local calendar date N days from now (YYYY-MM-DD). */
function futureDate(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function makeEvent(overrides: Partial<ShowsEvent> = {}): ShowsEvent {
  // Dates are computed relative to the real clock so the fixture never rots:
  // showsSentence() drops past events by design.
  const date = futureDate(10);
  return {
    id: "test-artist:evt-1",
    artistName: "Fleetwood Mac",
    eventDatetime: `${date}T20:00:00.000Z`,
    eventDate: date,
    venueName: "Crystal Ballroom",
    venueCity: "Portland",
    venueRegion: "OR",
    venueCountry: "US",
    ticketUrl: "https://example.com/tickets",
    nearCity: false,
    ...overrides,
  };
}

describe("ShowsFeedLane — event rows", () => {
  it("renders artist name in an event row", () => {
    render(
      <ShowsFeedLane
        events={[makeEvent()]}
        isLoading={false}
        hasTaste={true}
        city={null}
        onSetCity={vi.fn()}
        onArtistClick={vi.fn()}
      />,
    );
    expect(screen.getByText("Fleetwood Mac")).toBeTruthy();
  });

  it("renders the ticket link when ticketUrl is set", () => {
    render(
      <ShowsFeedLane
        events={[makeEvent()]}
        isLoading={false}
        hasTaste={true}
        city={null}
        onSetCity={vi.fn()}
        onArtistClick={vi.fn()}
      />,
    );
    const links = screen.getAllByRole("link");
    const ticketLink = links.find((l) => l.getAttribute("href") === "https://example.com/tickets");
    expect(ticketLink).toBeTruthy();
  });

  it("renders Bandsintown attribution when events are present", () => {
    render(
      <ShowsFeedLane
        events={[makeEvent()]}
        isLoading={false}
        hasTaste={true}
        city={null}
        onSetCity={vi.fn()}
        onArtistClick={vi.fn()}
      />,
    );
    expect(screen.getByText(/Powered by Bandsintown/i)).toBeTruthy();
  });

  it("calls onArtistClick when the artist button is clicked", () => {
    const onArtistClick = vi.fn();
    render(
      <ShowsFeedLane
        events={[makeEvent()]}
        isLoading={false}
        hasTaste={true}
        city={null}
        onSetCity={vi.fn()}
        onArtistClick={onArtistClick}
      />,
    );
    // The artist name is inside an aria-label button
    const artistBtn = screen.getByLabelText("Open Fleetwood Mac");
    fireEvent.click(artistBtn);
    expect(onArtistClick).toHaveBeenCalledWith("Fleetwood Mac");
  });

  it("renders both near-city and elsewhere bands when city matches some events", () => {
    const nearEvent = makeEvent({ id: "a:1", nearCity: true, artistName: "Near Artist" });
    const farEvent = makeEvent({ id: "b:2", nearCity: false, artistName: "Far Artist" });
    render(
      <ShowsFeedLane
        events={[nearEvent, farEvent]}
        isLoading={false}
        hasTaste={true}
        city="Portland, OR"
        onSetCity={vi.fn()}
        onArtistClick={vi.fn()}
      />,
    );
    expect(screen.getByText(/Near you/i)).toBeTruthy();
    expect(screen.getByText(/Elsewhere/i)).toBeTruthy();
    expect(screen.getByText("Near Artist")).toBeTruthy();
    expect(screen.getByText("Far Artist")).toBeTruthy();
  });
});
