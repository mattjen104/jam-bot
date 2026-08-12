/**
 * DialCliBar — front-door CLI overlay.
 *
 * Paradigm: an ambient background layer behind the full-height dial feed.
 * The oversized Signifier "Lore" wordmark anchors at the bottom-left of the
 * Dial region; typing replaces it with the slash command text in the same
 * face and size.
 *
 * The overlay itself is pointer-transparent (pointer-events: none) so it
 * NEVER intercepts taps on the dial rows above it — the wordmark is the
 * only click target (it focuses the invisible input). Once focused,
 * keystrokes land in the input as usual.
 *
 * Where the wordmark overlaps scrolling dial artist names the CSS renders
 * that overlap with an intentional graphic treatment (mix-blend-mode: screen)
 * so the collision looks designed, not accidental.
 *
 * No cursor glyph. No blinking. No border. No header bar.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import type { DialFilterBarProps } from "./DialFilterBar";

const COMMANDS = {
  "/current":  { kind: "tier",     value: "current"  },
  "/catalog":  { kind: "tier",     value: "catalog"  },
  "/deep":     { kind: "tier",     value: "deep"     },
  "/first":    { kind: "tier",     value: "first"    },
  "/lore":     { kind: "category", value: "lore"     },
  "/classics": { kind: "category", value: "classics" },
  "/ambient":  { kind: "category", value: "ambient"  },
} as const;

export function DialCliBar({
  onToggleTier,
  onToggleCategory,
}: DialFilterBarProps) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const focusInput = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  const executeCommand = useCallback(() => {
    const key = value.trim().toLowerCase() as keyof typeof COMMANDS;
    const cmd = COMMANDS[key];

    if (cmd) {
      if (cmd.kind === "tier") {
        onToggleTier(cmd.value as Parameters<typeof onToggleTier>[0]);
      } else {
        onToggleCategory(cmd.value as Parameters<typeof onToggleCategory>[0]);
      }
    }
    // Unrecognised commands are silently cleared.
    setValue("");
  }, [onToggleCategory, onToggleTier, value]);

  const handleSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    executeCommand();
  }, [executeCommand]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    executeCommand();
  }, [executeCommand]);

  // The overlay never receives pointer events (feed rows scroll over it), so
  // the "/" key is the entry point: pressing it anywhere outside another
  // editable field focuses the invisible input and starts the command.
  useEffect(() => {
    const handleGlobalKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "/") return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      event.preventDefault();
      focusInput();
      setValue("/");
    };
    window.addEventListener("keydown", handleGlobalKey);
    return () => window.removeEventListener("keydown", handleGlobalKey);
  }, [focusInput]);

  const isEmpty = value === "";

  return (
    <div
      className="dial-cli-overlay"
      role="search"
      aria-label="Dial commands"
    >
      {/* The wordmark anchors at the bottom of the Dial region.
          When the user types it transitions to showing the typed command.
          mix-blend-mode: screen on this element makes overlapping dial rows
          render as an intentional light-on-light graphic merge. */}
      <span
        className={`dial-cli-overlay__wordmark${isEmpty ? "" : " dial-cli-overlay__wordmark--typing"}`}
        aria-hidden="true"
      >
        {isEmpty ? "Lore" : value}
      </span>

      {/* Invisible input — completely transparent; the wordmark above is the
          only visible affordance. The caret is hidden; the wordmark replaces
          itself as the user types. */}
      <form className="dial-cli-overlay__form" onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          type="text"
          className="dial-cli-overlay__input"
          aria-label="Dial command"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleKeyDown}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
        />
      </form>
    </div>
  );
}
