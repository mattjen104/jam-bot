// @vitest-environment jsdom
/**
 * Unit tests for BottlePanel and PostItIcon.
 *
 * Covers:
 *  - Solo mode (socialEnabled=false): bottle trigger and panel are fully absent
 *    from the DOM.
 *  - No MBID: panel absent even with social enabled.
 *  - Listening-party mode: trigger renders with PostItIcon (scribble lines,
 *    no pencil) when there are no existing bottles and user hasn't sent yet.
 *  - Once bottles exist the trigger switches to BottleIcon.
 *  - Opening the panel shows the expanded section.
 *  - Sending a note transitions to the sealed state (BottleIcon, confirm text).
 *  - Send error reverts the sealed state and shows the error message.
 *  - PostItIcon SVG geometry: three scribble-line paths present, no ✏️ pencil.
 */

import React from "react";
import {
  describe,
  it,
  expect,
  vi,
  afterEach,
  beforeEach,
  type Mock,
} from "vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from "@testing-library/react";

// ---------------------------------------------------------------------------
// Hoisted mock fns — created before vi.mock() factories run.
// ---------------------------------------------------------------------------

const {
  mockUseSocialMode,
  mockUseSongBottles,
  mockUseMyAlbumAvatar,
} = vi.hoisted(() => ({
  mockUseSocialMode: vi.fn(() => ({ enabled: true, toggle: vi.fn() })),
  mockUseSongBottles: vi.fn(() => ({
    bottles: [],
    archivedCount: 0,
    hasUnread: false,
    markRead: vi.fn(),
    send: vi.fn(),
    loading: false,
    error: null,
  })),
  mockUseMyAlbumAvatar: vi.fn(() => ({
    data: {
      current: {
        artworkUrl: "https://example.com/cover.jpg",
        albumTitle: "Test Album",
        artist: "Test Artist",
      },
      eligible: true,
    },
    isLoading: false,
  })),
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("../src/lib/social", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useSocialMode: mockUseSocialMode,
  };
});

vi.mock("../src/hooks/useSongBottles", () => ({
  useSongBottles: mockUseSongBottles,
}));

vi.mock("../src/lib/meHooks", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useMyAlbumAvatar: mockUseMyAlbumAvatar,
  };
});

// AlbumAvatarPicker is a heavy component — stub it out.
vi.mock("../src/components/AlbumAvatarPicker", () => ({
  AlbumAvatarPicker: () => <div data-testid="album-avatar-picker-stub" />,
}));

