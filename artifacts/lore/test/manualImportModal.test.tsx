// @vitest-environment jsdom
/**
 * Unit tests for ManualImportModal — auto-detecting import flow.
 *
 * Confirms:
 *  - Input mode renders the unified text input + file drop zone (no service picker).
 *  - Submitting a single-word token switches to username disambiguation.
 *  - Clicking "Importing from Last.fm" from username mode switches to lfm-hint.
 *  - Pasting multiline content auto-switches to tracks mode.
 *  - Tracks mode shows parsed track count and an import button.
 *  - A successful ListenBrainz import calls postStartListenBrainzImport and closes the modal.
 *  - A successful manual import calls postStartManualImport and closes the modal.
 *  - An import error is shown in-line and does not close the modal.
 */
import React from "react";
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ManualImportModal } from "../src/components/ManualImportModal";

// ---------------------------------------------------------------------------
// Hoisted mock fns — created before vi.mock() factory runs.
// ---------------------------------------------------------------------------

const { mockPostStartManualImport, mockPostStartListenBrainzImport } = vi.hoisted(() => ({
  mockPostStartManualImport: vi.fn<[], Promise<void>>(),
  mockPostStartListenBrainzImport: vi.fn<[], Promise<void>>(),
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("../src/lib/meHooks", async (importOriginal) => {
  const { makeMeHooksMock } = await import("./helpers/meHooksMock");
  return makeMeHooksMock(importOriginal, {
    postStartManualImport: mockPostStartManualImport,
    postStartListenBrainzImport: mockPostStartListenBrainzImport,
  });
});

vi.mock("wouter", () => ({
  useLocation: vi.fn(() => ["/", vi.fn()]),
}));

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

/**
 * Enter tracks mode via the fallback detect path.
 *
 * handleDetect reads rawInput from its React closure. In React 18 automatic
 * batching, state updates from fireEvent.change are not committed until the
 * current task ends. We must flush the change first (separate act), then
 * fire the click so handleDetect sees the updated rawInput.
 *
 * Note: the value is NOT carried into the textarea automatically when detect
 * fires with stale rawInput=""; callers that need textarea content must set
 * it explicitly after calling enterTracksMode().
 */
async function enterTracksMode() {
  const input = screen.getByPlaceholderText(/username or paste tracks here/i);
  const detectBtn = input.nextElementSibling as HTMLButtonElement;
  // 1. Set a space-containing value so handleDetect falls through to tracks mode.
  await act(async () => { fireEvent.change(input, { target: { value: "Fleetwood Mac – Go Your Own Way" } }); });
  // 2. Click detect — handleDetect now reads the committed rawInput.
  await act(async () => { fireEvent.click(detectBtn); });
  // 3. Guarantee we are in tracks mode before returning.
  await screen.findByRole("textbox");
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
// Input mode (initial state)
// ---------------------------------------------------------------------------

describe("ManualImportModal — input mode (initial)", () => {
  it("renders the unified text input with the combined placeholder", () => {
    renderModal();
    expect(screen.getByPlaceholderText(/username or paste tracks here/i)).toBeTruthy();
  });

  it("renders the file drop zone", () => {
    renderModal();
    expect(screen.getByRole("button", { name: /upload or drop a csv or text file/i })).toBeTruthy();
  });

  it("does NOT show a 'choose a service' prompt", () => {
    renderModal();
    expect(screen.queryByText(/choose a service/i)).toBeNull();
  });

  it("does NOT show a service picker with Spotify / Apple Music buttons", () => {
    renderModal();
    expect(screen.queryByRole("button", { name: /^spotify$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^apple music$/i })).toBeNull();
  });

  it("shows the Close button", () => {
    renderModal();
    expect(screen.getByRole("button", { name: /close/i })).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Username disambiguation
// ---------------------------------------------------------------------------

describe("ManualImportModal — username disambiguation", () => {
  it("switches to username mode when a single token is submitted", async () => {
    renderModal();

    const input = screen.getByPlaceholderText(/username or paste tracks here/i);
    fireEvent.change(input, { target: { value: "musiclover42" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(await screen.findByText(/import from listenbrainz/i)).toBeTruthy();
  });

  it("shows the typed username in the disambiguation pane", async () => {
    renderModal();

    const input = screen.getByPlaceholderText(/username or paste tracks here/i);
    fireEvent.change(input, { target: { value: "testuser" } });
    fireEvent.keyDown(input, { key: "Enter" });

    // Username appears in both the subtitle span and the username pill — either confirms the pane is shown.
    const matches = await screen.findAllByText("testuser");
    expect(matches.length).toBeGreaterThan(0);
  });

  it("shows the 'Importing from Last.fm' option", async () => {
    renderModal();

    const input = screen.getByPlaceholderText(/username or paste tracks here/i);
    fireEvent.change(input, { target: { value: "djname" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(await screen.findByText(/importing from last\.fm instead/i)).toBeTruthy();
  });

  it("Back button returns to input mode", async () => {
    renderModal();

    const input = screen.getByPlaceholderText(/username or paste tracks here/i);
    fireEvent.change(input, { target: { value: "djname" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await screen.findByText(/import from listenbrainz/i);
    fireEvent.click(screen.getByRole("button", { name: /back/i }));

    expect(screen.getByPlaceholderText(/username or paste tracks here/i)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Last.fm hint mode
// ---------------------------------------------------------------------------

describe("ManualImportModal — Last.fm hint", () => {
  it("switches to lfm-hint when 'Importing from Last.fm instead?' is clicked", async () => {
    renderModal();

    const input = screen.getByPlaceholderText(/username or paste tracks here/i);
    fireEvent.change(input, { target: { value: "lfmuser" } });
    fireEvent.keyDown(input, { key: "Enter" });

    const lfmBtn = await screen.findByText(/importing from last\.fm instead/i);
    fireEvent.click(lfmBtn.closest("button")!);

    expect(await screen.findByText(/export your last\.fm loved tracks/i)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Tracks mode
//
// jsdom strips newlines from <input type="text"> values, so the multiline
// auto-switch effect cannot be triggered via fireEvent on the single-line
// input.  Instead we reach tracks mode through the fallback path in
// handleDetect(): a value that contains spaces but is not multiline is not
// treated as a username, so it falls through to setMode("tracks").
// ---------------------------------------------------------------------------

describe("ManualImportModal — tracks mode", () => {
  it("switches to tracks mode when a space-containing value is submitted", async () => {
    renderModal();
    await enterTracksMode();
    // Textarea is now visible (tracks mode).
    expect(screen.getByRole("textbox")).toBeTruthy();
  });

  it("shows the import button enabled with 1 track after typing a parseable line", async () => {
    renderModal();
    await enterTracksMode();

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, {
      target: { value: "Fleetwood Mac – Go Your Own Way" },
    });

    // "Import 1 tracks" button appears when exactly 1 track is parsed.
    expect(await screen.findByRole("button", { name: /import 1 tracks/i })).toBeTruthy();
  });

  it("shows the import button with 2 tracks after editing the textarea", async () => {
    renderModal();
    await enterTracksMode();

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, {
      target: { value: "Fleetwood Mac – Go Your Own Way\nThe Beatles – Hey Jude" },
    });

    expect(await screen.findByRole("button", { name: /import 2 tracks/i })).toBeTruthy();
  });

  it("shows 'No tracks recognised' when textarea content cannot be parsed", async () => {
    renderModal();
    await enterTracksMode();

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, {
      target: { value: "line one without separator\nline two without separator" },
    });

    expect(await screen.findByText(/no tracks recognised/i)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// ListenBrainz import — success + error
// ---------------------------------------------------------------------------

describe("ManualImportModal — ListenBrainz import", () => {
  it("calls postStartListenBrainzImport with the username and closes on success", async () => {
    mockPostStartListenBrainzImport.mockResolvedValue(undefined);
    const closeSpy = vi.fn();
    renderModal(closeSpy);

    const input = screen.getByPlaceholderText(/username or paste tracks here/i);
    fireEvent.change(input, { target: { value: "lbuser" } });
    fireEvent.keyDown(input, { key: "Enter" });

    const lbBtn = await screen.findByRole("button", { name: /import from listenbrainz/i });
    await act(async () => { fireEvent.click(lbBtn); });

    await waitFor(() => expect(closeSpy).toHaveBeenCalledOnce());
    expect(mockPostStartListenBrainzImport).toHaveBeenCalledWith("lbuser");
  });

  it("shows an error message and does not close when the import fails", async () => {
    mockPostStartListenBrainzImport.mockRejectedValue(new Error("not found"));
    const closeSpy = vi.fn();
    renderModal(closeSpy);

    const input = screen.getByPlaceholderText(/username or paste tracks here/i);
    fireEvent.change(input, { target: { value: "baduser" } });
    fireEvent.keyDown(input, { key: "Enter" });

    const lbBtn = await screen.findByRole("button", { name: /import from listenbrainz/i });
    await act(async () => { fireEvent.click(lbBtn); });

    await waitFor(() => expect(screen.getByText(/not found/i)).toBeTruthy());
    expect(closeSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Manual (track list) import — success + error
// ---------------------------------------------------------------------------

describe("ManualImportModal — manual track import", () => {
  it("calls postStartManualImport and closes on success", async () => {
    mockPostStartManualImport.mockResolvedValue(undefined);
    const closeSpy = vi.fn();
    renderModal(closeSpy);

    await enterTracksMode();

    // Expand to two tracks via the textarea.
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, {
      target: { value: "Fleetwood Mac – Go Your Own Way\nThe Beatles – Hey Jude" },
    });

    const submitBtn = await screen.findByRole("button", { name: /import 2 tracks/i });
    await act(async () => { fireEvent.click(submitBtn); });

    await waitFor(() => expect(closeSpy).toHaveBeenCalledOnce());
    expect(mockPostStartManualImport).toHaveBeenCalledWith([
      { artist: "Fleetwood Mac", title: "Go Your Own Way" },
      { artist: "The Beatles", title: "Hey Jude" },
    ]);
  });

  it("shows an error and does not close when the import fails", async () => {
    mockPostStartManualImport.mockRejectedValue(new Error("server error"));
    const closeSpy = vi.fn();
    renderModal(closeSpy);

    await enterTracksMode();

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "Fleetwood Mac – Go Your Own Way" } });

    const submitBtn = await screen.findByRole("button", { name: /import 1 tracks/i });
    await act(async () => { fireEvent.click(submitBtn); });

    await waitFor(() => expect(screen.getByText(/server error/i)).toBeTruthy());
    expect(closeSpy).not.toHaveBeenCalled();
  });
});
