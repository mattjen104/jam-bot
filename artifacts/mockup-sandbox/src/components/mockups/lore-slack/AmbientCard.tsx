import "./_group.css";

export function AmbientCard() {
  return (
    <div className="min-h-screen flex items-center justify-center p-8" style={{ background: "#16131f" }}>
      <div style={{ width: 680, fontFamily: "'Slack-Lato', 'Lato', sans-serif" }}>

        {/* Bot message row */}
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
          {/* Avatar */}
          <div style={{
            width: 36, height: 36, borderRadius: 8, flexShrink: 0,
            background: "linear-gradient(135deg, #5c4f8a 0%, #8b7ec8 100%)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 18,
          }}>🎙</div>

          <div style={{ flex: 1 }}>
            {/* Name + timestamp */}
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
              <span style={{ color: "#c4b8f0", fontWeight: 700, fontSize: 15 }}>jam-bot</span>
              <span style={{ color: "#5a5470", fontSize: 12 }}>Today at 11:42 AM</span>
            </div>

            {/* Intro line */}
            <p style={{ color: "#9991b8", fontSize: 14, margin: "0 0 10px 0", lineHeight: 1.5 }}>
              Track changed on <span style={{ color: "#b8aee0" }}>SomaFM — Groove Salad</span>
            </p>

            {/* Block Kit card */}
            <div style={{
              borderRadius: 8,
              border: "1px solid #2d2641",
              background: "#1d1929",
              overflow: "hidden",
              borderLeft: "4px solid #7c6fa8",
            }}>
              {/* Card body */}
              <div style={{ display: "flex", gap: 14, padding: "14px 16px" }}>
                {/* Album art */}
                <div style={{
                  width: 72, height: 72, borderRadius: 6, flexShrink: 0, overflow: "hidden",
                  background: "#2e2840",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 28,
                }}>🌊</div>

                {/* Track info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: "#e4ddf8", fontWeight: 700, fontSize: 16, marginBottom: 2 }}>
                    Go Your Own Way
                  </div>
                  <div style={{ color: "#9991b8", fontSize: 13, marginBottom: 6 }}>
                    Fleetwood Mac · <em>Rumours</em> · 1977
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <span style={{
                      background: "#2e2840", border: "1px solid #4a3f6e",
                      color: "#8b7ec8", fontSize: 11, padding: "2px 8px", borderRadius: 4,
                      fontWeight: 600, letterSpacing: "0.04em",
                    }}>SomaFM · Groove Salad</span>
                    <span style={{
                      display: "inline-flex", alignItems: "center", gap: 4,
                      color: "#5db87a", fontSize: 11,
                    }}>
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#5db87a", display: "inline-block" }} />
                      LIVE
                    </span>
                  </div>
                </div>
              </div>

              {/* Liner note */}
              <div style={{
                margin: "0 16px 14px",
                padding: "10px 12px",
                background: "#251f35",
                borderRadius: 6,
                borderLeft: "3px solid #5c4f8a",
              }}>
                <div style={{ color: "#6b5fa0", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", marginBottom: 4 }}>
                  LINER NOTE
                </div>
                <div style={{ color: "#b0a8d0", fontSize: 13, lineHeight: 1.5 }}>
                  Lindsey Buckingham wrote this after the breakup with Stevie Nicks — she refused to sing backing vocals on it at first.
                </div>
              </div>

              {/* Action buttons */}
              <div style={{
                padding: "10px 16px 14px",
                display: "flex", gap: 8, flexWrap: "wrap",
              }}>
                <button style={{
                  background: "#4a3f6e", border: "1px solid #6b5fa0",
                  color: "#d4ccf5", padding: "6px 14px", borderRadius: 5,
                  fontSize: 13, fontWeight: 600, cursor: "pointer",
                  display: "flex", alignItems: "center", gap: 6,
                }}>
                  <span>↗</span> Open in Lore
                </button>
                <button style={{
                  background: "transparent", border: "1px solid #2d2641",
                  color: "#7a7298", padding: "6px 14px", borderRadius: 5,
                  fontSize: 13, cursor: "pointer",
                  display: "flex", alignItems: "center", gap: 6,
                }}>
                  <span>⊕</span> Queue in Spotify
                </button>
                <button style={{
                  background: "transparent", border: "1px solid #2d2641",
                  color: "#7a7298", padding: "6px 14px", borderRadius: 5,
                  fontSize: 13, cursor: "pointer",
                }}>
                  Skip
                </button>
              </div>

              {/* Footer */}
              <div style={{
                padding: "8px 16px",
                borderTop: "1px solid #231d33",
                color: "#4a4468", fontSize: 11,
                display: "flex", justifyContent: "space-between",
              }}>
                <span>Posted automatically · Active Jam</span>
                <span>8 listeners</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
