// @vitest-environment jsdom
/**
 * Unit tests for ManualImportModal — service-picker + mode-based UX.
 *
 * Updated for the redesigned service-picker (spotify / applemusic / youtubemusic /
 * lastfm / listenbrainz / typeorpaste):
 *  - The modal opens on the service-picker (grid of 6 service tiles).
 *  - Selecting Spotify shows the per-service guide pane.
 *  - Selecting Apple Music shows its guide pane.
 *  - Selecting "Type or paste" goes directly to the tracks textarea.
 *  - Screenshots are accessible through "Type or paste" → "Paste screenshot" button.
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
  dedupeTracks,
  parseCsv,
  parseTracks,
} from "../src/components/ManualImportModal";

// ---------------------------------------------------------------------------
// Hoisted mock fns — created before vi.mock() factory runs.
// ---------------------------------------------------------------------------

const { mockPostStartManualImport, mockPostStartListenBrainzImport, mockPostExtractLibraryImages } = vi.hoisted(() => ({
  mockPostStartManualImport: vi.fn<[], Promise<void>>(),
  mockPostStartListenBrainzImport: vi.fn<[string], Promise<void>>(),
  mockPostExtractLibraryImages: vi.fn(),
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
    postExtractLibraryImages: mockPostExtractLibraryImages,
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
  mockPostExtractLibraryImages.mockReset();
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

  it("renders the Spotify service tile", () => {
    renderModal();
    expect(screen.getByTestId("service-tile-spotify")).toBeTruthy();
  });

  it("renders the Apple Music service tile", () => {
    renderModal();
    expect(screen.getByTestId("service-tile-applemusic")).toBeTruthy();
  });

  it("renders the ListenBrainz service tile", () => {
    renderModal();
    expect(screen.getByTestId("service-tile-listenbrainz")).toBeTruthy();
  });

  it("renders the Type or paste service tile", () => {
    renderModal();
    expect(screen.getByTestId("service-tile-typeorpaste")).toBeTruthy();
  });

  it("does NOT show the steps panel on first render", () => {
    renderModal();
    expect(screen.queryByTestId("service-steps-panel")).toBeNull();
  });

  it("Back button is NOT visible on the service picker", () => {
    renderModal();
    expect(screen.queryByRole("button", { name: /^back$/i })).toBeNull();
  });

  it("offers a screenshot import path via the Type or paste tile", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("service-tile-typeorpaste"));
    expect(screen.getByRole("button", { name: /paste screenshot/i })).toBeTruthy();
  });

  it("opens the screenshot capture pane via Type or paste → Paste screenshot", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("service-tile-typeorpaste"));
    fireEvent.click(screen.getByRole("button", { name: /paste screenshot/i }));
    expect(screen.getByText(/recognize library screenshots/i)).toBeTruthy();
    expect(screen.getByTestId("screenshot-file-input")).toBeTruthy();
  });

  it("accepts an image, extracts rows, and opens an editable review", async () => {
    mockPostExtractLibraryImages.mockResolvedValue({
      results: [{
        index: 0,
        status: "ok",
        tracks: [{ artist: "Fleetwood Mac", title: "Dreams", confidence: 0.97 }],
      }],
    });
    renderModal();
    fireEvent.click(screen.getByTestId("service-tile-typeorpaste"));
    fireEvent.click(screen.getByRole("button", { name: /paste screenshot/i }));
    const file = new File(["png-bytes"], "library.png", { type: "image/png" });
    fireEvent.change(screen.getByTestId("screenshot-file-input"), { target: { files: [file] } });
    expect(await screen.findByTestId("image-preview-list")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /read 1 screenshot/i }));
    expect(await screen.findByTestId("ocr-review-list")).toBeTruthy();
    expect(screen.getByDisplayValue("Fleetwood Mac")).toBeTruthy();
    expect(screen.getByDisplayValue("Dreams")).toBeTruthy();
  });

  it("edits and deletes reviewed rows before sending the existing manual import contract", async () => {
    mockPostExtractLibraryImages.mockResolvedValue({
      results: [{
        index: 0,
        status: "ok",
        tracks: [
          { artist: "Artist A", title: "Song A", confidence: 0.9 },
          { artist: "Artist B", title: "Song B", confidence: 0.9 },
        ],
      }],
    });
    mockPostStartManualImport.mockResolvedValue(undefined);
    const closeSpy = vi.fn();
    renderModal(closeSpy);
    fireEvent.click(screen.getByTestId("service-tile-typeorpaste"));
    fireEvent.click(screen.getByRole("button", { name: /paste screenshot/i }));
    fireEvent.change(screen.getByTestId("screenshot-file-input"), {
      target: { files: [new File(["png"], "library.png", { type: "image/png" })] },
    });
    fireEvent.click(await screen.findByRole("button", { name: /read 1 screenshot/i }));
    const artist = await screen.findByLabelText("Artist 1");
    fireEvent.change(artist, { target: { value: "Edited Artist" } });
    fireEvent.click(screen.getByRole("button", { name: /delete track 2/i }));
    fireEvent.click(screen.getByRole("button", { name: /import 1 track/i }));
    await waitFor(() => expect(closeSpy).toHaveBeenCalledOnce());
    expect(mockPostStartManualImport).toHaveBeenCalledWith([{ artist: "Edited Artist", title: "Song A" }]);
  });
});

// ---------------------------------------------------------------------------
// Tests: Spotify service guide (was Exportify steps)
// ---------------------------------------------------------------------------

describe("ManualImportModal — Spotify service guide", () => {
  it("shows the service guide after selecting Spotify (service picker hides)", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("service-tile-spotify"));
    expect(screen.queryByTestId("service-picker")).toBeNull();
    expect(screen.getByRole("button", { name: /^back$/i })).toBeTruthy();
  });

  it("mentions that Lore never sees your password", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("service-tile-spotify"));
    expect(screen.getByText(/Lore never sees your password/i)).toBeTruthy();
  });

  it("shows the Exportify link pointing to exportify.net", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("service-tile-spotify"));
    const link = screen.getByRole("link", { name: /exportify\.net/i }) as HTMLAnchorElement;
    expect(link.href).toContain("exportify.net");
  });

  it("hides the service picker after selecting Spotify", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("service-tile-spotify"));
    expect(screen.queryByTestId("service-picker")).toBeNull();
  });

  it("shows the Back button inside the Spotify guide", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("service-tile-spotify"));
    expect(screen.getByRole("button", { name: /^back$/i })).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Tests: Apple Music service guide (was Apple Music / TuneMyMusic steps)
// ---------------------------------------------------------------------------

describe("ManualImportModal — Apple Music service guide", () => {
  it("shows the service guide after selecting Apple Music (service picker hides)", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("service-tile-applemusic"));
    expect(screen.queryByTestId("service-picker")).toBeNull();
    expect(screen.getByRole("button", { name: /^back$/i })).toBeTruthy();
  });

  it("shows the TuneMyMusic link pointing to tunemymusic.com", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("service-tile-applemusic"));
    const link = screen.getByRole("link", { name: /tunemymusic\.com/i }) as HTMLAnchorElement;
    expect(link.href).toContain("tunemymusic.com");
  });
});

// ---------------------------------------------------------------------------
// Tests: Type or paste tile goes straight to tracks mode
// ---------------------------------------------------------------------------

describe("ManualImportModal — 'Type or paste' tile", () => {
  it("selecting Type or paste shows the tracks textarea immediately", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("service-tile-typeorpaste"));
    expect(screen.getByTestId("tracks-textarea")).toBeTruthy();
  });

  it("selecting Type or paste hides the service picker", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("service-tile-typeorpaste"));
    expect(screen.queryByTestId("service-picker")).toBeNull();
  });

  it("selecting Type or paste does NOT show a service-steps panel", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("service-tile-typeorpaste"));
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

  it("shows the Import button when a username is entered", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("service-tile-listenbrainz"));
    const input = screen.getByPlaceholderText(/listenbrainz username/i);
    fireEvent.change(input, { target: { value: "acme_user" } });
    const btn = screen.getByRole("button", { name: /^import$/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it("the Import button is disabled when the username field is empty", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("service-tile-listenbrainz"));
    const btn = screen.getByRole("button", { name: /^import$/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
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
  it("Back from Spotify guide returns to service picker", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("service-tile-spotify"));
    expect(screen.getByRole("button", { name: /^back$/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));

    expect(screen.getByTestId("service-picker")).toBeTruthy();
    expect(screen.queryByTestId("service-steps-panel")).toBeNull();
  });

  it("Back from Apple Music guide returns to service picker", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("service-tile-applemusic"));
    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));
    expect(screen.getByTestId("service-picker")).toBeTruthy();
  });

  it("Back from tracks mode (Type or paste) returns to service picker", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("service-tile-typeorpaste"));
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
    fireEvent.click(screen.getByTestId("service-tile-typeorpaste"));
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
    fireEvent.click(screen.getByTestId("service-tile-typeorpaste"));
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
    fireEvent.click(screen.getByTestId("service-tile-typeorpaste"));
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

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^import$/i }));
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

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^import$/i }));
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

    fireEvent.click(screen.getByTestId("service-tile-typeorpaste"));
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

    fireEvent.click(screen.getByTestId("service-tile-typeorpaste"));
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

// ---------------------------------------------------------------------------
// Tests: OCR failure isolation — mixed batches, retry, and remove
// ---------------------------------------------------------------------------

describe("ManualImportModal — OCR failure isolation", () => {
  /**
   * Helper: render → pick Type or paste → Paste screenshot → add files → click Extract.
   * Returns a promise that resolves once the review pane appears.
   */
  async function runMixedExtraction(files: File[]) {
    renderModal();
    fireEvent.click(screen.getByTestId("service-tile-typeorpaste"));
    fireEvent.click(screen.getByRole("button", { name: /paste screenshot/i }));
    fireEvent.change(screen.getByTestId("screenshot-file-input"), {
      target: { files },
    });
    await screen.findByTestId("image-preview-list");
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(`read ${files.length} screenshot`, "i") }),
    );
    return screen.findByTestId("ocr-review-list");
  }

  it("keeps successful rows editable after a mixed-batch extraction", async () => {
    mockPostExtractLibraryImages.mockResolvedValueOnce({
      results: [
        {
          index: 0,
          status: "ok",
          tracks: [{ artist: "Fleetwood Mac", title: "Dreams", confidence: 0.97 }],
        },
        { index: 1, status: "error", error: "Could not read this image" },
      ],
    });

    await runMixedExtraction([
      new File(["png"], "screen-a.png", { type: "image/png" }),
      new File(["png"], "screen-b.png", { type: "image/png" }),
    ]);

    // Successful tracks are editable
    expect(screen.getByDisplayValue("Fleetwood Mac")).toBeTruthy();
    expect(screen.getByDisplayValue("Dreams")).toBeTruthy();

    // Error notice for the failed image is visible
    expect(screen.getByRole("alert")).toBeTruthy();

    // Import button counts only the recognised tracks — not blocked by the failure
    expect(screen.getByRole("button", { name: /import 1 track/i })).toBeTruthy();
  });

  it("importing works immediately with partial success — failed image never blocks the action", async () => {
    mockPostExtractLibraryImages.mockResolvedValueOnce({
      results: [
        {
          index: 0,
          status: "ok",
          tracks: [{ artist: "Fleetwood Mac", title: "Dreams", confidence: 0.97 }],
        },
        { index: 1, status: "error", error: "Could not read this image" },
      ],
    });
    mockPostStartManualImport.mockResolvedValue(undefined);
    const closeSpy = vi.fn();

    renderModal(closeSpy);
    fireEvent.click(screen.getByTestId("service-tile-typeorpaste"));
    fireEvent.click(screen.getByRole("button", { name: /paste screenshot/i }));
    fireEvent.change(screen.getByTestId("screenshot-file-input"), {
      target: {
        files: [
          new File(["png"], "screen-a.png", { type: "image/png" }),
          new File(["png"], "screen-b.png", { type: "image/png" }),
        ],
      },
    });
    await screen.findByTestId("image-preview-list");
    fireEvent.click(screen.getByRole("button", { name: /read 2 screenshots/i }));
    await screen.findByTestId("ocr-review-list");

    // The Import button is enabled and carries only image A's track
    fireEvent.click(screen.getByRole("button", { name: /import 1 track/i }));
    await waitFor(() => expect(closeSpy).toHaveBeenCalledOnce());
    expect(mockPostStartManualImport).toHaveBeenCalledWith([
      { artist: "Fleetwood Mac", title: "Dreams" },
    ]);
  });

  it("shows the empty-state prompt and disables Import when every image in the batch fails", async () => {
    mockPostExtractLibraryImages.mockResolvedValueOnce({
      results: [
        { index: 0, status: "error", error: "Unreadable file" },
        { index: 1, status: "error", error: "Unreadable file" },
      ],
    });

    renderModal();
    fireEvent.click(screen.getByTestId("service-tile-typeorpaste"));
    fireEvent.click(screen.getByRole("button", { name: /paste screenshot/i }));
    fireEvent.change(screen.getByTestId("screenshot-file-input"), {
      target: {
        files: [
          new File(["png"], "screen-a.png", { type: "image/png" }),
          new File(["png"], "screen-b.png", { type: "image/png" }),
        ],
      },
    });
    await screen.findByTestId("image-preview-list");
    fireEvent.click(screen.getByRole("button", { name: /read 2 screenshots/i }));

    // Wait for the review pane to appear (empty-state text is the indicator)
    await screen.findByText(/no clear song rows found/i);

    // Import button is disabled — nothing to import
    const importBtn = screen.getByRole("button", { name: /import 0 tracks/i });
    expect(importBtn).toBeTruthy();
    expect((importBtn as HTMLButtonElement).disabled).toBe(true);

    // Failed-image count alert is visible with the "Review errors" link
    const alert = screen.getByRole("alert");
    expect(alert).toBeTruthy();
    expect(alert.textContent).toMatch(/2 screenshots? could not be read/i);
    expect(screen.getByRole("button", { name: /review errors/i })).toBeTruthy();
  });

  it("retrying a failed image does not drop rows already recognised from a successful image", async () => {
    // First extraction: image A ok, image B error
    mockPostExtractLibraryImages
      .mockResolvedValueOnce({
        results: [
          {
            index: 0,
            status: "ok",
            tracks: [{ artist: "Fleetwood Mac", title: "Dreams", confidence: 0.97 }],
          },
          { index: 1, status: "error", error: "Could not read this image" },
        ],
      })
      // Retry of image B only — index 0 of the single-image sub-call
      .mockResolvedValueOnce({
        results: [
          {
            index: 0,
            status: "ok",
            tracks: [{ artist: "The Beatles", title: "Hey Jude", confidence: 0.95 }],
          },
        ],
      });

    await runMixedExtraction([
      new File(["png"], "screen-a.png", { type: "image/png" }),
      new File(["png"], "screen-b.png", { type: "image/png" }),
    ]);

    // Go to images mode to access the Retry button
    fireEvent.click(screen.getByRole("button", { name: /review errors/i }));
    const retryBtn = await screen.findByRole("button", { name: /retry screen-b\.png/i });
    fireEvent.click(retryBtn);

    // Review mode returns with both images' tracks present
    await screen.findByTestId("ocr-review-list");
    expect(screen.getByDisplayValue("Fleetwood Mac")).toBeTruthy();
    expect(screen.getByDisplayValue("The Beatles")).toBeTruthy();
    expect(screen.getByRole("button", { name: /import 2 tracks/i })).toBeTruthy();
  });

  it("shows the exact provider error string under the failed image thumbnail in the images pane", async () => {
    mockPostExtractLibraryImages.mockResolvedValueOnce({
      results: [
        { index: 0, status: "error", error: "OCR provider timed out" },
      ],
    });

    // Set up the modal manually — do NOT use runMixedExtraction because that
    // helper waits for ocr-review-list, which never appears when all images fail
    // (there are no recognised tracks to review).
    renderModal();
    fireEvent.click(screen.getByTestId("service-tile-typeorpaste"));
    fireEvent.click(screen.getByRole("button", { name: /paste screenshot/i }));
    fireEvent.change(screen.getByTestId("screenshot-file-input"), {
      target: { files: [new File(["png"], "screen-a.png", { type: "image/png" })] },
    });
    await screen.findByTestId("image-preview-list");
    fireEvent.click(screen.getByRole("button", { name: /read 1 screenshot/i }));

    // After extraction the modal moves to review mode; with one failed image the
    // "Review errors" button is rendered there (failedImageCount > 0).
    const reviewErrorsBtn = await screen.findByRole("button", { name: /review errors/i });
    fireEvent.click(reviewErrorsBtn);

    // Now back in images mode — the exact error string from the provider must
    // appear under the failed thumbnail.
    expect(await screen.findByText("OCR provider timed out")).toBeTruthy();
  });

  it("removing a failed image does not drop rows from the successful image", async () => {
    // First extraction: image A ok (Dreams), image B error
    mockPostExtractLibraryImages
      .mockResolvedValueOnce({
        results: [
          {
            index: 0,
            status: "ok",
            tracks: [{ artist: "Fleetwood Mac", title: "Dreams", confidence: 0.97 }],
          },
          { index: 1, status: "error", error: "Could not read this image" },
        ],
      })
      // Second extraction after adding image C — only C is pending
      .mockResolvedValueOnce({
        results: [
          {
            index: 0,
            status: "ok",
            tracks: [{ artist: "The Beatles", title: "Hey Jude", confidence: 0.95 }],
          },
        ],
      });

    await runMixedExtraction([
      new File(["png"], "screen-a.png", { type: "image/png" }),
      new File(["png"], "screen-b.png", { type: "image/png" }),
    ]);

    // Go to images, remove the failed image B
    fireEvent.click(screen.getByRole("button", { name: /review errors/i }));
    fireEvent.click(await screen.findByRole("button", { name: /remove screen-b\.png/i }));

    // Add a new image C and extract it
    fireEvent.change(screen.getByTestId("screenshot-file-input"), {
      target: { files: [new File(["png"], "screen-c.png", { type: "image/png" })] },
    });
    await screen.findByRole("button", { name: /read 1 screenshot/i });
    fireEvent.click(screen.getByRole("button", { name: /read 1 screenshot/i }));

    // Review: image A's "Dreams" survived alongside image C's "Hey Jude"
    await screen.findByTestId("ocr-review-list");
    expect(screen.getByDisplayValue("Fleetwood Mac")).toBeTruthy();
    expect(screen.getByDisplayValue("The Beatles")).toBeTruthy();
    expect(screen.getByRole("button", { name: /import 2 tracks/i })).toBeTruthy();
  });
});

