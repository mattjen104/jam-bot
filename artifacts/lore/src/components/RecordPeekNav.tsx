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

type Section = "radio" | "selectors" | "library";
const HOLD_MS = 520;

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

function artFor(section: Section, memory: SectionMemory): string | null {
  if (section === "radio") return memory.radio?.station.logoUrl ?? null;
  if (section === "selectors") return memory.selectors?.queue[memory.selectors.index]?.artworkUrl ?? null;
  return memory.library?.album.artworkUrl ?? memory.library?.track.artworkUrl ?? null;
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

  const resume = async (section: Section) => {
    setBusy(true);
    try {
      if (section === "radio" && radioMemory) {
        radio.resume(radioMemory.station);
        setPeek(null);
      } else if (section === "selectors") {
        if (selectorMemory) {
          ride.startReplay(selectorMemory.queue, selectorMemory.label, {
            timeOrientation: selectorMemory.orientation,
            startIndex: selectorMemory.index,
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
          const artwork = artFor(section, memory);
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
              onKeyDown={(event) => {
                if ((event.key === " " || event.key === "Enter") && event.repeat === false) {
                  event.preventDefault();
                  setPeek(section);
                }
              }}
            >
              <span className="record-peek-tab__label">{label}</span>
              <span className="record-peek-tab__sleeve" aria-hidden="true">
                {artwork ? <img src={artwork} alt="" /> : fallbackMark(section)}
                <span className="record-peek-tab__record" />
              </span>
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