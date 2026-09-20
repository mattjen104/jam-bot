export type CanonicalAlbumTrack = {
  mbid: string;
  title: string;
  artist: string;
};

export type ProviderAlbumLinks = Partial<Record<
  "spotify" | "appleMusic" | "qobuz" | "bandcamp",
  string
>>;

export function buildCanonicalAlbumJspf(input: {
  releaseGroupMbid: string;
  title: string;
  artist: string | null;
  artworkUrl: string | null;
  tracks: CanonicalAlbumTrack[];
  providerAlbumLinks?: ProviderAlbumLinks;
}) {
  const providerMeta = {
    ...(input.providerAlbumLinks?.spotify ? { "lore:spotify-album": input.providerAlbumLinks.spotify } : {}),
    ...(input.providerAlbumLinks?.appleMusic ? { "lore:album-apple-music": input.providerAlbumLinks.appleMusic } : {}),
    ...(input.providerAlbumLinks?.qobuz ? { "lore:album-qobuz": input.providerAlbumLinks.qobuz } : {}),
    ...(input.providerAlbumLinks?.bandcamp ? { "lore:album-bandcamp": input.providerAlbumLinks.bandcamp } : {}),
  };
  return {
    playlist: {
      title: input.title,
      annotation: "Canonical Lore album export. Track membership is verified; release order may be incomplete.",
      ...(input.artworkUrl ? { image: input.artworkUrl } : {}),
      meta: {
        "lore:version": "lore.collection.v1",
        "lore:kind": "album",
        "lore:release-group": input.releaseGroupMbid,
        "lore:order": "unverified",
        ...providerMeta,
      },
      track: input.tracks.filter((track) => Boolean(track.mbid)).map((track) => ({
        title: track.title,
        creator: track.artist || input.artist || undefined,
        album: input.title,
        identifier: [`musicbrainz:recording:${track.mbid}`],
        meta: {
          "lore:identity": "mbid",
          "lore:provenance-source": "musicbrainz",
          "lore:confidence": "confirmed",
        },
      })),
    },
  };
}