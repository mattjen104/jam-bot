import React from "react";
import "./_group.css";
import {
  Search, Play, Sparkles, ListMusic, Radio, Plus,
  CornerUpRight, Repeat, GripVertical, Quote,
} from "lucide-react";

/* ---------------- shared atoms ---------------- */
type SrcKey = "wiki" | "pod" | "sos" | "beato" | "genius" | "rym";
const SRC: Record<SrcKey, { label: string; color: string }> = {
  wiki: { label: "WIKI", color: "var(--chip-wiki)" },
  pod: { label: "SONG EXPLODER", color: "var(--chip-pod)" },
  sos: { label: "SOUND ON SOUND", color: "var(--chip-sos)" },
  beato: { label: "BEATO", color: "var(--chip-beato)" },
  genius: { label: "GENIUS", color: "var(--chip-genius)" },
  rym: { label: "RYM", color: "var(--chip-rym)" },
};
function Chip({ k }: { k: SrcKey }) {
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
function Eq({ color = "var(--lore-amber)" }: { color?: string }) {
  return (
    <span className="inline-flex items-end gap-[2px] h-3">
      {[0, 1, 2, 3].map((i) => (
        <span key={i} className="eq-bar w-[2px] h-full rounded-full" style={{ backgroundColor: color, animationDelay: `${i * 0.12}s` }} />
      ))}
    </span>
  );
}

/* ---------------- services (service-agnostic switcher) ---------------- */
type SvcKey = "spotify" | "apple" | "ytm";
const SVC: Record<SvcKey, { label: string; short: string; color: string }> = {
  spotify: { label: "Spotify", short: "SPTFY", color: "var(--svc-spotify)" },
  apple: { label: "Apple Music", short: "APPLE", color: "var(--svc-apple)" },
  ytm: { label: "YT Music", short: "YTM", color: "var(--svc-ytm)" },
};
type Avail = "exact" | "search" | "none";
function AvailDots({ map }: { map: Record<SvcKey, Avail> }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {(Object.keys(SVC) as SvcKey[]).map((k) => {
        const a = map[k];
        const c = SVC[k].color;
        return (
          <span key={k} className="inline-flex items-center gap-0.5" title={`${SVC[k].label}: ${a}`}>
            <span
              className="w-2 h-2 rounded-full"
              style={
                a === "exact"
                  ? { backgroundColor: c }
                  : a === "search"
                  ? { border: `1.5px solid ${c}`, backgroundColor: "transparent" }
                  : { backgroundColor: "var(--lore-line)" }
              }
            />
          </span>
        );
      })}
    </span>
  );
}

/* ---------------- annotation timeline data ---------------- */
const DURATION = 218; // 3:38
const pct = (s: number) => `${(s / DURATION) * 100}%`;
const PINS = [
  { t: 0, label: "0:00", src: "wiki" as SrcKey, note: "Dry, lone guitar riff — no drums yet" },
  { t: 24, label: "0:24", src: "pod" as SrcKey, note: "The “wrong” drum feel", now: true },
  { t: 63, label: "1:03", src: "genius" as SrcKey, note: "The disputed line lands" },
];
const REGION = { from: 150, to: 218, src: "sos" as SrcKey }; // 2:30 → 3:38 outro

/* ---------------- queue (canonical identities) ---------------- */
const QUEUE: Array<{
  title: string; artist: string; isrc: string; from: string; avail: Record<SvcKey, Avail>; now?: boolean; votes?: number;
}> = [
  { title: "Go Your Own Way", artist: "Fleetwood Mac", isrc: "USWB10002556", from: "Classic Albums Hour", now: true, avail: { spotify: "exact", apple: "exact", ytm: "exact" } },
  { title: "Dreams", artist: "Fleetwood Mac", isrc: "USWB10002551", from: "rest of show", votes: 163, avail: { spotify: "exact", apple: "exact", ytm: "exact" } },
  { title: "The Chain", artist: "Fleetwood Mac", isrc: "USWB10002554", from: "rest of show", votes: 120, avail: { spotify: "exact", apple: "exact", ytm: "search" } },
  { title: "Silver Springs", artist: "Fleetwood Mac", isrc: "USEE10021456", from: "KEXP · 90.3", avail: { spotify: "exact", apple: "search", ytm: "none" } },
  { title: "Landslide", artist: "Fleetwood Mac", isrc: "USWB10259001", from: "RP · Mellow Mix", avail: { spotify: "exact", apple: "exact", ytm: "exact" } },
];

