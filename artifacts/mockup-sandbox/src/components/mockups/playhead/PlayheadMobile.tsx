import React from "react";
import "./_group.css";

export function PlayheadMobile() {
  return (
    <div
      className="min-h-screen w-full flex justify-center bg-black py-8"
      style={{
        backgroundColor: "var(--ph-bg)",
        color: "var(--ph-text)",
      }}
    >
      <div
        className="w-[402px] max-w-full relative flex flex-col font-grotesk overflow-hidden ph-grain shadow-2xl"
        style={{ backgroundColor: "var(--ph-bg-surface)" }}
      >
        {/* PERSISTENT TOP ANCHOR */}
        <div
          className="sticky top-0 z-20 flex flex-col px-4 pt-6 pb-4 border-b"
          style={{
            backgroundColor: "rgba(22, 21, 26, 0.85)",
            backdropFilter: "blur(12px)",
            borderColor: "var(--ph-bg-elevated)",
          }}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <img
                src="/__mockup/images/ph-album-art.png"
                alt="A Night at the Opera"
                className="w-12 h-12 rounded-sm object-cover shadow-lg"
              />
              <div className="flex flex-col">
                <span className="text-sm font-medium">Bohemian Rhapsody</span>
                <span
                  className="text-xs"
                  style={{ color: "var(--ph-text-muted)" }}
                >
                  Queen · 1975
                </span>
              </div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <div
                className="flex items-center gap-2 px-2 py-1 rounded-full bg-black/40 border"
                style={{ borderColor: "var(--ph-bg-elevated)" }}
              >
                <div
                  className="w-1.5 h-1.5 rounded-full pulse-dot"
                  style={{ backgroundColor: "var(--ph-live)" }}
                ></div>
                <span className="text-[10px] font-mono-custom tracking-wide">
                  412 LISTENING
                </span>
              </div>
              <div className="flex items-center gap-1.5 opacity-80">
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                </svg>
                <span className="text-[10px] font-mono-custom text-[#C9C4B8]">
                  SYNCED @2:14
                </span>
              </div>
            </div>
          </div>
          <div className="flex justify-center mt-1 opacity-50 cursor-pointer">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col relative z-10 pb-[140px]">
          {/* THE NOW-CARD */}
          <div className="px-4 py-6 flex flex-col gap-4 relative">
            {/* Scrubber Ribbon */}
            <div className="relative w-full h-8 flex flex-col justify-center">
              <div
                className="absolute w-full h-1 bg-[#1C1B22] rounded-full overflow-hidden"
              >
                {/* Heatmap overlay */}
                <div className="absolute inset-0 flex items-end">
                  <div className="w-[10%] h-[20%] bg-[#FF3B6B]/20"></div>
                  <div className="w-[20%] h-[40%] bg-[#FF3B6B]/40"></div>
                  <div className="w-[5%] h-[80%] bg-[#FF3B6B]/60"></div>
                  <div className="w-[20%] h-[30%] bg-[#FF3B6B]/30"></div>
                </div>
              </div>
              
              {/* Progress */}
              <div
                className="absolute h-1 rounded-full"
                style={{ width: "38%", backgroundColor: "var(--ph-accent)" }}
              ></div>

              {/* Playhead */}
              <div
                className="absolute w-[2px] h-4 top-1/2 -translate-y-1/2 playhead-glow"
                style={{ left: "38%", backgroundColor: "var(--ph-accent)" }}
              ></div>
              <div
                className="absolute text-[10px] font-mono-custom font-bold"
                style={{ left: "38%", top: "20px", color: "var(--ph-accent)", transform: "translateX(-50%)" }}
              >
                2:14
              </div>

              {/* Markers */}
              <div className="absolute w-1.5 h-1.5 rounded-full bg-[#ff0000] top-1/2 -translate-y-1/2 left-[38%] ring-2 ring-[#16151A]"></div>
              <div className="absolute w-1.5 h-1.5 rounded-full bg-[#737373] top-1/2 -translate-y-1/2 left-[15%] ring-2 ring-[#16151A]"></div>
              <div className="absolute w-1.5 h-1.5 rounded-full bg-[#eab308] top-1/2 -translate-y-1/2 left-[70%] ring-2 ring-[#16151A]"></div>
            </div>

            {/* Now-Card Content */}
            <div
              className="mt-6 p-4 rounded-xl border relative overflow-hidden"
              style={{
                backgroundColor: "var(--ph-bg-elevated)",
                borderColor: "rgba(255, 106, 43, 0.2)",
              }}
            >
              {/* Subtle background glow image */}
              <div className="absolute top-0 right-0 w-32 h-32 opacity-20 mix-blend-screen pointer-events-none">
                <img src="/__mockup/images/ph-needle.png" className="w-full h-full object-cover rounded-full blur-xl" alt="" />
              </div>

              <div className="flex items-center gap-2 mb-3 relative z-10">
                <span
                  className="px-1.5 py-0.5 text-[9px] font-mono-custom rounded font-bold"
                  style={{ backgroundColor: "var(--chip-yt)", color: "#fff" }}
                >
                  YT
                </span>
                <span className="text-[10px] font-mono-custom text-[#C9C4B8]">
                  via Rick Beato · What Makes This Song Great
                </span>
                <div className="ml-auto text-[#FF6A2B] flex items-center gap-1 text-[10px] font-mono-custom">
                  ★ CRYSTALLIZED
                </div>
              </div>

              <p className="text-[15px] leading-relaxed mb-4 relative z-10">
                Brian May's guitar "orchestra" here is a single Red Special multitracked through his home-built "Deacy Amp"—<strong>there are no synthesizers on this record.</strong>
              </p>

              <div className="flex items-center justify-between mt-2 pt-3 border-t border-[#2A2930] relative z-10">
                <button className="text-[11px] font-mono-custom flex items-center gap-1 opacity-70 hover:opacity-100 transition-opacity">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
                  VIEW SOURCE
                </button>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono-custom text-[#C9C4B8]">SEE DISSENT</span>
                  <div className="w-6 h-3 rounded-full bg-[#16151A] border border-[#2A2930] flex items-center p-[1px]">
                    <div className="w-2 h-2 rounded-full bg-[#737373]"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* THE LIVE STREAM */}
          <div className="px-4 flex-1 flex flex-col gap-4 pb-8">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-mono-custom text-[#FF3B6B]">LIVE CHAT</span>
              <div className="flex-1 h-px bg-[#2A2930]"></div>
            </div>

            {/* Chat Message */}
            <div className="flex flex-col gap-1">
              <div className="flex items-baseline gap-2">
                <span className="text-[11px] font-mono-custom opacity-50">@2:11</span>
                <span className="text-[12px] font-bold" style={{ color: "#8b5cf6" }}>User_X9</span>
              </div>
              <p className="text-[14px] opacity-90">Wait, that tone isn't a synth??</p>
            </div>

            {/* Curator Answer Example */}
            <div className="flex flex-col gap-1 ml-4 pl-3 border-l-2 border-[#2A2930]">
              <div className="flex items-baseline gap-2">
                <span className="text-[11px] font-mono-custom opacity-50">@2:12</span>
                <span className="text-[12px] font-bold" style={{ color: "#FF6A2B" }}>The Curator</span>
              </div>
              <div className="mt-1 p-2.5 rounded bg-[#1C1B22] border border-[#2A2930]">
                <div className="flex items-center gap-2 mb-1.5">
                  <span
                    className="px-1.5 py-0.5 text-[9px] font-mono-custom rounded font-bold"
                    style={{ backgroundColor: "var(--chip-wiki)", color: "#fff" }}
                  >
                    WIKI
                  </span>
                  <span className="text-[10px] font-mono-custom opacity-70">Deacy Amp</span>
                </div>
                <p className="text-[13px] opacity-90">
                  Built by John Deacon from a circuit board found in a skip, powered by a 9-volt battery.
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <div className="flex items-baseline gap-2">
                <span className="text-[11px] font-mono-custom opacity-50">@2:13</span>
                <span className="text-[12px] font-bold" style={{ color: "#3b82f6" }}>ToneGeek</span>
              </div>
              <p className="text-[14px] opacity-90">The layering is insane. Literally sounding like a cello section.</p>
              <div className="flex gap-1 mt-1">
                <span className="text-xs bg-[#1C1B22] px-1.5 py-0.5 rounded border border-[#2A2930]">🤯 4</span>
                <span className="text-xs bg-[#1C1B22] px-1.5 py-0.5 rounded border border-[#2A2930]">🎸 12</span>
              </div>
            </div>

            {/* Crystallizing Message */}
            <div className="flex flex-col gap-1 p-2 rounded-lg bg-[#1C1B22]/50 border border-[#FF6A2B]/30 relative overflow-hidden mt-2">
              <div className="absolute inset-0 bg-gradient-to-t from-transparent to-[#FF6A2B]/5 pointer-events-none"></div>
              <div className="flex items-center gap-2 text-[10px] font-mono-custom text-[#FF6A2B] mb-1">
                <span>↑ 42</span>
                <span>·</span>
                <span>→ pinned to 2:14 ★</span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-[11px] font-mono-custom opacity-50">@2:14</span>
                <span className="text-[12px] font-bold" style={{ color: "#eab308" }}>FreddieFanatic</span>
              </div>
              <p className="text-[14px] text-white">This is the exact moment music history changed forever.</p>
            </div>

            {/* Live froth */}
            <div className="flex items-center gap-2 mt-4 opacity-50 chat-crystallize">
              <span className="w-1.5 h-1.5 rounded-full bg-white pulse-dot"></span>
              <span className="text-[11px] font-mono-custom">stranger is typing...</span>
            </div>
          </div>
        </div>

        {/* BRANCH DOCK */}
        <div
          className="absolute bottom-0 left-0 right-0 z-30 pt-6 pb-6 px-4 flex flex-col gap-3 backdrop-blur-xl border-t"
          style={{
            background: "linear-gradient(to bottom, rgba(22,21,26,0.5) 0%, rgba(11,11,13,0.95) 40%, rgba(11,11,13,1) 100%)",
            borderColor: "var(--ph-bg-elevated)",
          }}
        >
          <div className="flex justify-between items-end mb-1">
            <span className="text-[11px] font-mono-custom tracking-wide opacity-70 flex items-center gap-2">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
              UP NEXT — ROOM IS VOTING
            </span>
            <span className="text-[9px] font-mono-custom opacity-40">data thins out on deep cuts</span>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between p-2 rounded bg-[#1C1B22] border border-[#2A2930]">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded bg-[#2A2930] flex items-center justify-center text-[10px]">👑</div>
                <div className="flex flex-col">
                  <span className="text-[12px] font-medium leading-none">Somebody to Love</span>
                  <span className="text-[10px] text-[#C9C4B8] mt-0.5">Queen</span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[11px] font-mono-custom text-[#FF6A2B]">142 VITES</span>
                <div className="w-4 h-4 rounded-full border border-[#FF6A2B] flex items-center justify-center">
                  <div className="w-2 h-2 rounded-full bg-[#FF6A2B]"></div>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between p-2 rounded border border-transparent hover:border-[#2A2930] transition-colors cursor-pointer">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded bg-transparent border border-[#2A2930] flex items-center justify-center"></div>
                <div className="flex flex-col">
                  <span className="text-[12px] font-medium leading-none opacity-80">Life on Mars?</span>
                  <span className="text-[10px] text-[#C9C4B8] mt-0.5 flex items-center gap-1">
                    <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                    David Bowie
                  </span>
                </div>
              </div>
              <span className="text-[11px] font-mono-custom opacity-50">89 VOTES</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
