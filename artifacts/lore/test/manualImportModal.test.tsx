// @vitest-environment jsdom
/**
 * Tests for ManualImportModal covering the service-picker flow and CSV parsing.
 *
 * Confirms:
 *  - The modal opens on the service-picker pane (service tiles visible)
 *  - Selecting the Exportify tile shows its instruction steps and external link
 *  - Selecting the Apple Music / TuneMyMusic tile shows its steps and external link
 *  - The Back arrow from a service-steps pane returns to the service picker
 *  - Selecting "Other" shows only the paste area with the generic hint (no step list)
 *  - Exportify CSV (columns "Track Name", "Artist Name") parses to the correct track count
 *  - Apple Music / TuneMyMusic CSV (columns "Name", "Artist") parses to the correct track count
 */
import React from "react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  ManualImportModal,
  parseCsv,
  parseTracks,
} from "../src/components/ManualImportModal";

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

vi.mock("wouter", () => ({
  useLocation: vi.fn(() => ["/", vi.fn()]),
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("../src/lib/meHooks", async (importOriginal) => {
  const { makeMeHooksMock } = await import("./helpers/meHooksMock");
  return makeMeHooksMock(importOriginal);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const noop = () => {};

function makeQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
}

function renderModal(onClose = noop) {
  return render(
    <QueryClientProvider client={makeQC()}>
      <ManualImportModal onClose={onClose} />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Service-picker: initial state
// ---------------------------------------------------------------------------

describe("ManualImportModal — service picker (initial state)", () => {
  it("shows the service-picker pane on first render", () => {
    renderModal();
    expect(screen.getByTestId("service-picker")).toBeTruthy();
  });

  it("renders an Exportify service tile", () => {
    renderModal();
    expect(screen.getByTestId("service-tile-exportify")).toBeTruthy();
  });

  it("renders an Apple Music / TuneMyMusic service tile", () => {
    renderModal();
    expect(screen.getByTestId("service-tile-applemusiccsv")).toBeTruthy();
  });

  it("renders an Other service tile", () => {
    renderModal();
    expect(screen.getByTestId("service-tile-other")).toBeTruthy();
  });

  it("does NOT show the steps panel on first render", () => {
    renderModal();
    expect(screen.queryByTestId("service-steps-panel")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Exportify tile: steps pane
// ---------------------------------------------------------------------------

describe("ManualImportModal — Exportify service steps", () => {
  it("shows the steps panel after selecting Exportify", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("service-tile-exportify"));
    expect(screen.getByTestId("service-steps-panel")).toBeTruthy();
  });

  it("shows at least one instruction step for Exportify", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("service-tile-exportify"));
    // The first step mentions logging in with Spotify
    expect(screen.getByText(/log in with your spotify account/i)).toBeTruthy();
  });

  it("shows the external link for Exportify", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("service-tile-exportify"));
    const link = screen.getByTestId("service-external-link");
    expect(link).toBeTruthy();
    expect((link as HTMLAnchorElement).href).toContain("exportify.net");
  });

  it("does NOT show the service picker after selecting Exportify", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("service-tile-exportify"));
    expect(screen.queryByTestId("service-picker")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Apple Music / TuneMyMusic tile: steps pane
// ---------------------------------------------------------------------------

describe("ManualImportModal — Apple Music / TuneMyMusic service steps", () => {
  it("shows the steps panel after selecting Apple Music / TuneMyMusic", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("service-tile-applemusiccsv"));
    expect(screen.getByTestId("service-steps-panel")).toBeTruthy();
  });

  it("shows the external link for TuneMyMusic", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("service-tile-applemusiccsv"));
    const link = screen.getByTestId("service-external-link");
    expect(link).toBeTruthy();
    expect((link as HTMLAnchorElement).href).toContain("tunemymusic.com");
  });
});

// ---------------------------------------------------------------------------
// Back arrow
// ---------------------------------------------------------------------------

describe("ManualImportModal — Back arrow navigation", () => {
  it("Back arrow is not visible on the service picker (initial state)", () => {
    renderModal();
    expect(screen.queryByRole("button", { name: /back/i })).toBeNull();
  });

  it("Back arrow appears after selecting Exportify", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("service-tile-exportify"));
    expect(screen.getByRole("button", { name: /back/i })).toBeTruthy();
  });

  it("clicking Back from Exportify steps returns to the service picker", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("service-tile-exportify"));
    // Confirm we are on the steps pane
    expect(screen.getByTestId("service-steps-panel")).toBeTruthy();
    // Go back
    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    // Should be back on service picker
    expect(screen.getByTestId("service-picker")).toBeTruthy();
    expect(screen.queryByTestId("service-steps-panel")).toBeNull();
  });

  it("clicking Back from Apple Music steps returns to the service picker", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("service-tile-applemusiccsv"));
    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(screen.getByTestId("service-picker")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Other tile: paste-only mode
// ---------------------------------------------------------------------------

describe("ManualImportModal — 'Other' service", () => {
  it("selecting Other shows the paste textarea", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("service-tile-other"));
    expect(screen.getByTestId("tracks-textarea")).toBeTruthy();
  });

  it("selecting Other does NOT show a service-steps panel", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("service-tile-other"));
    expect(screen.queryByTestId("service-steps-panel")).toBeNull();
  });

  it("selecting Other hides the service picker", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("service-tile-other"));
    expect(screen.queryByTestId("service-picker")).toBeNull();
  });

  it("the textarea placeholder contains the generic hint for Other", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("service-tile-other"));
    const ta = screen.getByTestId("tracks-textarea") as HTMLTextAreaElement;
    expect(ta.placeholder).toMatch(/artist.*title|any csv/i);
  });
});

