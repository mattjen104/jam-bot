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
 * variant="strip" — the SplitHome CLI seam: a single-line input with a
 * left-aligned `>_` prompt.
 * Pointer events are live (the strip is a real input row, not an ambient
 * layer); the "/" hotkey works here too.
 *
 * Commands:
 *   /first /current /catalog /deep      → age-tier toggles
 *   /ambient /campus /specialist /core
 *   /public /indie /discovery           → station-category select (radio-style
 *                                         single-select — one active at a time)
 *   /lore                               → navigate home (NOT a category)
 *   /add <names>                        → seed artists (comma/newline split;
 *                                         whitespace split when no commas)
 *   /scan1 /scan2 … /scanN              → compact-dial window offset (N-1)*5
 *   /library                            → navigate to the Stack (when wired)
 *   /matt                               → copy the configured Matt starter library
 *   /radio                              → blank radio mode: crossings suppressed,
 *                                         every row leads with the live sentence
 *   /crossings                          → crossing-ranked feed (the default)
 * Unknown commands are silently cleared.
 *
 * /radio and /crossings are handled BEFORE the tier/category maps and are
 * never registered in CATEGORY_BY_COMMAND / TIER_BY_COMMAND, so they can
 * never fall through to a filter toggle.
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
import { AGE_TIER_DEFINITIONS, type AgeTier } from "../../lib/dialAgeFilter";
import {
  STATION_CATEGORY_DEFINITIONS,
  type StationCategory,
} from "../../lib/dialCategories";

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

export interface DialCliBarProps extends Pick<DialFilterBarProps,
  "activeTiers" | "activeCategories" | "onToggleTier" | "onToggleCategory" | "className"> {
  /** Visual skin: front-door ambient overlay (default) or SplitHome strip. */
  variant?: "overlay" | "strip";
  /**
   * Called when `/add <artist names>` is submitted with the parsed,
   * trimmed, deduplicated artist list.
   */
  onAddArtists?: (names: string[]) => void;
  /**
   * Called when `/scanN` is submitted (any page number N ≥ 1).
   * Receives the zero-based station offset: (N - 1) * scanPageSize.
   */
  onScan?: (offset: number) => void;
  /**
   * Rows per scan page — the page-size unit `/scanN` multiplies by. Matches
   * the dial band's density (5 normal, 10 compact, 15 micro);
   * defaults to 5 (the classic five-row window).
   */
  scanPageSize?: number;
  /** Called when `/library` is submitted (SplitHome wires this to navigate). */
  onLibrary?: () => void;
  /**
   * Called when `/lore` is submitted — the home command. Navigation, not a
   * category toggle: the categories are an additive multi-select taxonomy
   * that no longer includes "lore".
   */
  onHome?: () => void;
  /** Called when `/matt` is submitted. The source library is server-configured. */
  onMatt?: () => void;
  /**
   * Called when `/radio` (on=true — crossings suppressed) or `/crossings`
   * (on=false — crossing-ranked feed, the default) is submitted.
   */
  onRadioMode?: (on: boolean) => void;
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
  scanPageSize = 5,
  onLibrary,
  onHome,
  onMatt,
  onRadioMode,
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

    // /scanN commands — compact-dial window offset. Any page number N ≥ 1
    // is accepted; the offset is (N - 1) * scanPageSize so the page number
    // tracks the dial band's active density (5-row, 10-row, or all).
    const scanMatch = /^\/scan(\d+)$/.exec(lower);
    if (scanMatch) {
      const page = Number.parseInt(scanMatch[1], 10);
      if (page >= 1) onScan?.((page - 1) * scanPageSize);
      setValue("");
      return;
    }

    if (lower === "/library") { onLibrary?.(); setValue(""); return; }
    // Home command — navigation, handled before the category map so it can
    // never be mistaken for a filter toggle.
    if (lower === "/lore") { onHome?.(); setValue(""); return; }
    if (lower === "/matt") {
      if (!mattPending) onMatt?.();
      setValue("");
      return;
    }

    // Feed-mode commands — handled before the tier/category maps so they can
    // never fall through to a filter toggle.
    if (lower === "/radio") { onRadioMode?.(true); setValue(""); return; }
    if (lower === "/crossings") { onRadioMode?.(false); setValue(""); return; }

    // A bare artist name is the front-door shorthand for adding one taste
    // seed. Feed mode still only uses slash commands because it wires the
    // same component without an onboarding callback.
    if (!trimmed.startsWith("/") && trimmed && onAddArtists) {
      onAddArtists([trimmed]);
      setValue("");
      return;
    }

    const tier = TIER_BY_COMMAND.get(lower);

    if (tier) {
      onToggleTier(tier);
    } else {
      const category = CATEGORY_BY_COMMAND.get(lower);
      if (category) onToggleCategory(category);
    }
    // Unrecognised commands are silently cleared.
    setValue("");
  }, [onToggleCategory, onToggleTier, onAddArtists, onScan, scanPageSize, onLibrary, onHome, onMatt, onRadioMode, mattPending, value]);

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
          clean when idle). Strip: a left-aligned `>_` prompt fills the idle
          state, replaced by the typed command text. */}
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
          &gt;_
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


const CATEGORY_BY_COMMAND = new Map<string, StationCategory>(
  STATION_CATEGORY_DEFINITIONS.map(({ command, cat }) => [command, cat]),
);

const TIER_BY_COMMAND = new Map<string, AgeTier>(
  AGE_TIER_DEFINITIONS.map(({ command, tier }) => [command, tier]),
);
