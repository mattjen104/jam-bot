import {
  eligibleDjName,
  normalizeAttributionName,
} from "@workspace/lore-attribution";

/**
 * Shared normalization for scraped schedule names (show_name / dj_name).
 *
 * Two consumers MUST stay in lockstep:
 *   - parse-time: `sanitizeName` in schedule-scraper.ts (JS, at extraction)
 *   - boot-time:  `cleanupInvisibleCharactersInShowNames` in
 *     station-schedule-migration.ts (Postgres regexp on stored rows)
 *
 * Both map every "invisible/odd whitespace" codepoint to a regular space,
 * collapse whitespace runs, and trim. The character class below is the single
 * source of truth; the Postgres pattern is derived from the same list so the
 * two implementations cannot drift (a unit test locks the derivation).
 *
 * Covered codepoints (beyond ASCII space):
 *   U+00A0 no-break space          U+1680 ogham space mark
 *   U+2000–U+200A en/em/thin spaces
 *   U+200B–U+200D zero-width space/non-joiner/joiner
 *   U+200E/U+200F LTR/RTL directional marks
 *   U+2028/U+2029 line/paragraph separator
 *   U+202F narrow no-break space   U+205F medium mathematical space
 *   U+2060 word joiner             U+3000 ideographic space
 *   U+FEFF BOM / zero-width no-break space
 *
 * Why a space (not empty string): a zero-width char often stands in for a
 * word break ("Morning\u200BJazz"), so mapping to a space normalises to the
 * same form as "Morning Jazz"; the whitespace collapse then squashes runs.
 * JS `\s` misses U+200B–U+200F and U+2060, and Postgres `[[:space:]]` misses
 * most of these, which is why the explicit class is needed in both places.
 */

/** Ranges as [start, end] codepoints (single chars are [c, c]). */
const INVISIBLE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x00a0, 0x00a0],
  [0x1680, 0x1680],
  [0x2000, 0x200f], // en quad..hair space, zero-widths, LRM/RLM
  [0x2028, 0x2029],
  [0x202f, 0x202f],
  [0x205f, 0x205f],
  [0x2060, 0x2060],
  [0x3000, 0x3000],
  [0xfeff, 0xfeff],
];

const hex4 = (n: number): string => n.toString(16).toUpperCase().padStart(4, "0");

const classBody = (esc: (n: number) => string): string =>
  INVISIBLE_RANGES.map(([a, b]) => (a === b ? esc(a) : `${esc(a)}-${esc(b)}`)).join("");

/** JS character class regex matching every covered codepoint, global. */
export const INVISIBLE_CHARS_RE = new RegExp(
  `[${classBody((n) => `\\u${hex4(n)}`)}]`,
  "g",
);

/**
 * The same character class as a Postgres ARE pattern string (Postgres AREs
 * support \uXXXX escapes). Interpolate via sql.raw inside a quoted literal.
 * Derived from the identical range list as INVISIBLE_CHARS_RE.
 */
export const INVISIBLE_CHARS_PG_CLASS = `[${classBody((n) => `\\u${hex4(n)}`)}]`;

/**
 * Canonical normalization: invisible/odd whitespace → space, whitespace
 * collapsed, trimmed. Pure, no I/O.
 */
export function sanitizeScheduleName(s: string): string {
  return s.replace(INVISIBLE_CHARS_RE, " ").replace(/\s+/g, " ").trim();
}

const DJ_LIST_SEPARATOR_RE = /\s*(?:,|;)\s*|\s+(?:&|\+|\/|\band\b)\s+/iu;
const MALFORMED_DJ_NAME_RE = /(?:https?:\/\/|www\.|@)/iu;
const MAX_DJ_NAMES = 8;

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 0x1f || code === 0x7f;
  });
}

/**
 * Turn a schedule's host credit into validated individual identities.
 *
 * Public calendars commonly flatten co-hosts into one string ("Alice & Bob").
 * Split only explicit list separators, validate every resulting identity with
 * the shared attribution rule, and preserve first-seen display spelling.
 */
export function parseScheduleDjNames(
  value: string | null | undefined,
  showTitle?: string | null,
): string[] {
  if (!value) return [];

  const parts = sanitizeScheduleName(value).split(DJ_LIST_SEPARATOR_RE);
  if (parts.length > MAX_DJ_NAMES) return [];

  const seen = new Set<string>();
  const names: string[] = [];
  for (const part of parts) {
    const candidate = sanitizeScheduleName(part);
    if (
      !candidate ||
      candidate.length > 100 ||
      MALFORMED_DJ_NAME_RE.test(candidate) ||
      hasControlCharacter(candidate)
    ) {
      continue;
    }
    const eligible = eligibleDjName(candidate, { showTitle });
    if (!eligible) continue;
    const key = normalizeAttributionName(eligible);
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(eligible);
  }
  return names;
}