// ---------------------------------------------------------------------------
// CSV parsing — pure unit tests (no rendering needed)
// ---------------------------------------------------------------------------

describe("parseCsv — Exportify format (Track Name, Artist Name)", () => {
  it("parses a two-row Exportify CSV to 2 tracks", () => {
    const csv = [
      '"Track Name","Artist Name","Album"',
      '"Bohemian Rhapsody","Queen","A Night at the Opera"',
      '"Hotel California","Eagles","Hotel California"',
    ].join("\n");
    expect(parseCsv(csv)).toHaveLength(2);
  });

  it("returns the correct artist and title from Exportify CSV", () => {
    const csv = [
      '"Track Name","Artist Name"',
      '"Superstition","Stevie Wonder"',
    ].join("\n");
    const [track] = parseCsv(csv);
    expect(track?.title).toBe("Superstition");
    expect(track?.artist).toBe("Stevie Wonder");
  });

  it("returns empty array for a header-only Exportify CSV", () => {
    const csv = '"Track Name","Artist Name"\n';
    expect(parseCsv(csv)).toHaveLength(0);
  });
});

describe("parseCsv — Apple Music / TuneMyMusic format (Name, Artist)", () => {
  it("parses a two-row Apple Music CSV to 2 tracks", () => {
    const csv = [
      "Name,Artist,Album",
      "Waterloo,ABBA,Waterloo",
      "Dancing Queen,ABBA,Arrival",
    ].join("\n");
    expect(parseCsv(csv)).toHaveLength(2);
  });

  it("returns the correct artist and title from Apple Music CSV", () => {
    const csv = [
      "Name,Artist",
      "Billie Jean,Michael Jackson",
    ].join("\n");
    const [track] = parseCsv(csv);
    expect(track?.title).toBe("Billie Jean");
    expect(track?.artist).toBe("Michael Jackson");
  });

  it("handles quoted fields in Apple Music / TuneMyMusic CSV", () => {
    const csv = [
      "Name,Artist,Album",
      '"Mr. Brightside","The Killers","Hot Fuss"',
    ].join("\n");
    const result = parseCsv(csv);
    expect(result).toHaveLength(1);
    expect(result[0]?.title).toBe("Mr. Brightside");
    expect(result[0]?.artist).toBe("The Killers");
  });
});

describe("parseTracks — routes through parseCsv for CSV content", () => {
  it("a 5-row Exportify CSV yields 5 tracks via parseTracks", () => {
    const header = '"Track Name","Artist Name"';
    const rows = Array.from({ length: 5 }, (_, i) => `"Song ${i + 1}","Artist ${i + 1}"`);
    const csv = [header, ...rows].join("\n");
    expect(parseTracks(csv)).toHaveLength(5);
  });

  it("a 3-row Apple Music CSV yields 3 tracks via parseTracks", () => {
    const header = "Name,Artist";
    const rows = Array.from({ length: 3 }, (_, i) => `Song ${i + 1},Artist ${i + 1}`);
    const csv = [header, ...rows].join("\n");
    expect(parseTracks(csv)).toHaveLength(3);
  });
});
