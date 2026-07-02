import React from "react";
import "./_group.css";
import {
  Search, Play, Radio, History, Disc3, Plus, Repeat, Users, Hand,
  Share2, ListMusic, CornerDownRight, Headphones, Check, ChevronDown,
} from "lucide-react";

/* ---------------- services (bring your own) ---------------- */
type SvcKey = "spotify" | "apple" | "ytm";
const SVC: Record<SvcKey, { label: string; color: string }> = {
  spotify: { label: "Spotify", color: "var(--svc-spotify)" },
  apple: { label: "Apple Music", color: "var(--svc-apple)" },
  ytm: { label: "YT Music", color: "var(--svc-ytm)" },
};
type Avail = "exact" | "search" | "none";
function AvailDots({ map }: { map: Record<SvcKey, Avail> }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {(Object.keys(SVC) as SvcKey[]).map((k) => {
        const a = map[k];
        const c = SVC[k].color;
        return (
          <span
            key={k}
            title={`${SVC[k].label}: ${a}`}
            className="w-2 h-2 rounded-full"
            style={
              a === "exact"
                ? { backgroundColor: c }
                : a === "search"
                ? { border: `1.5px solid ${c}`, backgroundColor: "transparent" }
                : { backgroundColor: "var(--lore-line)" }
            }
          />
        );
      })}
    </span>
  );
}

/* ---------------- provenance (why a track is next) ---------------- */
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
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-mono-lore font-bold leading-none"
      style={{ color, border: `1px solid ${color}`, backgroundColor: "transparent" }}>
      <Icon className="w-2.5 h-2.5" /> {label}
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

/* ---------------- the real radio segue thread ---------------- */
type ThreadItem = {
  title: string; artist: string; isrc: string; mbid: string;
  prov: Prov; state: "played" | "now" | "next";
  segue: string; avail: Record<SvcKey, Avail>;
};
const THREAD: ThreadItem[] = [
  { title: "Dreams", artist: "Fleetwood Mac", isrc: "USWB10002551", mbid: "a1f4c8e2", prov: "historical", state: "played",
    segue: "Garvey opened the hour on the Rumours run", avail: { spotify: "exact", apple: "exact", ytm: "exact" } },
  { title: "Go Your Own Way", artist: "Fleetwood Mac", isrc: "USWB10002556", mbid: "3d9b7f10", prov: "live", state: "now",
    segue: "the song Mara shared into this room", avail: { spotify: "exact", apple: "exact", ytm: "exact" } },
  { title: "Silver Springs", artist: "Fleetwood Mac", isrc: "USEE10021456", mbid: "c62e0a5d", prov: "live", state: "next",
    segue: "Garvey's real next pick — the famous B-side", avail: { spotify: "exact", apple: "search", ytm: "none" } },
  { title: "Songbird", artist: "Fleetwood Mac", isrc: "USWB10002557", mbid: "7b18d4aa", prov: "album", state: "next",
    segue: "or take the album road — Rumours, track 6", avail: { spotify: "exact", apple: "exact", ytm: "exact" } },
  { title: "Cortez the Killer", artist: "Neil Young", isrc: "USRE19942312", mbid: "e50f2c93", prov: "historical", state: "next",
    segue: "where Peel took it, 1977 broadcast", avail: { spotify: "exact", apple: "exact", ytm: "search" } },
  { title: "Landslide", artist: "Fleetwood Mac", isrc: "USWB10259001", mbid: "9a3c61be", prov: "you", state: "next",
    segue: "you dropped this into the room", avail: { spotify: "exact", apple: "exact", ytm: "exact" } },
];

