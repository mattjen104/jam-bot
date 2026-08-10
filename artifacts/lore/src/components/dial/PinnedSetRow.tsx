/**
 * PinnedSetRow — the Dial's pinned tuned-station sentence (Task #37).
 *
 * This subsumes the old station set/wiki workspace into the Dial itself:
 *
 *   - The currently tuned/playing station is pinned at the top of the sidebar.
 *   - Its live provenance sentence unfurls to include the COMPLETE current
 *     setlist. Live setlist artist interactions add to the library only —
 *     they never play or navigate.
 *   - A single left chevron steps back exactly one completed set. The previous
 *     set renders in past tense with its full artist list and strongest
 *     available provenance, plus playlist/export controls.
 *   - Live mode never exposes export/playlist controls — those are structurally
 *     absent, not merely hidden.
 *   - There is no post-sentence byline; provenance lives inside the sentence.
 *   - No wiki/knowledge or player surface is reachable from this flow, and no
 *     interaction here starts playback or replay.
 *
 * The previous set is resolved from the station archive/run endpoints (there is
 * no dedicated previous-set endpoint): the latest completed run strictly before
 * the current live run.
 */
import { useMemo, useState, type ReactNode } from "react";
import { Download } from "lucide-react";
import {
  useGetStationArchive,
  useGetStationRun,
  getGetStationArchiveQueryKey,
  getGetStationRunQueryKey,
} from "@workspace/api-client-react";
import { eligibleDjNames } from "@workspace/lore-attribution";
import {
  cleanLiveValue,
  sameLiveValue,
  usableShowName,
  dialShowAsAttribution,
  classifySetTimeContext,
} from "../dialViewHelpers";
import { type QueueArtist } from "./FrontDoorRow";
import type { DialStation, DialShow } from "../../hooks/useDialData";
import {
  stationSetIdentity,
  stationSetFilename,
  buildStationSetExport,
  STATION_SET_EXPORT_FORMATS,
  type StationSetExportFormat,
  type StationSetExportTrack,
  type SetPanelSet,
} from "../DialView";

/**
 * The live set built from the currently tuned show's spins. Artists render in
 * broadcast order (oldest → newest) so the unfurled sentence reads as the set
 * played out.
 */
function liveSetArtists(show: DialShow | null): QueueArtist[] {
  if (!show) return [];
  return show.spins
    .map((spin) => ({
      name: spin.artist,
      inLibrary: spin.isLibraryHit || spin.isArtistHit,
      title: spin.title || null,
    }))
    .filter((artist) => artist.name.trim());
}

/**
 * The COMPLETE setlist rendered inline in the sentence — never truncated.
 * Add-only semantics: the name itself is inert text (never navigates, never
 * plays); non-library names carry the explicit `+` affordance, which flips
 * off once the artist is seeded. Yours renders bright with no control.
 */
function inlineSetNodes(
  artists: QueueArtist[],
  seedsLower: Set<string>,
  onAdd: (name: string) => void,
): ReactNode {
  const usable = artists
    .map((artist) => ({ ...artist, name: cleanLiveValue(artist.name) }))
    .filter((artist): artist is QueueArtist & { name: string } => artist.name != null)
    // De-duplicate repeats (an artist spun twice reads once in the sentence).
    .filter((artist, index, all) => all.findIndex((other) => sameLiveValue(other.name, artist.name)) === index);
  if (usable.length === 0) return null;

  const nodes: ReactNode[] = [];
  usable.forEach((artist, i) => {
    if (i > 0) {
      nodes.push(i === usable.length - 1 ? (usable.length > 2 ? ", and " : " and ") : ", ");
    }
    const seeded = seedsLower.has(artist.name.trim().toLowerCase());
    const yours = artist.inLibrary || seeded;
    if (yours) {
      nodes.push(
        <b key={artist.name} className="fdrow__artist fdrow__artist--lib dial-artist--complete" aria-label={`${artist.name} is in your library`}>
          {artist.name}
        </b>,
      );
    } else {
      nodes.push(
        <span key={artist.name} className="fdrow__artist-wrap">
          <span className="fdrow__artist fdrow__artist--other">{artist.name}</span>
          <button
            type="button"
            className="fdrow__addplus dial-addplus"
            aria-label={`Add ${artist.name} to your artists`}
            onClick={(e) => { e.stopPropagation(); onAdd(artist.name); }}
          >+</button>
        </span>,
      );
    }
  });
  return <>{nodes}</>;
}

/**
 * Live provenance sentence — DJ / show / station, strongest-first, with NO
 * trailing byline. The whole setlist lives inline in the sentence.
 */
