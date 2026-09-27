/**
 * MusicBrainz release history keyed by ISRC. A Spotify album's release date
 * can be a reissue date, so it is not evidence of a recording's original era.
 * Missing, ambiguous or unparseable history fails closed.
 */
const cache = new Map<string, number | null>();
let nextRequestAt = 0;
let requestQueue: Promise<void> = Promise.resolve();

function normalized(value: string): string {
  return value.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

type MbRecording = {
  title?: string;
  "artist-credit"?: ({ name?: string; artist?: { name?: string } } | string)[];
  "first-release-date"?: string;
};

export async function recordingFirstReleaseYear(
  isrc: string | undefined,
  title: string,
  artist: string,
): Promise<number | null> {
  if (!isrc || !/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/i.test(isrc)) return null;
  const isrcKey = isrc.toUpperCase();
  const key = `${isrcKey}:${normalized(title)}:${normalized(artist)}`;
  if (cache.has(key)) return cache.get(key)!;

  // MusicBrainz public API asks clients to stay below one request/second.
  const turn = requestQueue.then(async () => {
    const wait = Math.max(0, nextRequestAt - Date.now());
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    nextRequestAt = Date.now() + 1_100;
  });
  requestQueue = turn.catch(() => {});
  try {
    await turn;
    const res = await fetch(
      `https://musicbrainz.org/ws/2/isrc/${encodeURIComponent(isrcKey)}?inc=artists&fmt=json`,
      {
        headers: { "User-Agent": "LoreRadioJamBot/1.0 (guided tour release verification)" },
        signal: AbortSignal.timeout(6_000),
      },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { recordings?: MbRecording[] };
    if (!Array.isArray(body.recordings) || !body.recordings.length) return null;
    const matched = body.recordings.filter((r) => {
      const credited = (r["artist-credit"] ?? [])
        .filter((part): part is Exclude<typeof part, string> => typeof part !== "string")
        .map((part) => part.artist?.name ?? part.name ?? "")
        .join(" ");
      return normalized(r.title ?? "") === normalized(title) &&
        normalized(credited) === normalized(artist);
    });
    // An ISRC reused across distinct recordings is ambiguous.
    if (matched.length !== 1) return null;
    const date = matched[0]!["first-release-date"];
    if (!date || !/^(?:19|20)\d{2}(?:-\d{2}(?:-\d{2})?)?$/.test(date)) return null;
    const year = Number(date.slice(0, 4));
    cache.set(key, year);
    return year;
  } catch {
    return null;
  }
}