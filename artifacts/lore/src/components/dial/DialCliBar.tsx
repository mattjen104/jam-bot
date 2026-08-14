/**
 * DialCliBar — the Lore slash-command input, in two skins:
 *
 * variant="overlay" (default) — the front-door ambient background layer
 * behind the full-height dial feed. The oversized Signifier wordmark anchors
 * at the bottom-left of the Dial region; typing replaces it with the slash
 * command text in the same face and size. The overlay is pointer-transparent
 * (pointer-events: none) so it NEVER intercepts taps on the dial rows above
 * it; the "/" hotkey is the entry point.
 *
 * variant="strip" — the SplitHome CLI seam: a single-line centred input with
 * a `/lore` ghost-text placeholder in the same Signifier wordmark style.
 * Pointer events are live (the strip is a real input row, not an ambient
 * layer); the "/" hotkey works here too.
 *
 * Commands:
 *   /first /current /catalog /deep      → age-tier toggles
 *   /lore /classics /ambient /spinitron
 *   /college /longtail                  → station-category toggles
 *   /add <names>                        → seed artists (comma/newline split;
 *                                         whitespace split when no commas)
 *   /scan1 /scan2 /scan3                → compact-dial window offset 0/5/10
 *   /library                            → navigate to the Stack (when wired)
 *   /matt                               → copy the configured Matt starter library
 * Unknown commands are silently cleared.
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
  type RefObject,
} from "react";
import type { DialFilterBarProps } from "./DialFilterBar";

const COMMANDS = {
  "/current":   { kind: "tier",     value: "current"   },
  "/catalog":   { kind: "tier",     value: "catalog"   },
  "/deep":      { kind: "tier",     value: "deep"      },
  "/first":     { kind: "tier",     value: "first"     },
  "/lore":      { kind: "category", value: "lore"      },
  "/classics":  { kind: "category", value: "classics"  },
  "/ambient":   { kind: "category", value: "ambient"   },
  "/spinitron": { kind: "category", value: "spinitron" },
  "/college":   { kind: "category", value: "college"   },
  "/longtail":  { kind: "category", value: "longtail"  },
} as const;

/**
 * Split the `/add` remainder into artist names.
 * Commas/newlines are the explicit separators (preserving multi-word names
 * like "Wet Leg"); when none are present, whitespace splits instead so
 * `/add Radiohead Portishead` still works. Tokens are trimmed and deduped
 * (case-insensitive, first spelling wins).
 */
export function parseAddArtists(remainder: string): string[] {
  const hasExplicitSeparator = /[,\n]/.test(remainder);
  const tokens = hasExplicitSeparator
    ? remainder.split(/[,\n]+/)
    : remainder.split(/\s+/);
  const seen = new Set<string>();
  const names: string[] = [];
  for (const token of tokens) {
    const name = token.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

export interface DialCliBarProps extends DialFilterBarProps {
  /** Visual skin: front-door ambient overlay (default) or SplitHome strip. */
  variant?: "overlay" | "strip";
  /**
   * Called when `/add <artist names>` is submitted with the parsed,
   * trimmed, deduplicated artist list.
   */
  onAddArtists?: (names: string[]) => void;
  /**
   * Called when `/scan1`, `/scan2`, or `/scan3` is submitted.
   * Receives the zero-based station offset: 0, 5, or 10.
   */
  onScan?: (offset: number) => void;
  /** Called when `/library` is submitted (SplitHome wires this to navigate). */
  onLibrary?: () => void;
  /** Called when `/matt` is submitted. The source library is server-configured. */
  onMatt?: () => void;
  /** Prevents a second `/matt` submission while the copy is in flight. */
  mattPending?: boolean;
  /** Accessible feedback for the `/matt` action. */
  mattStatus?: MattCliStatus | null;
  /**
   * External ref to the command input, so a parent (HomeCliStrip) can focus
   * it and insert a command prefix.
   */
  inputRef?: RefObject<HTMLInputElement | null>;
  /**
   * One-shot prefill: when `token` changes, the input is focused and its
   * value replaced with `text` (e.g. "/add " from the add-artists button).
   */
  prefill?: { token: number; text: string } | null;
}

export interface MattCliStatus {
  kind: "pending" | "success" | "error";
  message: string;
}

export function DialCliBar({
  onToggleTier,
  onToggleCategory,
  variant = "overlay",
  onAddArtists,
  onScan,
  onLibrary,
  onMatt,
  mattPending = false,
  mattStatus = null,
  inputRef: externalInputRef,
  prefill,
}: DialCliBarProps) {
  const [value, setValue] = useState("");
  const internalInputRef = useRef<HTMLInputElement>(null);
  const inputRef = externalInputRef ?? internalInputRef;

  const focusInput = useCallback(() => {
    inputRef.current?.focus();
  }, [inputRef]);

  // One-shot prefill from a parent button (e.g. "add artists" → "/add ").
  const lastPrefillToken = useRef<number | null>(null);
  useEffect(() => {
    if (!prefill || prefill.token === lastPrefillToken.current) return;
    lastPrefillToken.current = prefill.token;
    setValue(prefill.text);
    focusInput();
  }, [prefill, focusInput]);

  const executeCommand = useCallback(() => {
    const trimmed = value.trim();
    const lower = trimmed.toLowerCase();

    // /add command — parse the remainder into artist names.
    if (lower === "/add" || lower.startsWith("/add ")) {
      const remainder = trimmed.slice(4).trim();
      if (remainder && onAddArtists) {
        const names = parseAddArtists(remainder);
        if (names.length > 0) onAddArtists(names);
      }
      setValue("");
      return;
    }

    // /scan commands — compact-dial window offset.
    if (lower === "/scan1") { onScan?.(0); setValue(""); return; }
    if (lower === "/scan2") { onScan?.(5); setValue(""); return; }
    if (lower === "/scan3") { onScan?.(10); setValue(""); return; }

    if (lower === "/library") { onLibrary?.(); setValue(""); return; }
    if (lower === "/matt") {
      if (!mattPending) onMatt?.();
      setValue("");
      return;
    }

    const key = lower as keyof typeof COMMANDS;
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
  }, [onToggleCategory, onToggleTier, onAddArtists, onScan, onLibrary, onMatt, mattPending, value]);

  const handleSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    executeCommand();
  }, [executeCommand]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    executeCommand();
  }, [executeCommand]);

  // The "/" hotkey focuses the input from anywhere on the page (outside
  // another editable field) and starts the command.
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
  const isStrip = variant === "strip";

  return (
    <div
      className={`dial-cli-overlay${isStrip ? " dial-cli-overlay--strip" : ""}`}
      role="search"
      aria-label="Dial commands"
    >
      {/* Overlay: wordmark appears only while typing (ambient layer stays
          clean when idle). Strip: a `/lore` Signifier ghost placeholder fills
          the idle state, replaced by the typed command text. */}
      {!isEmpty && (
        <span
          className="dial-cli-overlay__wordmark dial-cli-overlay__wordmark--typing"
          aria-hidden="true"
        >
          {value}
        </span>
      )}
      {isEmpty && isStrip && (
        <span
          className="dial-cli-overlay__wordmark dial-cli-overlay__wordmark--ghost"
          aria-hidden="true"
        >
          /lore
        </span>
      )}

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
      {mattStatus && (
        <div
          className={`dial-cli-overlay__status dial-cli-overlay__status--${mattStatus.kind}`}
          role={mattStatus.kind === "error" ? "alert" : "status"}
          aria-live={mattStatus.kind === "error" ? "assertive" : "polite"}
        >
          {mattStatus.message}
        </div>
      )}
    </div>
  );
}
