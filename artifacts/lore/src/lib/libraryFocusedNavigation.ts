const ALBUM_KEY_SEPARATOR = "\x1f";

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