import React from "react";
import "./_group.css";
import { Search, Radio, Play, ArrowRight, Sparkles, Check, ListMusic, ChevronDown } from "lucide-react";

type Src = { label: string; color: string };
const SRC: Record<string, Src> = {
  wiki: { label: "WIKI", color: "var(--chip-wiki)" },
  pod: { label: "POD", color: "var(--chip-pod)" },
  sos: { label: "SOS", color: "var(--chip-sos)" },
  beato: { label: "BEATO", color: "var(--chip-beato)" },
  genius: { label: "GENIUS", color: "var(--chip-genius)" },
  p4k: { label: "P4K", color: "var(--chip-p4k)" },
  rym: { label: "RYM", color: "var(--chip-rym)" },
};

function Chip({ k }: { k: keyof typeof SRC }) {
  const s = SRC[k];
  return (
    <span className="px-1.5 py-0.5 text-[9px] font-mono-lore rounded font-bold leading-none" style={{ backgroundColor: s.color, color: "#0C0A08" }}>
      {s.label}
    </span>
  );
}

function Kicker({ children, color = "var(--lore-amber)" }: { children: React.ReactNode; color?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] font-mono-lore tracking-[0.2em] uppercase" style={{ color }}>
      <span className="w-3 h-px" style={{ backgroundColor: color }} />
      {children}
    </span>
  );
}

function Eq({ color = "var(--lore-live)" }: { color?: string }) {
  return (
    <span className="inline-flex items-end gap-[2px] h-3">
      {[0, 1, 2, 3].map((i) => (
        <span key={i} className="eq-bar w-[2px] h-full rounded-full" style={{ backgroundColor: color, animationDelay: `${i * 0.12}s` }} />
      ))}
    </span>
  );
}

const RUMOURS = [
  { n: 1, t: "Second Hand News", d: "2:56", s: "done" },
  { n: 2, t: "Dreams", d: "4:14", s: "done" },
  { n: 3, t: "Never Going Back Again", d: "2:14", s: "done" },
  { n: 4, t: "Don't Stop", d: "3:11", s: "done" },
  { n: 5, t: "Go Your Own Way", d: "3:38", s: "now" },
  { n: 6, t: "Songbird", d: "3:20", s: "next" },
  { n: 7, t: "The Chain", d: "4:28", s: "next" },
  { n: 8, t: "You Make Loving Fun", d: "3:31", s: "next" },
  { n: 9, t: "I Don't Want to Know", d: "3:11", s: "next" },
  { n: 10, t: "Oh Daddy", d: "3:54", s: "next" },
  { n: 11, t: "Gold Dust Woman", d: "4:51", s: "next" },
];

const LIBRARY = [
  { title: "Rumours", artist: "Fleetwood Mac", year: 1977, notes: 312, hue: "#b5763a" },
  { title: "Tusk", artist: "Fleetwood Mac", year: 1979, notes: 41, hue: "#6b4f8a" },
  { title: "Blue", artist: "Joni Mitchell", year: 1971, notes: 88, hue: "#2f6f8f" },
  { title: "Kind of Blue", artist: "Miles Davis", year: 1959, notes: 132, hue: "#3b6f5a" },
  { title: "In Rainbows", artist: "Radiohead", year: 2007, notes: 205, hue: "#8a5a2f" },
  { title: "Pet Sounds", artist: "The Beach Boys", year: 1966, notes: 176, hue: "#8f5a6f" },
];

const STATIONS = [
  { name: "Radio Paradise", sub: "Main Mix" },
  { name: "Radio Paradise", sub: "Mellow Mix" },
  { name: "Radio Paradise", sub: "Rock Mix" },
  { name: "KEXP", sub: "90.3 Seattle" },
];

