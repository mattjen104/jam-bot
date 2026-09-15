import { useMemo } from "react";
import { useGetMyMerch, getGetMyMerchQueryKey } from "@workspace/api-client-react";
import { proxyArtUrl } from "../lib/proxyArt";
import { onArtError } from "../lib/rumours";
import { ExternalLink } from "lucide-react";

export function DemoMerchView({
  focusedArtist,
}: {
  focusedArtist: string | null;
}) {
  const merchQuery = useGetMyMerch({
    query: {
      queryKey: getGetMyMerchQueryKey(),
    },
  });

  const merch = useMemo(() => {
    let items = merchQuery.data?.items ?? [];
    if (focusedArtist) {
      const lowerFocus = focusedArtist.toLocaleLowerCase();
      items = items.filter((a) => a.artist.toLocaleLowerCase() === lowerFocus);
    }
    return items;
  }, [merchQuery.data, focusedArtist]);

  if (merchQuery.isError) {
    return (
      <div className="demo-merged-library__empty" style={{ margin: "40px auto", textAlign: "center" }}>
        <p style={{ color: "hsl(var(--destructive))", fontFamily: "var(--app-font-mono)", fontSize: 13 }}>Couldn't load merch right now.</p>
      </div>
    );
  }

  if (merchQuery.isLoading) {
    return (
      <div className="demo-merged-library__empty" style={{ margin: "40px auto", textAlign: "center" }}>
        <p style={{ color: "hsl(var(--dim))", fontFamily: "var(--app-font-mono)", fontSize: 13 }}>Loading merch…</p>
      </div>
    );
  }

  if (merch.length === 0) {
    return (
      <div className="demo-merged-library__empty" style={{ margin: "40px auto", textAlign: "center" }}>
        <p style={{ color: "hsl(var(--dim))", fontFamily: "var(--app-font-mono)", fontSize: 13 }}>
          {focusedArtist ? `No merch found for ${focusedArtist}.` : "No merch found in your library or seeds."}
        </p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 840, margin: "0 auto", padding: "12px 14px", paddingBottom: "max(120px, calc(var(--shell-h, 0px) + 20px))" }}>
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
        gap: "24px 16px",
      }}>
        {merch.map((item, i) => (
          <a
            key={`${item.title}-${item.artist}-${i}`}
            href={item.destinationUrl}
            target="_blank"
            rel="noopener noreferrer"
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
              position: "relative",
            }}>
              {item.imageUrl ? (
                <img
                  src={proxyArtUrl(item.imageUrl) ?? item.imageUrl}
                  alt={item.title}
                  loading="lazy"
                  onError={onArtError}
                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                />
              ) : (
                <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, color: "hsl(var(--faint))" }}>NO ART</span>
                </div>
              )}
              <div style={{
                position: "absolute",
                top: 6,
                right: 6,
                background: "hsl(var(--background) / 0.75)",
                backdropFilter: "blur(4px)",
                borderRadius: "50%",
                padding: 4,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "hsl(var(--foreground))",
              }}>
                <ExternalLink size={12} />
              </div>
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{
                fontFamily: "var(--app-font-display)",
                fontSize: 14,
                fontWeight: 400,
                color: "hsl(var(--foreground))",
                lineHeight: 1.2,
                marginBottom: 2,
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}>
                {item.title}
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
                {item.artist}
              </div>
              <div style={{
                fontFamily: "var(--app-font-mono)",
                fontSize: 10,
                color: "hsl(var(--faint))",
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}>
                <span style={{ 
                  textTransform: "uppercase", 
                  letterSpacing: "0.05em",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 3,
                  padding: "1px 4px",
                  background: "hsl(var(--secondary) / 0.5)",
                }}>
                  {item.source}
                </span>
                {item.provider && (
                  <span style={{ color: "hsl(var(--muted-foreground))" }}>via {item.provider}</span>
                )}
              </div>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
