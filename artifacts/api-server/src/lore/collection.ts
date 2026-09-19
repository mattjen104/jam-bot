/**
 * Lossless, service-neutral collection representation and its JSPF projection.
 * This module intentionally contains no database or resolver code.
 */
export type CollectionKind = "album" | "playlist";
export type EntryIdentity = "mbid" | "isrc" | "text" | "unavailable";

export interface CollectionEntry {
  identity: EntryIdentity;
  mbid?: string;
  isrc?: string;
  title?: string;
  artist?: string;
  album?: string;
  spotifyTrackId?: string;
  spotifyTrackUrl?: string;
  spotifyAlbumId?: string;
  provenance?: { source?: string; confidence?: "confirmed" | "probable" | "unresolved" };
  /** Why an intentional gap exists (never shown as a resolver response). */
  unavailableReason?: string;
}

export interface LoreCollectionV1 {
  schema: "lore.collection.v1";
  kind: CollectionKind;
  slug: string;
  title: string;
  description: string | null;
  curatorNotes: string | null;
  coverArt: string | null;
  entries: CollectionEntry[];
  provenance: { authority: "lore"; public: true };
}

export const COMPATIBILITY_SAMPLE_SLUG = "lore-jspf-compatibility-sample";

/**
 * Code-owned public fixture for external reader compatibility checks.
 * Keep the identities and their order stable.
 */
export const compatibilitySampleCollection: LoreCollectionV1 = {
  schema: "lore.collection.v1",
  kind: "playlist",
  slug: COMPATIBILITY_SAMPLE_SLUG,
  title: "Lore JSPF Compatibility Sample",
  description: "A stable public fixture for testing Lore collection readers.",
  curatorNotes: "Entries deliberately cover MBID, ISRC, text-only, and unavailable identities in that order.",
  coverArt: null,
  provenance: { authority: "lore", public: true },
  entries: [
    {
      identity: "mbid",
      mbid: "f980fc14-e29b-481d-ad3a-5ed9b4ab6340",
      title: "MBID example",
      artist: "Lore compatibility fixture",
      provenance: { source: "compatibility-sample", confidence: "confirmed" },
    },
    {
      identity: "isrc",
      isrc: "USAAA1234567",
      title: "ISRC example",
      artist: "Lore compatibility fixture",
      provenance: { source: "compatibility-sample", confidence: "confirmed" },
    },
    {
      identity: "text",
      title: "Text-only example",
      artist: "Lore compatibility fixture",
      provenance: { source: "compatibility-sample", confidence: "unresolved" },
    },
    {
      identity: "unavailable",
      title: "Unavailable example",
      unavailableReason: "Intentionally unavailable compatibility fixture entry",
      provenance: { source: "compatibility-sample", confidence: "unresolved" },
    },
  ],
};

export interface JspfPlaylist {
  playlist: {
    title: string;
    annotation?: string;
    image?: string;
    meta?: Record<string, string>;
    track: Array<{
      title?: string;
      creator?: string;
      album?: string;
      location?: string;
      identifier?: string[];
      meta?: Record<string, string>;
    }>;
  };
}

export function toJspf(c: LoreCollectionV1): JspfPlaylist {
  return {
    playlist: {
      title: c.title,
      ...(c.description ? { annotation: c.description } : {}),
      ...(c.coverArt ? { image: c.coverArt } : {}),
      meta: {
        "lore:version": "lore.collection.v1", "lore:kind": c.kind, "lore:slug": c.slug,
        ...(c.curatorNotes ? { "lore:curator-notes": c.curatorNotes } : {}),
        ...(c.entries.find((e) => e.spotifyAlbumId && spotifyAlbumLink(e.spotifyAlbumId))
          ? { "lore:spotify-album": spotifyAlbumLink(c.entries.find((e) => e.spotifyAlbumId)?.spotifyAlbumId ?? "")! } : {}),
      },
      track: c.entries.map((e) => ({
        ...(e.title ? { title: e.title } : {}),
        ...(e.artist ? { creator: e.artist } : {}),
        ...(e.album ? { album: e.album } : {}),
        ...(e.spotifyTrackId && spotifyTrackLink(e.spotifyTrackId, e.spotifyTrackUrl)
          ? { location: spotifyTrackLink(e.spotifyTrackId, e.spotifyTrackUrl)! } : {}),
        identifier: [
          ...(e.mbid ? [`musicbrainz:recording:${e.mbid}`] : []),
          ...(e.isrc ? [`isrc:${e.isrc}`] : []),
          ...(e.spotifyTrackId && spotifyTrackLink(e.spotifyTrackId, e.spotifyTrackUrl) ? [`spotify:track:${e.spotifyTrackId}`] : []),
        ],
        meta: {
          "lore:identity": e.identity,
          ...(e.provenance?.source ? { "lore:provenance-source": e.provenance.source } : {}),
          ...(e.provenance?.confidence ? { "lore:confidence": e.provenance.confidence } : {}),
          ...(e.unavailableReason ? { "lore:unavailable": e.unavailableReason } : {}),
        },
      })),
    },
  };
}

