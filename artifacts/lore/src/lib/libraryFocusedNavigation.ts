const ALBUM_KEY_SEPARATOR = "\x1f";
const RETURN_CONTEXT_PARAM = "return";
const RETURN_CONTEXT_MAX_LENGTH = 2048;
const RETURN_SCROLL_MAX = 10_000_000;

export interface LibraryReturnContext {
  href: string;
  scrollY?: number;
}

/**
 * Return contexts are navigation state, not arbitrary redirect targets. Keep
 * them to same-origin Lore paths so a query copied from a link can never turn
 * an entity's back link into an open redirect.
 */
export function normalizeLorePath(
  value: string | null | undefined,
  fallback = "/",
): string {
  if (typeof value !== "string" || value.length === 0 || value.length > RETURN_CONTEXT_MAX_LENGTH) {
    return fallback;
  }
  const hasControlCharacter = [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
  if (value.includes("\\") || hasControlCharacter || !value.startsWith("/") || value.startsWith("//")) {
    return fallback;
  }
  try {
    const parsed = new URL(value, "https://lore.local");
    if (parsed.origin !== "https://lore.local" || !parsed.pathname.startsWith("/")) return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

export function readLibraryReturnContext(
  search: string,
  options: { demoSurface?: boolean } = {},
): LibraryReturnContext {
  const fallback = options.demoSurface ? "/library" : "/";
  const params = new URLSearchParams(search);
  const raw = params.get(RETURN_CONTEXT_PARAM) ?? params.get("returnTo");
  const href = normalizeLorePath(raw, fallback);
  const rawScroll = params.get("returnScroll");
  const scrollY = rawScroll == null ? undefined : Number(rawScroll);
  return typeof scrollY === "number" && Number.isFinite(scrollY) && scrollY >= 0 && scrollY <= RETURN_SCROLL_MAX
    ? { href, scrollY }
    : { href };
}

/** Reattach a captured position when rendering an entity's back link. */
export function buildLibraryReturnHref(context: LibraryReturnContext): string {
  if (context.scrollY == null) return context.href;
  const url = new URL(context.href, "https://lore.local");
  url.searchParams.set("scroll", String(Math.round(context.scrollY)));
  return `${url.pathname}?${url.searchParams.toString()}${url.hash}`;
}

/** Add a bounded internal return context to an entity URL. */
export function withLibraryReturnContext(
  href: string,
  returnTo: string | null | undefined,
  options: { demoSurface?: boolean; scrollY?: number } = {},
): string {
  const normalizedHref = normalizeLorePath(href, "/");
  // Non-demo links intentionally retain their historical URLs.
  if (!options.demoSurface) return normalizedHref;
  const rawContext = normalizeLorePath(returnTo, "/library");
  const contextUrl = new URL(rawContext, "https://lore.local");
  const embeddedScroll = Number(contextUrl.searchParams.get("scroll"));
  const hasEmbeddedScroll = contextUrl.searchParams.has("scroll")
    && Number.isFinite(embeddedScroll)
    && embeddedScroll >= 0
    && embeddedScroll <= RETURN_SCROLL_MAX;
  if (hasEmbeddedScroll) contextUrl.searchParams.delete("scroll");
  const context = `${contextUrl.pathname}${contextUrl.search}${contextUrl.hash}`;
  const url = new URL(normalizedHref, "https://lore.local");
  url.searchParams.set(RETURN_CONTEXT_PARAM, context);
  const scrollY = options.scrollY
    ?? (hasEmbeddedScroll ? embeddedScroll : undefined)
    ?? (typeof window !== "undefined" && Number.isFinite(window.scrollY) ? window.scrollY : undefined);
  if (typeof scrollY === "number" && Number.isFinite(scrollY) && scrollY >= 0 && scrollY <= RETURN_SCROLL_MAX) {
    url.searchParams.set("returnScroll", String(Math.round(scrollY)));
  }
  return `${url.pathname}?${url.searchParams.toString()}${url.hash}`;
}

export function buildLibraryEntityUrl(
  path: string,
  returnTo: string | null | undefined,
  options: { demoSurface?: boolean; scrollY?: number } = {},
): string {
  return withLibraryReturnContext(path, returnTo, options);
}

/**
 * Capture the return position at activation time, after the listener may have
 * scrolled since the entity links rendered. Install once at the app shell in
 * capture phase so wouter/browser navigation sees the updated href.
 */
export function captureLibraryReturnScroll(event: MouseEvent): void {
  if (
    event.defaultPrevented
    || event.button !== 0
    || event.metaKey
    || event.ctrlKey
    || event.shiftKey
    || event.altKey
  ) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  const anchor = target.closest<HTMLAnchorElement>("a[href]");
  if (!anchor) return;
  const rawHref = anchor.getAttribute("href");
  if (!rawHref) return;
  const url = new URL(rawHref, window.location.origin);
  if (!url.searchParams.has(RETURN_CONTEXT_PARAM)) return;
  // Entity-to-entity links already carry the original Library position.
  // Never replace it with a Song/Album/Artist page's scroll offset.
  if (!window.location.pathname.replace(/\/+$/, "").endsWith("/library")) return;
  const scrollY = window.scrollY;
  if (!Number.isFinite(scrollY) || scrollY < 0 || scrollY > RETURN_SCROLL_MAX) return;
  url.searchParams.set("returnScroll", String(Math.round(scrollY)));
  anchor.setAttribute("href", `${url.pathname}${url.search}${url.hash}`);
}

export function buildLibraryAlbumKey(albumTitle: string, artist: string): string {
  return `${albumTitle}${ALBUM_KEY_SEPARATOR}${artist}`;
}

export function buildFocusedLibraryUrl(
  search: string,
  target: { artist: string; albumKey?: string },
): string {
  const params = new URLSearchParams(search);
  params.set("view", "songs");
  params.set("focus", target.artist);
  params.set("sort", "album");

  if (target.albumKey) params.set("openAlbum", target.albumKey);
  else params.delete("openAlbum");

  return `/library?${params.toString()}`;
}

export function getArtistFromLibraryAlbumKey(albumKey: string): string {
  return albumKey.split(ALBUM_KEY_SEPARATOR)[1] ?? "";
}