/* ---------------- heard-on inputs (tappable → queue) ---------------- */
export function TimelineQueueDesktop() {
  return (
    <div className="min-h-screen w-full flex flex-col font-sans-lore lore-grain" style={{ backgroundColor: "var(--lore-bg)", color: "var(--lore-text)" }}>
      {/* HEADER */}
      <header className="h-[60px] shrink-0 border-b flex items-center justify-between px-6 z-30" style={{ backgroundColor: "var(--lore-surface)", borderColor: "var(--lore-line)" }}>
        <div className="flex items-baseline gap-3">
          <span className="font-serif-lore text-[22px] tracking-tight">Lore</span>
          <span className="text-[10px] font-mono-lore" style={{ color: "var(--lore-faint)" }}>a listening knowledge base</span>
        </div>
        <div className="flex items-center gap-2 px-3 h-8 rounded-lg border w-[360px]" style={{ backgroundColor: "var(--lore-bg)", borderColor: "var(--lore-line)" }}>
          <Search className="w-3.5 h-3.5" style={{ color: "var(--lore-faint)" }} />
          <span className="text-[12px]" style={{ color: "var(--lore-faint)" }}>Search songs, albums, sources…</span>
        </div>
        {/* service-agnostic switcher */}
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-mono-lore tracking-widest" style={{ color: "var(--lore-faint)" }}>OUTPUT</span>
          <div className="flex items-center gap-1 p-1 rounded-full border" style={{ backgroundColor: "var(--lore-bg)", borderColor: "var(--lore-line)" }}>
            {(Object.keys(SVC) as SvcKey[]).map((k) => {
              const active = k === "spotify";
              return (
                <span key={k} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium"
                  style={active ? { backgroundColor: SVC[k].color, color: "#0C0A08" } : { color: "var(--lore-muted)" }}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: active ? "#0C0A08" : SVC[k].color }} />
                  {SVC[k].label}
                </span>
              );
            })}
          </div>
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden">
        {/* ============ HERO — THE ANNOTATION TIMELINE ============ */}
        <section className="flex-1 overflow-y-auto lore-scroll px-8 py-6 flex flex-col">
          <div className="flex items-end justify-between">
            <div>
              <Kicker>The annotation timeline · scrubbing the record</Kicker>
              <h1 className="font-serif-lore text-[40px] leading-none mt-2">Go Your Own Way</h1>
              <p className="text-[13px] mt-1.5" style={{ color: "var(--lore-muted)" }}>
                Fleetwood Mac · <span className="font-serif-lore italic">Rumours</span> (1977) · track 5 —{" "}
                <span className="font-mono-lore text-[11px]" style={{ color: "var(--lore-faint)" }}>ISRC USWB10002556</span>
              </p>
            </div>
            <div className="flex items-center gap-2 text-[11px] font-mono-lore" style={{ color: "var(--lore-live)" }}>
              <span className="w-2 h-2 rounded-full pulse-dot" style={{ backgroundColor: "var(--lore-live)" }} /> NOW · 2:31 / 3:38
            </div>
          </div>

          {/* THE SCRUB TRACK — annotations pinned to moments + a region */}
          <div className="mt-7 mb-2">
            <div className="relative h-[104px] rounded-xl border tlq-track overflow-hidden" style={{ borderColor: "var(--lore-line)" }}>
              {/* played portion */}
              <div className="absolute inset-y-0 left-0 tlq-played" style={{ width: pct(151) }} />
              {/* outro region band */}
              <div className="absolute inset-y-0 tlq-region border-l border-r" style={{ left: pct(REGION.from), width: pct(REGION.to - REGION.from), borderColor: "rgba(15,157,143,0.5)" }}>
                <span className="absolute top-1.5 left-1.5 flex items-center gap-1"><Chip k={REGION.src} /></span>
                <span className="absolute bottom-1.5 left-1.5 text-[9px] font-mono-lore" style={{ color: "var(--lore-text)" }}>2:30–3:38 · outro guitar army</span>
              </div>
              {/* moment pins */}
              {PINS.map((p) => (
                <div key={p.t} className="absolute top-0 bottom-0 flex flex-col items-center" style={{ left: pct(p.t), transform: "translateX(-50%)" }}>
                  <div className="tlq-pin mt-2 flex flex-col items-center gap-1">
                    <Chip k={p.src} />
                  </div>
                  <div className="flex-1 w-px" style={{ backgroundColor: p.now ? "var(--lore-amber)" : "rgba(232,164,76,0.25)" }} />
                  <span className="w-2.5 h-2.5 rounded-full mb-2" style={{ backgroundColor: p.now ? "var(--lore-amber)" : "var(--lore-faint)", boxShadow: p.now ? "0 0 10px rgba(232,164,76,0.7)" : "none" }} />
                </div>
              ))}
              {/* playhead */}
              <div className="absolute top-0 bottom-0 w-[2px] tlq-playhead z-10" style={{ left: pct(151), backgroundColor: "var(--lore-amber)" }}>
                <span className="absolute -top-0 left-1/2 -translate-x-1/2 -translate-y-full px-1.5 py-0.5 rounded text-[9px] font-mono-lore font-bold" style={{ backgroundColor: "var(--lore-amber)", color: "#0C0A08" }}>2:31</span>
              </div>
            </div>
            {/* ruler */}
            <div className="flex justify-between mt-1.5 text-[9px] font-mono-lore" style={{ color: "var(--lore-faint)" }}>
              <span>0:00</span><span>0:54</span><span>1:49</span><span>2:43</span><span>3:38</span>
            </div>
          </div>

          {/* ANNOTATION CARDS anchored to the pins */}
          <div className="mt-4 grid grid-cols-2 gap-4">
            {/* NOW card — the crux annotation at 0:24 (currently in focus) */}
            <div className="col-span-2 rounded-2xl border p-5 relative overflow-hidden" style={{ backgroundColor: "var(--lore-surface)", borderColor: "rgba(232,164,76,0.4)" }}>
              <div className="flex items-center gap-2 mb-3">
                <span className="font-mono-lore text-[18px] font-bold" style={{ color: "var(--lore-amber)" }}>0:24</span>
                <Chip k="pod" />
                <span className="text-[11px] font-mono-lore" style={{ color: "var(--lore-muted)" }}>Ep. 150 · Lindsey Buckingham</span>
                <span className="ml-auto flex items-center gap-1.5"><Eq /><span className="text-[10px] font-mono-lore" style={{ color: "var(--lore-amber)" }}>IN VIEW</span></span>
              </div>
              <p className="text-[17px] leading-relaxed font-serif-lore">
                <Quote className="w-4 h-4 inline -mt-1 mr-1 opacity-40" />I had a <strong>“Street Fighting Man”</strong> drum feel in my head. Mick couldn’t play it that way — so he played it <strong>wrong</strong>, and the wrong version is the one everybody knows.
              </p>
              <div className="flex items-center gap-2 mt-4">
                <button className="flex items-center gap-1.5 text-[11px] font-mono-lore font-bold px-3 py-1.5 rounded" style={{ backgroundColor: "var(--lore-elevated)", border: "1px solid var(--lore-line)" }}><Play className="w-3 h-3" /> PLAY EXCERPT</button>
                <span className="text-[10px] font-mono-lore" style={{ color: "var(--lore-faint)" }}>Beato WMTSG #12 corroborates →</span>
              </div>
            </div>

            {/* 0:00 */}
            <div className="rounded-xl border p-4" style={{ backgroundColor: "var(--lore-surface)", borderColor: "var(--lore-line)" }}>
              <div className="flex items-center gap-2 mb-2"><span className="font-mono-lore text-[13px] font-bold" style={{ color: "var(--lore-muted)" }}>0:00</span><Chip k="wiki" /></div>
              <p className="text-[13px] leading-relaxed" style={{ color: "var(--lore-muted)" }}>Opens on a single dry electric guitar figure, no rhythm section — the arrangement withholds the drums until the “wrong” feel arrives.</p>
            </div>
            {/* 1:03 */}
            <div className="rounded-xl border p-4" style={{ backgroundColor: "var(--lore-surface)", borderColor: "var(--lore-line)" }}>
              <div className="flex items-center gap-2 mb-2"><span className="font-mono-lore text-[13px] font-bold" style={{ color: "var(--lore-muted)" }}>1:03</span><Chip k="genius" /></div>
              <p className="text-[13px] leading-relaxed" style={{ color: "var(--lore-muted)" }}>Nicks reportedly hated <em>“packing up, shacking up’s all you want to do,”</em> called it untrue and asked him to cut it. He kept it.</p>
            </div>

            {/* crystallizing from chat, pinned to the now moment */}
            <div className="col-span-2 rounded-xl border p-3.5" style={{ backgroundColor: "rgba(232,164,76,0.06)", borderColor: "rgba(232,164,76,0.35)" }}>
              <div className="flex items-center gap-1.5 mb-1 text-[10px] font-mono-lore" style={{ color: "var(--lore-amber)" }}>
                <Sparkles className="w-3 h-3" /> CRYSTALLIZING FROM CHAT · ↑51 · settling onto the spine @0:24
              </div>
              <p className="text-[14px]"><span className="font-semibold" style={{ color: "var(--chip-genius)" }}>caillatfan</span> — “The ‘mistake’ beat is the entire identity of this song.”</p>
            </div>
          </div>
        </section>

        {/* ============ RIGHT RAIL — HEARD ON + QUEUE ============ */}
        <aside className="w-[400px] shrink-0 border-l flex flex-col overflow-y-auto lore-scroll" style={{ backgroundColor: "var(--lore-bg)", borderColor: "var(--lore-line)" }}>
          {/* HEARD ON — metadata that is also tappable to drive the queue */}
          <div className="p-4 border-b" style={{ borderColor: "var(--lore-line)" }}>
            <Kicker>Heard on · tap to queue</Kicker>
            <p className="text-[11px] mt-1.5 leading-relaxed" style={{ color: "var(--lore-faint)" }}>Where this song is playing right now. Each show &amp; spin is metadata — and a tappable input that pushes canonical tracks into your queue.</p>

            {/* album show */}
            <div className="mt-3 rounded-xl border p-3" style={{ backgroundColor: "var(--lore-elevated)", borderColor: "rgba(232,164,76,0.35)" }}>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-[9px] font-mono-lore px-1.5 py-0.5 rounded" style={{ backgroundColor: "var(--lore-amber)", color: "#0C0A08", fontWeight: 700 }}>ALBUM SHOW</span>
                <span className="w-1.5 h-1.5 rounded-full pulse-dot" style={{ backgroundColor: "var(--lore-live)" }} />
                <span className="text-[9px] font-mono-lore" style={{ color: "var(--lore-live)" }}>LIVE · track 5/11</span>
              </div>
              <h4 className="text-[14px] font-semibold leading-tight">Classic Albums Hour — Rumours, front to back</h4>
              <div className="flex items-center gap-2 mt-2.5">
                <button className="flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1.5 rounded-full" style={{ backgroundColor: "var(--lore-amber)", color: "#0C0A08" }}><ListMusic className="w-3 h-3" /> Queue rest of show (6)</button>
                <button className="flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-full border" style={{ borderColor: "var(--lore-line)", color: "var(--lore-muted)" }}><CornerUpRight className="w-3 h-3" /> Play next</button>
              </div>
            </div>

            {/* individual radio spins */}
            <div className="mt-2.5 flex flex-col gap-2">
              {[
                { name: "KEXP", sub: "90.3 Seattle", fmt: "AAC", when: "spun 4m ago" },
                { name: "Radio Paradise", sub: "Rock Mix", fmt: "AAC", when: "on air now" },
                { name: "Radio Paradise", sub: "Main Mix", fmt: "FLAC", when: "spun 22m ago" },
              ].map((s) => (
                <div key={s.name + s.sub} className="rounded-lg border p-2.5 flex items-center gap-2.5" style={{ backgroundColor: "var(--lore-surface)", borderColor: "var(--lore-line)" }}>
                  <Radio className="w-4 h-4 shrink-0" style={{ color: "var(--lore-faint)" }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-[12px] font-semibold truncate">{s.name}</span>
                      <span className="text-[10px]" style={{ color: "var(--lore-muted)" }}>{s.sub}</span>
                      <span className="text-[8px] font-mono-lore px-1 py-0.5 rounded border" style={{ borderColor: "var(--lore-line)", color: "var(--lore-faint)" }}>{s.fmt}</span>
                    </div>
                    <span className="text-[10px] font-mono-lore" style={{ color: "var(--lore-faint)" }}>{s.when}</span>
                  </div>
                  <button className="flex items-center gap-1 text-[10px] font-mono-lore px-2 py-1 rounded-full border shrink-0" style={{ borderColor: "var(--lore-line)", color: "var(--lore-amber)" }}><Plus className="w-3 h-3" /> Queue</button>
                </div>
              ))}
            </div>
            <p className="text-[9px] font-mono-lore mt-2 leading-relaxed" style={{ color: "var(--lore-faint)" }}>Note: the live stream itself isn’t queueable — but each track it spins is, by canonical identity.</p>
          </div>

          {/* THE QUEUE — service-agnostic (canonical identities) */}
          <div className="p-4 flex-1">
            <div className="flex items-center justify-between">
              <Kicker>Queue · service-agnostic</Kicker>
              <span className="text-[10px] font-mono-lore" style={{ color: "var(--lore-faint)" }}>{QUEUE.length} tracks</span>
            </div>

            {/* active output + swap */}
            <div className="mt-2.5 rounded-xl border p-3" style={{ backgroundColor: "var(--lore-surface)", borderColor: "var(--lore-line)" }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono-lore" style={{ color: "var(--lore-faint)" }}>PLAYING VIA</span>
                  <span className="flex items-center gap-1.5 text-[12px] font-semibold">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: "var(--svc-spotify)" }} /> Spotify
                  </span>
                </div>
                <button className="flex items-center gap-1.5 text-[10px] font-mono-lore px-2.5 py-1 rounded-full border" style={{ borderColor: "rgba(232,164,76,0.4)", color: "var(--lore-amber)" }}><Repeat className="w-3 h-3" /> Swap output</button>
              </div>
              <p className="text-[10px] leading-relaxed mt-2" style={{ color: "var(--lore-faint)" }}>
                Swap to Apple Music or YT Music mid-song — resumes at <span style={{ color: "var(--lore-muted)" }}>2:31</span>. Near-seamless (~1s re-buffer), <span style={{ color: "var(--lore-muted)" }}>not gapless</span>. Availability is best-effort per track.
              </p>
              <div className="flex items-center gap-3 mt-2.5 text-[9px] font-mono-lore" style={{ color: "var(--lore-faint)" }}>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: "var(--lore-muted)" }} /> exact</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ border: "1.5px solid var(--lore-muted)" }} /> search-match</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: "var(--lore-line)" }} /> unavailable</span>
              </div>
            </div>

            {/* queue list */}
            <div className="mt-3 flex flex-col gap-1.5">
              {QUEUE.map((q, i) => (
                <div key={q.isrc} className="rounded-lg border p-2.5 flex items-center gap-2.5"
                  style={q.now ? { backgroundColor: "rgba(232,164,76,0.1)", borderColor: "rgba(232,164,76,0.4)" } : { backgroundColor: "var(--lore-surface)", borderColor: "var(--lore-line)" }}>
                  <span className="w-4 text-center shrink-0">
                    {q.now ? <Eq /> : <GripVertical className="w-3.5 h-3.5 opacity-40" />}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[13px] font-medium truncate" style={{ color: q.now ? "var(--lore-text)" : "var(--lore-text)" }}>{q.title}</span>
                      {q.now && <span className="text-[8px] font-mono-lore px-1 py-0.5 rounded" style={{ backgroundColor: "var(--lore-amber)", color: "#0C0A08", fontWeight: 700 }}>NOW</span>}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[9px] font-mono-lore truncate" style={{ color: "var(--lore-faint)" }}>{q.isrc} · from {q.from}</span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <AvailDots map={q.avail} />
                    {q.votes ? <span className="text-[9px] font-mono-lore" style={{ color: "var(--lore-faint)" }}>↑{q.votes}</span> : q.avail.ytm === "none" ? <span className="text-[8px] font-mono-lore" style={{ color: "var(--svc-ytm)" }}>1 gap</span> : null}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[10px] leading-relaxed mt-3" style={{ color: "var(--lore-faint)" }}>
              The queue stores <span style={{ color: "var(--lore-muted)" }}>canonical identities (MBID / ISRC)</span>, not service URLs — so it survives switching output and connecting new services.
            </p>
          </div>
        </aside>
      </main>

      {/* FOOTER — canonical now playing + active output */}
      <footer className="h-[56px] shrink-0 border-t flex items-center gap-4 px-6 z-30" style={{ backgroundColor: "var(--lore-surface)", borderColor: "var(--lore-line)" }}>
        <div className="w-9 h-9 rounded-full border-2 border-black/40 flex items-center justify-center shrink-0" style={{ background: "conic-gradient(from 0deg, #1a1410, #3a2a1c, #1a1410)" }}>
          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: "var(--lore-amber)" }} />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium truncate">Go Your Own Way</span>
            <span className="text-[9px] font-mono-lore px-1 py-0.5 rounded border shrink-0" style={{ borderColor: "var(--lore-line)", color: "var(--lore-faint)" }}>ISRC USWB10002556</span>
          </div>
          <span className="text-[11px]" style={{ color: "var(--lore-muted)" }}>Fleetwood Mac</span>
        </div>
        <div className="flex-1 flex items-center gap-2 max-w-[420px]">
          <span className="text-[10px] font-mono-lore" style={{ color: "var(--lore-faint)" }}>2:31</span>
          <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ backgroundColor: "var(--lore-line)" }}><div className="h-full" style={{ width: "69%", backgroundColor: "var(--lore-amber)" }} /></div>
          <span className="text-[10px] font-mono-lore" style={{ color: "var(--lore-faint)" }}>3:38</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1.5 rounded-full" style={{ backgroundColor: "var(--lore-elevated)", border: "1px solid var(--lore-line)" }}>
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: "var(--svc-spotify)" }} /> via Spotify
          </span>
          <button className="flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1.5 rounded-full border" style={{ borderColor: "rgba(232,164,76,0.4)", color: "var(--lore-amber)" }}>
            <Repeat className="w-3.5 h-3.5" /> Swap → resume @2:31
          </button>
        </div>
      </footer>
    </div>
  );
}
