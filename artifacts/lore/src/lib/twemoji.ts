/**
 * Twemoji SVG URL helper.
 *
 * Converts a single emoji character (or short sequence) to its Twemoji CDN
 * SVG URL.  Uses the jsDelivr CDN which mirrors Twitter's open-source set
 * (MIT-licensed).  No package required — the URL is derived from the emoji's
 * Unicode code points alone.
 *
 * Rules (matching Twemoji's own filename derivation):
 *  - Extract every code point from the string.
 *  - Drop variation selectors (U+FE0F) — Twemoji filenames omit them.
 *  - Join remaining code points (lowercased hex) with "-".
 *  - Append ".svg" and prepend the CDN base.
 */
export function emojiSvgUrl(emoji: string): string {
  const codePoints: string[] = [];
  for (const char of emoji) {
    const cp = char.codePointAt(0);
    if (cp === undefined) continue;
    // Skip variation selector U+FE0F — Twemoji filenames exclude it.
    if (cp === 0xfe0f) continue;
    codePoints.push(cp.toString(16));
  }
  const joined = codePoints.join("-");
  return `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/${joined}.svg`;
}

/**
 * The 12 Halloween avatars available for listener notes.
 * Single source of truth for both the picker and note display.
 */
export const HALLOWEEN_AVATARS: string[] = [
  "🎃", // jack-o-lantern
  "👻", // ghost
  "💀", // skull
  "🦇", // bat
  "🕷️", // spider
  "🧟", // zombie
  "🔪", // knife
  "🪓", // axe
  "🧛", // vampire
  "🕯️", // candle
  "🕸️", // spider web
  "🩸", // blood drop
];
