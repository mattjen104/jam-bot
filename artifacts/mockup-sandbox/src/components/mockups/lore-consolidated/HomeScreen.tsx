import React, { useState } from "react";
import "./_group.css";
import {
  Play, Pause, X, ChevronDown, ChevronUp, BookOpen, Headphones,
  Check, Archive, Radio, Library, Star, Bookmark
} from "lucide-react";

// ─── Stub data ────────────────────────────────────────────────────────────────

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

interface RunItem {
  id: string;
  album: Album;
  track: string;
  spunAt: string;
  inLibrary: boolean;
  kept?: boolean;
}

interface Station {
  id: string;
  name: string;
  selector: string;
  callsign: string;
  nowTrack: string;
  nowAlbum: string;
  nowArtist: string;
  matchCount: number;
  isActive: boolean;
  run: RunItem[];
  adjacency: {
    overlapPct: number;
    deepCuts: Array<{ album: Album; spins: number; viaStation: string }>;
  };
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

const EARTH: Album = {
  id: "earth-pentastar",
  title: "Pentastar: In the Style of Demons",
  artist: "Earth",
  year: 1996,
  hue: "#3f5a3b",
  artifactCount: 5,
  listCount: 2,
  provenance: {
    selectorSpins: 9,
    selectorName: "KEXP",
    seanceCount: 2,
    librarySince: 2020,
  },
  artifacts: [
    { kind: "READ", title: "Earth and the invention of drone metal", source: "Resident Advisor", duration: "7 min" },
    { kind: "WATCH", title: "Earth — live in Seattle 2005", source: "YouTube", duration: "47 min" },
    { kind: "CREDITS", title: "Dylan Carlson · guitar / Dave Harwell · bass", source: "MusicBrainz", duration: "" },
  ],
};

const RAGANA: Album = {
  id: "ragana-know",
  title: "We Know of a Place…",
  artist: "Ragana",
  year: 2021,
  hue: "#5f3b5a",
  artifactCount: 2,
  listCount: 1,
  provenance: { selectorSpins: 4, selectorName: "WFMU" },
  artifacts: [
    { kind: "READ", title: "Ragana's radical black metal feminism", source: "Bandcamp Daily", byline: "Kim Kelly", duration: "5 min" },
    { kind: "CREDITS", title: "Maria/cha · guitar / vocals / Evelyn Née · drums", source: "MusicBrainz", duration: "" },
  ],
};

const KALI: Album = {
  id: "kali-sacrificial",
  title: "The Sacrificial Code",
  artist: "Kali Malone",
  year: 2019,
  hue: "#2f4f5a",
  artifactCount: 1,
  listCount: 4,
  provenance: { selectorSpins: 6, selectorName: "Dublab", canonSeason: "S2 E11" },
  artifacts: [
    { kind: "READ", title: "Kali Malone's pipe organ minimalism", source: "Wire", duration: "4 min" },
  ],
};

const STATIONS: Station[] = [
  {
    id: "wfmu",
    name: "WFMU",
    selector: "Liz Berg",
    callsign: "91.1 NJ/NY",
    nowTrack: "Yell: Deaf Forever",
    nowAlbum: "Mirror Reaper",
    nowArtist: "Bell Witch",
    matchCount: 14,
    isActive: true,
    run: [
      { id: "r1", album: BELL_WITCH, track: "Mirror Reaper", spunAt: "Now", inLibrary: true },
      { id: "r2", album: SLEEP, track: "Dopesmoker", spunAt: "22 min ago", inLibrary: true },
      { id: "r3", album: RAGANA, track: "Beams Break", spunAt: "48 min ago", inLibrary: false },
      { id: "r4", album: KALI, track: "I Will Show You the Governor", spunAt: "1:04 ago", inLibrary: false, kept: true },
    ],
    adjacency: {
      overlapPct: 87,
      deepCuts: [
        { album: EARTH, spins: 8, viaStation: "WFMU" },
        { album: RAGANA, spins: 4, viaStation: "WFMU" },
        { album: KALI, spins: 6, viaStation: "WFMU" },
      ],
    },
  },
  {
    id: "dublab",
    name: "Dublab",
    selector: "Morgan Greenstreet",
    callsign: "Los Angeles",
    nowTrack: "Drowned in Sound",
    nowAlbum: "Dopesmoker",
    nowArtist: "Sleep",
    matchCount: 9,
    isActive: false,
    run: [],
    adjacency: { overlapPct: 71, deepCuts: [] },
  },
  {
    id: "wnmc",
    name: "WNMC",
    selector: "Elise Thorn",
    callsign: "90.7 Traverse City",
    nowTrack: "Shiva-Loka",
    nowAlbum: "Journey in Satchidananda",
    nowArtist: "Alice Coltrane",
    matchCount: 7,
    isActive: false,
    run: [],
    adjacency: { overlapPct: 58, deepCuts: [] },
  },
  {
    id: "kexp",
    name: "KEXP",
    selector: "Kevin Cole",
    callsign: "90.3 Seattle",
    nowTrack: "Racked and Stacked",
    nowAlbum: "Pentastar",
    nowArtist: "Earth",
    matchCount: 5,
    isActive: false,
    run: [],
    adjacency: { overlapPct: 41, deepCuts: [] },
  },
];

const NOW_PLAYING_ALBUM = BELL_WITCH;

// ─── Sub-components ───────────────────────────────────────────────────────────

function Eq() {
  return (
    <span className="inline-flex items-end gap-[2px] h-3">
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className="lc-eq-bar w-[2px] rounded-full"
          style={{ height: "11px", backgroundColor: "var(--lc-live)", animationDelay: `${i * 0.12}s` }}
        />
      ))}
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

