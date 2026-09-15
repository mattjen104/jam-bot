import { useMemo } from "react";
import { Link } from "wouter";
import { useGetMyAlbums, getGetMyAlbumsQueryKey } from "@workspace/api-client-react";
import { proxyArtUrl } from "../lib/proxyArt";
import { onArtError } from "../lib/rumours";

export function DemoAlbumsView({
  focusedArtist,
  returnContext,
}: {
  focusedArtist: string | null;
  returnContext: string;
}) {
  const albumsQuery = useGetMyAlbums({
    query: {
      queryKey: getGetMyAlbumsQueryKey(),
    },
  });

  const albums = useMemo(() => {
    let items = albumsQuery.data?.items ?? [];
    if (focusedArtist) {
      const lowerFocus = focusedArtist.toLocaleLowerCase();
      items = items.filter((a) => a.artist.toLocaleLowerCase() === lowerFocus);
    }
    return items;
  }, [albumsQuery.data, focusedArtist]);

  if (albumsQuery.isError) {
    return (
      <div className="demo-merged-library__empty" style={{ margin: "40px auto", textAlign: "center" }}>
        <p style={{ color: "hsl(var(--destructive))", fontFamily: "var(--app-font-mono)", fontSize: 13 }}>Couldn't load albums right now.</p>
      </div>
    );
  }

  if (albumsQuery.isLoading) {
    return (
      <div className="demo-merged-library__empty" style={{ margin: "40px auto", textAlign: "center" }}>
        <p style={{ color: "hsl(var(--dim))", fontFamily: "var(--app-font-mono)", fontSize: 13 }}>Loading albums…</p>
      </div>
    );
  }

  if (albums.length === 0) {
    return (
      <div className="demo-merged-library__empty" style={{ margin: "40px auto", textAlign: "center" }}>
        <p style={{ color: "hsl(var(--dim))", fontFamily: "var(--app-font-mono)", fontSize: 13 }}>
          {focusedArtist ? `No albums found for ${focusedArtist}.` : "No albums found in your library or seeds."}
        </p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 840, margin: "0 auto", padding: "12px 14px", paddingBottom: "max(120px, calc(var(--shell-h, 0px) + 20px))" }}>
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
        gap: "24px 16px",
      }}>
        {albums.map((album) => (
          <Link
            key={album.releaseGroupMbid}
            href={`/album/${album.releaseGroupMbid}?return=${encodeURIComponent(returnContext)}`}
            style={{ textDecoration: "none", color: "inherit", display: "flex", flexDirection: "column", gap: 8 }}
            className="demo-album-card"
          >
            <div style={{
              width: "100%",
              aspectRatio: "1/1",
              backgroundColor: "hsl(var(--secondary))",
              borderRadius: 6,
              overflow: "hidden",
              border: "1px solid hsl(var(--border) / 0.5)",
            }}>
              {album.artworkUrl ? (
                <img
                  src={proxyArtUrl(album.artworkUrl) ?? album.artworkUrl}
                  alt={album.title}
                  loading="lazy"
                  onError={onArtError}
                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                />
              ) : (
                <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, color: "hsl(var(--faint))" }}>NO ART</span>
                </div>
              )}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{
                fontFamily: "var(--app-font-display)",
                fontSize: 14,
                fontWeight: 400,
                color: "hsl(var(--foreground))",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                lineHeight: 1.2,
                marginBottom: 2,
              }}>
                {album.title}
              </div>
              <div style={{
                fontFamily: "var(--app-font-reading)",
                fontSize: 12,
                color: "hsl(var(--dim))",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                lineHeight: 1.2,
                marginBottom: 4,
              }}>
                {album.artist}
              </div>
              <div style={{
                fontFamily: "var(--app-font-mono)",
                fontSize: 10,
                color: "hsl(var(--faint))",
                display: "flex",
                flexWrap: "wrap",
                gap: "0 6px",
              }}>
                {album.releaseYear && <span>{album.releaseYear}</span>}
                {album.primaryType && <span style={{ textTransform: "capitalize" }}>{album.primaryType}</span>}
                {album.libraryTrackCount > 0 && <span>{album.libraryTrackCount}/{album.trackCount} lib</span>}
                {album.spinCount > 0 && <span>{album.spinCount} plays</span>}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