function LiveSentence({
  ds,
  show,
  list,
}: {
  ds: DialStation;
  show: DialShow | null;
  list: ReactNode;
}) {
  const station = cleanLiveValue(ds.station.name);

  const djList = show
    ? eligibleDjNames(dialShowAsAttribution(show), {
        artist: show.currentTrack?.artist,
        title: show.currentTrack?.title,
        showTitle: show.showName,
        stationName: station ?? undefined,
      })
    : [];
  const dj = djList.length === 1 ? cleanLiveValue(djList[0]) : null;
  const showName = usableShowName(show);

  // Grammar: "[DJ] is playing [set] on [Show]." → "[Show] is playing [set]."
  // → "[Station] is playing [set]." Falls back to "on air" when the set is
  // empty (e.g. before the first spin lands).
  if (!list) {
    const subject = dj ?? showName ?? station ?? "This station";
    return <>{subject} is on air.</>;
  }
  if (dj && showName) {
    return (
      <>
        <b className="fdrow__dj">{dj}</b>
        {" is playing "}
        {list}
        {" on "}
        <span className="fdrow__show">{showName}</span>
        {"."}
      </>
    );
  }
  if (dj) {
    return (
      <>
        <b className="fdrow__dj">{dj}</b>
        {" is playing "}
        {list}
        {"."}
      </>
    );
  }
  if (showName) {
    return (
      <>
        <span className="fdrow__show">{showName}</span>
        {" is playing "}
        {list}
        {"."}
      </>
    );
  }
  return (
    <>
      {station ?? "This station"}
      {" is playing "}
      {list}
      {"."}
    </>
  );
}

/**
 * Past-tense provenance sentence for the completed previous set. Renders at the
 * strongest available rung (DJ → show → station) with a station-local time
 * context and the full artist list.
 */
function PastSentence({
  set,
  timeLabel,
  list,
}: {
  set: SetPanelSet;
  timeLabel: string;
  list: ReactNode;
}) {
  const dj = set.djNames.length === 1 ? cleanLiveValue(set.djNames[0]) : null;
  const showName = cleanLiveValue(set.showName);
  const station = cleanLiveValue(set.stationName) ?? "This station";
  const timing = timeLabel === "now" ? "" : ` ${timeLabel}`;

  if (!list) {
    const subject = dj ?? showName ?? station;
    return <>{subject} aired{timing}.</>;
  }
  if (dj && showName) {
    return (
      <>
        <b className="fdrow__dj">{dj}</b>
        {" played "}
        {list}
        {" on "}
        <span className="fdrow__show">{showName}</span>
        {timing}
        {"."}
      </>
    );
  }
  if (dj) {
    return (
      <>
        <b className="fdrow__dj">{dj}</b>
        {" played "}
        {list}
        {timing}
        {"."}
      </>
    );
  }
  if (showName) {
    return (
      <>
        <span className="fdrow__show">{showName}</span>
        {" played "}
        {list}
        {timing}
        {"."}
      </>
    );
  }
  return (
    <>
      {station}
      {" played "}
      {list}
      {timing}
      {"."}
    </>
  );
}

