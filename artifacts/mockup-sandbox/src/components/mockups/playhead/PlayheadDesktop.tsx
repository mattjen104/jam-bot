import React from "react";
import "./_group.css";

export function PlayheadDesktop() {
  return (
    <div
      className="min-h-screen w-full flex flex-col font-grotesk ph-grain overflow-hidden"
      style={{
        backgroundColor: "var(--ph-bg)",
        color: "var(--ph-text)",
      }}
    >
      {/* TOP BAR */}
      <header
        className="h-[72px] shrink-0 border-b flex items-center justify-between px-6 z-20"
        style={{
          backgroundColor: "var(--ph-bg-surface)",
          borderColor: "var(--ph-bg-elevated)",
        }}
      >
        <div className="flex items-center gap-4">
          <img
            src="/__mockup/images/ph-album-art.png"
            alt="Album Art"
            className="w-12 h-12 rounded shadow-lg object-cover"
          />
          <div className="flex flex-col">
            <h1 className="text-lg font-medium leading-none mb-1">Bohemian Rhapsody</h1>
            <span className="text-sm" style={{ color: "var(--ph-text-muted)" }}>
              Queen · A Night at the Opera (1975)
            </span>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3">
            <div className="flex -space-x-2">
              <div className="w-8 h-8 rounded-full bg-[#1C1B22] border-2 border-[#16151A] flex items-center justify-center text-[10px]">A</div>
              <div className="w-8 h-8 rounded-full bg-[#2A2930] border-2 border-[#16151A] flex items-center justify-center text-[10px]">B</div>
              <div className="w-8 h-8 rounded-full bg-[#3A3940] border-2 border-[#16151A] flex items-center justify-center text-[10px]">C</div>
            </div>
            <div
              className="flex items-center gap-2 px-3 py-1.5 rounded-full border"
              style={{
                backgroundColor: "var(--ph-bg-elevated)",
                borderColor: "rgba(255, 59, 107, 0.3)",
              }}
            >
              <div
                className="w-2 h-2 rounded-full pulse-dot"
                style={{ backgroundColor: "var(--ph-live)" }}
              ></div>
              <span className="text-xs font-mono-custom tracking-widest text-[#FF3B6B]">
                412 LIVE
              </span>
            </div>
          </div>

          <div className="h-8 w-px bg-[#2A2930]"></div>

          <div className="flex items-center gap-2 opacity-80">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
            <span className="text-xs font-mono-custom tracking-wider text-[#C9C4B8]">
              SYNCED @2:14
            </span>
          </div>
        </div>
      </header>

      {/* THREE LANES */}
      <main className="flex-1 flex overflow-hidden relative">
        
        {/* GLOBAL NOW INDICATOR (Horizontal Line crossing all lanes) */}
        <div 
          className="absolute left-0 right-0 h-[1px] pointer-events-none z-30 opacity-50"
          style={{ 
            top: "40%", 
            background: "linear-gradient(90deg, rgba(255,106,43,0) 0%, rgba(255,106,43,1) 50%, rgba(255,106,43,0) 100%)",
            boxShadow: "0 0 10px 1px rgba(255,106,43,0.5)"
          }}
        ></div>

        {/* LEFT LANE: Atemporal Context */}
        <section className="w-[380px] shrink-0 border-r border-[#2A2930] flex flex-col overflow-y-auto custom-scrollbar bg-[#0B0B0D]">
          <div className="p-6 flex flex-col gap-8">
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-[11px] font-mono-custom tracking-widest opacity-60">CONTEXT SHELF</h2>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="opacity-40"><path d="M4 6h16M4 12h16M4 18h7"/></svg>
              </div>
              
              <div className="relative rounded-xl overflow-hidden mb-4 border border-[#2A2930]">
                <img src="/__mockup/images/ph-haze.png" className="w-full h-32 object-cover opacity-60" alt="" />
                <div className="absolute inset-0 bg-gradient-to-t from-[#0B0B0D] to-transparent"></div>
                <div className="absolute bottom-3 left-3 text-sm font-medium">Recording History</div>
              </div>

              <div className="space-y-4">
                <div className="flex gap-3">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#737373] mt-1.5 shrink-0"></div>
                  <p className="text-[13px] leading-relaxed text-[#C9C4B8]">
                    Recorded across 5 different studios (Rockfield, Roundhouse, SARM, Scorpion, Wessex) between August and September 1975. The operatic section alone required over 180 vocal overdubs.
                  </p>
                </div>
                <div className="flex gap-3">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#737373] mt-1.5 shrink-0"></div>
                  <p className="text-[13px] leading-relaxed text-[#C9C4B8]">
                    The analog tape was worn nearly transparent from the sheer number of passes required to layer the choir section.
                  </p>
                </div>
              </div>
            </div>

            <div className="h-px w-full bg-[#2A2930]"></div>

            {/* Critical Verdict */}
            <div>
              <h2 className="text-[11px] font-mono-custom tracking-widest opacity-60 mb-4">CRITICAL VERDICT (OUTRO)</h2>
              
              <div className="flex flex-col gap-4">
                {/* Consensus */}
                <div className="p-4 rounded-lg bg-[#1C1B22] border border-[#2A2930]">
                  <div className="flex justify-between items-start mb-3">
                    <span
                      className="px-1.5 py-0.5 text-[10px] font-mono-custom rounded font-bold"
                      style={{ backgroundColor: "var(--chip-rym)", color: "#fff" }}
                    >
                      RYM
                    </span>
                    <div className="text-right">
                      <div className="text-lg font-bold">4.33</div>
                      <div className="text-[10px] font-mono-custom opacity-50">142,000+ RATINGS</div>
                    </div>
                  </div>
                  <p className="text-sm font-serif-custom italic opacity-90 leading-relaxed">
                    "A monument to studio excess that somehow coalesces into perfect pop architecture."
                  </p>
                </div>

                {/* Dissent */}
                <div className="p-4 rounded-lg border border-dashed border-[#2A2930]">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[10px] font-mono-custom opacity-50 uppercase">Dissenting Voice</span>
                  </div>
                  <p className="text-[13px] text-[#C9C4B8]">
                    "Overwrought, bombastic, and entirely devoid of the blues root that gives rock its soul."
                    <br/>
                    <span className="text-[11px] opacity-50 mt-2 block">— Rolling Stone (1976 review)</span>
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* CENTER LANE: Timeline Spine & Now Card */}
        <section className="flex-1 relative flex justify-center bg-[#16151A]">
          {/* Reaction Heat Topography */}
          <div className="absolute left-12 top-0 bottom-0 w-24 opacity-20 pointer-events-none flex flex-col justify-between py-12">
            <div className="w-full h-[5%] bg-gradient-to-r from-transparent to-[#FF3B6B]"></div>
            <div className="w-full h-[2%] bg-gradient-to-r from-transparent to-[#FF3B6B] opacity-50"></div>
            <div className="w-[150%] h-[15%] bg-gradient-to-r from-transparent to-[#FF3B6B] -ml-12 rounded-r-full blur-md"></div>
            <div className="w-full h-[40%] flex flex-col justify-center">
               <div className="w-[200%] h-32 bg-[#FF3B6B] -ml-24 rounded-r-full blur-xl opacity-80"></div>
            </div>
            <div className="w-full h-[10%] bg-gradient-to-r from-transparent to-[#FF3B6B] opacity-40"></div>
          </div>

          {/* Timeline Spine */}
          <div className="absolute left-32 top-0 bottom-0 w-1 bg-[#2A2930]">
            {/* Played portion */}
            <div className="absolute top-0 w-full bg-[#4A4950]" style={{ height: "40%" }}></div>
            
            {/* Markers */}
            <div className="absolute w-3 h-3 rounded-full bg-[#737373] -left-1" style={{ top: "10%" }}></div>
            <div className="absolute w-3 h-3 rounded-full bg-[#8b5cf6] -left-1" style={{ top: "25%" }}></div>
            
            {/* THE PLAYHEAD POSITION */}
            <div 
              className="absolute w-5 h-5 rounded-full border-4 border-[#16151A] shadow-xl z-20" 
              style={{ top: "40%", left: "-8px", backgroundColor: "var(--ph-accent)", transform: "translateY(-50%)" }}
            ></div>
            
            <div className="absolute w-3 h-3 rounded-full bg-[#eab308] -left-1" style={{ top: "70%" }}></div>
            <div className="absolute w-3 h-3 rounded-full bg-[#ff0000] -left-1" style={{ top: "85%" }}></div>
          </div>

          {/* Center Content Area */}
          <div className="w-full max-w-[500px] h-full flex flex-col pt-[35vh]">
            {/* Expanded Now-Card */}
            <div className="w-full">
              <div className="flex items-center gap-4 mb-4 pl-4">
                <div className="text-3xl font-mono-custom font-bold text-[#FF6A2B] playhead-glow px-2">2:14</div>
                <div className="h-px flex-1 bg-[#FF6A2B] opacity-30"></div>
              </div>

              <div 
                className="p-6 rounded-2xl border backdrop-blur-md relative overflow-hidden shadow-2xl"
                style={{
                  backgroundColor: "rgba(28, 27, 34, 0.9)",
                  borderColor: "rgba(255, 106, 43, 0.4)",
                  boxShadow: "0 20px 40px -10px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.1)"
                }}
              >
                <div className="absolute -top-20 -right-20 w-64 h-64 bg-[#FF6A2B] rounded-full mix-blend-screen filter blur-[80px] opacity-10 pointer-events-none"></div>
                
                <div className="flex items-center gap-3 mb-6 relative z-10">
                  <span
                    className="px-2 py-1 text-[11px] font-mono-custom rounded font-bold"
                    style={{ backgroundColor: "var(--chip-yt)", color: "#fff" }}
                  >
                    YOUTUBE
                  </span>
                  <span className="text-[12px] font-mono-custom text-[#C9C4B8]">
                    Rick Beato · What Makes This Song Great? Ep. 38
                  </span>
                  <div className="ml-auto flex items-center gap-1">
                    <span className="text-[11px] font-mono-custom text-[#FF6A2B]">★ CRYSTALLIZED</span>
                  </div>
                </div>

                <p className="text-[18px] leading-relaxed mb-6 font-serif-custom relative z-10">
                  "Brian May's guitar 'orchestra' is a single Red Special multitracked through his home-built 'Deacy Amp'. People think it's a synthesizer. <strong>There are absolutely no synthesizers on this record.</strong>"
                </p>

                <div className="flex items-center gap-4 relative z-10">
                  <button className="px-4 py-2 bg-[#2A2930] hover:bg-[#3A3940] rounded text-[11px] font-mono-custom font-bold transition-colors flex items-center gap-2">
                    PLAY EXCERPT <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M5 3l14 9-14 9V3z"/></svg>
                  </button>
                  <button className="px-4 py-2 border border-[#2A2930] hover:border-[#4A4950] rounded text-[11px] font-mono-custom transition-colors flex items-center gap-2">
                    OPEN SOURCE <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
                  </button>
                </div>
              </div>

              {/* Rewind affordance */}
              <div className="mt-12 flex justify-center">
                <button className="px-4 py-2 rounded-full border border-[#2A2930] bg-[#16151A] text-[11px] font-mono-custom opacity-70 hover:opacity-100 transition-all flex items-center gap-2 shadow-lg">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 19l-7-7 7-7M20 19l-7-7 7-7"/></svg>
                  REWIND TO THE DROP
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* RIGHT LANE: Live Stream */}
        <section className="w-[340px] shrink-0 border-l border-[#2A2930] bg-[#0B0B0D] flex flex-col relative z-40">
          
          <div className="p-4 border-b border-[#2A2930] flex items-center justify-between bg-[#111114]">
            <span className="text-[11px] font-mono-custom tracking-widest text-[#FF3B6B] flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full pulse-dot bg-[#FF3B6B]"></div>
              THE ROOM
            </span>
            <span className="text-[11px] font-mono-custom opacity-50">412 ACTIVE</span>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar p-4 flex flex-col gap-6 pt-[10vh]">
            
            {/* Crystallization Visual at the top (near playhead horizontal line) */}
            <div className="p-3 rounded-lg bg-[#1C1B22]/80 border border-[#FF6A2B]/40 relative mt-[20vh] mb-4 z-10 shadow-[0_0_15px_rgba(255,106,43,0.15)]">
               <div className="absolute -left-4 top-1/2 w-4 border-t border-dashed border-[#FF6A2B]"></div>
               <div className="flex items-center gap-2 text-[10px] font-mono-custom text-[#FF6A2B] mb-2">
                <span>↑ 42</span>
                <span>·</span>
                <span>→ SETTLING ON TIMELINE ★</span>
              </div>
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-[11px] font-mono-custom opacity-50">@2:14</span>
                <span className="text-[12px] font-bold text-[#eab308]">FreddieFanatic</span>
              </div>
              <p className="text-[13px] text-white">This tone defies logic. Pure analog magic.</p>
            </div>

            {/* Chat History below */}
            <div className="flex flex-col gap-5 mt-4 opacity-80">
              <div className="flex flex-col gap-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-[11px] font-mono-custom opacity-50">@2:11</span>
                  <span className="text-[12px] font-bold" style={{ color: "#8b5cf6" }}>User_X9</span>
                </div>
                <p className="text-[13px]">Wait, that tone isn't a synth??</p>
              </div>

              {/* Curator On-Demand */}
              <div className="flex flex-col gap-1 ml-3 pl-3 border-l-2 border-[#2A2930]">
                <div className="flex items-baseline gap-2">
                  <span className="text-[11px] font-mono-custom opacity-50">@2:12</span>
                  <span className="text-[12px] font-bold" style={{ color: "#FF6A2B" }}>The Curator</span>
                  <span className="text-[9px] uppercase px-1 rounded bg-[#2A2930]">Bot</span>
                </div>
                <div className="mt-1 p-2 rounded bg-[#1C1B22] border border-[#2A2930]">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="px-1.5 py-0.5 text-[9px] font-mono-custom rounded font-bold bg-[#737373] text-white">WIKI</span>
                    <span className="text-[10px] font-mono-custom opacity-70">Deacy Amp</span>
                  </div>
                  <p className="text-[12px]">Built by John Deacon from a circuit board found in a skip, powered by a 9-volt battery.</p>
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-[11px] font-mono-custom opacity-50">@2:13</span>
                  <span className="text-[12px] font-bold" style={{ color: "#3b82f6" }}>ToneGeek</span>
                </div>
                <p className="text-[13px]">The layering is insane. Literally sounding like a cello section.</p>
                <div className="flex gap-1 mt-1">
                  <span className="text-[10px] bg-[#1C1B22] px-1.5 py-0.5 rounded border border-[#2A2930]">🤯 4</span>
                </div>
              </div>
            </div>

          </div>

          <div className="p-4 border-t border-[#2A2930] bg-[#111114]">
            <div className="w-full bg-[#1C1B22] border border-[#2A2930] rounded-full px-4 py-2.5 flex items-center justify-between">
              <span className="text-[12px] text-[#C9C4B8] opacity-50">Type your take...</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="opacity-50"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
            </div>
          </div>
        </section>

      </main>
    </div>
  );
}
