// @vitest-environment jsdom
/**
 * Unit tests for ManualImportModal — service-picker + mode-based UX.
 *
 * Confirms:
 *  - The modal opens on the service-picker (grid of service tiles).
 *  - Selecting Exportify shows the per-service steps pane and external link.
 *  - Selecting Apple Music / TuneMyMusic shows its steps pane and external link.
 *  - Selecting "Other" goes directly to the tracks textarea.
 *  - Selecting "ListenBrainz" goes to the username input pane.
 *  - Selecting "Last.fm" goes to the lfm-hint pane.
 *  - Back always returns to the service picker from any downstream mode.
 *  - Back from tracks mode with multiline content stays on the service picker
 *    (regression guard: useEffect multiline-auto-switch only fires from "input" mode).
 *  - A successful ListenBrainz import closes the modal.
 *  - A successful manual (tracks) import closes the modal.
 *  - Failed imports surface the error without closing.
 */
import React from "react";
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  ManualImportModal,
  parseCsv,
  parseTracks,
} from "../src/components/ManualImportModal";

// ---------------------------------------------------------------------------
// Hoisted mock fns — created before vi.mock() factory runs.
// ---------------------------------------------------------------------------

const { mockPostStartManualImport, mockPostStartListenBrainzImport } = vi.hoisted(() => ({
  mockPostStartManualImport: vi.fn<[], Promise<void>>(),
  mockPostStartListenBrainzImport: vi.fn<[string], Promise<void>>(),
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("wouter", () => ({
  useLocation: vi.fn(() => ["/", vi.fn()]),
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("../src/lib/meHooks", async (importOriginal) => {
  const { makeMeHooksMock } = await import("./helpers/meHooksMock");
  return makeMeHooksMock(importOriginal, {
    postStartManualImport: mockPostStartManualImport,
    postStartListenBrainzImport: mockPostStartListenBrainzImport,
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const noop = () => {};

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, enabled: false } },
  });
}

function renderModal(onClose: () => void = noop) {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <ManualImportModal onClose={onClose} />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockPostStartManualImport.mockReset();
  mockPostStartListenBrainzImport.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests: service picker (initial state)
// ---------------------------------------------------------------------------

describe("ManualImportModal — service picker (initial state)", () => {
  it("shows the service-picker pane on first render", () => {
    renderModal();
    expect(screen.getByTestId("service-picker")).toBeTruthy();
  });

  it("renders the Exportify service tile", () => {
    renderModal();
    expect(screen.getByTestId("service-tile-exportify")).toBeTruthy();
  });

  it("renders the Apple Music / TuneMyMusic service tile", () => {
    renderModal();
    expect(screen.getByTestId("service-tile-applemusiccsv")).toBeTruthy();
  });

  it("renders the ListenBrainz service tile", () => {
    renderModal();
    expect(screen.getByTestId("service-tile-listenbrainz")).toBeTruthy();
  });

  it("renders the Other service tile", () => {
    renderModal();
    expect(screen.getByTestId("service-tile-other")).toBeTruthy();
  });

  it("does NOT show the steps panel on first render", () => {
    renderModal();
    expect(screen.queryByTestId("service-steps-panel")).toBeNull();
  });

  it("Back button is NOT visible on the service picker", () => {
    renderModal();
    expect(screen.queryByRole("button", { name: /^back$/i })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests: Exportify service steps
// ---------------------------------------------------------------------------

describe("ManualImportModal — Exportify service steps", () => {
  it("shows the steps panel after selecting Exportify", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("service-tile-exportify"));
    expect(screen.getByTestId("service-steps-panel")).toBeTruthy();
  });

  it("shows a step mentioning logging in with Spotify", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("service-tile-exportify"));
    expect(screen.getByText(/log in with your spotify account/i)).toBeTruthy();
  });

  it("shows the Exportify external link pointing to exportify.net", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("service-tile-exportify"));
    const link = screen.getByTestId("service-external-link") as HTMLAnchorElement;
    expect(link.href).toContain("exportify.net");
  });

  it("hides the service picker after selecting Exportify", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("service-tile-exportify"));
    expect(screen.queryByTestId("service-picker")).toBeNull();
  });

  it("shows the Back button inside the steps pane", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("service-tile-exportify"));
    expect(screen.getByRole("button", { name: /^back$/i })).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Tests: Apple Music / TuneMyMusic service steps
// ---------------------------------------------------------------------------

describe("ManualImportModal — Apple Music service steps", () => {
  it("shows the steps panel after selecting Apple Music", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("service-tile-applemusiccsv"));
    expect(screen.getByTestId("service-steps-panel")).toBeTruthy();
  });

  it("shows the TuneMyMusic external link pointing to tunemymusic.com", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("service-tile-applemusiccsv"));
    const link = screen.getByTestId("service-external-link") as HTMLAnchorElement;
    expect(link.href).toContain("tunemymusic.com");
  });
});

// ---------------------------------------------------------------------------
// Tests: Other tile goes straight to tracks mode
// ---------------------------------------------------------------------------

describe("ManualImportModal — 'Other' tile", () => {
  it("selecting Other shows the tracks textarea immediately", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("service-tile-other"));
    expect(screen.getByTestId("tracks-textarea")).toBeTruthy();
  });

  it("selecting Other hides the service picker", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("service-tile-other"));
    expect(screen.queryByTestId("service-picker")).toBeNull();
  });

  it("selecting Other does NOT show a service-steps panel", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("service-tile-other"));
    expect(screen.queryByTestId("service-steps-panel")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests: ListenBrainz tile → input → username mode
// ---------------------------------------------------------------------------

describe("ManualImportModal — ListenBrainz username flow", () => {
  it("selecting ListenBrainz shows the username input", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("service-tile-listenbrainz"));
    expect(screen.getByPlaceholderText(/listenbrainz username/i)).toBeTruthy();
  });

  it("entering a username and pressing Enter shows the disambiguation pane", async () => {
    renderModal();
    fireEvent.click(screen.getByTestId("service-tile-listenbrainz"));
    const input = screen.getByPlaceholderText(/listenbrainz username/i);
    fireEvent.change(input, { target: { value: "acme_user" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByText(/import from listenbrainz/i)).toBeTruthy();
  });

  it("username disambiguation shows the Last.fm alternative", async () => {
    renderModal();
    fireEvent.click(screen.getByTestId("service-tile-listenbrainz"));
    const input = screen.getByPlaceholderText(/listenbrainz username/i);
    fireEvent.change(input, { target: { value: "acme_user" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByText(/importing from last\.fm instead/i)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Tests: Last.fm tile → lfm-hint mode
// ---------------------------------------------------------------------------

describe("ManualImportModal — Last.fm lfm-hint mode", () => {
  it("selecting Last.fm shows the export instructions", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("service-tile-lastfm"));
    expect(screen.getByText(/export your last\.fm loved tracks/i)).toBeTruthy();
  });

  it("lfm-hint shows the Last.fm to CSV link", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("service-tile-lastfm"));
    expect(screen.getByRole("link", { name: /last\.fm to csv/i })).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Tests: Back button returns to service picker
// ---------------------------------------------------------------------------

describe("ManualImportModal — Back returns to service picker", () => {
  it("Back from Exportify steps returns to service picker", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("service-tile-exportify"));
    expect(screen.getByTestId("service-steps-panel")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));

    expect(screen.getByTestId("service-picker")).toBeTruthy();
    expect(screen.queryByTestId("service-steps-panel")).toBeNull();
  });

  it("Back from Apple Music steps returns to service picker", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("service-tile-applemusiccsv"));
    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));
    expect(screen.getByTestId("service-picker")).toBeTruthy();
  });

  it("Back from tracks mode (Other) returns to service picker", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("service-tile-other"));
    expect(screen.getByTestId("tracks-textarea")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));

    expect(screen.getByTestId("service-picker")).toBeTruthy();
    expect(screen.queryByTestId("tracks-textarea")).toBeNull();
  });

  it("Back from Last.fm lfm-hint returns to service picker", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("service-tile-lastfm"));
    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));
    expect(screen.getByTestId("service-picker")).toBeTruthy();
  });

  it("Back from tracks mode with multiline textarea content stays on service picker", async () => {
    // Regression guard: in older builds, handleBack set mode to "input" and
    // the multiline useEffect bounced back to tracks mode. handleBack now
    // always goes to "service-picker", so the useEffect (gated on mode==="input")
    // can never fire.
    renderModal();
    fireEvent.click(screen.getByTestId("service-tile-other"));
    const textarea = screen.getByTestId("tracks-textarea");

    await act(async () => {
      fireEvent.change(textarea, {
        target: { value: "Fleetwood Mac – Go Your Own Way\nThe Beatles – Hey Jude" },
      });
    });
    await screen.findByRole("button", { name: /import 2 tracks/i });

    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));

    expect(screen.getByTestId("service-picker")).toBeTruthy();
    expect(screen.queryByTestId("tracks-textarea")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests: tracks mode — parse count
// ---------------------------------------------------------------------------

describe("ManualImportModal — tracks mode parse count", () => {
  it("shows the correct Import button count after pasting two tracks", async () => {
    renderModal();
    fireEvent.click(screen.getByTestId("service-tile-other"));
    const textarea = screen.getByTestId("tracks-textarea");

    await act(async () => {
      fireEvent.change(textarea, {
        target: { value: "Fleetwood Mac – Go Your Own Way\nThe Beatles – Hey Jude" },
      });
    });

    expect(await screen.findByRole("button", { name: /import 2 tracks/i })).toBeTruthy();
  });

  it("stays on service picker after Back when the textarea held multiline content", async () => {
    // Regression guard: handleBack now always goes to "service-picker", so
    // the multiline useEffect (gated on mode==="input") can never bounce back.
    renderModal();
    fireEvent.click(screen.getByTestId("service-tile-other"));
    const textarea = screen.getByTestId("tracks-textarea");

    await act(async () => {
      fireEvent.change(textarea, {
        target: { value: "Fleetwood Mac – Go Your Own Way\nThe Beatles – Hey Jude" },
      });
    });
    await screen.findByRole("button", { name: /import 2 tracks/i });

    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));

    expect(screen.getByTestId("service-picker")).toBeTruthy();
    expect(screen.queryByTestId("tracks-textarea")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests: successful imports close the modal
// ---------------------------------------------------------------------------

describe("ManualImportModal — successful ListenBrainz import", () => {
  it("closes the modal after a successful import", async () => {
    mockPostStartListenBrainzImport.mockResolvedValue(undefined);
    const closeSpy = vi.fn();
    renderModal(closeSpy);

    fireEvent.click(screen.getByTestId("service-tile-listenbrainz"));
    const input = screen.getByPlaceholderText(/listenbrainz username/i);
    fireEvent.change(input, { target: { value: "acme_user" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await act(async () => {
      fireEvent.click(await screen.findByText(/import from listenbrainz/i));
    });

    await waitFor(() => expect(closeSpy).toHaveBeenCalledOnce());
  });

  it("shows an error without closing when the import fails", async () => {
    mockPostStartListenBrainzImport.mockRejectedValue(new Error("unknown user"));
    const closeSpy = vi.fn();
    renderModal(closeSpy);

    fireEvent.click(screen.getByTestId("service-tile-listenbrainz"));
    const input = screen.getByPlaceholderText(/listenbrainz username/i);
    fireEvent.change(input, { target: { value: "acme_user" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await act(async () => {
      fireEvent.click(await screen.findByText(/import from listenbrainz/i));
    });

    await waitFor(() => expect(screen.getByText(/unknown user/i)).toBeTruthy());
    expect(closeSpy).not.toHaveBeenCalled();
  });
});

describe("ManualImportModal — successful manual tracks import", () => {
  it("closes the modal after a successful tracks import", async () => {
    mockPostStartManualImport.mockResolvedValue(undefined);
    const closeSpy = vi.fn();
    renderModal(closeSpy);

    fireEvent.click(screen.getByTestId("service-tile-other"));
    const textarea = screen.getByTestId("tracks-textarea");
    await act(async () => {
      fireEvent.change(textarea, {
        target: { value: "Fleetwood Mac – Go Your Own Way\nThe Beatles – Hey Jude" },
      });
    });

    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: /import 2 tracks/i }));
    });

    await waitFor(() => expect(closeSpy).toHaveBeenCalledOnce());
  });

  it("shows an error without closing when the tracks import fails", async () => {
    mockPostStartManualImport.mockRejectedValue(new Error("server error"));
    const closeSpy = vi.fn();
    renderModal(closeSpy);

    fireEvent.click(screen.getByTestId("service-tile-other"));
    const textarea = screen.getByTestId("tracks-textarea");
    await act(async () => {
      fireEvent.change(textarea, {
        target: { value: "Fleetwood Mac – Go Your Own Way\nThe Beatles – Hey Jude" },
      });
    });

    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: /import 2 tracks/i }));
    });

    await waitFor(() => expect(screen.getByText(/server error/i)).toBeTruthy());
    expect(closeSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Pure unit tests: parseCsv and parseTracks (no rendering needed)
// ---------------------------------------------------------------------------

describe("parseCsv — Exportify format (Track Name, Artist Name)", () => {
  const exportifyHeader = '"Track Name","Artist Name"';
  const exportifyRows = [
    '"Billie Jean","Michael Jackson"',
    '"Mr. Brightside","The Killers"',
  ];

  it("parses a two-row Exportify CSV to 2 tracks", () => {
    const csv = [exportifyHeader, ...exportifyRows].join("\n");
    expect(parseCsv(csv)).toHaveLength(2);
  });

  it("returns the correct artist and title for the first row", () => {
    const csv = [exportifyHeader, ...exportifyRows].join("\n");
    const [track] = parseCsv(csv);
    expect(track?.title).toBe("Billie Jean");
    expect(track?.artist).toBe("Michael Jackson");
  });
});

describe("parseCsv — Apple Music / TuneMyMusic format (Name, Artist)", () => {
  const appleHeader = "Name,Artist";
  const appleRows = [
    "Billie Jean,Michael Jackson",
    "Mr. Brightside,The Killers",
  ];

  it("parses a two-row Apple Music CSV to 2 tracks", () => {
    const csv = [appleHeader, ...appleRows].join("\n");
    expect(parseCsv(csv)).toHaveLength(2);
  });

  it("returns the correct artist and title for the first row", () => {
    const csv = [appleHeader, ...appleRows].join("\n");
    const [track] = parseCsv(csv);
    expect(track?.title).toBe("Billie Jean");
    expect(track?.artist).toBe("Michael Jackson");
  });
});

describe("parseTracks — routes through parseCsv for CSV-shaped input", () => {
  it("a 3-row CSV yields 3 tracks via parseTracks", () => {
    const header = "Name,Artist";
    const rows = Array.from({ length: 3 }, (_, i) => `Song ${i + 1},Artist ${i + 1}`);
    const csv = [header, ...rows].join("\n");
    expect(parseTracks(csv)).toHaveLength(3);
  });

  it("plain-text Artist – Title lines yield the correct track count", () => {
    const text = "Fleetwood Mac – Go Your Own Way\nThe Beatles – Hey Jude";
    expect(parseTracks(text)).toHaveLength(2);
  });
});
