import React, { useState } from "react";
import "./_group.css";
import {
  BookOpen, Check, Radio, Library, Archive, Headphones,
  X, Bookmark
} from "lucide-react";

// ─── Shared types & stub data ─────────────────────────────────────────────────

type ArtifactKind = "READ" | "WATCH" | "LISTEN" | "CREDITS";

interface Album {
  id: string;
  title: string;
  artist: string;
  year: number;
  hue: string;
  artifactCount: number;
  listCount: number;
  provenance: {
    canonSeason?: string;
    selectorSpins?: number;
    selectorName?: string;
    seanceCount?: number;
    librarySince?: number;
  };
  artifacts: Array<{
    kind: ArtifactKind;
    title: string;
    source: string;
    byline?: string;
    duration: string;
  }>;
}

const BELL_WITCH: Album = {
  id: "bell-witch-mirror",
  title: "Mirror Reaper",
  artist: "Bell Witch",
  year: 2017,
  hue: "#3b4f6f",
  artifactCount: 6,
  listCount: 3,
  provenance: {
    canonSeason: "S3 E4",
    selectorSpins: 18,
    selectorName: "WFMU",
    seanceCount: 3,
    librarySince: 2019,
  },
  artifacts: [
    { kind: "READ", title: "The Long Dying of Mirror Reaper", source: "The Wire", byline: "Joseph Stannard", duration: "8 min" },
    { kind: "WATCH", title: "Bell Witch live at Roadburn 2018", source: "YouTube", duration: "83 min" },
    { kind: "LISTEN", title: "Funeral doom episode", source: "Invisible Oranges pod", byline: "Rheanon Nicole", duration: "52 min" },
    { kind: "CREDITS", title: "Dylan Desmond · bass / Erik Moggridge · keys / Adrian Guerra · drums", source: "MusicBrainz", duration: "" },
  ],
};

const SLEEP: Album = {
  id: "sleep-dopesmoker",
  title: "Dopesmoker",
  artist: "Sleep",
  year: 2003,
  hue: "#5a3b2f",
  artifactCount: 4,
  listCount: 2,
  provenance: {
    selectorSpins: 11,
    selectorName: "Dublab",
    seanceCount: 1,
    librarySince: 2018,
  },
  artifacts: [
    { kind: "READ", title: "Sleep's Holy Mountain to Dopesmoker", source: "Pitchfork", byline: "Mark Richardson", duration: "6 min" },
    { kind: "WATCH", title: "Sleep — Jerusalem documentary", source: "YouTube", duration: "14 min" },
    { kind: "LISTEN", title: "Stoner doom deep cut episode", source: "Metal Injection pod", duration: "38 min" },
    { kind: "CREDITS", title: "Al Cisneros · bass / Matt Pike · guitar / Chris Hakius · drums", source: "MusicBrainz", duration: "" },
  ],
};

const ALICE: Album = {
  id: "alice-journey",
  title: "Journey in Satchidananda",
  artist: "Alice Coltrane",
  year: 1971,
  hue: "#4f3b6f",
  artifactCount: 3,
  listCount: 5,
  provenance: {
    canonSeason: "S1 E9",
    selectorSpins: 7,
    selectorName: "WNMC",
    librarySince: 2021,
  },
  artifacts: [
    { kind: "READ", title: "Alice Coltrane's spiritual harp explorations", source: "The Quietus", byline: "John Doran", duration: "5 min" },
    { kind: "LISTEN", title: "Alice Coltrane retrospective", source: "All Songs Considered", duration: "44 min" },
    { kind: "CREDITS", title: "Alice Coltrane · harp / piano / Charlie Haden · bass / Pharoah Sanders · saxophone", source: "MusicBrainz", duration: "" },
  ],
};

// ─── Reusable LoreChip ────────────────────────────────────────────────────────

function LoreChip({ album, onOpen }: { album: Album; onOpen: (a: Album) => void }) {
  return (
    <button
      className="lc-chip-btn lc-mono text-[10px]"
      style={{ color: "var(--lc-muted)" }}
      onClick={(e) => { e.stopPropagation(); onOpen(album); }}
      title={`${album.title} — ${album.artifactCount} artifacts · ${album.listCount} lists`}
    >
      <BookOpen size={9} style={{ color: "var(--lc-amber)" }} />
      <span style={{ color: "var(--lc-amber)", fontWeight: 700 }}>{album.artifactCount}</span>
      <span style={{ color: "var(--lc-faint)" }}>·</span>
      <span style={{ color: "var(--lc-muted)" }}>{album.listCount}</span>
    </button>
  );
}

// ─── ProvenancePill ───────────────────────────────────────────────────────────

