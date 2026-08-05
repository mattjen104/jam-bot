/**
 * Upgrade a known artwork URL to its highest-resolution variant.
 *
 * Cover sources embed the size in the URL path, so we can rewrite it:
 *   - Cover Art Archive: .../front-250 | front-500 | front (original) → front-1200
 *   - iTunes/Apple:      .../100x100bb.jpg → .../1200x1200bb.jpg
 *   - Spotify CDN:       ab67616d00001e02 (300px) / ab67616d00004851 (64px)
 *                        → ab67616d0000b273 (640px, largest Spotify serves)
 *
 * URLs are parsed so query strings and hashes are preserved. Unknown hosts
 * and unparseable strings are returned unchanged. The result may 404 (e.g.
 * a CAA release with no 1200px derivative), so callers must keep a fallback
 * chain to the original URL.
 */
/**
 * Hero-only: fetch dedicated high-resolution album art candidates for the
 * avatar album, ordered best-first. Sources:
 *   1. iTunes Search API (CORS-enabled) — clean 1200×1200 masters
 *   2. Cover Art Archive front-1200 by release-group MBID
 *   3. The pattern-upgraded original artwork URL
 * Callers still probe each candidate and fall back down the list, so a miss
 * at any tier is harmless.
 */
export async function heroArtCandidates(album: {
  artist: string;
  albumTitle: string;
  releaseGroupMbid?: string | null;
  artworkUrl: string;
}): Promise<string[]> {
  const out: string[] = [];
  try {
    const term = encodeURIComponent(`${album.artist} ${album.albumTitle}`);
    // Explicit timeout: fetch has none by default, and a hung lookup here
    // would leave the hero stuck on the fallback art forever (the candidate
    // list only resolves after this settles).
    const res = await fetch(
      `https://itunes.apple.com/search?term=${term}&entity=album&limit=5`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (res.ok) {
      const data = (await res.json()) as {
        results?: Array<{
          artworkUrl100?: string;
          collectionName?: string;
          artistName?: string;
        }>;
      };
      // The text search is fuzzy: for ambiguous artist/title pairs it happily
      // returns remixes, alternate-version singles, deluxe editions, or cover
      // artists — all with DIFFERENT artwork. Only trust a result whose artist
      // and title actually match the library album (modulo the "- Single"/
      // "- EP" suffix iTunes appends). A near-miss here is worse than falling
      // through to CAA/original, which are release-exact.
      const match = (data.results ?? []).find(
        (r) =>
          r.artworkUrl100 &&
          itunesTitleMatches(album.albumTitle, r.collectionName) &&
          normTitle(r.artistName ?? "") === normTitle(album.artist),
      );
      const a100 = match?.artworkUrl100;
      if (a100) out.push(a100.replace(/\/\d+x\d+([a-z-]*)\.(jpg|png)$/i, "/1200x1200$1.$2"));
    }
  } catch {
    // network/CORS failure — skip this tier
  }
  // Release-exact CAA lookup: library artwork URLs are usually CAA mirrors on
  // archive.org whose path embeds the release MBID (…/mbid-<uuid>-…_thumb500.jpg).
  // coverartarchive.org/release/<uuid>/front-1200 serves the same cover as a
  // true 1200px master — guaranteed the right album, unlike the text search.
  const releaseMbid = caaReleaseMbidFromUrl(album.artworkUrl);
  if (releaseMbid) {
    out.push(`https://coverartarchive.org/release/${releaseMbid}/front-1200`);
  }
  if (album.releaseGroupMbid) {
    out.push(
      `https://coverartarchive.org/release-group/${album.releaseGroupMbid}/front-1200`,
    );
  }
  const upgraded = highResArtUrl(album.artworkUrl);
  out.push(upgraded);
  if (upgraded !== album.artworkUrl) out.push(album.artworkUrl);
  return out;
}

/** Lowercase, strip diacritics-free punctuation and collapse whitespace. */
function normTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’'"“”·.,:;!?&]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function highResArtUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url; // relative/local paths and malformed strings: leave untouched
  }
  const host = parsed.hostname;
  if (host === "coverartarchive.org" || host.endsWith(".coverartarchive.org")) {
    parsed.pathname = parsed.pathname.replace(
      /\/front(-\d+)?(\.\w+)?$/,
      "/front-1200",
    );
  } else if (host.endsWith(".mzstatic.com")) {
    parsed.pathname = parsed.pathname.replace(
      /\/\d+x\d+([a-z-]*)(\.(jpg|jpeg|png|webp))$/i,
      "/1200x1200$1$2",
    );
  } else if (host === "i.scdn.co") {
    parsed.pathname = parsed.pathname
      .replace("ab67616d00001e02", "ab67616d0000b273")
      .replace("ab67616d00004851", "ab67616d0000b273");
  }
  return parsed.toString();
}

/** Extract a release MBID from a CAA/archive.org-mirror artwork URL path. */
export function caaReleaseMbidFromUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname;
  if (
    host !== "coverartarchive.org" &&
    !host.endsWith(".coverartarchive.org") &&
    host !== "archive.org" &&
    !host.endsWith(".archive.org")
  ) {
    return null;
  }
  const m = parsed.pathname.match(
    /mbid-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
  );
  return m ? m[1].toLowerCase() : null;
}

/**
 * Accept an iTunes collectionName only when it equals the library album title
 * after stripping the "- Single" / "- EP" suffix iTunes appends. Parenthetical
 * qualifiers ("(Lush Version)", "(Deluxe Edition)", "[feat. …]") that the
 * library title lacks mean a different release with different artwork → reject.
 */
export function itunesTitleMatches(
  libraryTitle: string,
  collectionName: string | undefined,
): boolean {
  if (!collectionName) return false;
  const stripped = collectionName.replace(/\s*-\s*(single|ep)\s*$/i, "");
  return normTitle(stripped) === normTitle(libraryTitle);
}