/** Parse only Lore's own projection. Uploaded JSPF is never archival authority. */
export function fromJspf(input: JspfPlaylist): LoreCollectionV1 {
  const p = input.playlist;
  const tracks = Array.isArray(p.track) ? p.track : [];
  return {
    schema: "lore.collection.v1",
    kind: p.meta?.["lore:kind"] === "album" ? "album" : "playlist",
    slug: p.meta?.["lore:slug"] ?? "",
    title: p.title,
    description: p.annotation ?? null,
    curatorNotes: p.meta?.["lore:curator-notes"] ?? null,
    coverArt: p.image ?? null,
    provenance: { authority: "lore", public: true },
    entries: tracks.map((t) => {
      const m = t.meta ?? {};
      const identifiers = t.identifier ?? [];
      const mbid = identifiers.find((x) => x.startsWith("musicbrainz:recording:"))?.slice(22);
      const isrc = identifiers.find((x) => x.startsWith("isrc:"))?.slice(5);
      const spotify = identifiers.find((x) => x.startsWith("spotify:track:"))?.slice(15);
      const identity = (m["lore:identity"] as EntryIdentity | undefined) ??
        (mbid ? "mbid" : isrc ? "isrc" : m["lore:unavailable"] ? "unavailable" : "text");
      return {
        identity, mbid, isrc, spotifyTrackId: spotify,
        spotifyTrackUrl: spotify ? spotifyTrackLink(spotify, t.location) ?? undefined : undefined,
        spotifyAlbumId: p.meta?.["lore:spotify-album"] && /^[A-Za-z0-9]{22}$/.test(p.meta["lore:spotify-album"].split("/").pop() ?? "")
          ? p.meta["lore:spotify-album"].split("/").pop() : undefined,
        title: t.title, artist: t.creator, album: t.album,
        provenance: m["lore:provenance-source"] || m["lore:confidence"]
          ? { source: m["lore:provenance-source"], confidence: m["lore:confidence"] as "confirmed" | "probable" | "unresolved" | undefined }
          : undefined,
        unavailableReason: m["lore:unavailable"],
      };
    }),
  };
}

export function spotifyTrackLink(id: string, url?: string): string | null {
  const validId = /^[A-Za-z0-9]{22}$/.test(id);
  const validUrl = url ? /^https:\/\/open\.spotify\.com\/track\/[A-Za-z0-9]{22}(?:\?[^\s]*)?$/.test(url) : true;
  return validId && validUrl ? `https://open.spotify.com/track/${id}` : null;
}

export function spotifyAlbumLink(id: string): string | null {
  return /^[A-Za-z0-9]{22}$/.test(id) ? `https://open.spotify.com/album/${id}` : null;
}

export interface VerifiedSpotifyTrack {
  recordingMbid: string;
  service: string;
  externalId: string | null;
  url: string | null;
  confidence: string;
  verification: string;
  deadLink: boolean;
}

/** Apply only durable exact/verified mappings; caller-provided provider IDs are ignored. */
export function enrichVerifiedSpotifyEntries(entries: CollectionEntry[], mappings: VerifiedSpotifyTrack[]): CollectionEntry[] {
  const byMbid = new Map(mappings.map((m) => [m.recordingMbid, m]));
  return entries.map((entry) => {
    const mapping = entry.mbid ? byMbid.get(entry.mbid) : undefined;
    if (!mapping || mapping.confidence !== "exact" || mapping.verification !== "verified" || mapping.deadLink ||
        !mapping.externalId || !mapping.url || !spotifyTrackLink(mapping.externalId, mapping.url)) {
      const { spotifyTrackId: _id, spotifyTrackUrl: _url, spotifyAlbumId: _album, ...withoutProvider } = entry;
      return withoutProvider;
    }
    const { spotifyTrackId: _id, spotifyTrackUrl: _url, spotifyAlbumId: _album, ...withoutProvider } = entry;
    return { ...withoutProvider, spotifyTrackId: mapping.externalId, spotifyTrackUrl: spotifyTrackLink(mapping.externalId, mapping.url)! };
  });
}

