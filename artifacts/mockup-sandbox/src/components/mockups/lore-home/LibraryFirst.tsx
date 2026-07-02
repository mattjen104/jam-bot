import React from "react";
import "./_group.css";
import { Search, Radio, Play, ArrowRight, Sparkles, Disc3, ListMusic } from "lucide-react";

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

const LIBRARY = [
  { title: "Tusk", artist: "Fleetwood Mac", year: 1979, notes: 41, hue: "#6b4f8a", srcs: ["wiki", "sos", "rym"] as const },
  { title: "Blue", artist: "Joni Mitchell", year: 1971, notes: 88, hue: "#2f6f8f", srcs: ["wiki", "pod", "genius"] as const },
  { title: "Kind of Blue", artist: "Miles Davis", year: 1959, notes: 132, hue: "#3b6f5a", srcs: ["wiki", "p4k", "rym"] as const },
  { title: "In Rainbows", artist: "Radiohead", year: 2007, notes: 205, hue: "#8a5a2f", srcs: ["wiki", "beato", "p4k"] as const },
  { title: "Sound of Silver", artist: "LCD Soundsystem", year: 2007, notes: 63, hue: "#7a6f2f", srcs: ["wiki", "genius"] as const },
  { title: "Pet Sounds", artist: "The Beach Boys", year: 1966, notes: 176, hue: "#8f5a6f", srcs: ["wiki", "sos", "rym"] as const },
];

const STATIONS = [
  { name: "Radio Paradise", sub: "Main Mix", now: "Talking Heads — This Must Be the Place", listeners: "8.2k" },
  { name: "Radio Paradise", sub: "Mellow Mix", now: "Nick Drake — Pink Moon", listeners: "3.4k" },
  { name: "Radio Paradise", sub: "Rock Mix", now: "Fleetwood Mac — The Chain", listeners: "2.1k" },
  { name: "KEXP", sub: "90.3 Seattle", now: "Khruangbin — Maria También", listeners: "5.7k" },
];

