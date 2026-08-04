import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import {
  getPickerRun,
  getRecordingAlbumTracks,
  useGetPickersDial,
} from "@workspace/api-client-react";
import type { RecordingLink } from "@workspace/api-client-react";
import { X } from "lucide-react";
import { usePlayer } from "../player/PlayerProvider";
import {
  useSectionMemory,
  type SectionMemory,
  type StoredRideSeed,
} from "../player/sectionMemory";
import { useMyAlbumAvatar, useMyLibraryInfinite } from "../lib/meHooks";

type Section = "radio" | "selectors" | "library";
const HOLD_MS = 480;

/**
 * Renders the section label as individual characters.
 * At rest they sit in a flat line at the label position;
 * when the parent has class `record-peek-tab--holding` the CSS transitions
 * each character to its arc position around the grown disc.
 * CSS sin/cos: Safari 15.4+, Chrome 111+, Firefox 108+.
 */
function ArcLabel({ label }: { label: string }) {
  const chars = label.toUpperCase().split("");
  // Degrees between characters — tighter for long words (SELECTORS)
  const spread = Math.min(18, 150 / Math.max(chars.length, 1));
  const total = (chars.length - 1) * spread;
  // Approximate centre-to-centre spacing for 10px monospace (charWidth ≈ 6px + 1.5px gap)
  const charStep = 7.5;
  return (
    <span className="record-peek-arc" aria-hidden="true">
      {chars.map((ch, i) => (
        <span
          key={i}
          className="record-peek-arc__ch"
          style={{
            "--a":      `${-total / 2 + i * spread}deg`,
            "--flat-x": `${(i - (chars.length - 1) / 2) * charStep}px`,
          } as React.CSSProperties}
        >
          {ch}
        </span>
      ))}
    </span>
  );
}

/** A realistic-looking vinyl disc rendered as an SVG. */
function VinylDisc() {
  return (
    <svg
      className="record-peek-tab__record"
      viewBox="0 0 40 40"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Outer vinyl body */}
      <circle cx="20" cy="20" r="19.5" fill="#120e18" />
      {/* Pressed groove rings */}
      <circle cx="20" cy="20" r="17.5" fill="none" stroke="#211828" strokeWidth="0.8" />
      <circle cx="20" cy="20" r="15.0" fill="none" stroke="#211828" strokeWidth="0.8" />
      <circle cx="20" cy="20" r="12.5" fill="none" stroke="#1e1625" strokeWidth="0.8" />
      <circle cx="20" cy="20" r="10.0" fill="none" stroke="#1e1625" strokeWidth="0.7" />
      {/* Subtle vinyl sheen — thin highlight arc top-left */}
      <path
        d="M 7.5 12 A 14 14 0 0 1 14 6.5"
        stroke="#ffffff" strokeWidth="0.7" fill="none"
        strokeLinecap="round" opacity="0.13"
      />
      {/* Centre label */}
      <circle cx="20" cy="20" r="7.5" fill="#2b1448" />
      <circle cx="20" cy="20" r="6.0" fill="#341858" />
      {/* Spindle hole */}
      <circle cx="20" cy="20" r="1.8" fill="#07040c" />
    </svg>
  );
}

function sectionFor(location: string): Section {
  if (location === "/selectors" || location.startsWith("/selectors/") ||
      location.startsWith("/archive/selectors") ||
      location.startsWith("/archive/selector-runs") ||
      location.startsWith("/archive/picker")) return "selectors";
  if (location === "/library" || location.startsWith("/library/") ||
      location === "/journal" || location.startsWith("/journal/") ||
      location === "/following" || location.startsWith("/following/")) return "library";
  return "radio";
}

function artFor(
  section: Section,
  memory: SectionMemory,
  liveRadioLogoUrl: string | null | undefined,
  liveRideArtworkUrl: string | null | undefined,
  fallbackSelectorArt: string | null,
  fallbackLibraryArt: string | null,
): string | null {
  if (section === "radio") {
    // Last resolved track art > station logo > live station logo
    return memory.radio?.lastTrack?.artworkUrl
      ?? memory.radio?.station.logoUrl
      ?? liveRadioLogoUrl
      ?? null;
  }
  if (section === "selectors") {
    // First track of the set (ghost radio thumbnail), not the current resume index
    return memory.selectors?.queue[0]?.artworkUrl ?? liveRideArtworkUrl ?? fallbackSelectorArt;
  }
  // Library: album art of last keep or last manual play
  return memory.library?.album.artworkUrl ?? memory.library?.track.artworkUrl ?? fallbackLibraryArt;
}

