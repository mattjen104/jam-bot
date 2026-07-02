import "./_group.css";

export function CommandCard() {
  return (
    <div className="min-h-screen flex items-center justify-center p-8" style={{ background: "#16131f" }}>
      <div style={{ width: 680, fontFamily: "'Slack-Lato', 'Lato', sans-serif" }}>

        {/* User slash command */}
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 16 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 8, flexShrink: 0,
            background: "#2e2840",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#8b7ec8", fontWeight: 700, fontSize: 14,
          }}>JD</div>
          <div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
              <span style={{ color: "#d4ccf5", fontWeight: 700, fontSize: 15 }}>Jamie</span>
              <span style={{ color: "#5a5470", fontSize: 12 }}>Today at 4:03 PM</span>
            </div>
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              background: "#1d1929", border: "1px solid #2d2641",
              borderRadius: 4, padding: "4px 10px",
              color: "#8b7ec8", fontSize: 13, fontFamily: "monospace",
            }}>
              <span style={{ opacity: 0.6 }}>/</span>lore now
            </div>
            <div style={{ color: "#4a4468", fontSize: 11, marginTop: 4 }}>
              Only visible to you
            </div>
          </div>
        </div>

        {/* Bot response */}
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
          <div style={{
            width: 36, height: 36, borderRadius: 8, flexShrink: 0,
            background: "linear-gradient(135deg, #5c4f8a 0%, #8b7ec8 100%)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 18,
          }}>🎙</div>

          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
              <span style={{ color: "#c4b8f0", fontWeight: 700, fontSize: 15 }}>jam-bot</span>
              <span style={{
                background: "#1d1929", border: "1px solid #3a3257",
                color: "#6b5fa0", fontSize: 10, padding: "1px 6px", borderRadius: 3,
                fontWeight: 700, letterSpacing: "0.06em",
              }}>APP</span>
              <span style={{ color: "#5a5470", fontSize: 12 }}>Today at 4:03 PM</span>
            </div>

            {/* Main block */}
            <div style={{
              borderRadius: 8,
              border: "1px solid #2d2641",
              background: "#1d1929",
              overflow: "hidden",
              borderLeft: "4px solid #7c6fa8",
            }}>
              {/* Station header */}
              <div style={{
                padding: "12px 16px",
                borderBottom: "1px solid #231d33",
                display: "flex", justifyContent: "space-between", alignItems: "center",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ color: "#8b7ec8", fontSize: 13 }}>◉</span>
                  <span style={{ color: "#9991b8", fontSize: 13 }}>SomaFM — Groove Salad</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#5db87a", display: "inline-block" }} />
                  <span style={{ color: "#5db87a", fontSize: 11, fontWeight: 600 }}>LIVE</span>
                </div>
              </div>

              {/* Track row */}
              <div style={{ display: "flex", gap: 14, padding: "16px 16px 12px" }}>
                <div style={{
                  width: 80, height: 80, borderRadius: 6, flexShrink: 0,
                  background: "#2e2840",
                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32,
                }}>🌊</div>
                <div style={{ flex: 1 }}>
                  <div style={{ color: "#e4ddf8", fontWeight: 700, fontSize: 18, marginBottom: 3 }}>
                    Go Your Own Way
                  </div>
                  <div style={{ color: "#9991b8", fontSize: 13, marginBottom: 3 }}>
                    Fleetwood Mac
                  </div>
                  <div style={{ color: "#5a5470", fontSize: 12 }}>
                    Rumours · 1977 · 3:38
                  </div>
                </div>
              </div>

              {/* Credits row */}
              <div style={{
                margin: "0 16px",
                display: "flex", gap: 12, flexWrap: "wrap",
              }}>
                {[
                  ["Written by", "Lindsey Buckingham"],
                  ["Produced by", "Richard Dashut"],
                  ["Label", "Warner Bros."],
                ].map(([k, v]) => (
                  <div key={k} style={{ minWidth: 120 }}>
                    <div style={{ color: "#4a4468", fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", marginBottom: 2 }}>{k}</div>
                    <div style={{ color: "#b0a8d0", fontSize: 12 }}>{v}</div>
                  </div>
                ))}
              </div>

              {/* Liner note */}
              <div style={{
                margin: "12px 16px",
                padding: "10px 12px",
                background: "#251f35",
                borderRadius: 6,
                borderLeft: "3px solid #5c4f8a",
              }}>
                <div style={{ color: "#6b5fa0", fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", marginBottom: 4 }}>
                  LINER NOTE
                </div>
                <div style={{ color: "#b0a8d0", fontSize: 13, lineHeight: 1.55 }}>
                  Buckingham wrote this after his split with Nicks. She refused to sing harmony on it during recording — then relented and delivered the part in one take.
                </div>
              </div>

              {/* Actions */}
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
                  ↗ Open in Lore
                </button>
                <button style={{
                  background: "transparent", border: "1px solid #2d2641",
                  color: "#7a7298", padding: "6px 14px", borderRadius: 5,
                  fontSize: 13, cursor: "pointer",
                }}>
                  ♫ Queue in Spotify
                </button>
                <button style={{
                  background: "transparent", border: "1px solid #2d2641",
                  color: "#7a7298", padding: "6px 14px", borderRadius: 5,
                  fontSize: 13, cursor: "pointer",
                }}>
                  📻 See archive
                </button>
              </div>

              {/* Select station */}
              <div style={{
                padding: "10px 16px 14px",
                borderTop: "1px solid #231d33",
              }}>
                <div style={{ color: "#5a5470", fontSize: 11, marginBottom: 8 }}>Switch station</div>
                <select style={{
                  background: "#231d33", border: "1px solid #2d2641",
                  color: "#9991b8", padding: "6px 10px", borderRadius: 5,
                  fontSize: 13, width: "100%", appearance: "none",
                }}>
                  <option>SomaFM — Groove Salad (current)</option>
                  <option>Radio Paradise — Main Mix</option>
                  <option>KCRW — Eclectic 24</option>
                  <option>SomaFM — Drone Zone</option>
                </select>
              </div>
            </div>

            <div style={{ color: "#4a4468", fontSize: 11, marginTop: 6 }}>
              Only visible to you · <span style={{ color: "#6b5fa0", cursor: "pointer" }}>Dismiss</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