function ProvenancePill({ children, color = "var(--lc-amber)" }: { children: React.ReactNode; color?: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] lc-mono"
      style={{ background: color + "18", border: `1px solid ${color}44`, color }}
    >
      {children}
    </span>
  );
}

function KindBadge({ kind }: { kind: ArtifactKind }) {
  const map: Record<ArtifactKind, string> = {
    READ: "var(--chip-read)",
    WATCH: "var(--chip-watch)",
    LISTEN: "var(--chip-listen)",
    CREDITS: "var(--chip-credits)",
  };
  return (
    <span
      className="lc-mono shrink-0 text-[8px] font-bold tracking-widest px-1.5 py-0.5 rounded"
      style={{ background: map[kind] + "22", color: map[kind], border: `1px solid ${map[kind]}44` }}
    >
      {kind}
    </span>
  );
}

// ─── Album Lore Panel ─────────────────────────────────────────────────────────

function AlbumLorePanel({ album, onClose }: { album: Album; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ background: "rgba(0,0,0,0.72)" }}
      onClick={onClose}
    >
      <div
        className="lc-panel-enter lc-scroll w-full max-w-[560px] rounded-t-2xl overflow-y-auto lc-sans"
        style={{
          background: "var(--lc-card)",
          border: "1px solid var(--lc-line)",
          borderBottom: "none",
          maxHeight: "78vh",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full" style={{ background: "var(--lc-line)" }} />
        </div>

        <div className="px-5 pt-3 pb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="w-8 h-8 rounded mb-2" style={{ background: album.hue }} />
            <h2 className="lc-serif text-[18px] font-semibold leading-tight" style={{ color: "var(--lc-text)" }}>
              {album.title}
            </h2>
            <p className="lc-mono text-[11px] mt-0.5" style={{ color: "var(--lc-muted)" }}>
              {album.artist} · {album.year}
            </p>
          </div>
          <button
            className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center"
            style={{ background: "var(--lc-elevated)", color: "var(--lc-faint)" }}
            onClick={onClose}
          >
            <X size={13} />
          </button>
        </div>

        <div className="px-5 pb-4">
          <p className="lc-mono text-[9px] tracking-[0.18em] uppercase mb-2" style={{ color: "var(--lc-faint)" }}>
            Provenance
          </p>
          <div className="flex flex-wrap gap-1.5">
            {album.provenance.canonSeason && (
              <ProvenancePill color="var(--lc-amber)">
                <Archive size={9} />Canon {album.provenance.canonSeason}
              </ProvenancePill>
            )}
            {album.provenance.selectorSpins !== undefined && (
              <ProvenancePill color="var(--lc-violet)">
                <Radio size={9} />
                {album.provenance.selectorName} × {album.provenance.selectorSpins} spins
              </ProvenancePill>
            )}
            {album.provenance.seanceCount !== undefined && (
              <ProvenancePill color="var(--lc-live)">
                <Headphones size={9} />séance × {album.provenance.seanceCount}
              </ProvenancePill>
            )}
            {album.provenance.librarySince !== undefined && (
              <ProvenancePill color="var(--lc-green)">
                <Library size={9} />In your library since {album.provenance.librarySince}
              </ProvenancePill>
            )}
          </div>
        </div>

        <div style={{ height: 1, background: "var(--lc-line)", marginBottom: 16 }} />

        <div className="px-5 pb-6">
          <p className="lc-mono text-[9px] tracking-[0.18em] uppercase mb-3" style={{ color: "var(--lc-faint)" }}>
            Go Deeper
          </p>
          <div className="flex flex-col gap-2">
            {album.artifacts.map((a, i) => (
              <div
                key={i}
                className="flex items-start gap-3 px-3 py-2.5 rounded-xl"
                style={{ background: "var(--lc-elevated)", border: "1px solid var(--lc-line)" }}
              >
                <KindBadge kind={a.kind} />
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-medium leading-snug" style={{ color: "var(--lc-text)" }}>
                    {a.title}
                  </p>
                  <p className="lc-mono text-[10px] mt-0.5" style={{ color: "var(--lc-muted)" }}>
                    {a.source}{a.byline ? ` · ${a.byline}` : ""}
                  </p>
                </div>
                {a.duration && (
                  <span className="lc-mono text-[10px] shrink-0" style={{ color: "var(--lc-faint)" }}>
                    {a.duration}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Chip Entry-Points Demo ───────────────────────────────────────────────────

export function ChipEntryPoints() {
  const [lorePanel, setLorePanel] = useState<Album | null>(null);

  return (
    <div
      className="min-h-screen w-full flex flex-col lc-sans lc-grain"
      style={{ background: "var(--lc-bg)", color: "var(--lc-text)" }}
    >
      {/* Header */}
      <div
        className="px-5 pt-6 pb-4 border-b"
        style={{ borderColor: "var(--lc-line)" }}
      >
        <p className="lc-mono text-[9px] tracking-[0.2em] uppercase mb-1" style={{ color: "var(--lc-faint)" }}>
          Design system · chip consistency check
        </p>
        <h1 className="lc-serif text-[22px] font-semibold" style={{ color: "var(--lc-text)" }}>
          LoreChip — three entry points
        </h1>
        <p className="text-[12px] mt-1" style={{ color: "var(--lc-muted)" }}>
          The same chip component renders identically in every surface. Tap any chip to open the album lore panel.
        </p>
      </div>

      <div className="flex-1 px-5 py-5 flex flex-col gap-5 max-w-[640px]">

        {/* ── Entry point 1: NOW PLAYING bar ───────────────── */}
        <section>
          <p className="lc-mono text-[9px] tracking-[0.18em] uppercase mb-2.5" style={{ color: "var(--lc-amber)" }}>
            Entry point 1 · Now playing bar
          </p>
          <div
            className="flex items-center gap-3 px-4 py-3 rounded-xl"
            style={{ background: "var(--lc-surface)", border: "1px solid var(--lc-line)" }}
          >
            {/* Artwork swatch */}
            <div className="w-10 h-10 rounded-lg shrink-0" style={{ background: BELL_WITCH.hue }} />

            {/* Track info */}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-end gap-[2px] h-3">
                  {[0,1,2,3].map(i => (
                    <span key={i} className="lc-eq-bar w-[2px] rounded-full"
                      style={{ height: 11, background: "var(--lc-live)", animationDelay: `${i*0.12}s` }} />
                  ))}
                </span>
                <span className="lc-serif text-[14px] font-semibold" style={{ color: "var(--lc-text)" }}>
                  Mirror Reaper
                </span>
                <span
                  className="inline-flex items-center gap-1 lc-mono text-[9px] px-1.5 py-0.5 rounded-full"
                  style={{ background: "var(--lc-green-dim)", color: "var(--lc-green)", border: "1px solid rgba(74,222,128,0.2)" }}
                >
                  <Check size={8} />
                  In your library
                </span>
              </div>
              <p className="lc-mono text-[10px] truncate mt-0.5" style={{ color: "var(--lc-muted)" }}>
                Bell Witch · WFMU
              </p>
            </div>

            {/* Chip + Keep */}
            <div className="flex items-center gap-2 shrink-0">
              <LoreChip album={BELL_WITCH} onOpen={setLorePanel} />
              <button className="lc-keep-btn lc-mono">
                <Bookmark size={9} />
                Keep
              </button>
            </div>
          </div>
        </section>

        {/* ── Entry point 2: IN A RUN DRAWER row ───────────── */}
        <section>
          <p className="lc-mono text-[9px] tracking-[0.18em] uppercase mb-2.5" style={{ color: "var(--lc-amber)" }}>
            Entry point 2 · In a run drawer row
          </p>
          <div
            className="rounded-xl overflow-hidden"
            style={{ background: "var(--lc-surface)", border: "1px solid var(--lc-line)" }}
          >
            {/* From library item */}
            <div
              className="flex items-center gap-3 px-4 py-2.5 border-b"
              style={{ borderColor: "var(--lc-line)", background: "var(--lc-green-dim)" }}
            >
              <Check size={13} style={{ color: "var(--lc-green)", flexShrink: 0 }} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-[12px] font-medium" style={{ color: "var(--lc-text)" }}>Mirror Reaper</span>
                  <span style={{ color: "var(--lc-faint)" }}>·</span>
                  <span className="text-[11px]" style={{ color: "var(--lc-muted)" }}>Bell Witch</span>
                </div>
                <p className="lc-mono text-[10px] mt-0.5" style={{ color: "var(--lc-faint)" }}>Now</p>
              </div>
              <LoreChip album={BELL_WITCH} onOpen={setLorePanel} />
            </div>

            {/* New-to-you item */}
            <div className="flex items-center gap-3 px-4 py-2.5 border-b" style={{ borderColor: "var(--lc-line)" }}>
              <div className="w-9 h-9 rounded shrink-0" style={{ background: SLEEP.hue }} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-[12px] font-medium" style={{ color: "var(--lc-text)" }}>Dopesmoker</span>
                  <span style={{ color: "var(--lc-faint)" }}>·</span>
                  <span className="text-[11px]" style={{ color: "var(--lc-muted)" }}>Sleep</span>
                </div>
                <p className="lc-mono text-[10px] mt-0.5" style={{ color: "var(--lc-faint)" }}>22 min ago</p>
              </div>
              <LoreChip album={SLEEP} onOpen={setLorePanel} />
              <button className="lc-keep-btn lc-mono">
                <Bookmark size={9} />
                Keep
              </button>
            </div>

            {/* Another new-to-you, kept state */}
            <div className="flex items-center gap-3 px-4 py-2.5" style={{ borderColor: "var(--lc-line)" }}>
              <div className="w-9 h-9 rounded shrink-0" style={{ background: ALICE.hue }} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-[12px] font-medium" style={{ color: "var(--lc-text)" }}>Journey in Satchidananda</span>
                </div>
                <p className="lc-mono text-[10px] mt-0.5" style={{ color: "var(--lc-faint)" }}>Alice Coltrane · 48 min ago</p>
              </div>
              <LoreChip album={ALICE} onOpen={setLorePanel} />
              <span className="lc-keep-btn kept lc-mono">
                <Check size={9} />
                kept → album queued
              </span>
            </div>
          </div>
        </section>

        {/* ── Entry point 3: IN YOUR LIBRARY ───────────────── */}
        <section>
          <p className="lc-mono text-[9px] tracking-[0.18em] uppercase mb-2.5" style={{ color: "var(--lc-amber)" }}>
            Entry point 3 · In your library
          </p>
          <div
            className="rounded-xl overflow-hidden"
            style={{ background: "var(--lc-surface)", border: "1px solid var(--lc-line)" }}
          >
            {[BELL_WITCH, SLEEP, ALICE].map((album, i) => (
              <div
                key={album.id}
                className="flex items-center gap-3 px-4 py-2.5"
                style={{
                  borderBottom: i < 2 ? `1px solid var(--lc-line)` : "none",
                }}
              >
                <div className="w-9 h-9 rounded shrink-0" style={{ background: album.hue }} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[12px] font-medium" style={{ color: "var(--lc-text)" }}>{album.title}</span>
                    <span style={{ color: "var(--lc-faint)" }}>·</span>
                    <span className="text-[11px]" style={{ color: "var(--lc-muted)" }}>{album.artist}</span>
                  </div>
                  <p className="lc-mono text-[10px] mt-0.5" style={{ color: "var(--lc-faint)" }}>
                    {album.year} · in library since {album.provenance.librarySince}
                  </p>
                </div>
                <LoreChip album={album} onOpen={setLorePanel} />
                {/* Library rows show "Hear in runs" reverse-flow CTA */}
                <button
                  className="lc-mono text-[10px] px-2.5 py-1 rounded-full shrink-0"
                  style={{
                    background: "var(--lc-violet-dim)",
                    border: "1px solid rgba(167,139,250,0.2)",
                    color: "var(--lc-violet)",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  Hear in runs
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* ── Chip anatomy callout ──────────────────────────── */}
        <section
          className="rounded-xl p-4"
          style={{ background: "var(--lc-elevated)", border: "1px solid var(--lc-line)" }}
        >
          <p className="lc-mono text-[9px] tracking-[0.18em] uppercase mb-3" style={{ color: "var(--lc-faint)" }}>
            Chip anatomy
          </p>
          <div className="flex items-center gap-5 flex-wrap">
            <div className="flex items-center gap-2">
              <LoreChip album={BELL_WITCH} onOpen={setLorePanel} />
              <span className="text-[11px]" style={{ color: "var(--lc-muted)" }}>
                active — has artifacts + lists
              </span>
            </div>
            <div className="flex items-center gap-2">
              {/* Minimal chip — 1 artifact, 0 lists */}
              <button
                className="lc-chip-btn lc-mono text-[10px]"
                style={{ color: "var(--lc-muted)", opacity: 0.5 }}
                onClick={() => {}}
              >
                <BookOpen size={9} style={{ color: "var(--lc-amber)" }} />
                <span style={{ color: "var(--lc-amber)", fontWeight: 700 }}>1</span>
                <span style={{ color: "var(--lc-faint)" }}>·</span>
                <span style={{ color: "var(--lc-muted)" }}>0</span>
              </button>
              <span className="text-[11px]" style={{ color: "var(--lc-muted)" }}>
                sparse — no list appearances yet
              </span>
            </div>
          </div>
          <p className="text-[11px] mt-3 leading-relaxed" style={{ color: "var(--lc-muted)" }}>
            <span style={{ color: "var(--lc-amber)", fontWeight: 600 }}>6</span>
            {" "}= artifact count (READ / WATCH / LISTEN / CREDITS){"  "}
            <span style={{ color: "var(--lc-muted)" }}>·</span>{"  "}
            <span style={{ color: "var(--lc-muted)" }}>3</span>
            {" "}= list appearances (canon + editorial). Same component, no per-surface variant.
          </p>
        </section>

      </div>

      {/* Album Lore Panel overlay */}
      {lorePanel && (
        <AlbumLorePanel album={lorePanel} onClose={() => setLorePanel(null)} />
      )}
    </div>
  );
}

export default ChipEntryPoints;
