import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import {
  getPickerRun,
  getRecordingAlbumTracks,
  useGetPickersDial,
  useGetRecordingKnowledge,
  getGetRecordingKnowledgeQueryKey,
  useGetStationNowPlaying,
  getGetStationNowPlayingQueryKey,
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
import { LinerNotesSheet } from "./LinerNotesSheet";

type Section = "radio" | "selectors" | "library";
const HOLD_MS = 480;

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

const RUMOURS_ART_STATIC = "https://coverartarchive.org/release-group/3e0b2fe7-c6d3-41a5-843a-73ffe5c6c57f/front-500";

function artFor(
  section: Section,
  memory: SectionMemory,
  liveNpArtworkUrl: string | null | undefined,
  liveRadioLogoUrl: string | null | undefined,
  liveRideArtworkUrl: string | null | undefined,
  fallbackSelectorArt: string | null,
  fallbackLibraryArt: string | null,
): string {
  if (section === "radio") {
    // Preference: live track art (most current) > last resolved track art > station logo
    return liveNpArtworkUrl
      ?? memory.radio?.lastTrack?.artworkUrl
      ?? memory.radio?.station.logoUrl
      ?? liveRadioLogoUrl
      ?? RUMOURS_ART_STATIC;
  }
  if (section === "selectors") {
    // First track of the set (ghost radio thumbnail), not the current resume index
    return memory.selectors?.queue[0]?.artworkUrl ?? liveRideArtworkUrl ?? fallbackSelectorArt ?? RUMOURS_ART_STATIC;
  }
  // Library: album art of last keep or last manual play
  return memory.library?.album.artworkUrl ?? memory.library?.track.artworkUrl ?? fallbackLibraryArt ?? RUMOURS_ART_STATIC;
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
  // Live now-playing artwork for the radio tab sleeve — shares the same cache
  // entry as PlayerDock so this is effectively free after the first fetch.
  const radioSlug = radio.station?.slug ?? "";
  const { data: liveNpData } = useGetStationNowPlaying(radioSlug, {
    query: {
      queryKey: getGetStationNowPlayingQueryKey(radioSlug),
      enabled: !!radio.station,
      staleTime: 15_000,
      refetchInterval: 30_000,
    },
  });
  const liveNpArtworkUrl =
    liveNpData?.nowPlaying?.recording?.artworkUrl ??
    liveNpData?.nowPlaying?.artworkUrl ??
    null;
  const [peek, setPeek] = useState<Section | null>(null);
  // Snapshotted track for the liner sheet — stored before peek is cleared so
  // the sheet still has identity to render against after peek becomes null.
  const [linerTrack, setLinerTrack] = useState<{
    mbid: string;
    title: string;
    artist: string;
    artworkUrl: string | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);
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
  }, []);

  const beginHold = useCallback((section: Section, x: number, y: number) => {
    stopHold();
    downPoint.current = { x, y };
    timer.current = setTimeout(() => {
      setPeek(section);
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

  // Rumours is the universal final fallback — every tab gets art even on a
  // fresh visit with no library, no selectors, and no live now-playing yet.
  const RUMOURS_ART = "https://coverartarchive.org/release-group/3e0b2fe7-c6d3-41a5-843a-73ffe5c6c57f/front-500";

  // Fallback artwork for Library: cascade through the three sources above.
  const fallbackLibraryArt =
    avatarData?.current?.artworkUrl ??
    avatarData?.candidates?.[0]?.artworkUrl ??
    (libData?.pages[0]?.items.find((item) => item.recording?.artworkUrl)?.recording?.artworkUrl ?? null) ??
    RUMOURS_ART;

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

  // Derive the current track identity for the active peek card.
  const peekTrackMbid: string = peek === "radio"
    ? (radioMemory?.lastTrack?.mbid ?? "")
    : peek === "selectors"
      ? (selectorMemory?.queue[selectorMemory.index]?.mbid ?? "")
      : peek === "library"
        ? (libraryMemory?.track.mbid ?? "")
        : "";

  const peekTrackTitle: string = peek === "radio"
    ? (radioMemory?.lastTrack?.title ?? "")
    : peek === "selectors"
      ? (selectorMemory?.queue[selectorMemory.index]?.title ?? "")
      : peek === "library"
        ? (libraryMemory?.track.title ?? "")
        : "";

  const peekTrackArtist: string = peek === "radio"
    ? (radioMemory?.lastTrack?.artist ?? "")
    : peek === "selectors"
      ? (selectorMemory?.queue[selectorMemory.index]?.artist ?? "")
      : peek === "library"
        ? (libraryMemory?.track.artist ?? "")
        : "";

  const peekTrackArt: string | null = peek === "radio"
    ? (liveNpArtworkUrl ?? radioMemory?.lastTrack?.artworkUrl ?? null)
    : peek === "selectors"
      ? (selectorMemory?.queue[selectorMemory.index]?.artworkUrl ?? null)
      : peek === "library"
        ? (libraryMemory?.track.artworkUrl ?? libraryMemory?.album.artworkUrl ?? null)
        : null;

  // Knowledge query — enabled only when peek track has a valid mbid.
  const { data: peekKnowledge, isLoading: knowledgeLoading } = useGetRecordingKnowledge(peekTrackMbid, {
    query: {
      queryKey: getGetRecordingKnowledgeQueryKey(peekTrackMbid),
      staleTime: 10 * 60_000,
      enabled: peekTrackMbid.length > 0,
    },
  });

  // Only expose knowledge after the query has settled — prevents a flicker from
  // "plain image" to "tappable button" while the first fetch is in flight.
  const hasKnowledge =
    !knowledgeLoading &&
    peekTrackMbid.length > 0 &&
    (
      (peekKnowledge?.knowledge?.personnel?.length ?? 0) > 0 ||
      Boolean(peekKnowledge?.knowledge?.pressing) ||
      (peekKnowledge?.knowledge?.relationships?.length ?? 0) > 0 ||
      (peekKnowledge?.claims?.length ?? 0) > 0
    );

  return (
    <>
      <nav className="record-peek-nav" aria-label="Primary">
        {(["radio", "selectors", "library"] as Section[]).map((section) => {
          const active = activeSection === section;
          const artwork = artFor(section, memory, liveNpArtworkUrl, radio.station?.logoUrl, ride.current?.artworkUrl, fallbackSelectorArt, fallbackLibraryArt);
          const label = section === "radio" ? "Radio" : section === "selectors" ? "Selectors" : "Library";
          return (
            <button
              key={section}
              type="button"
              className={`record-peek-tab${active ? " record-peek-tab--active" : ""}`}
              data-section={section}
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
              <span className="record-peek-tab__label" aria-hidden="true">{label}</span>
              <span className="record-peek-tab__sleeve" aria-hidden="true">
                {artwork ? <img src={artwork} alt="" draggable={false} /> : fallbackMark(section)}
              </span>
            </button>
          );
        })}
      </nav>
      {peek && hasMemory(peek) && !linerTrack && (
        <section className="record-peek" aria-live="polite" aria-label={`${peek} resume`}>
          {/* Album art thumbnail — tappable when track has knowledge */}
          {hasKnowledge ? (
            <button
              type="button"
              className="record-peek__art record-peek__art--tappable"
              aria-label="Open liner notes"
              onClick={() => {
                // Snapshot identity BEFORE clearing peek, so the sheet can
                // render even after peek becomes null.
                setLinerTrack({
                  mbid: peekTrackMbid,
                  title: peekTrackTitle,
                  artist: peekTrackArtist,
                  artworkUrl: peekTrackArt,
                });
                setPeek(null);
              }}
            >
              {peekTrackArt && <img src={peekTrackArt} alt="" draggable={false} />}
            </button>
          ) : peekTrackArt ? (
            <span className="record-peek__art">
              <img src={peekTrackArt} alt="" draggable={false} />
            </span>
          ) : null}
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
      {linerTrack && (
        <LinerNotesSheet
          mbid={linerTrack.mbid}
          title={linerTrack.title}
          artist={linerTrack.artist}
          artworkUrl={linerTrack.artworkUrl}
          radioArt={artFor("radio", memory, liveNpArtworkUrl, radio.station?.logoUrl, ride.current?.artworkUrl, fallbackSelectorArt, fallbackLibraryArt)}
          selectorArt={artFor("selectors", memory, liveNpArtworkUrl, radio.station?.logoUrl, ride.current?.artworkUrl, fallbackSelectorArt, fallbackLibraryArt)}
          libraryArt={artFor("library", memory, liveNpArtworkUrl, radio.station?.logoUrl, ride.current?.artworkUrl, fallbackSelectorArt, fallbackLibraryArt)}
          onResume={(section) => void resume(section)}
          onDismiss={() => setLinerTrack(null)}
          busy={busy}
        />
      )}
    </>
  );
}