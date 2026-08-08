// @vitest-environment jsdom
/**
 * Grayscale link-language consistency guard.
 *
 * The three-tone visual grammar is codified in shared CSS classes:
 *   - `.gram-link--nav`  dotted underline = navigate
 *   - `.gram__add`       explicit `+` = add/seed
 *   - `.gram--yours`     bright white = yours (library/seeded)
 *   - `.lrow__by-name`   library byline navigation links
 *
 * This spec asserts that the sentence renderers (dial grammar + library
 * bylines) emit ONLY those shared classes for link states, and that they
 * never smuggle tone back in through inline `style` attributes (saturated
 * colors, font-weight overrides) or emphasis tags (<i>/<em>/<strong>).
 * We assert on class usage and markup shape, never on pixels — the CSS
 * file owns the actual rendering.
 */
import React, { type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";

import {
  radioSummarySentence,
  artistNode,
  djNode,
  attributionLine,
  crossingSentence,
} from "../src/dial/grammar";
import type { DialShow } from "../src/hooks/useDialData";
import type { LibraryItem } from "../src/lib/meHooks";

vi.mock("../src/lib/meHooks", async (importOriginal) => {
  const { makeMeHooksMock } = await import("./helpers/meHooksMock");
  return makeMeHooksMock(importOriginal, {
    useMyAlbumAvatar: vi.fn(() => ({ data: undefined })),
    useSetAlbumAvatar: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
    useSetLibraryRemoved: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  });
});

vi.mock("../src/player/PlayerProvider", async (importOriginal) => {
  const { makePlayerProviderMock } = await import("./helpers/playerProviderMock");
  return makePlayerProviderMock(importOriginal, {
    usePlayer: vi.fn(() => ({ ride: { active: false }, radio: { station: null } })),
  });
});

import { LibraryRow } from "../src/components/LibraryRow";

afterEach(() => cleanup());

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function html(node: ReactNode): string {
  return renderToStaticMarkup(<>{node}</>);
}

/** Fails when markup carries inline tone: style attributes with color or
 *  font-weight, or emphasis tags. The shared classes are the only channel. */
function expectNoInlineTone(markup: string, label: string) {
  // No emphasis/weight tags other than the grammar's own <b> role wrappers,
  // which the CSS pins to font-weight 400 — italics and <strong> are banned.
  expect(markup, `${label}: <strong> is banned in sentence markup`).not.toMatch(/<strong[\s>]/i);
  expect(markup, `${label}: <i>/<em> is banned in sentence markup`).not.toMatch(/<(i|em)[\s>]/i);
  // No inline style may set color or font-weight — tone lives in shared CSS.
  const styleAttrs = [...markup.matchAll(/style="([^"]*)"/gi)].map((m) => m[1]);
  for (const style of styleAttrs) {
    expect(style, `${label}: inline color override`).not.toMatch(/(^|;)\s*color\s*:/i);
    expect(style, `${label}: inline font-weight override`).not.toMatch(/font-weight/i);
    // Saturated color literals are banned anywhere in inline styles.
    expect(style, `${label}: saturated inline color`).not.toMatch(
      /rgb\(|#(?!fff\b|ffffff\b|000\b|000000\b)[0-9a-f]{3,8}\b/i,
    );
  }
}

function makeShow(overrides: Partial<DialShow> = {}): DialShow {
  return {
    runId: 1,
    showName: "Morning Mix",
    djName: null,
    startedAt: new Date(Date.now() - 30 * 60_000).toISOString(),
    endedAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    ianaTimezone: "America/Los_Angeles",
    state: "live",
    spins: [],
    crossings: 0,
    artistCrossings: 0,
    topArtists: [],
    topArtistNames: [],
    currentTrack: null,
    isPickerShow: false,
    pickerId: null,
    ...overrides,
  } as DialShow;
}

const links = {
  onArtist: vi.fn(),
  onDj: vi.fn(),
  onAddArtist: vi.fn(),
  isYours: (name: string) => name === "Yours Band",
};

// ---------------------------------------------------------------------------
// Shared CSS contract — the classes the renderers rely on must exist
// ---------------------------------------------------------------------------

describe("shared grammar classes stay defined in index.css", () => {
  const css = readFileSync(join(__dirname, "../src/index.css"), "utf8");

  it.each([".gram-link--nav", ".gram__add", ".gram--yours", ".lrow__by-name"])(
    "defines %s",
    (cls) => {
      expect(css).toContain(cls);
    },
  );

  it("keeps the no-bold policy on grammar names", () => {
    // The rule pinning artist/dj names to normal weight must survive.
    expect(css).toMatch(/\.gram__artist,\s*\.gram__dj\s*{[^}]*font-weight:\s*400/);
  });
});

// ---------------------------------------------------------------------------
// Dial grammar renderers
// ---------------------------------------------------------------------------

describe("grammar renderers emit shared link-state classes only", () => {
  it("navigable artist/dj → gram-link--nav; yours → gram--yours; add → gram__add", () => {
    const markup = html(
      <>
        {artistNode("New Band", links)}
        {artistNode("Yours Band", links)}
        {djNode("Tom Schnabel", links)}
      </>,
    );
    expect(markup).toContain("gram-link--nav");
    expect(markup).toContain("gram--yours");
    expect(markup).toContain("gram__add");
    expectNoInlineTone(markup, "role nodes");
  });

  it("yours names never get the add affordance; underline only when navigable", () => {
    // With a nav handler, yours stays navigable (white + dotted per policy)
    // but must never grow a `+` — it is already yours.
    const withNav = render(<p>{artistNode("Yours Band", links)}</p>);
    expect(withNav.container.querySelector(".gram--yours")).toBeTruthy();
    expect(withNav.container.querySelector(".gram__add")).toBeNull();
    cleanup();
    // Without a nav handler, yours renders with no underline class at all.
    const plain = render(
      <p>{artistNode("Yours Band", { isYours: () => true, onAddArtist: vi.fn() })}</p>,
    );
    const yours = plain.container.querySelector(".gram--yours")!;
    expect(yours.className).not.toContain("gram-link--nav");
    expect(plain.container.querySelector(".gram__add")).toBeNull();
  });

  it("radioSummarySentence + attribution stay tone-free end to end", () => {
    const show = makeShow({
      djName: "Tom Schnabel",
      crossings: 2,
      topArtists: ["Portishead", "Yours Band", "Broadcast"],
    });
    const { sentence, attribution } = radioSummarySentence({
      stationName: "KCRW",
      show,
      links,
      attributionHandlers: { onShow: vi.fn(), onStation: vi.fn() },
    });
    const markup = html(sentence) + html(attribution);
    expect(markup).toContain("gram-link--nav");
    expect(markup).toContain("gram--yours");
    expectNoInlineTone(markup, "radioSummarySentence");
  });

  it("attributionLine links use the shared nav class, nothing bespoke", () => {
    const markup = html(attributionLine("KCRW", "Morning Mix", { onShow: vi.fn(), onStation: vi.fn() }));
    const buttonClasses = [...markup.matchAll(/<button[^>]*class="([^"]*)"/gi)].map((m) => m[1]);
    expect(buttonClasses.length).toBeGreaterThan(0);
    for (const cls of buttonClasses) expect(cls).toContain("gram-link--nav");
    expectNoInlineTone(markup, "attributionLine");
  });

  it("crossingSentence markup stays tone-free", () => {
    const show = makeShow({ crossings: 1, topArtists: ["Portishead"] });
    const result = crossingSentence("KCRW", show);
    expectNoInlineTone(html(result!.node), "crossingSentence");
  });
});

// ---------------------------------------------------------------------------
// Library bylines
// ---------------------------------------------------------------------------

describe("library byline sentences follow the shared grammar", () => {
  const baseItem = {
    mbid: "mbid-1",
    provenance: { kind: "keep" },
    addedAt: "2026-08-01T00:00:00.000Z",
    recording: { mbid: "mbid-1", title: "Go Your Own Way", artist: "Fleetwood Mac" },
  } as unknown as LibraryItem;

  function bylineOf(item: LibraryItem): Element {
    const { container } = render(<ul><LibraryRow item={item} /></ul>);
    const byline = container.querySelector(".lrow__by");
    expect(byline).toBeTruthy();
    return byline!;
  }

  it("picked-by links carry lrow__by-name and no inline tone", () => {
    const byline = bylineOf({
      ...baseItem,
      provenance: {
        kind: "keep",
        pickerName: "Tom Schnabel",
        pickerHandle: "tom-schnabel",
        stationName: "KCRW",
        stationSlug: "kcrw",
      },
    } as LibraryItem);
    const nameLink = byline.querySelector("a.lrow__by-name")!;
    expect(nameLink).toBeTruthy();
    expect(nameLink.textContent).toBe("Tom Schnabel");
    expectNoInlineTone(byline.outerHTML, "picked-by byline");
  });

  it("heard-on links carry lrow__by-name and no inline tone", () => {
    const byline = bylineOf({
      ...baseItem,
      provenance: { kind: "keep", stationName: "KCRW", stationSlug: "kcrw" },
    } as LibraryItem);
    const nameLink = byline.querySelector("a.lrow__by-name")!;
    expect(nameLink).toBeTruthy();
    expect(nameLink.textContent).toBe("KCRW");
    expectNoInlineTone(byline.outerHTML, "heard-on byline");
  });

  it("import bylines stay tone-free too", () => {
    const byline = bylineOf({
      ...baseItem,
      provenance: { kind: "import", service: "spotify" },
    } as LibraryItem);
    expectNoInlineTone(byline.outerHTML, "import byline");
  });
});
