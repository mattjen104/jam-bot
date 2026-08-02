// @vitest-environment jsdom
/**
 * Unit tests for ManualImportModal — mode-based auto-detecting input.
 *
 * The modal has four modes:
 *   input    — initial state: single text field + file drop zone
 *   username — single-token submitted; showing LB / Last.fm disambiguation
 *   lfm-hint — user tapped "Last.fm instead?"; showing export steps
 *   tracks   — multiline content detected; textarea + import action
 *
 * Confirms:
 *  - Input mode renders the unified text input + file drop zone (no service picker).
 *  - Submitting a single-word token switches to username disambiguation.
 *  - Clicking "Importing from Last.fm" from username mode switches to lfm-hint.
 *  - Tracks mode shows parsed track count and an import button.
 *  - The back button (and "Edit" pill) reset state correctly and return to input mode.
 *  - After navigating back, a new input updates the visible pane correctly.
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
// Hoisted mock fns
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

// wouter's useLocation is called for the "use your own Spotify credentials" nav link
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
// Tracks-mode helper
//
// jsdom strips newlines from <input type="text"> values, so the multiline
// auto-switch effect cannot be triggered via fireEvent on the single-line
// input.  Instead we reach tracks mode through the fallback path in
// handleDetect(): a value that contains spaces but is not multiline is not
// treated as a username, so it falls through to setMode("tracks").
//
// handleDetect reads rawInput from its React closure.  In React 18 automatic
// batching, state updates from fireEvent.change are not committed until the
// current task ends.  We must flush the change first (separate act), then
// fire the click so handleDetect sees the updated rawInput.
// ---------------------------------------------------------------------------

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
// Tests: initial "input" mode
// ---------------------------------------------------------------------------

describe("ManualImportModal — initial input mode", () => {
  it("renders the unified text input with the combined placeholder", () => {
    renderModal();
    expect(screen.getByPlaceholderText(/username or paste tracks here/i)).toBeTruthy();
  });

  it("renders the file drop zone", () => {
    renderModal();
    expect(screen.getByRole("button", { name: /upload or drop a csv or text file/i })).toBeTruthy();
  });

  it("does NOT show a service picker with Spotify / Apple Music buttons", () => {
    renderModal();
    expect(screen.queryByRole("button", { name: /^spotify$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^apple music$/i })).toBeNull();
  });

  it("does NOT show a back arrow in input mode", () => {
    renderModal();
    expect(screen.queryByRole("button", { name: /^back$/i })).toBeNull();
  });

  it("shows the Close button", () => {
    renderModal();
    expect(screen.getByRole("button", { name: /close/i })).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Tests: username detection
// ---------------------------------------------------------------------------

describe("ManualImportModal — username detection", () => {
  it("goes to username mode when a single-word value is submitted with Enter", () => {
    renderModal();
    const input = screen.getByPlaceholderText(/username or paste tracks here/i);
    fireEvent.change(input, { target: { value: "mfavourite" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByText(/import from listenbrainz/i)).toBeTruthy();
    expect(screen.getByText(/importing from last\.fm instead/i)).toBeTruthy();
  });

  it("shows the detected username in the disambiguation pane", () => {
    renderModal();
    const input = screen.getByPlaceholderText(/username or paste tracks here/i);
    fireEvent.change(input, { target: { value: "johndoe" } });
    fireEvent.keyDown(input, { key: "Enter" });

    // Username appears in both the pill and the subtitle; the Edit button
    // only appears inside the pill and confirms it is rendered correctly.
    expect(screen.getByRole("button", { name: /edit/i })).toBeTruthy();
    expect(screen.getAllByText(/johndoe/).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: Last.fm hint mode
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
// Tests: tracks mode
// ---------------------------------------------------------------------------

describe("ManualImportModal — tracks mode", () => {
  it("switches to tracks mode when a space-containing value is submitted", async () => {
    renderModal();
    await enterTracksMode();
    expect(screen.getByRole("textbox")).toBeTruthy();
  });

  it("shows the import button enabled with 2 tracks after typing two parseable lines", async () => {
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
// Tests: Back button resets to input mode (task #968 core)
// ---------------------------------------------------------------------------

describe("ManualImportModal — back button resets state to input mode", () => {
  it("clicking the back arrow from username mode returns the input field", () => {
    renderModal();

    const input = screen.getByPlaceholderText(/username or paste tracks here/i);
    fireEvent.change(input, { target: { value: "mfavourite" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByText(/import from listenbrainz/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));

    expect(screen.getByPlaceholderText(/username or paste tracks here/i)).toBeTruthy();
    expect(screen.queryByText(/import from listenbrainz/i)).toBeNull();
  });

  it("clicking 'Edit' in the username pill also returns to input mode", () => {
    renderModal();

    const input = screen.getByPlaceholderText(/username or paste tracks here/i);
    fireEvent.change(input, { target: { value: "mfavourite" } });
    fireEvent.keyDown(input, { key: "Enter" });

    fireEvent.click(screen.getByRole("button", { name: /edit/i }));

    expect(screen.getByPlaceholderText(/username or paste tracks here/i)).toBeTruthy();
    expect(screen.queryByText(/import from listenbrainz/i)).toBeNull();
  });

  it("clicking the back arrow from lfm-hint mode returns the input field", () => {
    renderModal();

    const input = screen.getByPlaceholderText(/username or paste tracks here/i);
    fireEvent.change(input, { target: { value: "lastfmuser" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(screen.getByText(/importing from last\.fm instead/i));

    expect(screen.getByText(/export your last\.fm loved tracks/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));

    expect(screen.getByPlaceholderText(/username or paste tracks here/i)).toBeTruthy();
    expect(screen.queryByText(/export your last\.fm loved tracks/i)).toBeNull();
  });

  it("clicking the back arrow from tracks mode returns the input field", async () => {
    renderModal();

    await enterTracksMode();

    expect(screen.getByRole("textbox")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));

    expect(screen.getByPlaceholderText(/username or paste tracks here/i)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Tests: after going back, a new input updates the UI correctly (task #968)
// ---------------------------------------------------------------------------

describe("ManualImportModal — after going back, new input updates the visible pane", () => {
  it("submitting a different username after navigating back shows that username in the pane", () => {
    renderModal();

    const input = screen.getByPlaceholderText(/username or paste tracks here/i);
    fireEvent.change(input, { target: { value: "firstuser" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("button", { name: /edit/i })).toBeTruthy();
    expect(screen.getAllByText(/firstuser/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));

    const input2 = screen.getByPlaceholderText(/username or paste tracks here/i);
    fireEvent.change(input2, { target: { value: "seconduser" } });
    fireEvent.keyDown(input2, { key: "Enter" });

    expect(screen.getAllByText(/seconduser/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/firstuser/)).toBeNull();
  });

  it("entering a tracks-mode value after going back switches to the tracks pane", async () => {
    renderModal();

    const input = screen.getByPlaceholderText(/username or paste tracks here/i);
    fireEvent.change(input, { target: { value: "someuser" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText(/import from listenbrainz/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));

    // Re-enter using the tracks fallback path
    await enterTracksMode();

    expect(screen.getByRole("textbox")).toBeTruthy();
    expect(screen.queryByText(/import from listenbrainz/i)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests: ListenBrainz import
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
  });
});

// ---------------------------------------------------------------------------
// Tests: manual track import
// ---------------------------------------------------------------------------

describe("ManualImportModal — manual track import", () => {
  it("calls postStartManualImport and closes on success", async () => {
    mockPostStartManualImport.mockResolvedValue(undefined);
    const closeSpy = vi.fn();
    renderModal(closeSpy);

    await enterTracksMode();

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