/** Playlist/export controls for a completed past set only. */
function PastSetExport({ set, tracks }: { set: SetPanelSet; tracks: StationSetExportTrack[] }) {
  const [format, setFormat] = useState<StationSetExportFormat>("m3u8");
  const [note, setNote] = useState<string | null>(null);
  const download = () => {
    const built = buildStationSetExport(format, set, tracks);
    const url = URL.createObjectURL(new Blob([built.content], { type: built.contentType }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = stationSetFilename(set, format);
    anchor.click();
    URL.revokeObjectURL(url);
    setNote(
      built.skipped > 0
        ? `${built.skipped} track${built.skipped === 1 ? "" : "s"} lacked the fields required for ${format.toUpperCase()} and ${built.skipped === 1 ? "was" : "were"} skipped.`
        : `Downloaded ${tracks.length} tracks in broadcast order.`,
    );
  };
  return (
    <div className="dial-pinned-set__export">
      <label>
        <span className="sr-only">Past set export format</span>
        <select
          aria-label="Past set export format"
          value={format}
          onChange={(event) => setFormat(event.target.value as StationSetExportFormat)}
        >
          {STATION_SET_EXPORT_FORMATS.map((value) => (
            <option key={value} value={value}>{value.toUpperCase()}</option>
          ))}
        </select>
      </label>
      <button type="button" onClick={download}><Download /> Download</button>
      {note ? <p className="dial-pinned-set__note" role="status">{note}</p> : null}
    </div>
  );
}

export interface PinnedSetRowProps {
  ds: DialStation;
  /** The tuned station's live show (state="live"), or null when off-air. */
  show: DialShow | null;
  seedsLower: Set<string>;
  onAddArtist: (name: string) => void;
}

/**
 * The pinned row: the live unfurled sentence by default, with a single left
 * chevron that toggles back to the previous completed set. Live mode adds
 * only (no play, no navigate, no export); past mode adds export/playlist and
 * shows the strongest provenance in past tense.
 */
export function PinnedSetRow({ ds, show, seedsLower, onAddArtist }: PinnedSetRowProps) {
  const [showingPast, setShowingPast] = useState(false);
  const liveArtists = useMemo(() => liveSetArtists(show), [show]);
  const liveRunId = show?.runId ?? null;

  // Resolve the previous completed run: the latest archive run strictly before
  // the live run (or the latest run overall when off-air). Only fetch the
  // archive once the listener steps back, to keep the live row cheap.
  const archive = useGetStationArchive(
    ds.station.slug,
    { offset: 0, limit: 10 },
    {
      query: {
        queryKey: getGetStationArchiveQueryKey(ds.station.slug, { offset: 0, limit: 10 }),
        enabled: showingPast,
      },
    },
  );
  const prevRun = useMemo(() => {
    const runs = archive.data?.runs ?? [];
    for (const run of runs) {
      if (liveRunId != null && run.runId === liveRunId) continue;
      return run; // runs are newest-first
    }
    return null;
  }, [archive.data?.runs, liveRunId]);

  const runDetail = useGetStationRun(prevRun?.runId ?? 0, {
    query: {
      queryKey: getGetStationRunQueryKey(prevRun?.runId ?? 0),
      enabled: showingPast && prevRun != null,
    },
  });

  const stationTz = ds.station.ianaTimezone ?? show?.ianaTimezone ?? null;
  const pastSet: SetPanelSet | null = useMemo(() => {
    if (!prevRun || !runDetail.data) return null;
    return {
      id: `${ds.station.slug}:archive:${prevRun.runId}`,
      runId: prevRun.runId,
      stationSlug: ds.station.slug,
      stationName: runDetail.data.station.name,
      startedAt: prevRun.startedAt,
      ianaTimezone: stationTz,
      showName: prevRun.show?.name ?? null,
      djNames: prevRun.show?.djName ? [prevRun.show.djName] : [],
      artists: runDetail.data.tracks
        .slice()
        .reverse()
        .map((track) => ({
          name: track.recording?.artist || track.rawArtist,
          title: track.recording?.title || track.rawTitle,
          inLibrary: false,
        }))
        .filter((artist) => artist.name.trim()),
      spins: [],
      progress: 1,
    };
  }, [prevRun, runDetail.data, ds.station.slug, stationTz]);

  const pastTracks: StationSetExportTrack[] = useMemo(
    () =>
      (runDetail.data?.tracks ?? []).map((track) => ({
        artist: track.recording?.artist || track.rawArtist,
        title: track.recording?.title || track.rawTitle,
        playedAt: track.playedAt,
        mbid: track.recording?.mbid ?? null,
        location: track.recording?.links?.find((link) => link.kind === "exact")?.url ?? null,
      })),
    [runDetail.data?.tracks],
  );

  const pastTimeLabel = pastSet
    ? classifySetTimeContext({
        startedAt: new Date(pastSet.startedAt),
        stationIanaTimezone: pastSet.ianaTimezone,
      }).label
    : "in the last set";

  // The full setlist lives INLINE in the sentence — one rendering, no
  // separate queue block, so no name ever appears twice.
  const liveList = inlineSetNodes(liveArtists, seedsLower, onAddArtist);
  const pastList = pastSet ? inlineSetNodes(pastSet.artists, seedsLower, onAddArtist) : null;

  return (
    <div className="dial-pinned-row dial-pinned-set" aria-label="Tuned station">
      <div className="dial-pinned-set__head">
        <button
          type="button"
          className="dial-pinned-set__chev"
          aria-label={showingPast ? "Back to the current set" : "Show the previous set"}
          aria-pressed={showingPast}
          onClick={() => setShowingPast((v) => !v)}
        >‹</button>
        <p className="dial-pinned-set__sentence fdrow__t1">
          {showingPast ? (
            pastSet ? (
              <PastSentence set={pastSet} timeLabel={pastTimeLabel} list={pastList} />
            ) : archive.isLoading || runDetail.isLoading ? (
              "Loading the previous set…"
            ) : (
              "No earlier set to show."
            )
          ) : (
            <LiveSentence ds={ds} show={show} list={liveList} />
          )}
        </p>
      </div>

      {/* Export/playlist controls exist ONLY for the completed past set. */}
      {showingPast && pastSet ? (
        <>
          <div className="dial-pinned-set__meta">
            <time dateTime={pastSet.startedAt}>{stationSetIdentity(pastSet).date} · {stationSetIdentity(pastSet).time}</time>
          </div>
          <PastSetExport set={pastSet} tracks={pastTracks} />
        </>
      ) : null}
    </div>
  );
}
