import React from "react";
import "./_group.css";

const LENSES = ["Production", "Theory", "Lyrics", "Drama", "Reactions"];

function ConceptTag({ label, color = "var(--ph-accent)" }: { label: string; color?: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-[9px] font-mono-custom tracking-widest uppercase"
      style={{ color }}
    >
      <span className="w-2 h-px" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

function SourceChip({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="px-1.5 py-0.5 text-[9px] font-mono-custom rounded font-bold"
      style={{ backgroundColor: color, color: "#fff" }}
    >
      {label}
    </span>
  );
}

export function OneSpineDesktop() {
  return (
    <div
      className="min-h-screen w-full flex flex-col font-grotesk ph-grain overflow-hidden"
      style={{ backgroundColor: "var(--ph-bg)", color: "var(--ph-text)" }}
    >
      {/* TOP BAR */}
      <header
        className="h-[68px] shrink-0 border-b flex items-center justify-between px-6 z-30"
        style={{ backgroundColor: "var(--ph-bg-surface)", borderColor: "var(--ph-bg-elevated)" }}
      >
        <div className="flex items-center gap-4">
          <div className="w-11 h-11 rounded overflow-hidden shadow-lg shrink-0 relative">
            <img src="/__mockup/images/ph-needle.png" alt="" className="w-full h-full object-cover" />
            <div className="absolute inset-0" style={{ background: "linear-gradient(135deg, rgba(255,106,43,0.35), rgba(255,59,107,0.25))" }} />
          </div>
          <div className="flex flex-col">
            <h1 className="text-[17px] font-medium leading-none mb-1">Go Your Own Way</h1>
            <span className="text-[12px]" style={{ color: "var(--ph-text-muted)" }}>
              Fleetwood Mac · Rumours (1977)
            </span>
          </div>
        </div>

        {/* LENS SELECTOR — single reranking control for the whole spine */}
        <div className="flex flex-col items-center gap-1">
          <ConceptTag label="Lens · reranks the one spine" color="var(--ph-text-muted)" />
          <div className="flex items-center gap-1 p-1 rounded-full" style={{ backgroundColor: "var(--ph-bg-elevated)" }}>
            {LENSES.map((l) => {
              const active = l === "Production";
              return (
                <span
                  key={l}
                  className="px-3 py-1 rounded-full text-[11px] font-mono-custom transition-colors"
                  style={
                    active
                      ? { backgroundColor: "var(--ph-accent)", color: "#0B0B0D", fontWeight: 700 }
                      : { color: "var(--ph-text-muted)" }
                  }
                >
                  {l}
                </span>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div
            className="flex items-center gap-2 px-3 py-1.5 rounded-full border"
            style={{ backgroundColor: "var(--ph-bg-elevated)", borderColor: "rgba(255, 59, 107, 0.3)" }}
          >
            <div className="w-2 h-2 rounded-full pulse-dot" style={{ backgroundColor: "var(--ph-live)" }} />
            <span className="text-xs font-mono-custom tracking-widest text-[#FF3B6B]">388 LIVE</span>
          </div>
          <div className="flex items-center gap-2 opacity-80">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
            <span className="text-[11px] font-mono-custom tracking-wider text-[#C9C4B8]">SYNCED @0:24</span>
          </div>
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden">
        {/* ===================== THE ONE SPINE ===================== */}
        <section className="flex-1 relative overflow-y-auto custom-scrollbar" style={{ backgroundColor: "var(--ph-bg-surface)" }}>
          {/* the single vertical spine line */}
          <div className="absolute top-0 bottom-0 w-[2px] spine-rail" style={{ left: "120px" }} />

          {/* heat topography hugging the spine */}
          <div className="absolute top-0 bottom-0 w-16 opacity-[0.18] pointer-events-none flex flex-col justify-start gap-6 pt-40" style={{ left: "56px" }}>
            <div className="w-full h-6 bg-gradient-to-r from-transparent to-[#FF3B6B]" />
            <div className="w-[160%] h-20 -ml-10 rounded-r-full blur-xl bg-[#FF3B6B]" />
            <div className="w-full h-8 bg-gradient-to-r from-transparent to-[#FF3B6B] opacity-60" />
          </div>

          <div className="relative pl-[120px] pr-10 py-8 flex flex-col">
            <ConceptTag label="One Spine · Production lens active" />

            {/* ---- played point: intro (PEEK depth) ---- */}
            <SpineRow top dim node="#737373" time="0:00">
              <div className="flex items-center gap-2">
                <ConceptTag label="On-spine · Peek" color="#737373" />
              </div>
              <p className="text-[13px] mt-1" style={{ color: "var(--ph-text-muted)" }}>
                ▸ The lone, dry guitar riff — no drums yet. <span className="opacity-60">Tap to open the card.</span>
              </p>
            </SpineRow>

            {/* ---- THE NOW (CARD depth, with Dive affordance) ---- */}
            <div className="relative my-3">
              {/* now node */}
              <div
                className="absolute w-5 h-5 rounded-full border-4 z-20 playhead-glow"
                style={{ left: "-120px", marginLeft: "111px", top: "6px", backgroundColor: "var(--ph-accent)", borderColor: "var(--ph-bg-surface)" }}
              />
              <div className="flex items-center gap-3 mb-2">
                <span className="text-2xl font-mono-custom font-bold text-[#FF6A2B]">0:24</span>
                <ConceptTag label="On-spine · Card · NOW" />
                <div className="h-px flex-1 bg-[#FF6A2B] opacity-25" />
              </div>

              <div
                className="p-5 rounded-2xl border relative overflow-hidden shadow-2xl"
                style={{
                  backgroundColor: "rgba(28, 27, 34, 0.92)",
                  borderColor: "rgba(255, 106, 43, 0.45)",
                  boxShadow: "0 20px 40px -12px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.08)",
                }}
              >
                <div className="absolute -top-20 -right-16 w-56 h-56 bg-[#FF6A2B] rounded-full mix-blend-screen blur-[80px] opacity-10 pointer-events-none" />

                <div className="flex items-center gap-2 mb-4 relative z-10 flex-wrap">
                  <SourceChip label="PODCAST" color="var(--chip-pod)" />
                  <span className="text-[11px] font-mono-custom text-[#C9C4B8]">Song Exploder Ep. 150 · Lindsey Buckingham</span>
                  <span className="ml-auto text-[10px] font-mono-custom text-[#FF6A2B]">★ CRYSTALLIZED FROM CHAT</span>
                </div>

                <p className="text-[17px] leading-relaxed mb-4 font-serif-custom relative z-10">
                  "I had this drum pattern in my head — a <strong>Rolling Stones, 'Street Fighting Man'</strong> kind of feel.
                  Mick couldn't play it the way I heard it… so he played it <strong>wrong</strong>, and the wrong version is the one everybody knows."
                </p>

                <div className="flex items-center gap-3 relative z-10 mb-4">
                  <button className="px-4 py-2 bg-[#2A2930] rounded text-[11px] font-mono-custom font-bold flex items-center gap-2">
                    PLAY EXCERPT <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M5 3l14 9-14 9V3z" /></svg>
                  </button>
                  <button className="px-4 py-2 border border-[#2A2930] rounded text-[11px] font-mono-custom flex items-center gap-2">
                    CROSS-REF <span className="opacity-60">Beato WMTSG #12 agrees</span>
                  </button>
                </div>

                {/* DIVE depth — wiki/liner-notes only revealed this deep */}
                <div className="relative z-10 rounded-lg border border-dashed border-[#2A2930] p-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ConceptTag label="Dive" color="#737373" />
                    <span className="text-[12px]" style={{ color: "var(--ph-text-muted)" }}>
                      Wikipedia · Sound on Sound liner notes · full 9-min segment
                    </span>
                  </div>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="opacity-50"><path d="M6 9l6 6 6-6" /></svg>
                </div>
              </div>

              {/* LIQUID chat flowing right at the spine, one take crystallizing */}
              <div className="mt-5 pl-1 flex flex-col gap-3">
                <ConceptTag label="Liquid · same fabric as knowledge" color="var(--ph-live)" />

                <ChatLine time="0:22" name="toneNerd" color="#3b82f6" text="wait the drum beat is technically 'wrong'?? it's the best part" />
                <ChatLine time="0:23" name="rhiannon77" color="#8b5cf6" text="Mick just refused to overthink it and that's the whole magic" />

                {/* crystallizing → becoming an on-spine marker */}
                <div className="relative ml-1 p-3 rounded-lg border" style={{ backgroundColor: "rgba(28,27,34,0.7)", borderColor: "rgba(255,106,43,0.4)", boxShadow: "0 0 15px rgba(255,106,43,0.12)" }}>
                  <div className="absolute -left-[34px] top-1/2 w-8 spur-connector h-px" />
                  <div className="flex items-center gap-2 text-[10px] font-mono-custom text-[#FF6A2B] mb-1">
                    <span>↑ 51</span><span>·</span><span>→ settling onto the spine @0:24 ★</span>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-[11px] font-mono-custom opacity-50">@0:24</span>
                    <span className="text-[12px] font-bold text-[#eab308]">caillatfan</span>
                  </div>
                  <p className="text-[14px] text-white">The "mistake" beat is the entire identity of this song. Crystallize this.</p>
                </div>
              </div>
            </div>

            {/* ---- upcoming point: chorus (PEEK) ---- */}
            <SpineRow node="#eab308" time="1:03">
              <ConceptTag label="On-spine · Peek · ahead" color="#eab308" />
              <p className="text-[13px] mt-1" style={{ color: "var(--ph-text-muted)" }}>
                ▸ "You can go your own way" — the hook the room is waiting for.
              </p>
            </SpineRow>

            {/* ---- upcoming RANGE: the outro guitar army ---- */}
            <div className="relative mt-6 pb-10">
              <div
                className="absolute w-[6px] rounded-full"
                style={{ left: "-120px", marginLeft: "109px", top: "4px", height: "92px", backgroundColor: "rgba(255,106,43,0.35)" }}
              />
              <ConceptTag label="On-spine · Range (2:30 → 3:38)" />
              <p className="text-[14px] mt-1 font-medium">The outro guitar army</p>
              <p className="text-[13px]" style={{ color: "var(--ph-text-muted)" }}>
                Buckingham's layered Les Paul overdubs fade out the record. A whole region of the spine, not a single point.
              </p>
            </div>
          </div>
        </section>

        {/* ===================== OFF-SPINE SHELF ===================== */}
        <aside
          className="w-[340px] shrink-0 border-l flex flex-col overflow-y-auto custom-scrollbar"
          style={{ backgroundColor: "var(--ph-bg)", borderColor: "var(--ph-bg-elevated)" }}
        >
          <div className="p-4 border-b" style={{ borderColor: "var(--ph-bg-elevated)" }}>
            <ConceptTag label="Off-spine · atemporal spurs" color="#737373" />
            <p className="text-[11px] mt-1 opacity-50 font-mono-custom">things true of the whole song, not a moment</p>
          </div>

          <div className="p-4 flex flex-col gap-5">
            {/* Album spur */}
            <div className="rounded-xl border border-[#2A2930] overflow-hidden">
              <div className="relative h-24">
                <img src="/__mockup/images/ph-haze.png" className="w-full h-full object-cover opacity-60" alt="" />
                <div className="absolute inset-0 bg-gradient-to-t from-[#0B0B0D] to-transparent" />
                <div className="absolute bottom-2 left-3 text-[13px] font-medium">Rumours — the album that ate the band</div>
              </div>
              <p className="text-[12px] leading-relaxed text-[#C9C4B8] p-3">
                Cut at the Record Plant, Sausalito, 1976 as both couples in the band were splitting up. "Go Your Own Way" is Buckingham's open letter to Stevie Nicks.
              </p>
            </div>

            {/* Drama / lineage spur */}
            <div className="rounded-lg border border-dashed border-[#2A2930] p-3">
              <div className="flex items-center gap-2 mb-2">
                <SourceChip label="GENIUS" color="var(--chip-genius)" />
                <span className="text-[10px] font-mono-custom opacity-60">lyric dispute</span>
              </div>
              <p className="text-[13px] text-[#C9C4B8]">
                Nicks reportedly hated the line <em>"packing up, shacking up's all you want to do"</em> — called it untrue and asked him to cut it. He kept it.
              </p>
            </div>

            {/* Artist graph spur */}
            <div className="rounded-lg bg-[#1C1B22] border border-[#2A2930] p-3">
              <div className="flex items-center gap-2 mb-2">
                <ConceptTag label="Artist graph" color="var(--chip-rym)" />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {["Buckingham Nicks", "Tusk", "Bob Welch era", "Tom Petty"].map((t) => (
                  <span key={t} className="px-2 py-0.5 text-[11px] rounded-full bg-[#2A2930] text-[#C9C4B8]">{t}</span>
                ))}
              </div>
            </div>

            {/* Critical verdict spur */}
            <div className="rounded-lg bg-[#1C1B22] border border-[#2A2930] p-4">
              <div className="flex justify-between items-start mb-3">
                <SourceChip label="RYM" color="var(--chip-rym)" />
                <div className="text-right">
                  <div className="text-lg font-bold">4.21</div>
                  <div className="text-[10px] font-mono-custom opacity-50">98,000+ RATINGS</div>
                </div>
              </div>
              <p className="text-sm font-serif-custom italic opacity-90 leading-relaxed">
                "Heartbreak engineered into the most durable pop record of its decade."
              </p>
            </div>
          </div>
        </aside>
      </main>

      {/* ===================== UP NEXT + COMPOSER ===================== */}
      <footer className="shrink-0 border-t z-30" style={{ borderColor: "var(--ph-bg-elevated)", backgroundColor: "var(--ph-bg-surface)" }}>
        <div className="px-6 py-3 flex items-center gap-6">
          <div className="flex items-center gap-2 shrink-0">
            <ConceptTag label="Enqueue · never cuts the playhead" color="var(--ph-text-muted)" />
          </div>
          <div className="flex items-center gap-3 flex-1 overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#1C1B22] border border-[#FF6A2B]/40 shrink-0">
              <span className="text-[11px] font-medium">Dreams</span>
              <span className="text-[10px] text-[#C9C4B8]">·</span>
              <span className="text-[11px] font-mono-custom text-[#FF6A2B]">163 votes</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#1C1B22] border border-[#2A2930] shrink-0 opacity-80">
              <span className="text-[11px] font-medium">The Chain</span>
              <span className="text-[10px] text-[#C9C4B8]">·</span>
              <span className="text-[11px] font-mono-custom opacity-60">120 votes</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-dashed border-[#2A2930] shrink-0 opacity-60">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></svg>
              <span className="text-[10px] font-mono-custom">you're privately peeking ahead — room won't follow</span>
            </div>
          </div>
        </div>
        <div className="px-6 pb-4">
          <div className="w-full bg-[#1C1B22] border border-[#2A2930] rounded-full px-4 py-2.5 flex items-center justify-between">
            <span className="text-[13px] text-[#C9C4B8] opacity-50">Drop a take — it stays liquid until the room crystallizes it…</span>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="opacity-50"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" /></svg>
          </div>
        </div>
      </footer>
    </div>
  );
}

function SpineRow({
  children,
  time,
  node,
  dim,
  top,
}: {
  children: React.ReactNode;
  time: string;
  node: string;
  dim?: boolean;
  top?: boolean;
}) {
  return (
    <div className={`relative ${top ? "mt-4" : "mt-6"} ${dim ? "opacity-70" : ""}`}>
      <div
        className="absolute w-3 h-3 rounded-full border-2"
        style={{ left: "-120px", marginLeft: "114px", top: "4px", backgroundColor: node, borderColor: "var(--ph-bg-surface)" }}
      />
      <div className="flex items-center gap-2 mb-0.5">
        <span className="text-[12px] font-mono-custom opacity-60">{time}</span>
      </div>
      {children}
    </div>
  );
}

function ChatLine({ time, name, color, text }: { time: string; name: string; color: string; text: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-baseline gap-2">
        <span className="text-[11px] font-mono-custom opacity-50">@{time}</span>
        <span className="text-[12px] font-bold" style={{ color }}>{name}</span>
      </div>
      <p className="text-[14px] opacity-90">{text}</p>
    </div>
  );
}