export function LibraryFirst() {
  return (
    <div className="min-h-screen w-full flex flex-col font-sans-lore lore-grain" style={{ backgroundColor: "var(--lore-bg)", color: "var(--lore-text)" }}>
      {/* HEADER */}
      <header className="h-[64px] shrink-0 border-b flex items-center justify-between px-7 z-30" style={{ backgroundColor: "var(--lore-surface)", borderColor: "var(--lore-line)" }}>
        <div className="flex items-baseline gap-3">
          <span className="font-serif-lore text-[24px] tracking-tight" style={{ color: "var(--lore-text)" }}>Lore</span>
          <span className="text-[11px] font-mono-lore tracking-wide" style={{ color: "var(--lore-faint)" }}>a listening knowledge base</span>
        </div>
        <div className="flex items-center gap-2 px-3 h-9 rounded-lg border w-[420px]" style={{ backgroundColor: "var(--lore-bg)", borderColor: "var(--lore-line)" }}>
          <Search className="w-4 h-4" style={{ color: "var(--lore-faint)" }} />
          <span className="text-[13px]" style={{ color: "var(--lore-faint)" }}>Search songs, albums, sources…</span>
        </div>
        <button className="flex items-center gap-2 px-3 h-9 rounded-lg border" style={{ borderColor: "rgba(255,90,60,0.35)", backgroundColor: "var(--lore-elevated)" }}>
          <span className="w-1.5 h-1.5 rounded-full pulse-dot" style={{ backgroundColor: "var(--lore-live)" }} />
          <span className="text-[11px] font-mono-lore tracking-wide" style={{ color: "var(--lore-live)" }}>ON AIR</span>
        </button>
      </header>

      {/* ON-AIR STRIP — radio demoted to a slim input driving the spine */}
      <div className="shrink-0 flex items-center gap-4 px-7 py-2.5 border-b" style={{ backgroundColor: "rgba(232,164,76,0.05)", borderColor: "var(--lore-line)" }}>
        <Kicker>Driving the spine now</Kicker>
        <Eq />
        <span className="text-[13px]">
          <span className="font-medium">Go Your Own Way</span>
          <span style={{ color: "var(--lore-muted)" }}> · Fleetwood Mac · via </span>
          <span style={{ color: "var(--lore-amber)" }}>Classic Albums Hour</span>
        </span>
        <span className="text-[11px] font-mono-lore" style={{ color: "var(--lore-faint)" }}>2:31 / 3:38</span>
        <button className="ml-auto flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-full" style={{ backgroundColor: "var(--lore-amber)", color: "#0C0A08" }}>
          Follow the spine <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>

      <main className="flex-1 overflow-y-auto lore-scroll">
        {/* SECTION 1 — LIBRARY (the front door) */}
        <section className="px-7 pt-7 pb-6">
          <div className="flex items-end justify-between mb-4">
            <div>
              <Kicker>Your library</Kicker>
              <h2 className="font-serif-lore text-[28px] leading-tight mt-1">Everything you've encountered</h2>
              <p className="text-[13px] mt-0.5" style={{ color: "var(--lore-muted)" }}>Albums and songs, thick with the lore you've collected along the way.</p>
            </div>
            <div className="flex items-center gap-1.5">
              {["Albums", "Songs", "Sources", "Recently annotated"].map((f, i) => (
                <span key={f} className="px-3 py-1.5 rounded-full text-[11px] font-mono-lore" style={i === 0 ? { backgroundColor: "var(--lore-amber)", color: "#0C0A08", fontWeight: 700 } : { color: "var(--lore-muted)", border: "1px solid var(--lore-line)" }}>{f}</span>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-4 gap-4">
            {/* FEATURED — Rumours */}
            <div className="col-span-2 row-span-1 rounded-2xl border overflow-hidden flex" style={{ backgroundColor: "var(--lore-surface)", borderColor: "var(--lore-line)" }}>
              <div className="relative w-[180px] shrink-0">
                <div className="absolute inset-0" style={{ background: "radial-gradient(120% 120% at 30% 20%, #b5763a, #3a2416 70%)" }} />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-24 h-24 rounded-full border-2 border-black/40 flex items-center justify-center" style={{ background: "conic-gradient(from 0deg, #1a1410, #3a2a1c, #1a1410)" }}>
                    <div className="w-6 h-6 rounded-full" style={{ backgroundColor: "var(--lore-amber)" }} />
                  </div>
                </div>
              </div>
              <div className="flex-1 p-4 flex flex-col">
                <div className="flex items-center gap-2 mb-1">
                  <Kicker>Most annotated</Kicker>
                </div>
                <h3 className="font-serif-lore text-[22px] leading-tight">Rumours</h3>
                <p className="text-[12px]" style={{ color: "var(--lore-muted)" }}>Fleetwood Mac · 1977</p>
                <p className="text-[12px] leading-relaxed mt-2 flex-1" style={{ color: "var(--lore-muted)" }}>
                  Cut at the Record Plant, Sausalito while both couples in the band were splitting up. 11 tracks, all threaded with liner notes, interviews and disputes.
                </p>
                <div className="flex items-center gap-2 mt-3 flex-wrap">
                  <span className="text-[11px] font-mono-lore" style={{ color: "var(--lore-amber)" }}>312 annotations</span>
                  <span style={{ color: "var(--lore-faint)" }}>·</span>
                  {(["wiki", "pod", "sos", "beato", "genius", "rym"] as const).map((k) => <Chip key={k} k={k} />)}
                </div>
              </div>
            </div>

            {/* smaller library cards */}
            {LIBRARY.map((a) => (
              <div key={a.title} className="rounded-2xl border overflow-hidden flex flex-col" style={{ backgroundColor: "var(--lore-surface)", borderColor: "var(--lore-line)" }}>
                <div className="h-24 relative" style={{ background: `radial-gradient(120% 120% at 30% 20%, ${a.hue}, #1a1410 75%)` }}>
                  <Disc3 className="w-8 h-8 absolute bottom-2 right-2 opacity-30" />
                </div>
                <div className="p-3 flex flex-col gap-1.5">
                  <div>
                    <h4 className="text-[14px] font-semibold leading-tight">{a.title}</h4>
                    <p className="text-[11px]" style={{ color: "var(--lore-muted)" }}>{a.artist} · {a.year}</p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] font-mono-lore" style={{ color: "var(--lore-amber)" }}>{a.notes} notes</span>
                    {a.srcs.map((k) => <Chip key={k} k={k} />)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* SECTION 2 — DISCOVER + ON-AIR PROVENANCE */}
        <section className="px-7 pb-8 grid grid-cols-3 gap-6">
          {/* DISCOVER (left, wider) */}
          <div className="col-span-2 flex flex-col gap-5">
            <div>
              <Kicker>Discover · ways to aim the spine</Kicker>
              <h2 className="font-serif-lore text-[22px] mt-1">Live stations & shows</h2>
              <p className="text-[12px]" style={{ color: "var(--lore-muted)" }}>A station or show is just a human-curated input. Tune in live or replay an archive — either way, the provenance layer lights up for whatever's playing.</p>
            </div>

            {/* Album show — the hero pattern */}
            <div className="rounded-2xl border p-4 flex items-center gap-4" style={{ backgroundColor: "var(--lore-elevated)", borderColor: "rgba(232,164,76,0.35)" }}>
              <div className="w-14 h-14 rounded-xl shrink-0 flex items-center justify-center" style={{ background: "radial-gradient(120% 120% at 30% 20%, #b5763a, #3a2416 70%)" }}>
                <ListMusic className="w-6 h-6" style={{ color: "var(--lore-amber)" }} />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono-lore px-1.5 py-0.5 rounded" style={{ backgroundColor: "var(--lore-amber)", color: "#0C0A08", fontWeight: 700 }}>ALBUM SHOW</span>
                  <span className="w-1.5 h-1.5 rounded-full pulse-dot" style={{ backgroundColor: "var(--lore-live)" }} />
                  <span className="text-[10px] font-mono-lore" style={{ color: "var(--lore-live)" }}>LIVE</span>
                </div>
                <h4 className="text-[15px] font-semibold mt-1">Classic Albums Hour — Rumours, front to back</h4>
                <p className="text-[12px]" style={{ color: "var(--lore-muted)" }}>Now on track 5 of 11 · the knowledge base unrolls track-by-track as the record plays.</p>
              </div>
              <button className="flex items-center gap-1.5 text-[12px] font-medium px-3 py-2 rounded-full shrink-0" style={{ backgroundColor: "var(--lore-amber)", color: "#0C0A08" }}>
                <Play className="w-3.5 h-3.5" /> Follow
              </button>
            </div>

            {/* Live stations grid */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Radio className="w-3.5 h-3.5" style={{ color: "var(--lore-muted)" }} />
                <span className="text-[11px] font-mono-lore tracking-wide" style={{ color: "var(--lore-muted)" }}>LIVE STATIONS</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {STATIONS.map((s) => (
                  <div key={s.sub} className="rounded-xl border p-3 flex flex-col gap-2" style={{ backgroundColor: "var(--lore-surface)", borderColor: "var(--lore-line)" }}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-[13px] font-semibold">{s.name}</span>
                        <span className="text-[11px]" style={{ color: "var(--lore-muted)" }}>{s.sub}</span>
                      </div>
                      <span className="text-[9px] font-mono-lore px-1.5 py-0.5 rounded border" style={{ borderColor: "var(--lore-line)", color: "var(--lore-faint)" }}>AAC</span>
                    </div>
                    <p className="text-[11px] truncate" style={{ color: "var(--lore-muted)" }}>♪ {s.now}</p>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono-lore" style={{ color: "var(--lore-faint)" }}>{s.listeners} listening</span>
                      <span className="text-[11px] flex items-center gap-1" style={{ color: "var(--lore-amber)" }}>Tune in <ArrowRight className="w-3 h-3" /></span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Replays */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <ListMusic className="w-3.5 h-3.5" style={{ color: "var(--lore-muted)" }} />
                <span className="text-[11px] font-mono-lore tracking-wide" style={{ color: "var(--lore-muted)" }}>SHOWS & REPLAYS · same primitive, played back</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { t: "The Rock Mix Replay", d: "Sat show · 24 tracks · DJ picks became provenance" },
                  { t: "Buckingham Nicks — deep cut hour", d: "Archived · replays drive the same spine" },
                ].map((r) => (
                  <div key={r.t} className="rounded-xl border p-3 flex items-center gap-3" style={{ backgroundColor: "var(--lore-surface)", borderColor: "var(--lore-line)" }}>
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: "var(--lore-elevated)" }}>
                      <Play className="w-4 h-4" style={{ color: "var(--lore-muted)" }} />
                    </div>
                    <div>
                      <h5 className="text-[13px] font-medium leading-tight">{r.t}</h5>
                      <p className="text-[11px]" style={{ color: "var(--lore-faint)" }}>{r.d}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ON-AIR PROVENANCE PANEL (right rail) */}
          <aside className="rounded-2xl border p-4 flex flex-col gap-4 h-fit" style={{ backgroundColor: "var(--lore-surface)", borderColor: "var(--lore-line)" }}>
            <div>
              <Kicker color="var(--lore-live)">On air · provenance</Kicker>
              <h3 className="font-serif-lore text-[19px] mt-1 leading-tight">Go Your Own Way</h3>
              <p className="text-[12px]" style={{ color: "var(--lore-muted)" }}>Fleetwood Mac · Rumours · track 5</p>
            </div>

            {/* mini spine */}
            <div className="relative pl-5">
              <div className="absolute left-[5px] top-1 bottom-1 w-[2px] lore-spine" />
              <div className="flex flex-col gap-3">
                <div className="relative">
                  <span className="absolute -left-5 top-1 w-3 h-3 rounded-full now-glow" style={{ backgroundColor: "var(--lore-amber)", border: "2px solid var(--lore-surface)" }} />
                  <div className="rounded-lg border p-2.5" style={{ backgroundColor: "var(--lore-elevated)", borderColor: "rgba(232,164,76,0.4)" }}>
                    <div className="flex items-center gap-1.5 mb-1.5"><Chip k="pod" /><span className="text-[10px] font-mono-lore" style={{ color: "var(--lore-muted)" }}>Song Exploder · Ep. 150</span></div>
                    <p className="text-[13px] leading-snug font-serif-lore">"Mick couldn't play the drum feel I heard — so he played it <em>wrong</em>, and the wrong version is the one everybody knows."</p>
                  </div>
                </div>
                <div className="relative">
                  <span className="absolute -left-5 top-1 w-2.5 h-2.5 rounded-full" style={{ backgroundColor: "var(--chip-sos)", border: "2px solid var(--lore-surface)" }} />
                  <div className="flex items-center gap-1.5"><Chip k="sos" /><span className="text-[11px]" style={{ color: "var(--lore-muted)" }}>Ken Caillat on the outro Les Paul overdubs</span></div>
                </div>
                <div className="relative">
                  <span className="absolute -left-5 top-1 w-2.5 h-2.5 rounded-full" style={{ backgroundColor: "var(--chip-genius)", border: "2px solid var(--lore-surface)" }} />
                  <div className="flex items-center gap-1.5"><Chip k="genius" /><span className="text-[11px]" style={{ color: "var(--lore-muted)" }}>Lyric dispute: Nicks asked him to cut a line. He kept it.</span></div>
                </div>
              </div>
            </div>

            {/* live annotation crystallizing */}
            <div className="rounded-lg border p-2.5" style={{ backgroundColor: "rgba(232,164,76,0.06)", borderColor: "rgba(232,164,76,0.35)" }}>
              <div className="flex items-center gap-1.5 mb-1 text-[10px] font-mono-lore" style={{ color: "var(--lore-amber)" }}>
                <Sparkles className="w-3 h-3" /> CRYSTALLIZING FROM CHAT · ↑51
              </div>
              <p className="text-[13px]"><span className="font-semibold" style={{ color: "var(--chip-genius)" }}>caillatfan</span> — "The 'mistake' beat is the entire identity of this song."</p>
            </div>

            <p className="text-[11px] leading-relaxed" style={{ color: "var(--lore-faint)" }}>
              One shared source pool: the DJ's picks become provenance, scraped sources ground it, and listener takes layer on top.
            </p>
          </aside>
        </section>
      </main>
    </div>
  );
}
