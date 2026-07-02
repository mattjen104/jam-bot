import React from "react";
import "./_group.css";
import {
  Play, Sparkles, ListMusic, Radio, Plus, Repeat, ChevronUp, Quote, Check,
} from "lucide-react";

type SrcKey = "wiki" | "pod" | "sos" | "genius";
const SRC: Record<SrcKey, { label: string; color: string }> = {
  wiki: { label: "WIKI", color: "var(--chip-wiki)" },
  pod: { label: "SONG EXPLODER", color: "var(--chip-pod)" },
  sos: { label: "SOUND ON SOUND", color: "var(--chip-sos)" },
  genius: { label: "GENIUS", color: "var(--chip-genius)" },
};
function Chip({ k }: { k: SrcKey }) {
  const s = SRC[k];
  return (
    <span className="px-1.5 py-0.5 text-[8px] font-mono-lore rounded font-bold leading-none" style={{ backgroundColor: s.color, color: "#0C0A08" }}>
      {s.label}
    </span>
  );
}
function Kicker({ children, color = "var(--lore-amber)" }: { children: React.ReactNode; color?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[9px] font-mono-lore tracking-[0.2em] uppercase" style={{ color }}>
      <span className="w-3 h-px" style={{ backgroundColor: color }} /> {children}
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

type SvcKey = "spotify" | "apple" | "ytm";
const SVC: Record<SvcKey, { label: string; color: string }> = {
  spotify: { label: "Spotify", color: "var(--svc-spotify)" },
  apple: { label: "Apple", color: "var(--svc-apple)" },
  ytm: { label: "YTM", color: "var(--svc-ytm)" },
};
type Avail = "exact" | "search" | "none";
function AvailDots({ map }: { map: Record<SvcKey, Avail> }) {
  return (
    <span className="inline-flex items-center gap-1">
      {(Object.keys(SVC) as SvcKey[]).map((k) => {
        const a = map[k]; const c = SVC[k].color;
        return (
          <span key={k} className="w-2 h-2 rounded-full"
            style={a === "exact" ? { backgroundColor: c } : a === "search" ? { border: `1.5px solid ${c}` } : { backgroundColor: "var(--lore-line)" }} />
        );
      })}
    </span>
  );
}

/* vertical annotation spine — the hero on mobile */
const SPINE = [
  { t: "0:00", src: "wiki" as SrcKey, done: true, text: "Lone, dry guitar riff — the arrangement withholds the drums." },
  {
    t: "0:24", src: "pod" as SrcKey, now: true,
    text: "I had a “Street Fighting Man” drum feel in my head. Mick couldn’t play it — so he played it wrong, and the wrong version is the one everybody knows.",
    meta: "Ep. 150 · Lindsey Buckingham",
  },
  { t: "1:03", src: "genius" as SrcKey, text: "Nicks asked him to cut “packing up, shacking up’s all you want to do.” He kept it." },
  { t: "2:30–3:38", src: "sos" as SrcKey, region: true, text: "The outro guitar army — layered Les Paul overdubs fade out the record. A region, not a moment." },
];

const QUEUE = [
  { title: "Go Your Own Way", now: true, avail: { spotify: "exact", apple: "exact", ytm: "exact" } as Record<SvcKey, Avail> },
  { title: "Dreams", avail: { spotify: "exact", apple: "exact", ytm: "exact" } as Record<SvcKey, Avail> },
  { title: "The Chain", avail: { spotify: "exact", apple: "exact", ytm: "search" } as Record<SvcKey, Avail> },
  { title: "Silver Springs", avail: { spotify: "exact", apple: "search", ytm: "none" } as Record<SvcKey, Avail> },
];

export function TimelineQueueMobile() {
  return (
    <div className="mx-auto w-[402px] min-h-screen flex flex-col font-sans-lore lore-grain relative" style={{ backgroundColor: "var(--lore-bg)", color: "var(--lore-text)" }}>
      {/* HEADER — wordmark + compact service switcher */}
      <header className="h-[52px] shrink-0 border-b flex items-center justify-between px-4" style={{ backgroundColor: "var(--lore-surface)", borderColor: "var(--lore-line)" }}>
        <span className="font-serif-lore text-[20px]">Lore</span>
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-full border" style={{ borderColor: "var(--lore-line)", backgroundColor: "var(--lore-bg)" }}>
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: "var(--svc-spotify)" }} />
          <span className="text-[11px] font-medium">Spotify</span>
          <Repeat className="w-3 h-3" style={{ color: "var(--lore-amber)" }} />
        </div>
      </header>

      {/* scroll body — annotation timeline is the hero, pinned to the record */}
      <div className="flex-1 overflow-y-auto lore-scroll pb-[150px]">
        {/* song identity */}
        <div className="px-4 pt-4">
          <Kicker>The annotation timeline</Kicker>
          <h1 className="font-serif-lore text-[30px] leading-none mt-2">Go Your Own Way</h1>
          <p className="text-[12px] mt-1.5" style={{ color: "var(--lore-muted)" }}>
            Fleetwood Mac · <span className="font-serif-lore italic">Rumours</span> · track 5
          </p>
          <span className="text-[9px] font-mono-lore" style={{ color: "var(--lore-faint)" }}>ISRC USWB10002556</span>
        </div>

        {/* mini scrub bar with the playhead */}
        <div className="px-4 mt-3">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono-lore" style={{ color: "var(--lore-amber)" }}>2:31</span>
            <div className="flex-1 h-1.5 rounded-full overflow-hidden relative" style={{ backgroundColor: "var(--lore-line)" }}>
              <div className="h-full" style={{ width: "69%", backgroundColor: "var(--lore-amber)" }} />
              <span className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full tlq-playhead" style={{ left: "69%", marginLeft: "-6px", backgroundColor: "var(--lore-amber)" }} />
            </div>
            <span className="text-[10px] font-mono-lore" style={{ color: "var(--lore-faint)" }}>3:38</span>
          </div>
        </div>

        {/* VERTICAL SPINE OF ANNOTATIONS */}
        <div className="relative pl-9 pr-4 mt-5">
          <div className="absolute left-[18px] top-2 bottom-2 w-[2px] tlq-spine" />
          <div className="flex flex-col gap-4">
            {SPINE.map((a, i) => (
              <div key={i} className="relative">
                {/* node */}
                <span className="absolute -left-[26px] top-1 rounded-full flex items-center justify-center"
                  style={a.now
                    ? { width: 16, height: 16, backgroundColor: "var(--lore-amber)", boxShadow: "0 0 12px rgba(232,164,76,0.7)", border: "2px solid var(--lore-surface)" }
                    : { width: 11, height: 11, backgroundColor: a.done ? "var(--chip-sos)" : a.region ? "var(--chip-sos)" : "var(--lore-faint)", border: "2px solid var(--lore-surface)" }}>
                  {a.done && <Check className="w-2 h-2" style={{ color: "#0C0A08" }} />}
                </span>

                {a.now ? (
                  <div className="rounded-2xl border p-3.5" style={{ backgroundColor: "var(--lore-surface)", borderColor: "rgba(232,164,76,0.4)" }}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-mono-lore text-[15px] font-bold" style={{ color: "var(--lore-amber)" }}>{a.t}</span>
                      <Chip k={a.src} />
                      <span className="ml-auto flex items-center gap-1"><Eq /><span className="text-[9px] font-mono-lore" style={{ color: "var(--lore-amber)" }}>NOW</span></span>
                    </div>
                    <p className="text-[15px] leading-relaxed font-serif-lore"><Quote className="w-3.5 h-3.5 inline -mt-1 mr-1 opacity-40" />{a.text}</p>
                    <p className="text-[10px] font-mono-lore mt-2" style={{ color: "var(--lore-faint)" }}>{a.meta}</p>
                    <button className="mt-2.5 flex items-center gap-1.5 text-[10px] font-mono-lore font-bold px-2.5 py-1.5 rounded" style={{ backgroundColor: "var(--lore-elevated)", border: "1px solid var(--lore-line)" }}><Play className="w-3 h-3" /> PLAY EXCERPT</button>
                  </div>
                ) : (
                  <div className="rounded-xl border p-3" style={{ backgroundColor: "var(--lore-surface)", borderColor: a.region ? "rgba(15,157,143,0.4)" : "var(--lore-line)" }}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="font-mono-lore text-[12px] font-bold" style={{ color: a.done ? "var(--lore-faint)" : "var(--lore-muted)" }}>{a.t}</span>
                      <Chip k={a.src} />
                      {a.region && <span className="text-[8px] font-mono-lore" style={{ color: "var(--chip-sos)" }}>REGION</span>}
                    </div>
                    <p className="text-[12px] leading-relaxed" style={{ color: "var(--lore-muted)" }}>{a.text}</p>
                  </div>
                )}
              </div>
            ))}

            {/* crystallizing */}
            <div className="relative">
              <span className="absolute -left-[24px] top-2 w-2.5 h-2.5 rounded-full" style={{ backgroundColor: "var(--chip-genius)", border: "2px solid var(--lore-surface)" }} />
              <div className="rounded-xl border p-3" style={{ backgroundColor: "rgba(232,164,76,0.06)", borderColor: "rgba(232,164,76,0.35)" }}>
                <div className="flex items-center gap-1.5 mb-1 text-[9px] font-mono-lore" style={{ color: "var(--lore-amber)" }}><Sparkles className="w-3 h-3" /> CRYSTALLIZING · ↑51 · @0:24</div>
                <p className="text-[12px]"><span className="font-semibold" style={{ color: "var(--chip-genius)" }}>caillatfan</span> — “The ‘mistake’ beat is the entire identity of this song.”</p>
              </div>
            </div>
          </div>
        </div>

        {/* HEARD ON — tappable inputs */}
        <div className="px-4 mt-7">
          <Kicker>Heard on · tap to queue</Kicker>
          <div className="mt-2.5 rounded-xl border p-3" style={{ backgroundColor: "var(--lore-elevated)", borderColor: "rgba(232,164,76,0.35)" }}>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[8px] font-mono-lore px-1.5 py-0.5 rounded" style={{ backgroundColor: "var(--lore-amber)", color: "#0C0A08", fontWeight: 700 }}>ALBUM SHOW</span>
              <span className="w-1.5 h-1.5 rounded-full pulse-dot" style={{ backgroundColor: "var(--lore-live)" }} />
              <span className="text-[9px] font-mono-lore" style={{ color: "var(--lore-live)" }}>LIVE 5/11</span>
            </div>
            <h4 className="text-[13px] font-semibold leading-tight">Classic Albums Hour — Rumours</h4>
            <button className="mt-2.5 flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-full" style={{ backgroundColor: "var(--lore-amber)", color: "#0C0A08" }}><ListMusic className="w-3 h-3" /> Queue rest of show (6)</button>
          </div>
          <div className="mt-2 flex flex-col gap-2">
            {[
              { name: "KEXP", sub: "90.3", fmt: "AAC" },
              { name: "Radio Paradise", sub: "Rock Mix", fmt: "AAC" },
            ].map((s) => (
              <div key={s.sub} className="rounded-lg border p-2.5 flex items-center gap-2.5" style={{ backgroundColor: "var(--lore-surface)", borderColor: "var(--lore-line)" }}>
                <Radio className="w-4 h-4 shrink-0" style={{ color: "var(--lore-faint)" }} />
                <div className="flex-1 min-w-0">
                  <span className="text-[12px] font-semibold">{s.name}</span>
                  <span className="text-[10px] ml-1.5" style={{ color: "var(--lore-muted)" }}>{s.sub}</span>
                </div>
                <span className="text-[8px] font-mono-lore px-1 py-0.5 rounded border" style={{ borderColor: "var(--lore-line)", color: "var(--lore-faint)" }}>{s.fmt}</span>
                <button className="flex items-center gap-1 text-[10px] font-mono-lore px-2 py-1 rounded-full border" style={{ borderColor: "var(--lore-line)", color: "var(--lore-amber)" }}><Plus className="w-3 h-3" /> Queue</button>
              </div>
            ))}
          </div>
          <p className="text-[9px] font-mono-lore mt-2 leading-relaxed" style={{ color: "var(--lore-faint)" }}>The stream itself isn’t queueable — each track it spins is, by canonical identity.</p>
        </div>
      </div>

      {/* STICKY QUEUE SHEET — service-agnostic */}
      <div className="absolute bottom-0 left-0 right-0 border-t rounded-t-2xl" style={{ backgroundColor: "var(--lore-surface)", borderColor: "var(--lore-line)", boxShadow: "0 -12px 30px rgba(0,0,0,0.5)" }}>
        <div className="flex items-center justify-center pt-1.5"><span className="w-9 h-1 rounded-full" style={{ backgroundColor: "var(--lore-line)" }} /></div>
        <div className="px-4 pt-1.5 pb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ListMusic className="w-3.5 h-3.5" style={{ color: "var(--lore-amber)" }} />
            <span className="text-[11px] font-mono-lore" style={{ color: "var(--lore-muted)" }}>QUEUE · {QUEUE.length} · via</span>
            <span className="flex items-center gap-1 text-[11px] font-semibold"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: "var(--svc-spotify)" }} />Spotify</span>
          </div>
          <button className="flex items-center gap-1 text-[10px] font-mono-lore px-2 py-1 rounded-full border" style={{ borderColor: "rgba(232,164,76,0.4)", color: "var(--lore-amber)" }}><Repeat className="w-3 h-3" /> Swap</button>
        </div>

        {/* service legend */}
        <div className="px-4 pb-1.5 flex items-center gap-3 text-[9px] font-mono-lore" style={{ color: "var(--lore-faint)" }}>
          {(Object.keys(SVC) as SvcKey[]).map((k) => (
            <span key={k} className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: SVC[k].color }} />{SVC[k].label}</span>
          ))}
          <span className="ml-auto flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ border: "1.5px solid var(--lore-muted)" }} />search</span>
        </div>

        {/* peek of the queue with per-service availability */}
        <div className="px-4 pb-2 flex flex-col gap-1">
          {QUEUE.map((q, i) => (
            <div key={q.title} className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg" style={q.now ? { backgroundColor: "rgba(232,164,76,0.1)" } : {}}>
              <span className="w-4 text-center shrink-0">{q.now ? <Eq /> : <span className="text-[10px] font-mono-lore" style={{ color: "var(--lore-faint)" }}>{i + 1}</span>}</span>
              <span className="flex-1 text-[12px] truncate" style={{ fontWeight: q.now ? 600 : 400 }}>{q.title}</span>
              {q.now && <span className="text-[8px] font-mono-lore px-1 py-0.5 rounded" style={{ backgroundColor: "var(--lore-amber)", color: "#0C0A08", fontWeight: 700 }}>NOW</span>}
              <AvailDots map={q.avail} />
            </div>
          ))}
        </div>

        <div className="px-4 pb-3 flex items-center gap-2 border-t pt-2" style={{ borderColor: "var(--lore-line)" }}>
          <p className="text-[9px] leading-snug flex-1" style={{ color: "var(--lore-faint)" }}>
            Queue holds <span style={{ color: "var(--lore-muted)" }}>canonical IDs</span>, not links. Swap resumes at <span style={{ color: "var(--lore-muted)" }}>2:31</span> — ~1s re-buffer, not gapless.
          </p>
          <button className="flex items-center gap-1 text-[10px] font-mono-lore" style={{ color: "var(--lore-amber)" }}>Expand <ChevronUp className="w-3 h-3" /></button>
        </div>
      </div>
    </div>
  );
}
