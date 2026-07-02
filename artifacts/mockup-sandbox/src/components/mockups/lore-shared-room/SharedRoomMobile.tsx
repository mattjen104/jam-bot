import React from "react";
import "./_group.css";
import {
  Play, Radio, History, Disc3, Plus, Repeat, Users, Hand,
  Share2, ListMusic, CornerDownRight, Check, ChevronUp,
} from "lucide-react";

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

type Prov = "album" | "live" | "historical" | "you";
const PROV: Record<Prov, { label: string; color: string; Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }> }> = {
  album: { label: "NEXT ON ALBUM", color: "var(--prov-album)", Icon: Disc3 },
  live: { label: "DJ SEGUE · LIVE", color: "var(--prov-live)", Icon: Radio },
  historical: { label: "DJ SEGUE · PAST", color: "var(--prov-historical)", Icon: History },
  you: { label: "ADDED BY YOU", color: "var(--prov-you)", Icon: Plus },
};
function ProvBadge({ p }: { p: Prov }) {
  const { label, color, Icon } = PROV[p];
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[7px] font-mono-lore font-bold leading-none"
      style={{ color, border: `1px solid ${color}` }}>
      <Icon className="w-2 h-2" /> {label}
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

type ThreadItem = {
  title: string; artist: string; isrc: string; mbid: string;
  prov: Prov; state: "played" | "now" | "next";
  segue: string; avail: Record<SvcKey, Avail>;
};
const THREAD: ThreadItem[] = [
  { title: "Dreams", artist: "Fleetwood Mac", isrc: "USWB10002551", mbid: "a1f4c8e2", prov: "historical", state: "played",
    segue: "Garvey opened on the Rumours run", avail: { spotify: "exact", apple: "exact", ytm: "exact" } },
  { title: "Go Your Own Way", artist: "Fleetwood Mac", isrc: "USWB10002556", mbid: "3d9b7f10", prov: "live", state: "now",
    segue: "the song Mara shared in", avail: { spotify: "exact", apple: "exact", ytm: "exact" } },
  { title: "Silver Springs", artist: "Fleetwood Mac", isrc: "USEE10021456", mbid: "c62e0a5d", prov: "live", state: "next",
    segue: "Garvey's real next pick", avail: { spotify: "exact", apple: "search", ytm: "none" } },
  { title: "Songbird", artist: "Fleetwood Mac", isrc: "USWB10002557", mbid: "7b18d4aa", prov: "album", state: "next",
    segue: "or next on Rumours (track 6)", avail: { spotify: "exact", apple: "exact", ytm: "exact" } },
  { title: "Cortez the Killer", artist: "Neil Young", isrc: "USRE19942312", mbid: "e50f2c93", prov: "historical", state: "next",
    segue: "where Peel took it, '77", avail: { spotify: "exact", apple: "exact", ytm: "search" } },
  { title: "Landslide", artist: "Fleetwood Mac", isrc: "USWB10259001", mbid: "9a3c61be", prov: "you", state: "next",
    segue: "you dropped this into the room", avail: { spotify: "exact", apple: "exact", ytm: "exact" } },
];

const UP_NEXT = THREAD.filter((t) => t.state !== "played");

export function SharedRoomMobile() {
  return (
    <div className="mx-auto w-[402px] min-h-screen flex flex-col font-sans-lore lore-grain relative" style={{ backgroundColor: "var(--lore-bg)", color: "var(--lore-text)" }}>
      {/* HEADER */}
      <header className="h-[52px] shrink-0 border-b flex items-center justify-between px-4" style={{ backgroundColor: "var(--lore-surface)", borderColor: "var(--lore-line)" }}>
        <div className="flex items-center gap-2">
          <span className="font-serif-lore text-[20px]">Lore</span>
          <span className="text-[8px] font-mono-lore inline-flex items-center gap-1" style={{ color: "var(--lore-faint)" }}><Share2 className="w-2.5 h-2.5" /> shared room</span>
        </div>
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-full border" style={{ borderColor: "var(--lore-line)", backgroundColor: "var(--lore-bg)" }}>
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: "var(--svc-spotify)" }} />
          <span className="text-[11px] font-medium">Spotify</span>
          <Repeat className="w-3 h-3" style={{ color: "var(--lore-amber)" }} />
        </div>
      </header>

      <div className="flex-1 overflow-y-auto lore-scroll pb-[176px]">
        {/* ROOM BANNER */}
        <div className="px-4 pt-4">
          <div className="rounded-2xl border p-3.5 ride-sweep" style={{ backgroundColor: "var(--lore-surface)", borderColor: "rgba(255,90,60,0.4)" }}>
            <p className="text-[11px] leading-tight" style={{ color: "var(--lore-muted)" }}>
              <span className="font-semibold" style={{ color: "var(--lore-text)" }}>Mara</span> shared <span className="font-semibold" style={{ color: "var(--lore-text)" }}>“Go Your Own Way”</span> and opened this room.
            </p>
            <div className="mt-3 flex items-center gap-2.5">
              <span className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: "var(--lore-elevated)" }}>
                <Radio className="w-4 h-4" style={{ color: "var(--lore-live)" }} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold leading-tight truncate">Guy Garvey’s Finest Hour</p>
                <p className="text-[10px]" style={{ color: "var(--lore-muted)" }}>BBC 6 Music · you’re riding along</p>
              </div>
              <span className="flex items-center gap-1 text-[9px] font-mono-lore shrink-0" style={{ color: "var(--lore-live)" }}>
                <span className="w-2 h-2 rounded-full pulse-dot" style={{ backgroundColor: "var(--lore-live)" }} /> LIVE
              </span>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <button className="flex-1 flex items-center justify-center gap-1.5 text-[10px] font-medium px-2 py-1.5 rounded-full border" style={{ borderColor: "var(--lore-line)", color: "var(--lore-muted)" }}><Hand className="w-3 h-3" /> Take the wheel</button>
              <span className="flex items-center gap-1 text-[10px] font-mono-lore" style={{ color: "var(--lore-faint)" }}><Users className="w-3 h-3" /> 23</span>
            </div>
          </div>
        </div>

        {/* provenance legend */}
        <div className="px-4 mt-4 flex flex-wrap items-center gap-1.5">
          {(Object.keys(PROV) as Prov[]).map((p) => <ProvBadge key={p} p={p} />)}
        </div>

        {/* SEGUE THREAD (hero) */}
        <div className="px-4 mt-4">
          <Kicker>The segue thread · real radio sequence</Kicker>
        </div>
        <div className="relative pl-9 pr-4 mt-3">
          <div className="absolute left-[18px] top-2 bottom-2 w-[2px] seg-spine" />
          <div className="flex flex-col gap-3.5">
            {THREAD.map((t, i) => {
              const prev = THREAD[i - 1];
              const isNow = t.state === "now";
              const played = t.state === "played";
              const c = PROV[t.prov].color;
              return (
                <div key={t.isrc} className="relative">
                  {prev && (
                    <div className="flex items-center gap-1 mb-1.5">
                      <CornerDownRight className="w-2.5 h-2.5" style={{ color: "var(--lore-faint)" }} />
                      <span className="text-[9px] font-mono-lore italic" style={{ color: "var(--lore-faint)" }}>{t.segue}</span>
                    </div>
                  )}
                  <span className={`absolute -left-[26px] rounded-full flex items-center justify-center ${!isNow && t.prov === "live" ? "seg-arrive" : ""}`}
                    style={isNow
                      ? { width: 16, height: 16, top: 12, backgroundColor: "var(--lore-amber)", boxShadow: "0 0 12px rgba(232,164,76,0.7)", border: "2px solid var(--lore-bg)" }
                      : { width: 11, height: 11, top: 14, backgroundColor: played ? "var(--lore-faint)" : c, border: "2px solid var(--lore-bg)" }}>
                    {played && <Check className="w-2 h-2" style={{ color: "#0C0A08" }} />}
                  </span>

                  <div className="rounded-xl border p-3"
                    style={isNow
                      ? { backgroundColor: "var(--lore-surface)", borderColor: "rgba(232,164,76,0.45)", boxShadow: "0 0 18px 1px rgba(232,164,76,0.16)" }
                      : { backgroundColor: "var(--lore-surface)", borderColor: "var(--lore-line)", opacity: played ? 0.6 : 1 }}>
                    <div className="flex items-center gap-2">
                      <span className="w-4 text-center shrink-0">
                        {isNow ? <Eq /> : played ? <Check className="w-3 h-3" style={{ color: "var(--lore-faint)" }} /> : <span className="text-[10px] font-mono-lore" style={{ color: "var(--lore-faint)" }}>{i}</span>}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[13px] font-medium truncate">{t.title}</span>
                          {isNow && <span className="text-[7px] font-mono-lore px-1 py-0.5 rounded" style={{ backgroundColor: "var(--lore-amber)", color: "#0C0A08", fontWeight: 700 }}>NOW</span>}
                        </div>
                        <span className="text-[11px]" style={{ color: "var(--lore-muted)" }}>{t.artist}</span>
                      </div>
                      <AvailDots map={t.avail} />
                    </div>
                    <div className="flex items-center gap-2 mt-2 pl-6">
                      <ProvBadge p={t.prov} />
                      <span className="text-[8px] font-mono-lore truncate" style={{ color: "var(--lore-faint)" }}>MBID {t.mbid}… · {t.isrc}</span>
                    </div>
                  </div>
                </div>
              );
            })}

            <div className="relative">
              <span className="absolute -left-[24px] top-2 w-2.5 h-2.5 rounded-full seg-arrive" style={{ backgroundColor: "var(--lore-live)", border: "2px solid var(--lore-bg)" }} />
              <div className="rounded-xl border border-dashed p-2.5 flex items-center gap-2" style={{ borderColor: "rgba(255,90,60,0.4)", backgroundColor: "rgba(255,90,60,0.05)" }}>
                <Radio className="w-3 h-3" style={{ color: "var(--lore-live)" }} />
                <span className="text-[10px] font-mono-lore" style={{ color: "var(--lore-live)" }}>new segues append as Garvey plays…</span>
              </div>
            </div>
          </div>
        </div>

        {/* load their real picks */}
        <div className="px-4 mt-6">
          <div className="rounded-xl border p-3" style={{ backgroundColor: "var(--lore-elevated)", borderColor: "rgba(232,164,76,0.35)" }}>
            <p className="text-[11px] leading-relaxed" style={{ color: "var(--lore-muted)" }}>
              Pull the DJ’s <span style={{ color: "var(--lore-text)" }}>actual next tracks</span> into your queue — what they really played, never an algorithm.
            </p>
            <button className="mt-2.5 w-full flex items-center justify-center gap-1.5 text-[11px] font-medium px-3 py-2 rounded-full" style={{ backgroundColor: "var(--lore-amber)", color: "#0C0A08" }}>
              <ListMusic className="w-3.5 h-3.5" /> Load Garvey’s next 6 segues
            </button>
          </div>
        </div>
      </div>

      {/* STICKY QUEUE SHEET */}
      <div className="absolute bottom-0 left-0 right-0 border-t rounded-t-2xl" style={{ backgroundColor: "var(--lore-surface)", borderColor: "var(--lore-line)", boxShadow: "0 -12px 30px rgba(0,0,0,0.5)" }}>
        <div className="flex items-center justify-center pt-1.5"><span className="w-9 h-1 rounded-full" style={{ backgroundColor: "var(--lore-line)" }} /></div>
        <div className="px-4 pt-1.5 pb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ListMusic className="w-3.5 h-3.5" style={{ color: "var(--lore-amber)" }} />
            <span className="text-[11px] font-mono-lore" style={{ color: "var(--lore-muted)" }}>QUEUE · {UP_NEXT.length} · via</span>
            <span className="flex items-center gap-1 text-[11px] font-semibold"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: "var(--svc-spotify)" }} />Spotify</span>
          </div>
          <button className="flex items-center gap-1 text-[10px] font-mono-lore px-2 py-1 rounded-full border" style={{ borderColor: "rgba(232,164,76,0.4)", color: "var(--lore-amber)" }}><Repeat className="w-3 h-3" /> Swap</button>
        </div>

        {/* provenance dots + service legend */}
        <div className="px-4 pb-1.5 flex items-center gap-3 text-[8px] font-mono-lore" style={{ color: "var(--lore-faint)" }}>
          {(Object.keys(SVC) as SvcKey[]).map((k) => (
            <span key={k} className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: SVC[k].color }} />{SVC[k].label}</span>
          ))}
          <span className="ml-auto flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ border: "1.5px solid var(--lore-muted)" }} />search</span>
        </div>

        <div className="px-4 pb-2 flex flex-col gap-1">
          {UP_NEXT.map((q, i) => (
            <div key={q.isrc} className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg" style={q.state === "now" ? { backgroundColor: "rgba(232,164,76,0.1)" } : {}}>
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: PROV[q.prov].color }} title={PROV[q.prov].label} />
              <span className="w-4 text-center shrink-0">{q.state === "now" ? <Eq /> : <span className="text-[10px] font-mono-lore" style={{ color: "var(--lore-faint)" }}>{i}</span>}</span>
              <span className="flex-1 text-[12px] truncate" style={{ fontWeight: q.state === "now" ? 600 : 400 }}>{q.title}</span>
              {q.state === "now" && <span className="text-[7px] font-mono-lore px-1 py-0.5 rounded" style={{ backgroundColor: "var(--lore-amber)", color: "#0C0A08", fontWeight: 700 }}>NOW</span>}
              <AvailDots map={q.avail} />
            </div>
          ))}
        </div>

        {/* add to room + honesty */}
        <div className="px-4 pb-3 flex items-center gap-2 border-t pt-2" style={{ borderColor: "var(--lore-line)" }}>
          <button className="flex items-center gap-1 text-[10px] font-mono-lore px-2 py-1 rounded-full border shrink-0" style={{ borderColor: "var(--lore-line)", color: "var(--lore-amber)" }}><Plus className="w-3 h-3" /> Add</button>
          <p className="text-[9px] leading-snug flex-1" style={{ color: "var(--lore-faint)" }}>
            Queue holds <span style={{ color: "var(--lore-muted)" }}>canonical IDs</span>. Swap resumes at <span style={{ color: "var(--lore-muted)" }}>2:31</span> — ~1s re-buffer, not gapless.
          </p>
          <button className="flex items-center gap-1 text-[10px] font-mono-lore shrink-0" style={{ color: "var(--lore-amber)" }}>Expand <ChevronUp className="w-3 h-3" /></button>
        </div>
      </div>
    </div>
  );
}