// twemoji helper only needed for <img> rendering — return a stable URL.
vi.mock("../src/lib/twemoji", () => ({
  emojiSvgUrl: (emoji: string) => `https://twemoji.example/${emoji}.svg`,
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { BottlePanel } from "../src/components/BottlePanel";
import { PostItIcon } from "../src/components/icons/PostItIcon";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_PROPS = {
  mbid: "test-mbid-1234",
  stationId: 7,
  stationName: "KEXP 90.3 FM",
  trackTitle: "Anchor Track",
  progressMs: 30000,
};

function renderPanel(props: Partial<typeof DEFAULT_PROPS> = {}) {
  return render(<BottlePanel {...DEFAULT_PROPS} {...props} />);
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockUseSocialMode.mockReturnValue({ enabled: true, toggle: vi.fn() });
  mockUseSongBottles.mockReturnValue({
    bottles: [],
    archivedCount: 0,
    hasUnread: false,
    markRead: vi.fn(),
    send: vi.fn(),
    loading: false,
    error: null,
  });
  mockUseMyAlbumAvatar.mockReturnValue({
    data: {
      current: {
        artworkUrl: "https://example.com/cover.jpg",
        albumTitle: "Test Album",
        artist: "Test Artist",
      },
      eligible: true,
    },
    isLoading: false,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Solo mode gate
// ---------------------------------------------------------------------------

describe("BottlePanel — solo mode gate (socialEnabled=false)", () => {
  it("renders nothing when socialEnabled is false", () => {
    mockUseSocialMode.mockReturnValue({ enabled: false, toggle: vi.fn() });
    const { container } = renderPanel();
    expect(container.firstChild).toBeNull();
  });

  it("does NOT render the bottle trigger in solo mode", () => {
    mockUseSocialMode.mockReturnValue({ enabled: false, toggle: vi.fn() });
    renderPanel();
    expect(screen.queryByTestId("bottle-trigger")).toBeNull();
  });

  it("does NOT render the bottle panel wrapper in solo mode", () => {
    mockUseSocialMode.mockReturnValue({ enabled: false, toggle: vi.fn() });
    renderPanel();
    expect(screen.queryByTestId("bottle-panel")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Missing MBID gate
// ---------------------------------------------------------------------------

describe("BottlePanel — missing MBID gate", () => {
  it("renders nothing when mbid is null even with social enabled", () => {
    const { container } = renderPanel({ mbid: null });
    expect(container.firstChild).toBeNull();
  });

  it("does NOT render the bottle trigger when mbid is null", () => {
    renderPanel({ mbid: null });
    expect(screen.queryByTestId("bottle-trigger")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Listening-party mode — panel presence
// ---------------------------------------------------------------------------

describe("BottlePanel — listening-party mode (socialEnabled=true)", () => {
  it("renders the bottle-panel wrapper", () => {
    renderPanel();
    expect(screen.getByTestId("bottle-panel")).toBeTruthy();
  });

  it("renders the trigger button", () => {
    renderPanel();
    expect(screen.getByTestId("bottle-trigger")).toBeTruthy();
  });

  it("expanded panel is NOT visible before the trigger is clicked", () => {
    renderPanel();
    expect(screen.queryByTestId("bottle-panel-expanded")).toBeNull();
  });

  it("clicking the trigger opens the expanded panel", () => {
    renderPanel();
    fireEvent.click(screen.getByTestId("bottle-trigger"));
    expect(screen.getByTestId("bottle-panel-expanded")).toBeTruthy();
  });

  it("clicking the trigger again closes the expanded panel", () => {
    renderPanel();
    fireEvent.click(screen.getByTestId("bottle-trigger"));
    expect(screen.getByTestId("bottle-panel-expanded")).toBeTruthy();
    fireEvent.click(screen.getByTestId("bottle-trigger"));
    expect(screen.queryByTestId("bottle-panel-expanded")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// PostItIcon in trigger (no existing bottles, not yet sealed)
// ---------------------------------------------------------------------------

describe("BottlePanel — PostItIcon shown when no bottles and not sealed", () => {
  it("trigger uses PostItIcon (aria-label 'Write a note') when bottles=[] and not sealed", () => {
    mockUseSongBottles.mockReturnValue({
      bottles: [],
      archivedCount: 0,
      hasUnread: false,
      markRead: vi.fn(),
      send: vi.fn(),
      loading: false,
      error: null,
    });
    renderPanel();
    const trigger = screen.getByTestId("bottle-trigger");
    expect(trigger.getAttribute("aria-label")).toBe("Write a note");
    // PostItIcon renders an SVG inside the trigger
    const svg = trigger.querySelector("svg");
    expect(svg).toBeTruthy();
  });

  it("trigger does NOT show a bottle count label when bottles=[]", () => {
    renderPanel();
    const trigger = screen.getByTestId("bottle-trigger");
    // The count span only appears when there are bottles
    const countSpan = trigger.querySelector("span");
    expect(countSpan).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// BottleIcon shown when existing bottles are present
// ---------------------------------------------------------------------------

describe("BottlePanel — BottleIcon shown when bottles exist", () => {
  it("trigger aria-label is 'Open bottle notes' when bottles are present", () => {
    mockUseSongBottles.mockReturnValue({
      bottles: [
        {
          id: 1,
          mbid: "test-mbid-1234",
          handle: "listener1",
          avatar: "🎵",
          body: "Great track!",
          progressMs: 10000,
          playsRemaining: 2,
          createdAt: new Date().toISOString(),
          stationId: 7,
        },
      ],
      archivedCount: 0,
      hasUnread: false,
      markRead: vi.fn(),
      send: vi.fn(),
      loading: false,
      error: null,
    });
    renderPanel();
    const trigger = screen.getByTestId("bottle-trigger");
    expect(trigger.getAttribute("aria-label")).toBe("Open bottle notes");
  });

  it("shows a bottle count label when bottles are present", () => {
    mockUseSongBottles.mockReturnValue({
      bottles: [
        {
          id: 1,
          mbid: "test-mbid-1234",
          handle: "listener1",
          avatar: "🎵",
          body: "Great track!",
          progressMs: 10000,
          playsRemaining: 2,
          createdAt: new Date().toISOString(),
          stationId: 7,
        },
      ],
      archivedCount: 0,
      hasUnread: false,
      markRead: vi.fn(),
      send: vi.fn(),
      loading: false,
      error: null,
    });
    renderPanel();
    const trigger = screen.getByTestId("bottle-trigger");
    expect(trigger.textContent).toContain("1 note");
  });
});

// ---------------------------------------------------------------------------
// Sealed state after sending a note
// ---------------------------------------------------------------------------

describe("BottlePanel — sealed state after sending a note", () => {
  it("clicking 'seal & send' optimistically seals the panel", async () => {
    const send = vi.fn(() => new Promise<void>(() => { /* never resolves in test */ }));
    (mockUseSongBottles as Mock).mockReturnValue({
      bottles: [],
      archivedCount: 0,
      hasUnread: false,
      markRead: vi.fn(),
      send,
      loading: false,
      error: null,
    });

    renderPanel();
    // Open the panel
    fireEvent.click(screen.getByTestId("bottle-trigger"));
    // Fill in the note
    const textarea = screen.getByTestId("bottle-input");
    fireEvent.change(textarea, { target: { value: "Hello from the test" } });
    // Send
    await act(async () => {
      fireEvent.click(screen.getByTestId("bottle-send"));
    });
    // Confirm message appears
    expect(screen.getByTestId("bottle-sent-confirm")).toBeTruthy();
    expect(screen.getByTestId("bottle-sent-confirm").textContent).toContain("sealed");
  });

  it("send button is disabled when the textarea is empty", () => {
    renderPanel();
    fireEvent.click(screen.getByTestId("bottle-trigger"));
    const sendBtn = screen.getByTestId("bottle-send") as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(true);
  });

  it("send button becomes enabled after typing text", () => {
    renderPanel();
    fireEvent.click(screen.getByTestId("bottle-trigger"));
    const textarea = screen.getByTestId("bottle-input");
    fireEvent.change(textarea, { target: { value: "Hello" } });
    const sendBtn = screen.getByTestId("bottle-send") as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Send error — reverts optimistic sealed state
// ---------------------------------------------------------------------------

describe("BottlePanel — send error reverts sealed state", () => {
  it("shows send error and reverts sealed state when server rejects the note", async () => {
    const send = vi.fn().mockRejectedValue(new Error("Network error"));
    (mockUseSongBottles as Mock).mockReturnValue({
      bottles: [],
      archivedCount: 0,
      hasUnread: false,
      markRead: vi.fn(),
      send,
      loading: false,
      error: null,
    });

    renderPanel();
    fireEvent.click(screen.getByTestId("bottle-trigger"));

    const textarea = screen.getByTestId("bottle-input");
    fireEvent.change(textarea, { target: { value: "Test message" } });

    await act(async () => {
      fireEvent.click(screen.getByTestId("bottle-send"));
    });

    // After the promise rejects, sealed is reverted and error shown
    await waitFor(() => {
      expect(screen.queryByTestId("bottle-sent-confirm")).toBeNull();
      expect(screen.getByTestId("bottle-send-error")).toBeTruthy();
    });
    expect(screen.getByTestId("bottle-send-error").textContent).toContain("Couldn't send");
  });

  it("shows 'Already sent' friendly message on 409-style error", async () => {
    const send = vi.fn().mockRejectedValue(new Error("409 conflict"));
    (mockUseSongBottles as Mock).mockReturnValue({
      bottles: [],
      archivedCount: 0,
      hasUnread: false,
      markRead: vi.fn(),
      send,
      loading: false,
      error: null,
    });

    renderPanel();
    fireEvent.click(screen.getByTestId("bottle-trigger"));
    fireEvent.change(screen.getByTestId("bottle-input"), {
      target: { value: "Duplicate note" },
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("bottle-send"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("bottle-send-error")).toBeTruthy();
    });
    expect(screen.getByTestId("bottle-send-error").textContent).toContain(
      "Already sent",
    );
  });
});

// ---------------------------------------------------------------------------
// Panel markup
// ---------------------------------------------------------------------------

describe("BottlePanel — expanded panel content", () => {
  it("shows the track title in the panel header", () => {
    renderPanel({ trackTitle: "My Favourite Song" });
    fireEvent.click(screen.getByTestId("bottle-trigger"));
    expect(screen.getByTestId("bottle-panel-expanded").textContent).toContain(
      "My Favourite Song",
    );
  });

  it("shows 'no notes yet' placeholder when bottles=[]", () => {
    renderPanel();
    fireEvent.click(screen.getByTestId("bottle-trigger"));
    expect(
      screen.getByTestId("bottle-panel-expanded").textContent,
    ).toContain("no notes yet");
  });

  it("close (×) button hides the expanded panel", () => {
    renderPanel();
    fireEvent.click(screen.getByTestId("bottle-trigger"));
    expect(screen.getByTestId("bottle-panel-expanded")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByTestId("bottle-panel-expanded")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// PostItIcon SVG geometry
// ---------------------------------------------------------------------------

describe("PostItIcon — SVG geometry", () => {
  it("renders an SVG element", () => {
    const { container } = render(<PostItIcon />);
    expect(container.querySelector("svg")).toBeTruthy();
  });

  it("uses a 24x24 viewBox by default", () => {
    const { container } = render(<PostItIcon />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(svg.getAttribute("width")).toBe("24");
    expect(svg.getAttribute("height")).toBe("24");
  });

  it("respects the size prop", () => {
    const { container } = render(<PostItIcon size={16} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("16");
    expect(svg.getAttribute("height")).toBe("16");
  });

  it("has three scribble-line paths (M7 10h8, M7 13h6, M7 16h7)", () => {
    const { container } = render(<PostItIcon />);
    const paths = Array.from(container.querySelectorAll("path")).map((p) =>
      p.getAttribute("d"),
    );
    expect(paths).toContain("M7 10h8");
    expect(paths).toContain("M7 13h6");
    expect(paths).toContain("M7 16h7");
  });

  it("has the dog-ear body path", () => {
    const { container } = render(<PostItIcon />);
    const paths = Array.from(container.querySelectorAll("path")).map((p) =>
      p.getAttribute("d"),
    );
    // Note body with dog-ear cutout
    expect(
      paths.some((d) => d && d.startsWith("M5 4h10")),
    ).toBe(true);
  });

  it("does NOT contain a pencil shape (no M17 3 path)", () => {
    // Lucide's pencil icon uses a path starting with M17 3 — PostItIcon must
    // not include it.
    const { container } = render(<PostItIcon />);
    const paths = Array.from(container.querySelectorAll("path")).map((p) =>
      p.getAttribute("d") ?? "",
    );
    expect(paths.every((d) => !d.startsWith("M17 3"))).toBe(true);
  });

  it("has exactly five paths (body + dog-ear fold + 3 scribble lines)", () => {
    const { container } = render(<PostItIcon />);
    const paths = container.querySelectorAll("path");
    expect(paths.length).toBe(5);
  });

  it("uses stroke='currentColor' so it inherits the parent color", () => {
    const { container } = render(<PostItIcon />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("stroke")).toBe("currentColor");
  });

  it("is aria-hidden so screen readers skip it", () => {
    const { container } = render(<PostItIcon />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
  });
});