export function SharedRoomDesktop() {
  return (
    <div className="min-h-screen w-full flex flex-col font-sans-lore lore-grain" style={{ backgroundColor: "var(--lore-bg)", color: "var(--lore-text)" }}>
      {/* HEADER */}
      <header className="h-[60px] shrink-0 border-b flex items-center justify-between px-6 z-30" style={{ backgroundColor: "var(--lore-surface)", borderColor: "var(--lore-line)" }}>
        <div className="flex items-baseline gap-3">
          <span className="font-serif-lore text-[22px] tracking-tight">Lore</span>
          <span className="text-[10px] font-mono-lore inline-flex items-center gap-1.5" style={{ color: "var(--lore-faint)" }}>
            <Share2 className="w-3 h-3" /> shared room · opened from a link
          </span>
        </div>
        <div className="flex items-center gap-2 px-3 h-8 rounded-lg border w-[300px]" style={{ backgroundColor: "var(--lore-bg)", borderColor: "var(--lore-line)" }}>
          <Search className="w-3.5 h-3.5" style={{ color: "var(--lore-faint)" }} />
          <span className="text-[12px]" style={{ color: "var(--lore-faint)" }}>Add a track to the room…</span>
        </div>
        {/* bring-your-own-service switcher */}
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-mono-lore tracking-widest" style={{ color: "var(--lore-faint)" }}>YOUR OUTPUT</span>
          <div className="flex items-center gap-1 p-1 rounded-full border" style={{ backgroundColor: "var(--lore-bg)", borderColor: "var(--lore-line)" }}>
            {(Object.keys(SVC) as SvcKey[]).map((k) => {
              const active = k === "spotify";
              return (
                <button key={k} type="button" aria-pressed={active} aria-label={`Play through ${SVC[k].label}${active ? " (active output)" : ""}`}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium"
                  style={active ? { backgroundColor: SVC[k].color, color: "#0C0A08" } : { color: "var(--lore-muted)" }}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: active ? "#0C0A08" : SVC[k].color }} />
                  {SVC[k].label}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden">
        {/* ============ LEFT RAIL — THE ROOM ============ */}
        <aside className="w-[320px] shrink-0 border-r flex flex-col overflow-y-auto lore-scroll" style={{ backgroundColor: "var(--lore-bg)", borderColor: "var(--lore-line)" }}>
          <div className="p-4 border-b" style={{ borderColor: "var(--lore-line)" }}>
            <Kicker>The room</Kicker>
            {/* who shared it */}
            <div className="mt-3 flex items-center gap-2.5">
              <span className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0" style={{ backgroundColor: "var(--lore-elevated)", color: "var(--lore-amber)" }}>M</span>
              <p className="text-[12px] leading-tight" style={{ color: "var(--lore-muted)" }}>
                <span className="font-semibold" style={{ color: "var(--lore-text)" }}>Mara</span> shared a song and opened this room
              </p>
            </div>
            <div className="mt-2.5 rounded-lg border p-2.5 flex items-center gap-2.5" style={{ backgroundColor: "var(--lore-surface)", borderColor: "var(--lore-line)" }}>
              <div className="w-8 h-8 rounded flex items-center justify-center shrink-0" style={{ background: "conic-gradient(from 0deg, #1a1410, #3a2a1c, #1a1410)" }}>
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: "var(--lore-amber)" }} />
              </div>
              <div className="min-w-0">
                <p className="text-[12px] font-semibold truncate">Go Your Own Way</p>
                <p className="text-[10px]" style={{ color: "var(--lore-faint)" }}>Fleetwood Mac · the seed</p>
              </div>
            </div>
          </div>

          {/* following a DJ */}
          <div className="p-4 border-b" style={{ borderColor: "var(--lore-line)" }}>
            <Kicker color="var(--lore-live)">Following · live</Kicker>
            <div className="mt-3 rounded-xl border p-3 ride-sweep" style={{ backgroundColor: "var(--lore-surface)", borderColor: "rgba(255,90,60,0.4)" }}>
              <div className="flex items-center gap-2.5">
                <span className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: "var(--lore-elevated)" }}>
                  <Radio className="w-4 h-4" style={{ color: "var(--lore-live)" }} />
                </span>
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold leading-tight truncate">Guy Garvey’s Finest Hour</p>
                  <p className="text-[10px]" style={{ color: "var(--lore-muted)" }}>BBC 6 Music</p>
                </div>
                <span className="ml-auto flex items-center gap-1.5 text-[9px] font-mono-lore" style={{ color: "var(--lore-live)" }}>
                  <span className="w-2 h-2 rounded-full pulse-dot" style={{ backgroundColor: "var(--lore-live)" }} /> LIVE
                </span>
              </div>
              <p className="text-[11px] leading-relaxed mt-2.5" style={{ color: "var(--lore-muted)" }}>
                You’re <span style={{ color: "var(--lore-text)" }}>riding along</span> — the room auto-advances on Garvey’s real segues as he plays them on air.
              </p>
              <button className="mt-2.5 w-full flex items-center justify-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-full border" style={{ borderColor: "var(--lore-line)", color: "var(--lore-muted)" }}>
                <Hand className="w-3 h-3" /> Take the wheel (steer it yourself)
              </button>
            </div>
            {/* jump to a historical set */}
            <button className="mt-2.5 w-full flex items-center justify-between text-[11px] px-3 py-2 rounded-lg border" style={{ borderColor: "var(--lore-line)", color: "var(--lore-muted)", backgroundColor: "var(--lore-surface)" }}>
              <span className="flex items-center gap-1.5"><History className="w-3.5 h-3.5" style={{ color: "var(--prov-historical)" }} /> Follow a past set instead</span>
              <span className="text-[9px] font-mono-lore" style={{ color: "var(--lore-faint)" }}>Peel ’77 ▾</span>
            </button>

            <div className="mt-3 flex items-center gap-1.5 text-[10px] font-mono-lore" style={{ color: "var(--lore-faint)" }}>
              <Users className="w-3.5 h-3.5" /> 23 listening in this room
            </div>
          </div>

          {/* load their real next tracks */}
          <div className="p-4">
            <Kicker>Load their picks</Kicker>
            <p className="text-[11px] leading-relaxed mt-2" style={{ color: "var(--lore-muted)" }}>
              Instead of riding one segue at a time, pull the DJ’s <span style={{ color: "var(--lore-text)" }}>actual next tracks</span> into your queue now — what they really played, not an algorithm.
            </p>
            <button className="mt-2.5 w-full flex items-center justify-center gap-1.5 text-[12px] font-medium px-3 py-2 rounded-full" style={{ backgroundColor: "var(--lore-amber)", color: "#0C0A08" }}>
              <ListMusic className="w-3.5 h-3.5" /> Load Garvey’s next 6 segues
            </button>
            <p className="text-[9px] font-mono-lore mt-2 leading-relaxed" style={{ color: "var(--lore-faint)" }}>
              Every autoplay here is a human pick or the next album track — never a recommendation.
            </p>
          </div>
        </aside>

        {/* ============ CENTER — THE SEGUE THREAD (hero) ============ */}
        <section className="flex-1 overflow-y-auto lore-scroll px-8 py-6 flex flex-col">
          <div className="flex items-end justify-between">
            <div>
              <Kicker>The segue thread · real human radio sequence</Kicker>
              <h1 className="font-serif-lore text-[34px] leading-none mt-2">What Garvey played, back to back</h1>
              <p className="text-[13px] mt-1.5 max-w-[560px]" style={{ color: "var(--lore-muted)" }}>
                The queue rides a real DJ’s segues. Each step is tagged with why it’s next — a live segue, a past-broadcast segue, the next album track, or a track someone in the room added.
              </p>
            </div>
          </div>

          {/* provenance legend */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {(Object.keys(PROV) as Prov[]).map((p) => <ProvBadge key={p} p={p} />)}
          </div>

          {/* the thread */}
          <div className="relative pl-10 mt-6">
            <div className="absolute left-[15px] top-3 bottom-3 w-[2px] seg-spine" />
            <div className="flex flex-col gap-3">
              {THREAD.map((t, i) => {
                const prev = THREAD[i - 1];
                const isNow = t.state === "now";
                const played = t.state === "played";
                const c = PROV[t.prov].color;
                return (
                  <div key={t.isrc} className="relative">
                    {/* segue connector label from the previous track */}
                    {prev && (
                      <div className="flex items-center gap-1.5 mb-2 -ml-6 pl-6">
                        <CornerDownRight className="w-3 h-3" style={{ color: "var(--lore-faint)" }} />
                        <span className="text-[10px] font-mono-lore italic" style={{ color: "var(--lore-faint)" }}>{t.segue}</span>
                      </div>
                    )}
                    {/* node */}
                    <span className={`absolute -left-[30px] rounded-full flex items-center justify-center ${isNow ? "" : t.prov === "live" ? "seg-arrive" : ""}`}
                      style={isNow
                        ? { width: 18, height: 18, top: 16, backgroundColor: "var(--lore-amber)", boxShadow: "0 0 12px rgba(232,164,76,0.7)", border: "2px solid var(--lore-bg)" }
                        : { width: 12, height: 12, top: 18, backgroundColor: played ? "var(--lore-faint)" : c, border: "2px solid var(--lore-bg)" }}>
                      {played && <Check className="w-2 h-2" style={{ color: "#0C0A08" }} />}
                    </span>

                    <div className="rounded-xl border p-3.5 flex items-center gap-3"
                      style={isNow
                        ? { backgroundColor: "var(--lore-surface)", borderColor: "rgba(232,164,76,0.45)", boxShadow: "0 0 22px 2px rgba(232,164,76,0.18)" }
                        : { backgroundColor: "var(--lore-surface)", borderColor: "var(--lore-line)", opacity: played ? 0.6 : 1 }}>
                      <span className="w-5 text-center shrink-0">
                        {isNow ? <Eq /> : played ? <Check className="w-3.5 h-3.5" style={{ color: "var(--lore-faint)" }} /> : <span className="text-[11px] font-mono-lore" style={{ color: "var(--lore-faint)" }}>{i}</span>}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[15px] font-medium truncate">{t.title}</span>
                          {isNow && <span className="text-[8px] font-mono-lore px-1 py-0.5 rounded" style={{ backgroundColor: "var(--lore-amber)", color: "#0C0A08", fontWeight: 700 }}>NOW</span>}
                          <ProvBadge p={t.prov} />
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[12px]" style={{ color: "var(--lore-muted)" }}>{t.artist}</span>
                          <span className="text-[9px] font-mono-lore" style={{ color: "var(--lore-faint)" }}>MBID {t.mbid}… · ISRC {t.isrc}</span>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1.5 shrink-0">
                        <AvailDots map={t.avail} />
                        {t.avail.ytm === "none"
                          ? <span className="text-[8px] font-mono-lore" style={{ color: "var(--svc-ytm)" }}>1 gap on YTM</span>
                          : isNow
                          ? <button className="flex items-center gap-1 text-[10px] font-mono-lore px-2 py-0.5 rounded-full" style={{ backgroundColor: "var(--lore-elevated)", color: "var(--lore-amber)" }}><Play className="w-2.5 h-2.5" /> at 2:31</button>
                          : <button className="flex items-center gap-1 text-[9px] font-mono-lore px-2 py-0.5 rounded-full border" style={{ borderColor: "var(--lore-line)", color: "var(--lore-muted)" }}><CornerDownRight className="w-2.5 h-2.5" /> play next</button>}
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* live tail: more segues keep arriving */}
              <div className="relative">
                <span className="absolute -left-[28px] top-2 w-2.5 h-2.5 rounded-full seg-arrive" style={{ backgroundColor: "var(--lore-live)", border: "2px solid var(--lore-bg)" }} />
                <div className="rounded-xl border border-dashed p-3 flex items-center gap-2" style={{ borderColor: "rgba(255,90,60,0.4)", backgroundColor: "rgba(255,90,60,0.05)" }}>
                  <Radio className="w-3.5 h-3.5" style={{ color: "var(--lore-live)" }} />
                  <span className="text-[11px] font-mono-lore" style={{ color: "var(--lore-live)" }}>riding along — new segues append as Garvey keeps playing…</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ============ RIGHT RAIL — YOUR PLAYBACK + QUEUE ============ */}
        <aside className="w-[360px] shrink-0 border-l flex flex-col overflow-y-auto lore-scroll" style={{ backgroundColor: "var(--lore-bg)", borderColor: "var(--lore-line)" }}>
          {/* bring your service */}
          <div className="p-4 border-b" style={{ borderColor: "var(--lore-line)" }}>
            <Kicker>Bring your service</Kicker>
            <p className="text-[11px] mt-1.5 leading-relaxed" style={{ color: "var(--lore-faint)" }}>
              You stay in Lore. The room plays through <span style={{ color: "var(--lore-muted)" }}>your</span> account — connect one and it becomes your output.
            </p>
            <div className="mt-3 flex flex-col gap-2">
              {(Object.keys(SVC) as SvcKey[]).map((k) => {
                const connected = k === "spotify";
                return (
                  <div key={k} className="flex items-center gap-2.5 rounded-lg border p-2.5" style={{ backgroundColor: "var(--lore-surface)", borderColor: connected ? SVC[k].color : "var(--lore-line)" }}>
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: SVC[k].color }} />
                    <span className="text-[12px] font-medium flex-1">{SVC[k].label}</span>
                    {connected
                      ? <span className="flex items-center gap-1 text-[10px] font-mono-lore" style={{ color: SVC[k].color }}><Check className="w-3 h-3" /> connected · output</span>
                      : <button className="flex items-center gap-1 text-[10px] font-mono-lore px-2 py-1 rounded-full border" style={{ borderColor: "var(--lore-line)", color: "var(--lore-muted)" }}><Headphones className="w-3 h-3" /> Connect</button>}
                  </div>
                );
              })}
            </div>
            <div className="mt-3 rounded-lg border p-2.5" style={{ backgroundColor: "var(--lore-surface)", borderColor: "var(--lore-line)" }}>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-[11px] font-semibold"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: "var(--svc-spotify)" }} /> Playing via Spotify</span>
                <button className="flex items-center gap-1 text-[10px] font-mono-lore px-2 py-1 rounded-full border" style={{ borderColor: "rgba(232,164,76,0.4)", color: "var(--lore-amber)" }}><Repeat className="w-3 h-3" /> Swap</button>
              </div>
              <p className="text-[10px] leading-relaxed mt-2" style={{ color: "var(--lore-faint)" }}>
                Swap output mid-song — resumes at <span style={{ color: "var(--lore-muted)" }}>2:31</span>. Near-seamless (~1s re-buffer), <span style={{ color: "var(--lore-muted)" }}>not gapless</span>.
              </p>
            </div>
          </div>

          {/* the queue */}
          <div className="p-4 flex-1">
            <div className="flex items-center justify-between">
              <Kicker>Queue · service-agnostic</Kicker>
              <span className="text-[10px] font-mono-lore" style={{ color: "var(--lore-faint)" }}>{THREAD.filter((t) => t.state !== "played").length} up next</span>
            </div>
            <div className="mt-2 flex items-center gap-3 text-[9px] font-mono-lore" style={{ color: "var(--lore-faint)" }}>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: "var(--lore-muted)" }} /> exact</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ border: "1.5px solid var(--lore-muted)" }} /> search-match</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: "var(--lore-line)" }} /> unavailable</span>
            </div>

            <div className="mt-3 flex flex-col gap-1.5">
              {THREAD.filter((t) => t.state !== "played").map((q) => (
                <div key={q.isrc} className="rounded-lg border p-2.5 flex items-center gap-2.5"
                  style={q.state === "now" ? { backgroundColor: "rgba(232,164,76,0.1)", borderColor: "rgba(232,164,76,0.4)" } : { backgroundColor: "var(--lore-surface)", borderColor: "var(--lore-line)" }}>
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: PROV[q.prov].color }} title={PROV[q.prov].label} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[12px] font-medium truncate">{q.title}</span>
                      {q.state === "now" && <span className="text-[8px] font-mono-lore px-1 py-0.5 rounded" style={{ backgroundColor: "var(--lore-amber)", color: "#0C0A08", fontWeight: 700 }}>NOW</span>}
                    </div>
                    <span className="text-[9px] font-mono-lore truncate block" style={{ color: "var(--lore-faint)" }}>MBID {q.mbid}… · ISRC {q.isrc}</span>
                  </div>
                  <AvailDots map={q.avail} />
                </div>
              ))}
            </div>

            {/* add to the room queue */}
            <div className="mt-3 flex items-center gap-2 rounded-lg border p-2" style={{ backgroundColor: "var(--lore-surface)", borderColor: "var(--lore-line)" }}>
              <Plus className="w-3.5 h-3.5" style={{ color: "var(--lore-amber)" }} />
              <span className="text-[11px] flex-1" style={{ color: "var(--lore-faint)" }}>Add a track to the room…</span>
              <span className="text-[9px] font-mono-lore px-1.5 py-0.5 rounded" style={{ backgroundColor: "var(--lore-elevated)", color: "var(--lore-muted)" }}>you can steer</span>
            </div>

            <p className="text-[10px] leading-relaxed mt-3" style={{ color: "var(--lore-faint)" }}>
              The queue stores <span style={{ color: "var(--lore-muted)" }}>canonical identities (MBID / ISRC)</span>, not service links — so it survives switching output and connecting new services. The live stream itself isn’t queueable; each track it spins is.
            </p>
          </div>
        </aside>
      </main>

      {/* FOOTER — canonical now playing */}
      <footer className="h-[56px] shrink-0 border-t flex items-center gap-4 px-6 z-30" style={{ backgroundColor: "var(--lore-surface)", borderColor: "var(--lore-line)" }}>
        <div className="w-9 h-9 rounded-full border-2 border-black/40 flex items-center justify-center shrink-0" style={{ background: "conic-gradient(from 0deg, #1a1410, #3a2a1c, #1a1410)" }}>
          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: "var(--lore-amber)" }} />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium truncate">Go Your Own Way</span>
            <ProvBadge p="live" />
          </div>
          <span className="text-[11px]" style={{ color: "var(--lore-muted)" }}>Fleetwood Mac · in Garvey’s room</span>
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
          <span className="flex items-center gap-1 text-[10px] font-mono-lore" style={{ color: "var(--lore-faint)" }}><ChevronDown className="w-3 h-3" /></span>
        </div>
      </footer>
    </div>
  );
}