const MAX_ENTRIES = 500;
const MAX_TEXT = 2000;
const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISRC = /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/i;

/** Reject malformed/untrusted create payloads and return a bounded copy. */
export function validateCollectionInput(input: unknown): { ok: true; value: Omit<LoreCollectionV1, "schema" | "provenance"> } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "collection must be an object" };
  const x = input as Record<string, unknown>;
  if (x.kind !== "album" && x.kind !== "playlist" || typeof x.title !== "string" || !x.title.trim()) return { ok: false, error: "kind and title are required" };
  if (typeof x.slug !== "string" || !/^[a-z0-9][a-z0-9-]{1,79}$/.test(x.slug)) return { ok: false, error: "invalid slug" };
  if (!Array.isArray(x.entries) || x.entries.length > MAX_ENTRIES) return { ok: false, error: "invalid entry count" };
  const text = (v: unknown, name: string) => v == null ? undefined : typeof v === "string" && v.length <= MAX_TEXT ? v.trim() : (() => { throw new Error(`invalid ${name}`); })();
  try {
    const entries = x.entries.map((raw) => {
      if (!raw || typeof raw !== "object") throw new Error("invalid entry");
      const e = raw as Record<string, unknown>;
      if (!["mbid", "isrc", "text", "unavailable"].includes(String(e.identity))) throw new Error("invalid identity");
      const out: CollectionEntry = { identity: e.identity as EntryIdentity };
      out.title = text(e.title, "title"); out.artist = text(e.artist, "artist"); out.album = text(e.album, "album");
      if (out.identity === "mbid") { if (typeof e.mbid !== "string" || !MBID.test(e.mbid)) throw new Error("invalid mbid"); out.mbid = e.mbid; }
      if (out.identity === "isrc") { if (typeof e.isrc !== "string" || !ISRC.test(e.isrc)) throw new Error("invalid isrc"); out.isrc = e.isrc.toUpperCase(); }
      if (out.identity === "text" && (!out.title || !out.artist)) throw new Error("text identity requires title and artist");
      if (out.identity === "unavailable") { out.unavailableReason = text(e.unavailableReason, "unavailableReason"); if (!out.unavailableReason) throw new Error("unavailable reason required"); }
      if (e.provenance != null) {
        if (typeof e.provenance !== "object") throw new Error("invalid provenance");
        const p = e.provenance as Record<string, unknown>;
        const confidence = p.confidence;
        if (confidence != null && !["confirmed", "probable", "unresolved"].includes(String(confidence))) throw new Error("invalid confidence");
        out.provenance = { source: text(p.source, "provenance source"), confidence: confidence as "confirmed" | "probable" | "unresolved" | undefined };
      }
      if (e.spotifyTrackId != null || e.spotifyTrackUrl != null) {
        if (typeof e.spotifyTrackId !== "string" || !spotifyTrackLink(e.spotifyTrackId, typeof e.spotifyTrackUrl === "string" ? e.spotifyTrackUrl : undefined)) throw new Error("invalid Spotify track");
        out.spotifyTrackId = e.spotifyTrackId; out.spotifyTrackUrl = spotifyTrackLink(e.spotifyTrackId, e.spotifyTrackUrl as string) ?? undefined;
      }
      if (e.spotifyAlbumId != null) { if (typeof e.spotifyAlbumId !== "string" || !spotifyAlbumLink(e.spotifyAlbumId)) throw new Error("invalid Spotify album"); out.spotifyAlbumId = e.spotifyAlbumId; }
      return out;
    });
    return { ok: true, value: { kind: x.kind, slug: x.slug, title: text(x.title, "title")!, description: text(x.description, "description") ?? null, curatorNotes: text(x.curatorNotes, "curatorNotes") ?? null, coverArt: text(x.coverArt, "coverArt") ?? null, entries } };
  } catch (err) { return { ok: false, error: err instanceof Error ? err.message : "invalid collection" }; }
}

export const playerCapability = {
  available: false,
  kind: "byom-web-component",
  reason: "No stable BYOM web-component contract has been verified.",
} as const;