// ─── LoreChip ─────────────────────────────────────────────────────────────────

interface LoreChipProps {
  album: Album;
  onOpen: (album: Album) => void;
}

function LoreChip({ album, onOpen }: LoreChipProps) {
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

// ─── Album Lore Panel ─────────────────────────────────────────────────────────

function AlbumLorePanel({ album, onClose }: { album: Album; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ background: "rgba(0,0,0,0.72)" }}
      onClick={onClose}
    >
      <div
        className="lc-panel-enter lc-scroll w-full max-w-[600px] rounded-t-2xl overflow-y-auto lc-sans"
        style={{
          background: "var(--lc-card)",
          border: "1px solid var(--lc-line)",
          borderBottom: "none",
          maxHeight: "80vh",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full" style={{ background: "var(--lc-line)" }} />
        </div>

        {/* Header */}
        <div className="px-5 pt-3 pb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div
              className="w-8 h-8 rounded mb-2"
              style={{ background: album.hue, opacity: 0.9 }}
            />
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

        {/* Provenance */}
        <div className="px-5 pb-4">
          <p className="lc-mono text-[9px] tracking-[0.18em] uppercase mb-2" style={{ color: "var(--lc-faint)" }}>
            Provenance
          </p>
          <div className="flex flex-wrap gap-1.5">
            {album.provenance.canonSeason && (
              <ProvenancePill color="var(--lc-amber)">
                <Archive size={9} />
                Canon {album.provenance.canonSeason}
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
                <Headphones size={9} />
                séance × {album.provenance.seanceCount}
              </ProvenancePill>
            )}
            {album.provenance.librarySince !== undefined && (
              <ProvenancePill color="var(--lc-green)">
                <Library size={9} />
                In your library since {album.provenance.librarySince}
              </ProvenancePill>
            )}
          </div>
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: "var(--lc-line)", marginBottom: 16 }} />

        {/* Go Deeper */}
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

// ─── Run Drawer ───────────────────────────────────────────────────────────────

function RunDrawer({
  station,
  onOpenLorePanel,
}: {
  station: Station;
  onOpenLorePanel: (album: Album) => void;
}) {
  const [keptIds, setKeptIds] = useState<Set<string>>(
    new Set(station.run.filter((r) => r.kept).map((r) => r.id))
  );

  const library = station.run.filter((r) => r.inLibrary);
  const newToYou = station.run.filter((r) => !r.inLibrary);

  function toggleKeep(id: string) {
    setKeptIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <div
      className="lc-drawer-enter lc-sans border-t"
      style={{ background: "var(--lc-surface)", borderColor: "var(--lc-line)" }}
    >
      {/* ── FROM YOUR LIBRARY ─────────────────────────── */}
      {library.length > 0 && (
        <div className="px-5 pt-4 pb-2">
          <p className="lc-mono text-[9px] tracking-[0.18em] uppercase mb-2 flex items-center gap-1.5" style={{ color: "var(--lc-green)" }}>
            <Check size={9} />
            From your library
          </p>
          <div className="flex flex-col gap-1">
            {library.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-3 px-3 py-2 rounded-lg"
                style={{ background: "var(--lc-green-dim)", border: "1px solid rgba(74,222,128,0.14)" }}
              >
                <Check size={13} style={{ color: "var(--lc-green)", flexShrink: 0 }} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-[12px] font-medium truncate" style={{ color: "var(--lc-text)" }}>
                      {item.album.title}
                    </span>
                    <span style={{ color: "var(--lc-faint)" }} className="text-[11px]">·</span>
                    <span className="text-[11px] truncate" style={{ color: "var(--lc-muted)" }}>
                      {item.album.artist}
                    </span>
                  </div>
                  <p className="lc-mono text-[10px] mt-0.5" style={{ color: "var(--lc-faint)" }}>
                    {item.spunAt === "Now" ? (
                      <span className="flex items-center gap-1"><span className="lc-live-dot" /> Now</span>
                    ) : item.spunAt}
                  </p>
                </div>
                <LoreChip album={item.album} onOpen={onOpenLorePanel} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── NEW TO YOU ─────────────────────────────────── */}
      {newToYou.length > 0 && (
        <div className="px-5 pt-3 pb-3">
          <p className="lc-mono text-[9px] tracking-[0.18em] uppercase mb-2" style={{ color: "var(--lc-amber)" }}>
            New to you
          </p>
          <div className="flex flex-col gap-1.5">
            {newToYou.map((item) => {
              const isKept = keptIds.has(item.id);
              return (
                <div
                  key={item.id}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg"
                  style={{ background: "var(--lc-elevated)", border: "1px solid var(--lc-line)" }}
                >
                  {/* Color swatch stands in for artwork */}
                  <div
                    className="w-9 h-9 rounded shrink-0"
                    style={{ background: item.album.hue }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-[12px] font-medium truncate" style={{ color: "var(--lc-text)" }}>
                        {item.album.title}
                      </span>
                      <span style={{ color: "var(--lc-faint)" }} className="text-[11px]">·</span>
                      <span className="text-[11px] truncate" style={{ color: "var(--lc-muted)" }}>
                        {item.album.artist}
                      </span>
                    </div>
                    <p className="lc-mono text-[10px] mt-0.5" style={{ color: "var(--lc-faint)" }}>
                      {item.spunAt}
                    </p>
                  </div>
                  <LoreChip album={item.album} onOpen={onOpenLorePanel} />
                  {isKept ? (
                    <span className="lc-keep-btn kept lc-mono" style={{ fontSize: 10 }}>
                      <Check size={9} />
                      kept → album queued
                    </span>
                  ) : (
                    <button className="lc-keep-btn lc-mono" onClick={() => toggleKeep(item.id)}>
                      <Bookmark size={9} />
                      Keep
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── SELECTOR ADJACENCY ─────────────────────────── */}
      <div
        className="mx-5 mb-4 mt-1 rounded-xl p-3"
        style={{ background: "var(--lc-elevated)", border: "1px solid var(--lc-line)" }}
      >
        <div className="flex items-center justify-between mb-2">
          <p className="lc-mono text-[9px] tracking-[0.18em] uppercase" style={{ color: "var(--lc-faint)" }}>
            Selector adjacency
          </p>
          <span className="lc-mono text-[10px]" style={{ color: "var(--lc-violet)" }}>
            {station.adjacency.overlapPct}% overlap with {station.name}
          </span>
        </div>
        <p className="text-[11px] mb-2" style={{ color: "var(--lc-muted)" }}>
          3 deep cuts this selector spins that aren't in your library yet:
        </p>
        <div className="flex flex-col gap-1.5">
          {station.adjacency.deepCuts.map((dc, i) => (
            <div key={i} className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded shrink-0" style={{ background: dc.album.hue }} />
              <div className="min-w-0 flex-1">
                <span className="text-[11px] font-medium" style={{ color: "var(--lc-text)" }}>
                  {dc.album.title}
                </span>
                <span className="text-[11px]" style={{ color: "var(--lc-faint)" }}> · {dc.album.artist}</span>
              </div>
              <LoreChip album={dc.album} onOpen={onOpenLorePanel} />
              <span className="lc-mono text-[9px] shrink-0" style={{ color: "var(--lc-faint)" }}>
                via {dc.viaStation}, {dc.spins} spins
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Station Row ──────────────────────────────────────────────────────────────

function StationRow({
  station,
  expanded,
  isPlaying,
  onToggleExpand,
  onTogglePlay,
  onOpenLorePanel,
}: {
  station: Station;
  expanded: boolean;
  isPlaying: boolean;
  onToggleExpand: () => void;
  onTogglePlay: (e: React.MouseEvent) => void;
  onOpenLorePanel: (album: Album) => void;
}) {
  return (
    <li style={{ borderBottom: "1px solid var(--lc-line)" }}>
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer"
        style={{
          background: expanded ? "var(--lc-elevated)" : isPlaying ? "var(--lc-amber-dim)" : "transparent",
          transition: "background 0.15s",
        }}
        onClick={onToggleExpand}
      >
        {/* Play button */}
        <button
          className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-colors"
          style={{
            background: isPlaying ? "var(--lc-amber)" : "var(--lc-elevated)",
            border: `1px solid ${isPlaying ? "var(--lc-amber)" : "var(--lc-line)"}`,
            color: isPlaying ? "var(--lc-bg)" : "var(--lc-muted)",
          }}
          onClick={onTogglePlay}
          aria-label={isPlaying ? `Pause ${station.name}` : `Play ${station.name}`}
        >
          {isPlaying
            ? <Eq />
            : <Play size={13} style={{ marginLeft: 1 }} />}
        </button>

        {/* Station info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="lc-serif text-[14px] font-semibold truncate" style={{ color: "var(--lc-text)" }}>
              {station.name}
            </span>
            <span className="lc-mono text-[10px] shrink-0" style={{ color: "var(--lc-faint)" }}>
              {station.callsign}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="lc-mono text-[10px]" style={{ color: "var(--lc-muted)" }}>
              {station.selector}
            </span>
            <span style={{ color: "var(--lc-line)" }}>·</span>
            <span className="lc-mono text-[10px] truncate" style={{ color: "var(--lc-faint)" }}>
              {isPlaying ? "" : "Earlier: "}{station.nowAlbum}
            </span>
          </div>
        </div>

        {/* Match badge */}
        <div className="shrink-0 flex items-center gap-2">
          <span
            className="lc-mono text-[10px] font-bold px-2 py-0.5 rounded-full"
            style={{ background: "var(--lc-match-dim)", color: "var(--lc-match)", border: "1px solid rgba(96,165,250,0.2)" }}
            title={`${station.matchCount} albums match your library`}
          >
            {station.matchCount} match
          </span>
          <ChevronDown
            size={14}
            style={{
              color: "var(--lc-faint)",
              transform: expanded ? "rotate(180deg)" : "none",
              transition: "transform 0.18s",
            }}
          />
        </div>
      </div>

      {expanded && (
        <RunDrawer station={station} onOpenLorePanel={onOpenLorePanel} />
      )}
    </li>
  );
}

// ─── Main HomeScreen export ───────────────────────────────────────────────────

export function HomeScreen() {
  const [expandedId, setExpandedId] = useState<string | null>("wfmu");
  const [playingId, setPlayingId] = useState<string | null>("wfmu");
  const [lorePanel, setLorePanel] = useState<Album | null>(null);

  function handleToggleExpand(id: string) {
    setExpandedId((prev) => (prev === id ? null : id));
  }

  function handleTogglePlay(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    setPlayingId((prev) => (prev === id ? null : id));
  }

  const nowStation = STATIONS.find((s) => s.id === playingId) ?? STATIONS[0];

  return (
    <div
      className="min-h-screen w-full flex flex-col lc-sans lc-grain"
      style={{ background: "var(--lc-bg)", color: "var(--lc-text)" }}
    >
      {/* ── STICKY NOW-PLAYING BAR ───────────────────────── */}
      <header
        className="sticky top-0 z-30 border-b px-4 py-2.5"
        style={{ background: "var(--lc-surface)", borderColor: "var(--lc-line)" }}
      >
        <div className="flex items-center gap-3">
          {/* Artwork swatch */}
          <div
            className="w-10 h-10 rounded-lg shrink-0"
            style={{ background: NOW_PLAYING_ALBUM.hue }}
          />

          {/* Track info */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              <Eq />
              <span className="lc-serif text-[15px] font-semibold truncate" style={{ color: "var(--lc-text)" }}>
                Mirror Reaper
              </span>
              <span
                className="hidden sm:inline-flex items-center gap-1 lc-mono text-[9px] px-1.5 py-0.5 rounded-full shrink-0"
                style={{ background: "var(--lc-green-dim)", color: "var(--lc-green)", border: "1px solid rgba(74,222,128,0.2)" }}
              >
                <Check size={8} />
                In your library
              </span>
            </div>
            <p className="lc-mono text-[10px] truncate" style={{ color: "var(--lc-muted)" }}>
              Bell Witch · {nowStation.name}
            </p>
          </div>

          {/* LoreChip + Keep */}
          <div className="flex items-center gap-2 shrink-0">
            <LoreChip album={NOW_PLAYING_ALBUM} onOpen={setLorePanel} />
            <button
              className="lc-keep-btn lc-mono hidden sm:inline-flex"
              onClick={() => {}}
            >
              <Bookmark size={9} />
              Keep
            </button>
          </div>
        </div>
      </header>

      {/* ── IMPORT PROGRESS BANNER ──────────────────────── */}
      <div
        className="px-4 py-2.5 border-b flex items-center gap-3"
        style={{ background: "var(--lc-elevated)", borderColor: "var(--lc-line)" }}
      >
        <div className="min-w-0 flex-1">
          <p className="lc-mono text-[10px]" style={{ color: "var(--lc-muted)" }}>
            Importing your Spotify library — <span style={{ color: "var(--lc-amber)" }}>847 / 2,400</span> albums matched
          </p>
          <div className="mt-1.5 h-1 rounded-full overflow-hidden" style={{ background: "var(--lc-line)" }}>
            <div className="h-full rounded-full" style={{ width: "35%", background: "var(--lc-amber)" }} />
          </div>
        </div>
        <span className="lc-mono text-[10px] shrink-0" style={{ color: "var(--lc-faint)" }}>35%</span>
      </div>

      {/* ── SECTION HEADER ──────────────────────────────── */}
      <div
        className="px-4 pt-4 pb-2 flex items-baseline justify-between"
      >
        <h2 className="lc-serif text-[17px] font-semibold" style={{ color: "var(--lc-text)" }}>
          On the air
        </h2>
        <span className="lc-mono text-[10px]" style={{ color: "var(--lc-faint)" }}>
          sorted by your overlap
        </span>
      </div>

      {/* ── STATION LIST ────────────────────────────────── */}
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {STATIONS.map((station) => (
          <StationRow
            key={station.id}
            station={station}
            expanded={expandedId === station.id}
            isPlaying={playingId === station.id}
            onToggleExpand={() => handleToggleExpand(station.id)}
            onTogglePlay={(e) => handleTogglePlay(station.id, e)}
            onOpenLorePanel={setLorePanel}
          />
        ))}
      </ul>

      {/* ── ALBUM LORE PANEL OVERLAY ─────────────────────── */}
      {lorePanel && (
        <AlbumLorePanel album={lorePanel} onClose={() => setLorePanel(null)} />
      )}
    </div>
  );
}

export default HomeScreen;
