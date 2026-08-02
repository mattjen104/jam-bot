import { describe, it, expect } from "vitest";

// We can't import the frontend lib directly from the api-server test runner,
// so we inline the same logic here to unit-test the URL derivation.
function emojiSvgUrl(emoji: string): string {
  const codePoints: string[] = [];
  for (const char of emoji) {
    const cp = char.codePointAt(0);
    if (cp === undefined) continue;
    if (cp === 0xfe0f) continue;
    codePoints.push(cp.toString(16));
  }
  const joined = codePoints.join("-");
  return `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/${joined}.svg`;
}

const HALLOWEEN_AVATARS = [
  "🎃", "👻", "💀", "🦇", "🕷️", "🧟",
  "🔪", "🪓", "🧛", "🕯️", "🕸️", "🩸",
];

describe("emojiSvgUrl", () => {
  it("returns a valid CDN URL for a simple emoji", () => {
    const url = emojiSvgUrl("🎃");
    expect(url).toContain("cdn.jsdelivr.net");
    expect(url).toContain("twemoji");
    expect(url).toMatch(/\.svg$/);
    expect(url).toContain("1f383");
  });

  it("strips variation selector U+FE0F from compound emoji", () => {
    // 🕷️ is U+1F577 + U+FE0F — Twemoji filenames exclude FE0F
    const url = emojiSvgUrl("🕷️");
    expect(url).not.toContain("fe0f");
    expect(url).toContain("1f577");
  });

  it("returns valid URLs for all 12 Halloween avatars", () => {
    for (const emoji of HALLOWEEN_AVATARS) {
      const url = emojiSvgUrl(emoji);
      expect(url).toMatch(/^https:\/\/cdn\.jsdelivr\.net\/.+\.svg$/);
    }
  });

  it("produces 12 distinct URLs for 12 distinct emoji", () => {
    const urls = new Set(HALLOWEEN_AVATARS.map(emojiSvgUrl));
    expect(urls.size).toBe(12);
  });
});
