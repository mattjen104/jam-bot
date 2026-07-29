// @vitest-environment node
/**
 * Locks the shared schedule-name normalization so the parse-time sanitizer
 * (schedule-scraper.ts) and the boot-time DB cleanup
 * (station-schedule-migration.ts) cannot drift apart: both derive from
 * schedule-name-sanitizer.ts, and this suite pins (a) the sanitize behavior
 * per codepoint and (b) that the Postgres pattern matches the JS regex
 * character-for-character.
 */

import { describe, it, expect } from "vitest";
import {
  sanitizeScheduleName,
  INVISIBLE_CHARS_RE,
  INVISIBLE_CHARS_PG_CLASS,
} from "../../src/lore/schedule-name-sanitizer.js";
import { parseExtractedSchedule } from "../../src/lore/schedule-scraper.js";

/** Every codepoint the sanitizer must treat as invisible whitespace. */
const COVERED: Array<[string, number]> = [
  ["no-break space", 0x00a0],
  ["ogham space mark", 0x1680],
  ["en quad", 0x2000],
  ["hair space", 0x200a],
  ["zero-width space", 0x200b],
  ["zero-width non-joiner", 0x200c],
  ["zero-width joiner", 0x200d],
  ["left-to-right mark", 0x200e],
  ["right-to-left mark", 0x200f],
  ["line separator", 0x2028],
  ["paragraph separator", 0x2029],
  ["narrow no-break space", 0x202f],
  ["medium mathematical space", 0x205f],
  ["word joiner", 0x2060],
  ["ideographic space", 0x3000],
  ["BOM / zero-width no-break space", 0xfeff],
];

describe("sanitizeScheduleName", () => {
  it.each(COVERED)("maps %s (U+%s) to a single space", (_name, cp) => {
    const ch = String.fromCharCode(cp);
    expect(sanitizeScheduleName(`Morning${ch}Jazz`)).toBe("Morning Jazz");
  });

  it("collapses runs of mixed invisible chars and trims edges", () => {
    expect(
      sanitizeScheduleName("\u00A0\u200B Morning\u202F\u2060 \u200EJazz \uFEFF"),
    ).toBe("Morning Jazz");
  });

  it("leaves ordinary names untouched", () => {
    expect(sanitizeScheduleName("Morning Jazz")).toBe("Morning Jazz");
  });

  it("does not strip visible non-ASCII letters", () => {
    expect(sanitizeScheduleName("Café Olé — La Hora Ñ")).toBe(
      "Café Olé — La Hora Ñ",
    );
  });

  it("returns empty string for input that is only invisible chars", () => {
    expect(sanitizeScheduleName("\u200B\u00A0\u2060")).toBe("");
  });
});

describe("JS regex ↔ Postgres pattern lockstep", () => {
  // Rebuild a JS regex from the Postgres class string. Postgres AREs use the
  // same \uXXXX escapes, so a faithful translation is direct construction.
  const pgAsJs = new RegExp(INVISIBLE_CHARS_PG_CLASS.replace(/\\u/g, "\\u"), "u");

  it("every covered codepoint matches BOTH the JS regex and the PG class", () => {
    for (const [, cp] of COVERED) {
      const ch = String.fromCharCode(cp);
      expect(new RegExp(INVISIBLE_CHARS_RE.source).test(ch)).toBe(true);
      expect(pgAsJs.test(ch)).toBe(true);
    }
  });

  it("the PG class is byte-identical to the JS class source", () => {
    // Strongest possible drift lock: both are derived from one range list,
    // so their textual character classes must be identical.
    expect(`[${INVISIBLE_CHARS_RE.source.slice(1, -1)}]`).toBe(
      INVISIBLE_CHARS_PG_CLASS,
    );
  });

  it("ordinary characters match neither", () => {
    for (const ch of ["a", "Z", " ", "é", "-", "0"]) {
      expect(new RegExp(INVISIBLE_CHARS_RE.source).test(ch)).toBe(false);
      expect(pgAsJs.test(ch)).toBe(false);
    }
  });
});

describe("parseExtractedSchedule uses the shared sanitizer", () => {
  it("normalises NBSP / narrow NBSP / word joiner in stored names and dedupes against the clean form", () => {
    const raw = JSON.stringify([
      {
        showName: "Morning\u00A0Jazz",
        dayOfWeek: "Mon",
        startTime: "09:00",
        endTime: "10:00",
        djName: "DJ\u202FRey\u2060nolds",
      },
      // Same slot after normalization — must be deduped, not stored twice.
      {
        showName: "Morning Jazz",
        dayOfWeek: "Mon",
        startTime: "09:00",
        endTime: "10:00",
        djName: null,
      },
    ]);
    const out = parseExtractedSchedule(raw);
    expect(out).not.toBeNull();
    expect(out).toHaveLength(1);
    expect(out![0]!.showName).toBe("Morning Jazz");
    expect(out![0]!.djName).toBe("DJ Rey nolds");
  });
});
