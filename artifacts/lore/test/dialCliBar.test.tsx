// @vitest-environment jsdom
/**
 * DialCliBar — the front-door CLI overlay that replaces the visible
 * filter-button bar. The whole sidebar is an invisible input field; the
 * oversized "Lore" wordmark is the empty-state label and is replaced by
 * the typed command text (no cursor glyph).
 *
 * Covers:
 *  1. Renders the wordmark (empty state) and the command input.
 *  2. Slash commands fire the matching toggle callback and clear the field.
 *  3. Age-tier vs station-category commands route to the right callback.
 *  4. Unrecognised input is silently ignored (no callback).
 *  5. Commands are case-insensitive and whitespace-tolerant.
 *  6. Form submit (mobile "go"/tap path) executes like Enter.
 *  7. Typing replaces the wordmark text with the typed command.
 *
 * Toggle semantics themselves (additive tiers, single-select categories)
 * stay in dialFilterState and are tested there.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { DialCliBar } from "../src/components/dial/DialCliBar";
import type { StationCategory } from "../src/lib/dialCategories";
import type { AgeTier } from "../src/lib/dialAgeFilter";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderCli(overrides: Partial<React.ComponentProps<typeof DialCliBar>> = {}) {
  const props = {
    activeTiers: new Set<AgeTier>(),
    activeCategories: new Set<StationCategory>(["anchor"]),
    onToggleTier: vi.fn(),
    onToggleCategory: vi.fn(),
    ...overrides,
  };
  const utils = render(<DialCliBar {...props} />);
  const input = screen.getByRole("textbox", { name: "Dial command" }) as HTMLInputElement;
  return { ...utils, props, input };
}

function type(input: HTMLInputElement, value: string) {
  fireEvent.change(input, { target: { value } });
}

describe("DialCliBar", () => {
  it("treats a plain multi-word value as one artist when artist entry is wired", () => {
    const onAddArtists = vi.fn();
    const { input } = renderCli({ onAddArtists });
    type(input, "A Tribe Called Quest");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onAddArtists).toHaveBeenCalledWith(["A Tribe Called Quest"]);
    expect(input.value).toBe("");
  });

  it("renders the command input with no wordmark when idle, and no cursor glyph", () => {
    renderCli();
    const bar = document.querySelector(".dial-cli-overlay");
    expect(bar).toBeTruthy();
    // Wordmark is hidden when idle (the "Lore" text is suppressed).
    expect(bar?.querySelector(".dial-cli-overlay__wordmark")).toBeNull();
    expect(bar?.querySelector(".dial-cli-bar__cursor")).toBeNull();
    expect(screen.getByRole("textbox", { name: "Dial command" })).toBeTruthy();
  });

  it("shows the typed command text in the wordmark slot, hides again when cleared", () => {
    const { input } = renderCli();
    // Idle: no wordmark element in the DOM.
    expect(document.querySelector(".dial-cli-overlay__wordmark")).toBeNull();
    type(input, "/genre");
    // Typing: wordmark appears with the command text.
    const wordmark = document.querySelector(".dial-cli-overlay__wordmark");
    expect(wordmark?.textContent).toBe("/genre");
    expect(wordmark?.className).toContain("dial-cli-overlay__wordmark--typing");
    // Clearing: wordmark disappears again.
    type(input, "");
    expect(document.querySelector(".dial-cli-overlay__wordmark")).toBeNull();
  });

  it.each([
    ["/first", "first"],
    ["/current", "current"],
    ["/catalog", "catalog"],
    ["/deep", "deep"],
  ] as const)("routes %s to onToggleTier and clears the field", (command, tier) => {
    const { props, input } = renderCli();
    type(input, command);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(props.onToggleTier).toHaveBeenCalledWith(tier);
    expect(props.onToggleCategory).not.toHaveBeenCalled();
    expect(input.value).toBe("");
  });

  it.each([
    ["/ambient",    "ambient"    ],
    ["/campus",     "campus"     ],
    ["/specialist", "specialist" ],
    ["/core",       "anchor"     ],
    ["/public",     "public"     ],
    ["/indie",      "indie"      ],
    ["/discovery",  "discovery"  ],
  ] as const)("routes %s to onToggleCategory and clears the field", (command, cat) => {
    const { props, input } = renderCli();
    type(input, command);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(props.onToggleCategory).toHaveBeenCalledWith(cat);
    expect(props.onToggleTier).not.toHaveBeenCalled();
    expect(input.value).toBe("");
  });

  it("routes /lore to onHome (home navigation, not a category toggle)", () => {
    const onHome = vi.fn();
    const { props, input } = renderCli({ onHome });
    type(input, "/lore");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onHome).toHaveBeenCalled();
    expect(props.onToggleCategory).not.toHaveBeenCalled();
    expect(input.value).toBe("");
  });

  it("silently ignores unrecognised input on Enter", () => {
    const { props, input } = renderCli();
    type(input, "/nonsense");
    fireEvent.keyDown(input, { key: "Enter" });
    type(input, "campus"); // missing slash — not a command
    fireEvent.keyDown(input, { key: "Enter" });
    type(input, "/genre"); // retired command — silently ignored
    fireEvent.keyDown(input, { key: "Enter" });
    type(input, "/spinitron"); // retired command — silently ignored
    fireEvent.keyDown(input, { key: "Enter" });
    type(input, "/college"); // retired command — silently ignored
    fireEvent.keyDown(input, { key: "Enter" });
    type(input, "/flagship"); // retired command — silently ignored
    fireEvent.keyDown(input, { key: "Enter" });
    type(input, "/classics"); // retired command — silently ignored
    fireEvent.keyDown(input, { key: "Enter" });
    type(input, "/longtail"); // retired command — silently ignored
    fireEvent.keyDown(input, { key: "Enter" });
    expect(props.onToggleTier).not.toHaveBeenCalled();
    expect(props.onToggleCategory).not.toHaveBeenCalled();
  });

  it("accepts commands case-insensitively with surrounding whitespace", () => {
    const { props, input } = renderCli();
    type(input, "  /CAMPUS  ");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(props.onToggleCategory).toHaveBeenCalledWith("campus");
  });

  it("executes on form submit (mobile enter/tap path)", () => {
    const { props, input } = renderCli();
    type(input, "/deep");
    const form = document.querySelector(".dial-cli-overlay__form");
    expect(form).toBeTruthy();
    fireEvent.submit(form as HTMLFormElement);
    expect(props.onToggleTier).toHaveBeenCalledWith("deep");
    expect(input.value).toBe("");
  });

  it("does not execute on other keys", () => {
    const { props, input } = renderCli();
    type(input, "/deep");
    fireEvent.keyDown(input, { key: "Tab" });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(props.onToggleTier).not.toHaveBeenCalled();
    expect(input.value).toBe("/deep");
  });

  describe("/add command", () => {
    it("splits comma-separated names, trims, and calls onAddArtists", () => {
      const onAddArtists = vi.fn();
      const { input } = renderCli({ onAddArtists });
      type(input, "/add Radiohead,  Portishead , Wet Leg");
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onAddArtists).toHaveBeenCalledWith(["Radiohead", "Portishead", "Wet Leg"]);
      expect(input.value).toBe("");
    });

    it("splits on whitespace when no commas are present", () => {
      const onAddArtists = vi.fn();
      const { input } = renderCli({ onAddArtists });
      type(input, "/add Radiohead Portishead");
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onAddArtists).toHaveBeenCalledWith(["Radiohead", "Portishead"]);
    });

    it("deduplicates names case-insensitively (first spelling wins)", () => {
      const onAddArtists = vi.fn();
      const { input } = renderCli({ onAddArtists });
      type(input, "/add Radiohead, radiohead, Portishead");
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onAddArtists).toHaveBeenCalledWith(["Radiohead", "Portishead"]);
    });

    it("clears silently with no callback when /add has no names", () => {
      const onAddArtists = vi.fn();
      const { input } = renderCli({ onAddArtists });
      type(input, "/add");
      fireEvent.keyDown(input, { key: "Enter" });
      type(input, "/add   ");
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onAddArtists).not.toHaveBeenCalled();
      expect(input.value).toBe("");
    });
  });

  describe("/scan commands", () => {
    it.each([
      ["/scan1", 0],
      ["/scan2", 5],
      ["/scan3", 10],
      ["/scan4", 15],
      ["/scan10", 45],
    ] as const)("routes %s to onScan(%i) and clears the field", (command, offset) => {
      const onScan = vi.fn();
      const { input } = renderCli({ onScan });
      type(input, command);
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onScan).toHaveBeenCalledWith(offset);
      expect(input.value).toBe("");
    });

    it("ignores /scan0 and /scan without a page number", () => {
      const onScan = vi.fn();
      const { input } = renderCli({ onScan });
      type(input, "/scan0");
      fireEvent.keyDown(input, { key: "Enter" });
      type(input, "/scan");
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onScan).not.toHaveBeenCalled();
      expect(input.value).toBe("");
    });
  });

  it("routes /library to onLibrary", () => {
    const onLibrary = vi.fn();
    const { input } = renderCli({ onLibrary });
    type(input, "/library");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onLibrary).toHaveBeenCalled();
    expect(input.value).toBe("");
  });

  it("routes /matt case-insensitively, clears the field, and does not pass a source user", () => {
    const onMatt = vi.fn();
    const { input } = renderCli({ onMatt });
    type(input, "  /MATT  ");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onMatt).toHaveBeenCalledTimes(1);
    expect(onMatt).toHaveBeenCalledWith();
    expect(input.value).toBe("");
  });

  it("does not invoke /matt twice while the starter copy is pending", () => {
    const onMatt = vi.fn();
    const { input } = renderCli({ onMatt, mattPending: true });
    type(input, "/matt");
    fireEvent.keyDown(input, { key: "Enter" });
    type(input, "/matt");
    fireEvent.submit(document.querySelector(".dial-cli-overlay__form") as HTMLFormElement);
    expect(onMatt).not.toHaveBeenCalled();
    expect(input.value).toBe("");
  });

  it("renders accessible Matt pending and error feedback", () => {
    const { input, rerender, props } = renderCli({
      mattPending: true,
      mattStatus: { kind: "pending", message: "Adding Matt’s starter library…" },
    });
    expect(screen.getByRole("status").textContent).toContain("Adding Matt’s starter library");
    type(input, "/matt");
    fireEvent.keyDown(input, { key: "Enter" });
    rerender(
      <DialCliBar
        {...props}
        mattStatus={{ kind: "error", message: "Matt’s starter library is unavailable." }}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("Matt’s starter library is unavailable.");
  });

  it("strip variant renders the left-aligned >_ prompt when idle", () => {
    renderCli({ variant: "strip" });
    const ghost = document.querySelector(".dial-cli-overlay__wordmark--ghost");
    expect(ghost?.textContent).toBe(">_");
  });

  describe("/radio and /crossings mode commands", () => {
    it("routes /radio to onRadioMode(true) and clears the field", () => {
      const onRadioMode = vi.fn();
      const { props, input } = renderCli({ onRadioMode });
      type(input, "/radio");
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onRadioMode).toHaveBeenCalledWith(true);
      expect(props.onToggleTier).not.toHaveBeenCalled();
      expect(props.onToggleCategory).not.toHaveBeenCalled();
      expect(input.value).toBe("");
    });

    it("routes /crossings to onRadioMode(false) and clears the field", () => {
      const onRadioMode = vi.fn();
      const { props, input } = renderCli({ onRadioMode });
      type(input, "/crossings");
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onRadioMode).toHaveBeenCalledWith(false);
      expect(props.onToggleTier).not.toHaveBeenCalled();
      expect(props.onToggleCategory).not.toHaveBeenCalled();
      expect(input.value).toBe("");
    });

    it("accepts the mode commands case-insensitively with surrounding whitespace", () => {
      const onRadioMode = vi.fn();
      const { input } = renderCli({ onRadioMode });
      type(input, "  /RADIO  ");
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onRadioMode).toHaveBeenCalledWith(true);
      type(input, "  /Crossings  ");
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onRadioMode).toHaveBeenCalledWith(false);
    });

    it("executes /radio on form submit (mobile enter/tap path)", () => {
      const onRadioMode = vi.fn();
      const { input } = renderCli({ onRadioMode });
      type(input, "/radio");
      fireEvent.submit(document.querySelector(".dial-cli-overlay__form") as HTMLFormElement);
      expect(onRadioMode).toHaveBeenCalledWith(true);
      expect(input.value).toBe("");
    });

    it("clears silently without a callback when onRadioMode is not wired", () => {
      const { props, input } = renderCli();
      type(input, "/radio");
      fireEvent.keyDown(input, { key: "Enter" });
      expect(props.onToggleTier).not.toHaveBeenCalled();
      expect(props.onToggleCategory).not.toHaveBeenCalled();
      expect(input.value).toBe("");
    });
  });
});
