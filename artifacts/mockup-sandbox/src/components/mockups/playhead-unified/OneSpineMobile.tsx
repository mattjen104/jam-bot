import React from "react";
import "./_group.css";

const LENSES = ["Production", "Theory", "Lyrics", "Drama", "Reactions"];

function ConceptTag({ label, color = "var(--ph-accent)" }: { label: string; color?: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[9px] font-mono-custom tracking-widest uppercase" style={{ color }}>
      <span className="w-2 h-px" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

function SourceChip({ label, color }: { label: string; color: string }) {
  return (
    <span className="px-1.5 py-0.5 text-[9px] font-mono-custom rounded font-bold" style={{ backgroundColor: color, color: "#fff" }}>
      {label}
    </span>
  );
}

export function OneSpineMobile() {
  return (
    <div className="min-h-screen w-full flex justify-center bg-black py-8" style={{ backgroundColor: "var(--ph-bg)", color: "var(--ph-text)" }}>
      <div
        className="w-[402px] max-w-full relative flex flex-col font-grotesk overflow-hidden ph-grain shadow-2xl"
        style={{ backgroundColor: "var(--ph-bg-surface)" }}
      >
        {/* TOP ANCHOR */}
        <div
          className="sticky top-0 z-20 flex flex-col px-4 pt-5 pb-3 border-b"
          style={{ backgroundColor: "rgba(22, 21, 26, 0.9)", backdropFilter: "blur(12px)", borderColor: "var(--ph-bg-elevated)" }}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-sm overflow-hidden shadow-lg relative shrink-0">
                <img src="/__mockup/images/ph-needle.png" alt="" className="w-full h-full object-cover" />
                <div className="absolute inset-0" style={{ background: "linear-gradient(135deg, rgba(255,106,43,0.35), rgba(255,59,107,0.25))" }} />
              </div>
              <div className="flex flex-col">
                <span className="text-[14px] font-medium leading-tight">Go Your Own Way</span>
                <span className="text-[11px]" style={{ color: "var(--ph-text-muted)" }}>Fleetwood Mac · 1977</span>
              </div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-black/40 border" style={{ borderColor: "var(--ph-bg-elevated)" }}>
                <div className="w-1.5 h-1.5 rounded-full pulse-dot" style={{ backgroundColor: "var(--ph-live)" }} />
                <span className="text-[10px] font-mono-custom tracking-wide">388 LIVE</span>
              </div>
              <span className="text-[10px] font-mono-custom text-[#C9C4B8]">SYNCED @0:24</span>
            </div>
          </div>

          {/* LENS selector — horizontal scroll */}
          <div className="flex items-center gap-1.5 overflow-x-auto custom-scrollbar -mx-1 px-1 pb-0.5">
            {LENSES.map((l) => {
              const active = l === "Production";
              return (
                <span
                  key={l}
                  className="px-2.5 py-1 rounded-full text-[10px] font-mono-custom whitespace-nowrap shrink-0"
                  style={active ? { backgroundColor: "var(--ph-accent)", color: "#0B0B0D", fontWeight: 700 } : { backgroundColor: "var(--ph-bg-elevated)", color: "var(--ph-text-muted)" }}
                >
                  {l}
                </span>
              );
            })}
          </div>
        </div>

        {/* THE ONE SPINE (scrolls) */}
        <div className="flex-1 overflow-y-auto custom-scrollbar relative pb-[210px]">
          {/* single vertical spine */}
          <div className="absolute top-0 bottom-0 w-[2px] spine-rail" style={{ left: "30px" }} />

          <div className="relative pl-[52px] pr-4 py-5 flex flex-col">
            <ConceptTag label="One Spine · Production lens" />

            {/* played peek */}
            <div className="relative mt-4 opacity-70">
              <div className="absolute w-2.5 h-2.5 rounded-full border-2" style={{ left: "-52px", marginLeft: "25px", top: "3px", backgroundColor: "#737373", borderColor: "var(--ph-bg-surface)" }} />
              <span className="text-[11px] font-mono-custom opacity-60">0:00</span>
              <p className="text-[12px] mt-0.5" style={{ color: "var(--ph-text-muted)" }}>▸ The lone dry guitar riff — no drums yet.</p>
            </div>

            {/* NOW node + card */}
            <div className="relative mt-5">
              <div className="absolute w-4 h-4 rounded-full border-[3px] z-20 playhead-glow" style={{ left: "-52px", marginLeft: "23px", top: "3px", backgroundColor: "var(--ph-accent)", borderColor: "var(--ph-bg-surface)" }} />
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-[20px] font-mono-custom font-bold text-[#FF6A2B]">0:24</span>
                <ConceptTag label="Card · NOW" />
              </div>

              <div className="p-4 rounded-xl border relative overflow-hidden" style={{ backgroundColor: "var(--ph-bg-elevated)", borderColor: "rgba(255,106,43,0.4)" }}>
                <div className="flex items-center gap-2 mb-2.5 flex-wrap">
                  <SourceChip label="POD" color="var(--chip-pod)" />
                  <span className="text-[10px] font-mono-custom text-[#C9C4B8]">Song Exploder #150 · Buckingham</span>
                  <span className="ml-auto text-[9px] font-mono-custom text-[#FF6A2B]">★ CRYSTALLIZED</span>
                </div>
                <p className="text-[15px] leading-relaxed mb-3 font-serif-custom">
                  "Mick couldn't play the beat the way I heard it… he played it <strong>wrong</strong>, and the wrong version is the one everybody knows."
                </p>
                <div className="rounded-lg border border-dashed border-[#2A2930] p-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ConceptTag label="Dive" color="#737373" />
                    <span className="text-[11px]" style={{ color: "var(--ph-text-muted)" }}>Wiki · Sound on Sound · full clip</span>
                  </div>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="opacity-50"><path d="M6 9l6 6 6-6" /></svg>
                </div>
              </div>
            </div>

            {/* LIQUID chat */}
            <div className="mt-4 flex flex-col gap-3">
              <ConceptTag label="Liquid · one fabric with knowledge" color="var(--ph-live)" />
              <div className="flex flex-col gap-0.5">
                <div className="flex items-baseline gap-2"><span className="text-[10px] font-mono-custom opacity-50">@0:22</span><span className="text-[12px] font-bold text-[#3b82f6]">toneNerd</span></div>
                <p className="text-[14px] opacity-90">wait the drum beat is technically "wrong"?? best part of the song</p>
              </div>

              {/* crystallizing */}
              <div className="relative p-2.5 rounded-lg border" style={{ backgroundColor: "rgba(28,27,34,0.7)", borderColor: "rgba(255,106,43,0.4)", boxShadow: "0 0 15px rgba(255,106,43,0.12)" }}>
                <div className="absolute -left-[24px] top-1/2 w-5 spur-connector h-px" />
                <div className="flex items-center gap-2 text-[10px] font-mono-custom text-[#FF6A2B] mb-1"><span>↑ 51</span><span>·</span><span>→ settling @0:24 ★</span></div>
                <div className="flex items-baseline gap-2"><span className="text-[10px] font-mono-custom opacity-50">@0:24</span><span className="text-[12px] font-bold text-[#eab308]">caillatfan</span></div>
                <p className="text-[14px] text-white">The "mistake" beat IS the identity of this song.</p>
              </div>

              <div className="flex items-center gap-2 mt-1 opacity-50 chat-crystallize">
                <span className="w-1.5 h-1.5 rounded-full bg-white pulse-dot" />
                <span className="text-[11px] font-mono-custom">stranger is typing…</span>
              </div>
            </div>

            {/* upcoming peek + range */}
            <div className="relative mt-6 opacity-80">
              <div className="absolute w-2.5 h-2.5 rounded-full border-2" style={{ left: "-52px", marginLeft: "25px", top: "3px", backgroundColor: "#eab308", borderColor: "var(--ph-bg-surface)" }} />
              <span className="text-[11px] font-mono-custom opacity-60">1:03</span>
              <p className="text-[12px] mt-0.5" style={{ color: "var(--ph-text-muted)" }}>▸ "You can go your own way" — the hook ahead.</p>
            </div>
            <div className="relative mt-5">
              <div className="absolute w-[5px] rounded-full" style={{ left: "-52px", marginLeft: "23px", top: "3px", height: "58px", backgroundColor: "rgba(255,106,43,0.35)" }} />
              <ConceptTag label="Range 2:30 → 3:38" />
              <p className="text-[13px] mt-0.5 font-medium">The outro guitar army</p>
              <p className="text-[12px]" style={{ color: "var(--ph-text-muted)" }}>Layered Les Paul overdubs — a region, not a point.</p>
            </div>
          </div>
        </div>

        {/* OFF-SPINE PULL-UP DRAWER (peeking) — closes the mobile context gap */}
        <div
          className="absolute left-0 right-0 z-30 rounded-t-2xl border-t px-4 pt-3 pb-3"
          style={{ bottom: "118px", backgroundColor: "var(--ph-bg)", borderColor: "var(--ph-bg-elevated)", boxShadow: "0 -16px 32px -12px rgba(0,0,0,0.7)" }}
        >
          <div className="w-10 h-1 rounded-full bg-[#3A3940] mx-auto mb-2.5" />
          <div className="flex items-center justify-between mb-2">
            <ConceptTag label="Off-spine · atemporal" color="#737373" />
            <span className="text-[10px] font-mono-custom opacity-50">pull up for album · graph · lineage</span>
          </div>
          <div className="flex gap-2 overflow-x-auto custom-scrollbar -mx-1 px-1">
            <div className="shrink-0 w-[200px] rounded-lg border border-[#2A2930] bg-[#1C1B22] p-2.5">
              <div className="text-[12px] font-medium mb-0.5">Rumours — the breakup album</div>
              <p className="text-[11px] text-[#C9C4B8] leading-snug">Record Plant, Sausalito, 1976. Buckingham's open letter to Stevie Nicks.</p>
            </div>
            <div className="shrink-0 w-[180px] rounded-lg border border-dashed border-[#2A2930] p-2.5">
              <SourceChip label="GENIUS" color="var(--chip-genius)" />
              <p className="text-[11px] text-[#C9C4B8] leading-snug mt-1.5">Nicks hated "packing up, shacking up" — he kept it.</p>
            </div>
          </div>
        </div>

        {/* UP NEXT + COMPOSER */}
        <div
          className="absolute bottom-0 left-0 right-0 z-40 px-4 pt-3 pb-4 flex flex-col gap-2.5 border-t"
          style={{ background: "linear-gradient(to bottom, rgba(11,11,13,0.96), rgba(11,11,13,1))", borderColor: "var(--ph-bg-elevated)" }}
        >
          <div className="flex items-center gap-2">
            <ConceptTag label="Enqueue · never cuts" color="var(--ph-text-muted)" />
            <div className="ml-auto flex items-center gap-1 opacity-50">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></svg>
              <span className="text-[9px] font-mono-custom">private peek</span>
            </div>
          </div>
          <div className="flex items-center gap-2 overflow-x-auto custom-scrollbar -mx-1 px-1">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#1C1B22] border border-[#FF6A2B]/40 shrink-0">
              <span className="text-[11px] font-medium">Dreams</span><span className="text-[10px] font-mono-custom text-[#FF6A2B]">163</span>
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#1C1B22] border border-[#2A2930] shrink-0 opacity-80">
              <span className="text-[11px] font-medium">The Chain</span><span className="text-[10px] font-mono-custom opacity-60">120</span>
            </div>
          </div>
          <div className="w-full bg-[#1C1B22] border border-[#2A2930] rounded-full px-4 py-2.5 flex items-center justify-between">
            <span className="text-[12px] text-[#C9C4B8] opacity-50">Drop a take…</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="opacity-50"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" /></svg>
          </div>
        </div>
      </div>
    </div>
  );
}