function fallbackMark(_section: Section) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 39 39"
      fill="none"
      aria-hidden="true"
      className="record-peek-tab__sleeve--empty"
      style={{ width: "100%", height: "100%", position: "absolute", inset: 0, opacity: 0.45 }}
    >
      {/* Empty sleeve outline with diagonal stripe on lower-right corner */}
      <rect x="1" y="1" width="37" height="37" rx="2" stroke="currentColor" strokeWidth="1.5" />
      {/* Diagonal stripe — bottom-right empty sleeve idiom */}
      <line x1="26" y1="39" x2="39" y2="26" stroke="currentColor" strokeWidth="1" opacity="0.5" />
      <line x1="31" y1="39" x2="39" y2="31" stroke="currentColor" strokeWidth="1" opacity="0.3" />
      {/* Faint disc peeking from top-right corner */}
      <circle cx="34" cy="5" r="6" stroke="currentColor" strokeWidth="1" opacity="0.35" />
      <circle cx="34" cy="5" r="2" stroke="currentColor" strokeWidth="0.75" opacity="0.25" />
    </svg>
  );
}

function selectorSeeds(
  tracks: Array<{ recording?: { mbid: string; title: string; artist: string; artworkUrl?: string | null; links?: RecordingLink[] } | null }>,
): StoredRideSeed[] {
  return tracks.filter((t) => t.recording).map((t) => ({
    mbid: t.recording!.mbid,
    title: t.recording!.title,
    artist: t.recording!.artist,
    artworkUrl: t.recording!.artworkUrl ?? null,
    links: t.recording!.links ?? [],
  }));
}