describe("OCR review helpers", () => {
  it("deduplicates recognized rows case-insensitively without changing order", () => {
    expect(dedupeTracks([
      { artist: "The Beatles", title: "Hey Jude" },
      { artist: "the beatles", title: "hey jude" },
      { artist: "Fleetwood Mac", title: "Dreams" },
    ])).toEqual([
      { artist: "The Beatles", title: "Hey Jude" },
      { artist: "Fleetwood Mac", title: "Dreams" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Pure unit tests: parseCsv — Exportify "Artist Name(s)" plural header
// ---------------------------------------------------------------------------

describe("parseCsv — Exportify plural 'Artist Name(s)' header", () => {
  const exportifyPluralHeader = '"Track Name","Artist Name(s)"';
  const exportifyPluralRows = [
    '"Billie Jean","Michael Jackson"',
    '"Mr. Brightside","The Killers"',
    '"Africa","Toto"',
  ];

  it("parses a real Exportify-format header row with 'Artist Name(s)' to 3 tracks", () => {
    const csv = [exportifyPluralHeader, ...exportifyPluralRows].join("\n");
    expect(parseCsv(csv)).toHaveLength(3);
  });

  it("extracts the correct artist using the 'Artist Name(s)' column", () => {
    const csv = [exportifyPluralHeader, ...exportifyPluralRows].join("\n");
    const [first] = parseCsv(csv);
    expect(first?.artist).toBe("Michael Jackson");
    expect(first?.title).toBe("Billie Jean");
  });

  it("extracts the artist for the third track correctly", () => {
    const csv = [exportifyPluralHeader, ...exportifyPluralRows].join("\n");
    const tracks = parseCsv(csv);
    expect(tracks[2]?.artist).toBe("Toto");
    expect(tracks[2]?.title).toBe("Africa");
  });
});

// ---------------------------------------------------------------------------
// Tests: tracks mode — preview list
// ---------------------------------------------------------------------------

describe("ManualImportModal — tracks mode preview list", () => {
  it("shows a track preview list after pasting tracks", async () => {
    renderModal();
    fireEvent.click(screen.getByTestId("service-tile-typeorpaste"));
    const textarea = screen.getByTestId("tracks-textarea");

    await act(async () => {
      fireEvent.change(textarea, {
        target: { value: "Fleetwood Mac – Go Your Own Way\nThe Beatles – Hey Jude" },
      });
    });

    expect(await screen.findByTestId("track-preview-list")).toBeTruthy();
  });

  it("shows each track as Artist – Title in the preview list", async () => {
    renderModal();
    fireEvent.click(screen.getByTestId("service-tile-typeorpaste"));
    const textarea = screen.getByTestId("tracks-textarea");

    await act(async () => {
      fireEvent.change(textarea, {
        target: { value: "Fleetwood Mac – Go Your Own Way\nThe Beatles – Hey Jude" },
      });
    });

    await screen.findByTestId("track-preview-list");
    expect(screen.getByText("Fleetwood Mac")).toBeTruthy();
    expect(screen.getByText("The Beatles")).toBeTruthy();
  });

  it("shows '…and N more' when more than 50 tracks are parsed", async () => {
    renderModal();
    fireEvent.click(screen.getByTestId("service-tile-typeorpaste"));
    const textarea = screen.getByTestId("tracks-textarea");

    const lines = Array.from({ length: 60 }, (_, i) => `Artist ${i + 1} – Song ${i + 1}`).join("\n");
    await act(async () => {
      fireEvent.change(textarea, { target: { value: lines } });
    });

    await screen.findByTestId("track-preview-list");
    expect(screen.getByText(/…and 10 more/i)).toBeTruthy();
  });

  it("does NOT show '…and N more' when 50 or fewer tracks are parsed", async () => {
    renderModal();
    fireEvent.click(screen.getByTestId("service-tile-typeorpaste"));
    const textarea = screen.getByTestId("tracks-textarea");

    const lines = Array.from({ length: 50 }, (_, i) => `Artist ${i + 1} – Song ${i + 1}`).join("\n");
    await act(async () => {
      fireEvent.change(textarea, { target: { value: lines } });
    });

    await screen.findByTestId("track-preview-list");
    expect(screen.queryByText(/…and/i)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests: improved empty-parse error messages
// ---------------------------------------------------------------------------

describe("ManualImportModal — empty-parse error messages", () => {
  it("shows a CSV-specific hint when the input has commas but no data rows", async () => {
    renderModal();
    fireEvent.click(screen.getByTestId("service-tile-typeorpaste"));
    const textarea = screen.getByTestId("tracks-textarea");

    // A header-only CSV: has commas, parseCsv returns [] (no data rows), parsePlainText also returns []
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "Spotify URI,Track Name,Artist Name(s),Album Name" } });
    });

    const errEl = await screen.findByTestId("track-count");
    expect(errEl.textContent).toMatch(/Track Name/i);
    expect(errEl.textContent).toMatch(/Artist Name/i);
  });

  it("shows a plain-text hint when the input has no commas and no dashes", async () => {
    renderModal();
    fireEvent.click(screen.getByTestId("service-tile-typeorpaste"));
    const textarea = screen.getByTestId("tracks-textarea");

    await act(async () => {
      fireEvent.change(textarea, { target: { value: "just some words without any dashes" } });
    });

    // Use testId to avoid matching the inline tip which also contains "Artist" and "Title"
    const errEl = await screen.findByTestId("track-count");
    expect(errEl.textContent).toMatch(/Artist/i);
    expect(errEl.textContent).toMatch(/Title/i);
  });
});

// ---------------------------------------------------------------------------
// Tests: Import button always shows count
// ---------------------------------------------------------------------------

describe("ManualImportModal — Import button label", () => {
  it("shows 'Import 0 tracks' when no tracks are parsed yet", async () => {
    renderModal();
    fireEvent.click(screen.getByTestId("service-tile-typeorpaste"));
    // Button should show count even when 0
    expect(screen.getByRole("button", { name: /import 0 tracks/i })).toBeTruthy();
  });

  it("shows 'Import 3 tracks' after pasting 3 tracks", async () => {
    renderModal();
    fireEvent.click(screen.getByTestId("service-tile-typeorpaste"));
    const textarea = screen.getByTestId("tracks-textarea");

    await act(async () => {
      fireEvent.change(textarea, {
        target: {
          value: "Artist A – Song A\nArtist B – Song B\nArtist C – Song C",
        },
      });
    });

    expect(await screen.findByRole("button", { name: /import 3 tracks/i })).toBeTruthy();
  });
});