export function NowFirst() {
  return (
    <div className="min-h-screen w-full flex flex-col font-sans-lore lore-grain" style={{ backgroundColor: "var(--lore-bg)", color: "var(--lore-text)" }}>
      {/* HEADER */}
      <header className="h-[64px] shrink-0 border-b flex items-center justify-between px-7 z-30" style={{ backgroundColor: "var(--lore-surface)", borderColor: "var(--lore-line)" }}>
        <div className="flex items-baseline gap-3">
          <span className="font-serif-lore text-[24px] tracking-tight">Lore</span>
          <span className="text-[11px] font-mono-lore tracking-wide" style={{ color: "var(--lore-faint)" }}>a listening knowledge base</span>
        </div>
        <div className="flex items-center gap-2 px-3 h-9 rounded-lg border w-[420px]" style={{ backgroundColor: "var(--lore-bg)", borderColor: "var(--lore-line)" }}>
          <Search className="w-4 h-4" style={{ color: "var(--lore-faint)" }} />
          <span className="text-[13px]" style={{ color: "var(--lore-faint)" }}>Search songs, albums, sources…</span>
        </div>
        <div className="flex items-center gap-5">
          <span className="text-[12px]" style={{ color: "var(--lore-muted)" }}>Library</span>
          <span className="text-[12px]" style={{ color: "var(--lore-muted)" }}>Discover</span>
          <span className="text-[12px] font-medium" style={{ color: "var(--lore-amber)" }}>On air</span>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto lore-scroll">
        {/* HERO — ON AIR: album show playing Rumours front-to-back */}
        <section className="px-7 pt-6 pb-7">
          <div className="flex items-center gap-3 mb-4">
            <span className="w-2 h-2 rounded-full pulse-dot" style={{ backgroundColor: "var(--lore-live)" }} />
            <Kicker color="var(--lore-live)">On air now · album show</Kicker>
            <span className="text-[11px] font-mono-lore" style={{ color: "var(--lore-faint)" }}>1,204 listening along</span>
          </div>

          <div className="grid grid-cols-5 gap-6">
            {/* LEFT — the album spine (content follows the record) */}
            <div className="col-span-2 rounded-2xl border overflow-hidden flex flex-col" style={{ backgroundColor: "var(--lore-surface)", borderColor: "var(--lore-line)" }}>
              <div className="relative h-[132px] flex items-center gap-4 px-5" style={{ background: "radial-gradient(120% 160% at 20% 10%, #b5763a, #2a1c12 75%)" }}>
                <div className="w-20 h-20 rounded-full border-2 border-black/40 flex items-center justify-center shrink-0" style={{ background: "conic-gradient(from 0deg, #1a1410, #3a2a1c, #1a1410)" }}>
                  <div className="w-5 h-5 rounded-full" style={{ backgroundColor: "var(--lore-amber)" }} />
                </div>
                <div>
                  <span className="text-[10px] font-mono-lore px-1.5 py-0.5 rounded" style={{ backgroundColor: "var(--lore-amber)", color: "#0C0A08", fontWeight: 700 }}>CLASSIC ALBUMS HOUR</span>
                  <h2 className="font-serif-lore text-[26px] leading-tight mt-1.5">Rumours</h2>
                  <p className="text-[12px]" style={{ color: "var(--lore-text)" }}>Fleetwood Mac · 1977 · playing front to back</p>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto lore-scroll p-2">
                {RUMOURS.map((tk) => {
                  const now = tk.s === "now";
                  const done = tk.s === "done";
                  return (
                    <div key={tk.n} className="flex items-center gap-3 px-3 py-2 rounded-lg" style={now ? { backgroundColor: "rgba(232,164,76,0.1)", border: "1px solid rgba(232,164,76,0.4)" } : {}}>
                      <span className="w-4 text-center text-[11px] font-mono-lore" style={{ color: done ? "var(--chip-sos)" : now ? "var(--lore-amber)" : "var(--lore-faint)" }}>
                        {done ? <Check className="w-3.5 h-3.5 inline" /> : now ? <Eq color="var(--lore-amber)" /> : tk.n}
                      </span>
                      <span className="flex-1 text-[13px]" style={{ color: now ? "var(--lore-text)" : done ? "var(--lore-faint)" : "var(--lore-muted)", fontWeight: now ? 600 : 400 }}>{tk.t}</span>
                      <span className="text-[11px] font-mono-lore" style={{ color: "var(--lore-faint)" }}>{tk.d}</span>
                    </div>
                  );
                })}
              </div>
              <div className="px-4 py-2.5 border-t text-[11px] font-mono-lore flex items-center gap-2" style={{ borderColor: "var(--lore-line)", color: "var(--lore-faint)" }}>
                <ListMusic className="w-3.5 h-3.5" /> the knowledge base unrolls track-by-track as the record plays
              </div>
            </div>

            {/* RIGHT — provenance + annotation for the NOW track */}
            <div className="col-span-3 rounded-2xl border p-5 flex flex-col" style={{ backgroundColor: "var(--lore-surface)", borderColor: "rgba(232,164,76,0.35)" }}>
              <div className="flex items-center gap-3 mb-3">
                <span className="text-[22px] font-mono-lore font-bold" style={{ color: "var(--lore-amber)" }}>2:31</span>
                <div>
                  <h3 className="font-serif-lore text-[22px] leading-none">Go Your Own Way</h3>
                  <p className="text-[12px] mt-0.5" style={{ color: "var(--lore-muted)" }}>track 5 · Buckingham's open letter to Nicks</p>
                </div>
                <div className="ml-auto flex items-center gap-1.5"><Eq /><span className="text-[10px] font-mono-lore" style={{ color: "var(--lore-live)" }}>NOW</span></div>
              </div>

              <div className="grid grid-cols-2 gap-4 flex-1">
                {/* on-spine provenance */}
                <div className="flex flex-col gap-3">
                  <div className="rounded-xl border p-3.5" style={{ backgroundColor: "var(--lore-elevated)", borderColor: "rgba(232,164,76,0.4)" }}>
                    <div className="flex items-center gap-1.5 mb-2"><Chip k="pod" /><span className="text-[10px] font-mono-lore" style={{ color: "var(--lore-muted)" }}>Song Exploder · Ep. 150 · Buckingham</span></div>
                    <p className="text-[14px] leading-relaxed font-serif-lore">"I had a <strong>Street Fighting Man</strong> drum feel in my head. Mick couldn't play it that way — so he played it <strong>wrong</strong>, and the wrong version is the one everybody knows."</p>
                    <div className="flex items-center gap-2 mt-3">
                      <button className="flex items-center gap-1.5 text-[11px] font-mono-lore font-bold px-3 py-1.5 rounded" style={{ backgroundColor: "var(--lore-elevated)", border: "1px solid var(--lore-line)" }}><Play className="w-3 h-3" /> EXCERPT</button>
                      <span className="text-[10px] font-mono-lore" style={{ color: "var(--lore-faint)" }}>Beato WMTSG #12 agrees →</span>
                    </div>
                  </div>
                  <div className="rounded-xl border p-3" style={{ backgroundColor: "var(--lore-surface)", borderColor: "var(--lore-line)" }}>
                    <div className="flex items-center gap-1.5 mb-1.5"><Chip k="sos" /><span className="text-[10px] font-mono-lore" style={{ color: "var(--lore-muted)" }}>Sound on Sound · Ken Caillat</span></div>
                    <p className="text-[12px]" style={{ color: "var(--lore-muted)" }}>The outro is a whole army of layered Les Paul overdubs fading out the record — a region of the song, not a single moment.</p>
                  </div>
                </div>

                {/* off-spine + live annotation */}
                <div className="flex flex-col gap-3">
                  <div className="rounded-xl border p-3" style={{ backgroundColor: "var(--lore-surface)", borderColor: "var(--lore-line)" }}>
                    <div className="flex items-center gap-1.5 mb-1.5"><Chip k="genius" /><span className="text-[10px] font-mono-lore" style={{ color: "var(--lore-muted)" }}>Lyric dispute</span></div>
                    <p className="text-[12px]" style={{ color: "var(--lore-muted)" }}>Nicks reportedly hated <em>"packing up, shacking up's all you want to do"</em> — asked him to cut it. He kept it.</p>
                  </div>
                  <div className="rounded-xl border p-3 flex items-start justify-between" style={{ backgroundColor: "var(--lore-surface)", borderColor: "var(--lore-line)" }}>
                    <div><div className="flex items-center gap-1.5 mb-1"><Chip k="rym" /></div><p className="text-[13px] font-serif-lore italic" style={{ color: "var(--lore-muted)" }}>"Heartbreak engineered into the most durable pop record of its decade."</p></div>
                    <div className="text-right shrink-0 ml-2"><div className="text-[16px] font-bold">4.21</div><div className="text-[9px] font-mono-lore" style={{ color: "var(--lore-faint)" }}>98k rated</div></div>
                  </div>
                  <div className="rounded-xl border p-3 mt-auto" style={{ backgroundColor: "rgba(232,164,76,0.06)", borderColor: "rgba(232,164,76,0.35)" }}>
                    <div className="flex items-center gap-1.5 mb-1 text-[10px] font-mono-lore" style={{ color: "var(--lore-amber)" }}><Sparkles className="w-3 h-3" /> CRYSTALLIZING FROM CHAT · ↑51</div>
                    <p className="text-[13px]"><span className="font-semibold" style={{ color: "var(--chip-genius)" }}>caillatfan</span> — "The 'mistake' beat is the entire identity of this song."</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* radio demoted: this show is one input among many */}
          <div className="flex items-center gap-3 mt-4 px-4 py-2.5 rounded-xl border" style={{ backgroundColor: "var(--lore-surface)", borderColor: "var(--lore-line)" }}>
            <Radio className="w-4 h-4" style={{ color: "var(--lore-faint)" }} />
            <span className="text-[12px]" style={{ color: "var(--lore-muted)" }}>This show is just one human-curated input aiming the spine. Swap the source anytime — the provenance layer follows whatever plays.</span>
            <span className="ml-auto flex items-center gap-1 text-[12px]" style={{ color: "var(--lore-amber)" }}>Other inputs <ChevronDown className="w-3.5 h-3.5" /></span>
          </div>
        </section>

        {/* SECONDARY — LIBRARY SHELF */}
        <section className="px-7 pb-6">
          <div className="flex items-end justify-between mb-3">
            <div>
              <Kicker>Your library</Kicker>
              <h2 className="font-serif-lore text-[20px] mt-1">Albums you've encountered</h2>
            </div>
            <span className="text-[12px] flex items-center gap-1" style={{ color: "var(--lore-muted)" }}>See all <ArrowRight className="w-3.5 h-3.5" /></span>
          </div>
          <div className="grid grid-cols-6 gap-3">
            {LIBRARY.map((a) => (
              <div key={a.title} className="rounded-xl border overflow-hidden" style={{ backgroundColor: "var(--lore-surface)", borderColor: "var(--lore-line)" }}>
                <div className="h-20" style={{ background: `radial-gradient(120% 120% at 30% 20%, ${a.hue}, #1a1410 75%)` }} />
                <div className="p-2.5">
                  <h4 className="text-[12px] font-semibold leading-tight truncate">{a.title}</h4>
                  <p className="text-[10px]" style={{ color: "var(--lore-muted)" }}>{a.artist}</p>
                  <span className="text-[10px] font-mono-lore" style={{ color: "var(--lore-amber)" }}>{a.notes} notes</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* SECONDARY — DISCOVER */}
        <section className="px-7 pb-8">
          <div className="mb-3">
            <Kicker>Discover · more ways to aim the spine</Kicker>
            <h2 className="font-serif-lore text-[20px] mt-1">Live stations & replays</h2>
          </div>
          <div className="grid grid-cols-4 gap-3">
            {STATIONS.map((s) => (
              <div key={s.sub} className="rounded-xl border p-3 flex items-center gap-3" style={{ backgroundColor: "var(--lore-surface)", borderColor: "var(--lore-line)" }}>
                <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: "var(--lore-elevated)" }}>
                  <Radio className="w-4 h-4" style={{ color: "var(--lore-muted)" }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-1.5"><span className="text-[13px] font-semibold truncate">{s.name}</span></div>
                  <span className="text-[11px]" style={{ color: "var(--lore-muted)" }}>{s.sub}</span>
                </div>
                <span className="text-[9px] font-mono-lore px-1.5 py-0.5 rounded border shrink-0" style={{ borderColor: "var(--lore-line)", color: "var(--lore-faint)" }}>AAC</span>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
