/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import {
  buildLibraryEntityUrl,
  buildLibraryReturnHref,
  normalizeLorePath,
  readLibraryReturnContext,
  captureLibraryReturnScroll,
} from "../src/lib/libraryFocusedNavigation";

describe("safe Library return context", () => {
  it("keeps the complete Library query and captures a bounded scroll position", () => {
    const source = "/library?view=songs&layout=grid&filter=ambient&sort=album&focus=Broadcast&openAlbum=Album%1FBroadcast";
    const href = buildLibraryEntityUrl("/song/recording-1", source, {
      demoSurface: true,
      scrollY: 412,
    });
    const entity = new URL(href, "https://lore.test");
    expect(entity.pathname).toBe("/song/recording-1");
    expect(entity.searchParams.get("return")).toBe(source);
    expect(entity.searchParams.get("returnScroll")).toBe("412");
    const context = readLibraryReturnContext(entity.search, { demoSurface: true });
    expect(buildLibraryReturnHref(context)).toBe(`${source}&scroll=412`);
  });

  it("rejects external, protocol-relative, oversized, and control-character paths", () => {
    expect(normalizeLorePath("https://evil.example/phish", "/library")).toBe("/library");
    expect(normalizeLorePath("//evil.example/phish", "/")).toBe("/");
    expect(normalizeLorePath(`${"/library?"}${"x".repeat(2100)}`, "/library")).toBe("/library");
    expect(normalizeLorePath("/library\u0000", "/library")).toBe("/library");
    expect(readLibraryReturnContext("?return=https%3A%2F%2Fevil.test", { demoSurface: true }).href).toBe("/library");
  });

  it("does not change non-demo entity URLs and falls back to the dial", () => {
    expect(buildLibraryEntityUrl("/artist/artist-1", "/library?view=songs", { demoSurface: false }))
      .toBe("/artist/artist-1");
    expect(readLibraryReturnContext("?return=%2Flibrary%3Fview%3Dsongs").href).toBe("/library?view=songs");
    expect(readLibraryReturnContext("").href).toBe("/");
  });

  it("captures the latest scroll position when an entity link is activated", () => {
    window.history.replaceState(null, "", "/library");
    const anchor = document.createElement("a");
    anchor.href = buildLibraryEntityUrl("/album/release-1", "/library?view=songs", {
      demoSurface: true,
      scrollY: 0,
    });
    const child = document.createElement("span");
    anchor.append(child);
    document.body.append(anchor);
    Object.defineProperty(window, "scrollY", { configurable: true, value: 735 });

    captureLibraryReturnScroll(new MouseEvent("click", {
      bubbles: true,
      button: 0,
    }));
    // A synthetic event without a dispatched target is intentionally ignored.
    expect(new URL(anchor.href).searchParams.get("returnScroll")).toBe("0");

    child.addEventListener("click", captureLibraryReturnScroll);
    child.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    expect(new URL(anchor.href).searchParams.get("returnScroll")).toBe("735");
    anchor.remove();
  });

  it("preserves the original Library scroll through chained entity links", () => {
    window.history.replaceState(null, "", "/song/recording-1");
    const anchor = document.createElement("a");
    anchor.href = "/artist/artist-1?return=%2Flibrary%3Fview%3Dsongs&returnScroll=412";
    const child = document.createElement("span");
    anchor.append(child);
    document.body.append(anchor);
    Object.defineProperty(window, "scrollY", { configurable: true, value: 900 });
    child.addEventListener("click", captureLibraryReturnScroll);
    child.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    expect(new URL(anchor.href).searchParams.get("returnScroll")).toBe("412");
    anchor.remove();
  });

  it("preserves structured return state through the real URL builder", () => {
    const songReturn = readLibraryReturnContext(
      "?return=%2Flibrary%3Fview%3Dsongs&returnScroll=412",
      { demoSurface: true },
    );
    const albumHref = buildLibraryEntityUrl(
      "/album/release-1",
      buildLibraryReturnHref(songReturn),
      { demoSurface: true },
    );
    const albumUrl = new URL(albumHref, "https://lore.test");
    expect(albumUrl.searchParams.get("return")).toBe("/library?view=songs");
    expect(albumUrl.searchParams.get("returnScroll")).toBe("412");
    const albumReturn = readLibraryReturnContext(albumUrl.search, { demoSurface: true });
    expect(buildLibraryReturnHref(albumReturn)).toBe("/library?view=songs&scroll=412");
  });
});