export function RecordPeekNav() {
  const [location, setLocation] = useLocation();
  const activeSection = sectionFor(location);
  const memory = useSectionMemory();
  const { radio, ride } = usePlayer();
  const { data: dial } = useGetPickersDial();
  // Library artwork cascade (most → least reliable):
  //   1. avatarData.current — user's explicitly chosen cover
  //   2. avatarData.candidates[0] — any MB-enriched library recording with art
  //   3. libData scan — Spotify soft items carry artworkUrl even without enrichment
  const { data: avatarData } = useMyAlbumAvatar();
  // Fetch 20 items so we have a good chance of hitting one with artworkUrl
  // even if the first few are hard rows that haven't been enriched yet.
  const { data: libData } = useMyLibraryInfinite({}, 20);
  const [peek, setPeek] = useState<Section | null>(null);
  const [busy, setBusy] = useState(false);
  const [holding, setHolding] = useState<Section | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const downPoint = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    setPeek(null);
    setBusy(false);
  }, [location]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const stopHold = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setHolding(null);
  }, []);

  const beginHold = useCallback((section: Section, x: number, y: number) => {
    stopHold();
    downPoint.current = { x, y };
    setHolding(section);
    timer.current = setTimeout(() => {
      setPeek(section);
      setHolding(null);
      timer.current = null;
    }, HOLD_MS);
  }, [stopHold]);

  const moveHold = useCallback((x: number, y: number) => {
    const start = downPoint.current;
    if (start && Math.hypot(x - start.x, y - start.y) > 12) stopHold();
  }, [stopHold]);

  const fallbackRun = dial?.items.find((item) =>
    item.run && item.run.resolvedCount > 0 && item.run.resolvedCount === item.run.trackCount,
  ) ?? dial?.items.find((item) => item.run && item.run.resolvedCount > 0);
  const selectorMemory = memory.selectors;
  const libraryMemory = memory.library;
  const radioMemory = memory.radio;

  // Fallback artwork for Selectors: previewTracks is in the API response but
  // absent from the generated PickerDialItemRun type — cast to access it.
  const fallbackSelectorArt = (
    (dial?.items[0] as unknown as { previewTracks?: Array<{ artworkUrl: string | null }> })
      ?.previewTracks?.find((t) => t.artworkUrl)?.artworkUrl
  ) ?? null;

  // Fallback artwork for Library: cascade through the three sources above.
  const fallbackLibraryArt =
    avatarData?.current?.artworkUrl ??
    avatarData?.candidates?.[0]?.artworkUrl ??
    (libData?.pages[0]?.items.find((item) => item.recording?.artworkUrl)?.recording?.artworkUrl ?? null);

  const resume = async (section: Section) => {
    setBusy(true);
    try {
      if (section === "radio" && radioMemory) {
        radio.resume(radioMemory.station);
        setPeek(null);
      } else if (section === "selectors") {
        if (selectorMemory) {
          // Ghost run: always start from track 1 of the set, not the resume index.
          ride.startReplay(selectorMemory.queue, selectorMemory.label, {
            timeOrientation: selectorMemory.orientation,
            startIndex: 0,
          });
          setPeek(null);
        } else if (fallbackRun?.run) {
          const data = await getPickerRun(fallbackRun.run.runId);
          const seeds = selectorSeeds(data.tracks);
          if (seeds.length) {
            ride.startReplay(seeds, `${data.picker.name}${data.run.title ? ` — ${data.run.title}` : ""}`, {
              timeOrientation: "curated",
            });
            setPeek(null);
          }
        }
      } else if (section === "library" && libraryMemory) {
        try {
          const data = await getRecordingAlbumTracks(libraryMemory.albumLookupMbid);
          const seeds: StoredRideSeed[] = data.tracks.map((track) => ({
            mbid: track.mbid,
            title: track.title,
            artist: track.artist,
            artworkUrl: libraryMemory.album.artworkUrl,
            links: [],
          }));
          if (seeds.length) {
            ride.startReplay(seeds, data.rgTitle ?? libraryMemory.album.title, {
              timeOrientation: "curated",
              context: "library",
              startIndex: 0,
            });
            setPeek(null);
          } else {
            ride.startReplay([libraryMemory.track], libraryMemory.track.title, {
              timeOrientation: "curated",
              context: "library",
            });
            setPeek(null);
          }
        } catch {
          ride.startReplay([libraryMemory.track], libraryMemory.track.title, {
            timeOrientation: "curated",
            context: "library",
          });
          setPeek(null);
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const hasMemory = (section: Section) =>
    section === "radio" ? !!radioMemory : section === "selectors" ? !!selectorMemory || !!fallbackRun : !!libraryMemory;

  return (
    <>
      <nav className="record-peek-nav" aria-label="Primary">
        {(["radio", "selectors", "library"] as Section[]).map((section) => {
          const active = activeSection === section;
          const artwork = artFor(section, memory, radio.station?.logoUrl, ride.current?.artworkUrl, fallbackSelectorArt, fallbackLibraryArt);
          const label = section === "radio" ? "Radio" : section === "selectors" ? "Selectors" : "Library";
          return (
            <button
              key={section}
              type="button"
              className={`record-peek-tab${active ? " record-peek-tab--active" : ""}${holding === section ? " record-peek-tab--holding" : ""}`}
              aria-current={active ? "page" : undefined}
              aria-label={label}
              onClick={() => setLocation(section === "radio" ? "/" : `/${section}`)}
              onPointerDown={(event) => {
                if (event.pointerType !== "mouse" || event.button === 0) {
                  beginHold(section, event.clientX, event.clientY);
                }
              }}
              onPointerMove={(event) => moveHold(event.clientX, event.clientY)}
              onPointerUp={stopHold}
              onPointerCancel={stopHold}
              onContextMenu={(e) => e.preventDefault()}
              onKeyDown={(event) => {
                if ((event.key === " " || event.key === "Enter") && event.repeat === false) {
                  event.preventDefault();
                  setPeek(section);
                }
              }}
            >
              {/* ArcLabel renders the section name — flat at rest, arced on hold */}
              <ArcLabel label={label} />
              <span className="record-peek-tab__sleeve" aria-hidden="true">
                {artwork ? <img src={artwork} alt="" draggable={false} /> : fallbackMark(section)}
                {/* VinylDisc lives inside the sleeve; it grows into the art on hold */}
                <VinylDisc />
              </span>
              {/* Disc lives outside the sleeve so it can animate past the sleeve's clip */}
              <span className="record-peek-tab__record" aria-hidden="true" />
              <ArcLabel label={label} />
            </button>
          );
        })}
      </nav>
      {peek && hasMemory(peek) && (
        <section className="record-peek" aria-live="polite" aria-label={`${peek} resume`}>
          <div className="record-peek__copy">
            <strong>
              {peek === "radio" ? radioMemory?.station.name :
                peek === "selectors" ? selectorMemory?.label ?? fallbackRun?.picker.name :
                libraryMemory?.album.title}
            </strong>
            <span>
              {peek === "radio" ? "Last station · live edge" :
                peek === "selectors" ? selectorMemory ? "Ghost Radio · resume run" : "Recommended selector · ready to play" :
                "Last Library listen · open album"}
            </span>
          </div>
          <button type="button" className="record-peek__action" onClick={() => void resume(peek)} disabled={busy}>
            {busy ? "Loading…" : peek === "radio" ? "Resume live" : peek === "selectors" ? "Resume Ghost Radio" : "Open album"}
          </button>
          <button type="button" className="record-peek__close" onClick={() => setPeek(null)} aria-label="Dismiss resume peek">
            <X aria-hidden="true" />
          </button>
        </section>
      )}
    </>
  );
}