import "./_group.css";

export function UnfurlCard() {
  return (
    <div className="min-h-screen flex items-center justify-center p-8" style={{ background: "#16131f" }}>
      <div style={{ width: 680, fontFamily: "'Slack-Lato', 'Lato', sans-serif" }}>

        {/* Human message */}
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 2 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 8, flexShrink: 0,
            background: "#3b3260",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#c4b8f0", fontWeight: 700, fontSize: 14,
          }}>MK</div>
          <div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
              <span style={{ color: "#d4ccf5", fontWeight: 700, fontSize: 15 }}>Mika</span>
              <span style={{ color: "#5a5470", fontSize: 12 }}>Today at 2:17 PM</span>
            </div>
            <p style={{ color: "#c8c0e8", fontSize: 14, margin: "0 0 8px", lineHeight: 1.6 }}>
              this is the song I was telling you about 👇
            </p>
            <p style={{ color: "#6b5fa0", fontSize: 13, margin: "0 0 10px", textDecoration: "underline", wordBreak: "break-all" }}>
              https://lore.radio/api/share/songs/60ef6538-feaa-4b8f-a6b5-e8a3dfd7e2d2
            </p>

            {/* Unfurl card — mimics the og:image card we actually ship */}
            <div style={{
              borderRadius: 8,
              border: "1px solid #2d2641",
              overflow: "hidden",
              width: 500,
            }}>
              {/* The actual share card image */}
              <div style={{
                background: "#0f0d16",
                padding: "28px 32px",
                display: "flex",
                flexDirection: "column",
                gap: 20,
              }}>
                {/* Top label */}
                <div style={{ color: "#7c6fa8", fontSize: 10, fontWeight: 700, letterSpacing: "0.15em" }}>
                  ONE SONG, TOLD IN FULL
                </div>

                {/* Song row */}
                <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
                  {/* Album art placeholder */}
                  <div style={{
                    width: 90, height: 90, borderRadius: 6, flexShrink: 0,
                    background: "linear-gradient(135deg, #2e2840 0%, #1a1525 100%)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 36, border: "1px solid #2d2641",
                  }}>🌿</div>

                  <div>
                    <div style={{ color: "#f0ecff", fontWeight: 700, fontSize: 26, fontFamily: "Georgia, serif", lineHeight: 1.2, marginBottom: 6 }}>
                      Enemy
                    </div>
                    <div style={{ color: "#9991b8", fontSize: 15 }}>
                      Jesca Hoop
                    </div>
                  </div>
                </div>

                {/* Divider */}
                <div style={{ height: 1, background: "#2d2641" }} />

                {/* Footer row */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ color: "#e4ddf8", fontWeight: 700, fontSize: 16, fontFamily: "Georgia, serif" }}>Lore</span>
                  <span style={{ color: "#5a5470", fontSize: 11 }}>lore · free radio, tracked to the source</span>
                </div>
              </div>

              {/* Slack unfurl footer */}
              <div style={{
                background: "#1d1929",
                padding: "8px 14px",
                borderTop: "1px solid #2d2641",
                display: "flex", justifyContent: "space-between", alignItems: "center",
              }}>
                <span style={{ color: "#5a5470", fontSize: 11 }}>lore.radio</span>
                <div style={{ display: "flex", gap: 8 }}>
                  <button style={{
                    background: "#4a3f6e", border: "1px solid #6b5fa0",
                    color: "#d4ccf5", padding: "4px 12px", borderRadius: 4,
                    fontSize: 12, fontWeight: 600, cursor: "pointer",
                  }}>Open</button>
                  <button style={{
                    background: "transparent", border: "1px solid #2d2641",
                    color: "#5a5470", padding: "4px 10px", borderRadius: 4,
                    fontSize: 12, cursor: "pointer",
                  }}>✕</button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Reaction row */}
        <div style={{ marginLeft: 48, marginTop: 8, display: "flex", gap: 6 }}>
          {[["🎸", 3], ["🔥", 2]].map(([emoji, n]) => (
            <span key={String(emoji)} style={{
              background: "#251f35", border: "1px solid #3a3257",
              borderRadius: 20, padding: "3px 10px",
              fontSize: 13, color: "#9991b8", display: "flex", gap: 4, alignItems: "center",
            }}>
              {emoji} <span style={{ fontSize: 12 }}>{n}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
