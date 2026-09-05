import { useMemo, useState, type FormEvent } from "react";
import { Link, useLocation, useSearch } from "wouter";
import {
  AlertCircle,
  ArrowRight,
  Clock3,
  Compass,
  Library,
  Loader2,
  MapPin,
  Music2,
  Play,
  Radio,
  RefreshCw,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { ExploreHeader, ExploreSectionHeader } from "../components/ExploreHeader";
import { StationMark } from "../components/StationMark";
import { useExplore, type ExploreCandidate, type ExploreMode } from "../hooks/useExplore";
import { useDialData, type DialStation } from "../hooks/useDialData";
import { resolvePlaybackSource } from "../hooks/useRadioPlayer";
import { usePlayer } from "../player/PlayerProvider";
import { useStationFollows } from "../hooks/useStationFollows";

const MODES: Array<{
  mode: ExploreMode;
  label: string;
  detail: string;
  icon: typeof Compass;
}> = [
  { mode: "location", label: "Near You", detail: "Start with a US ZIP", icon: MapPin },
  { mode: "artist", label: "Artists", detail: "Follow recent plays", icon: Music2 },
  { mode: "genre", label: "Genres", detail: "Match station profiles", icon: Compass },
  { mode: "newness", label: "New Music", detail: "Find recent rotation", icon: Sparkles },
  { mode: "station", label: "Stations", detail: "Open one station", icon: Radio },
  { mode: "library-crossing", label: "Library", detail: "Hear your kept music cross live radio", icon: Library },
];

function parseMode(value: string | null): ExploreMode | null {
  return MODES.some(({ mode }) => mode === value) ? value as ExploreMode : null;
}

function formatTime(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function candidateKey(candidate: ExploreCandidate): string {
  return `${candidate.station.slug}:${candidate.show?.name ?? "station"}:${candidate.timing?.startsAt ?? "any"}`;
}

export default function Explore() {
  const queryString = useSearch();
  return <ExploreSurface key={queryString} queryString={queryString} />;
}

function ExploreSurface({ queryString }: { queryString: string }) {
  const [, setLocation] = useLocation();
  const params = useMemo(() => new URLSearchParams(queryString), [queryString]);
  const mode = parseMode(params.get("mode"));
  const query = params.get("q") ?? "";
  const zip = params.get("zip") ?? "";
  const radiusMiles = params.get("radiusMiles") ?? "50";
  const stationSlug = params.get("station") ?? "";
  const draftSource = `${query}\u001f${zip}\u001f${stationSlug}`;
  const sourceDraft = query || zip || stationSlug;
  const [draftState, setDraftState] = useState({ source: draftSource, value: sourceDraft });
  const [radiusState, setRadiusState] = useState({ source: radiusMiles, value: radiusMiles });
  const draft = draftState.source === draftSource ? draftState.value : sourceDraft;
  const draftRadius = radiusState.source === radiusMiles ? radiusState.value : radiusMiles;
  const setDraft = (value: string) => setDraftState({ source: draftSource, value });
  const setDraftRadius = (value: string) => setRadiusState({ source: radiusMiles, value });

  const requestParams = useMemo(() => {
    if (!mode) return null;
    const next = new URLSearchParams({ mode });
    if (query) next.set("q", query);
    if (zip) next.set("zip", zip);
    if (mode === "location") next.set("radiusMiles", radiusMiles);
    if (stationSlug) next.set("station", stationSlug);
    return next;
  }, [mode, query, radiusMiles, stationSlug, zip]);
  const { data, isLoading, error, refetch } = useExplore(requestParams);
  const { stations: dialStations } = useDialData("personal", {
    includeAllStations: true,
    crossingsEnabled: mode === "library-crossing",
    deferEnrichment: true,
  });
  const { radio } = usePlayer();
  const { isFollowing, toggleFollow } = useStationFollows();

  const setExplore = (next: URLSearchParams) => {
    setLocation(`/explore?${next.toString()}`);
  };

  const chooseMode = (nextMode: ExploreMode) => {
    setDraft("");
    if (nextMode === "newness" || nextMode === "library-crossing") {
      setExplore(new URLSearchParams({ mode: nextMode }));
      return;
    }
    setLocation(`/explore?draft=${nextMode}`);
  };

  const draftMode = parseMode(params.get("draft"));
  const displayedMode = mode ?? draftMode;

  const submitConstraint = (event: FormEvent) => {
    event.preventDefault();
    if (!displayedMode) return;
    const value = draft.trim();
    if (displayedMode === "location") {
      if (!/^\d{5}$/.test(value)) return;
      setExplore(new URLSearchParams({
        mode: displayedMode,
        zip: value,
        radiusMiles: draftRadius,
      }));
      return;
    }
    if (!value) return;
    setExplore(new URLSearchParams(
      displayedMode === "station"
        ? { mode: displayedMode, station: value }
        : { mode: displayedMode, q: value },
    ));
  };

  const pivot = (nextMode: ExploreMode, value?: string) => {
    const next = new URLSearchParams({ mode: nextMode });
    if (value) next.set(nextMode === "station" ? "station" : "q", value);
    setExplore(next);
    setDraft(value ?? "");
  };

  const tune = (candidate: ExploreCandidate) => {
    const match = dialStations.find(({ station }) => station.slug === candidate.station.slug);
    if (match && resolvePlaybackSource(match.station)) void radio.toggle(match.station);
  };

  const locality = data?.metadata.locality;
  const title = mode === "location" && locality
    ? `Radio near ${locality.city}, ${locality.region}`
    : mode === "artist" ? `Radio playing ${query}`
      : mode === "genre" ? `${query} on the dial`
        : mode === "station" ? "One station, in context"
          : mode === "library-crossing" ? "Your Library, live on radio"
            : mode === "newness" ? "New music, chosen by radio"
              : "Find a way into live radio";
  const description = mode
    ? "Live broadcasts lead. Upcoming programs and durable station identity follow when the evidence exists."
    : "Start anywhere: a place, an artist, a sound, a station, new music, or a crossing with your Library.";
  const crossingCount = data?.stations.reduce(
    (total, candidate) => total + candidate.evidence.libraryCrossings24h,
    0,
  ) ?? 0;

  return (
    <main className="explore-page" data-testid="explore-page">
      <ExploreHeader
        title={title}
        description={description}
        liveCount={data?.onAirNow.length ?? 0}
        crossingCount={crossingCount}
        onOpenScan={() => setLocation("/feed")}
      />

      <section className="explore-entry" aria-label="Ways to explore">
        <div className="explore-entry__modes">
          {MODES.map(({ mode: option, label, detail, icon: Icon }) => (
            <button
              key={option}
              type="button"
              className={`explore-mode${displayedMode === option ? " is-active" : ""}`}
              aria-pressed={displayedMode === option}
              onClick={() => chooseMode(option)}
              data-testid={`button-explore-${option}`}
            >
              <Icon aria-hidden="true" size={16} />
              <span><strong>{label}</strong><small>{detail}</small></span>
            </button>
          ))}
        </div>

        {displayedMode && !["newness", "library-crossing"].includes(displayedMode) ? (
          <form className="explore-search" onSubmit={submitConstraint}>
            <label htmlFor="explore-query">
              {displayedMode === "location" ? "Where should we look?" :
                displayedMode === "station" ? "Which station?" :
                  displayedMode === "artist" ? "Which artist?" : "Which genre?"}
            </label>
            <div className="explore-search__row">
              <Search aria-hidden="true" size={16} />
              <input
                id="explore-query"
                type="search"
                inputMode={displayedMode === "location" ? "numeric" : "search"}
                maxLength={displayedMode === "location" ? 5 : 100}
                value={draft}
                onChange={(event) => setDraft(
                  displayedMode === "location"
                    ? event.target.value.replace(/\D/g, "").slice(0, 5)
                    : event.target.value,
                )}
                placeholder={displayedMode === "location" ? "5-digit US ZIP" :
                  displayedMode === "station" ? "Station slug, for example kexp" :
                    displayedMode === "artist" ? "Artist name" : "Genre"}
                aria-label="Explore search"
                data-testid="input-explore-query"
              />
              {displayedMode === "location" ? (
                <select
                  value={draftRadius}
                  onChange={(event) => setDraftRadius(event.target.value)}
                  aria-label="Search radius"
                  data-testid="select-explore-radius"
                >
                  {[25, 50, 100, 250].map((miles) => (
                    <option key={miles} value={miles}>{miles} mi</option>
                  ))}
                </select>
              ) : null}
              <button
                type="submit"
                disabled={!draft.trim() || (displayedMode === "location" && draft.length !== 5)}
                data-testid="button-explore-submit"
              >
                Explore <ArrowRight aria-hidden="true" size={14} />
              </button>
            </div>
            {displayedMode === "location" ? (
              <p>Your ZIP is sent for this search only and is not saved. Distances are approximate straight-line distances, not reception coverage.</p>
            ) : null}
          </form>
        ) : null}
      </section>

      {mode ? (
        <div className="explore-constraints" aria-label="Active Explore constraints">
          <span className="explore-constraints__label">Active</span>
          <span className="explore-constraints__chip" data-testid="chip-explore-mode">
            {MODES.find((item) => item.mode === mode)?.label}
            {query || zip || stationSlug ? ` · ${query || zip || stationSlug}` : ""}
            {mode === "location" ? ` · ${radiusMiles} mi` : ""}
            <button
              type="button"
              onClick={() => {
                setDraft("");
                setLocation("/explore");
              }}
              aria-label="Remove Explore constraint"
              data-testid="button-remove-explore-constraint"
            >
              <X aria-hidden="true" size={12} />
            </button>
          </span>
        </div>
      ) : null}

      {data?.metadata.partial.personalCrossings ? (
        <Notice>Your Library is empty or unavailable on this device. Try an artist or genre while it catches up.</Notice>
      ) : null}
      {data && (data.metadata.partial.schedules || data.metadata.partial.genreEnrichment) ? (
        <Notice>
          Some stations have incomplete schedule or genre evidence. They remain available, but Lore won’t invent missing details.
        </Notice>
      ) : null}

      <div className="explore-content">
        {!mode ? (
          <div className="explore-orientation">
            <Compass aria-hidden="true" size={28} />
            <h2>Choose a starting point</h2>
            <p>Every path stays on this page, so you can pivot without losing the live dial.</p>
          </div>
        ) : isLoading ? (
          <div className="explore-state" aria-busy="true" data-testid="status-explore-loading">
            <Loader2 className="animate-spin" aria-hidden="true" size={24} />
            <p>Listening across the dial…</p>
          </div>
        ) : error ? (
          <div className="explore-state explore-state--error" role="alert" data-testid="status-explore-error">
            <AlertCircle aria-hidden="true" size={24} />
            <p>{error.message}</p>
            <button type="button" className="explore-btn" onClick={() => void refetch()} data-testid="button-explore-retry">
              <RefreshCw aria-hidden="true" size={14} /> Try again
            </button>
          </div>
        ) : data ? (
          <ExploreResults
            data={data}
            dialStations={dialStations}
            onTune={tune}
            onPivot={pivot}
             isFollowing={isFollowing}
             onToggleFollow={toggleFollow}
          />
        ) : null}
      </div>
    </main>
  );
}

function Notice({ children }: { children: string }) {
  return (
    <div className="explore-notice" role="status" data-testid="status-explore-partial">
      <AlertCircle aria-hidden="true" size={14} />
      <p>{children}</p>
    </div>
  );
}

function ExploreResults({
  data,
  dialStations,
  onTune,
  onPivot,
  isFollowing,
  onToggleFollow,
}: {
  data: NonNullable<ReturnType<typeof useExplore>["data"]>;
  dialStations: DialStation[];
  onTune: (candidate: ExploreCandidate) => void;
  onPivot: (mode: ExploreMode, value?: string) => void;
  isFollowing: (slug: string) => boolean;
  onToggleFollow: (slug: string) => void;
}) {
  const sections = [
    { key: "live", title: "Live radio", description: "Playable broadcasts matching this path right now.", items: data.onAirNow },
    { key: "upcoming", title: "Upcoming shows", description: "The next confirmed airings from matching stations.", items: data.comingUp },
    { key: "known", title: "Shows to know", description: "Durable programs heard here before; last airing shown when known.", items: data.showsToKnow },
    { key: "stations", title: "Stations", description: "The station identities behind this result.", items: data.stations },
  ] as const;

  if (data.stations.length === 0) {
    return (
      <div className="explore-state" data-testid="status-explore-empty">
        <Radio aria-hidden="true" size={24} />
        <h2>No matching radio yet</h2>
        <p>Try a wider place, a broader genre, another artist, or New Music.</p>
      </div>
    );
  }

  return (
    <div className="explore-sections">
      {sections.map((section) => (
        <section className="explore-section" key={section.key} data-testid={`section-explore-${section.key}`}>
          <ExploreSectionHeader title={section.title} description={section.description} count={section.items.length} />
          {section.items.length ? (
            <div className="explore-grid">
              {section.items.map((candidate) => (
                <CandidateCard
                  key={candidateKey(candidate)}
                  candidate={candidate}
                  dialStation={dialStations.find(({ station }) => station.slug === candidate.station.slug)}
                  onTune={() => onTune(candidate)}
                  onPivot={onPivot}
                   following={isFollowing(candidate.station.slug)}
                   onToggleFollow={() => onToggleFollow(candidate.station.slug)}
                  kind={section.key}
                />
              ))}
            </div>
          ) : (
            <p className="explore-section__empty">
              {section.key === "live"
                ? "Nothing is confirmed live in this view. The scheduled and station results are still useful."
                : `No ${section.title.toLowerCase()} have enough evidence yet.`}
            </p>
          )}
        </section>
      ))}
    </div>
  );
}

function CandidateCard({
  candidate,
  dialStation,
  onTune,
  onPivot,
  kind,
  following,
  onToggleFollow,
}: {
  candidate: ExploreCandidate;
  dialStation?: DialStation;
  onTune: () => void;
  onPivot: (mode: ExploreMode, value?: string) => void;
  kind: "live" | "upcoming" | "known" | "stations";
  following: boolean;
  onToggleFollow: () => void;
}) {
  const { radio } = usePlayer();
  const { station, show, evidence, timing } = candidate;
  const playable = Boolean(dialStation && resolvePlaybackSource(dialStation.station));
  const isCurrent = radio.station?.slug === station.slug;
  const isPlaying = isCurrent && radio.status === "playing";
  const loading = isCurrent && radio.status === "loading";
  const time = formatTime(timing?.startsAt ?? null);
  const liveArtist = dialStation?.liveTrack?.artist?.trim() || null;

  return (
    <article className={`explore-card${isCurrent ? " explore-card--active" : ""}`} data-testid={`card-explore-${kind}-${station.slug}`}>
      <header className="explore-card__header">
        <StationMark name={station.name} logoUrl={dialStation?.station.logoUrl} variant="cube" className="explore-card__mark" />
        <div className="explore-card__identity">
          <button type="button" onClick={() => onPivot("station", station.slug)} data-testid={`button-pivot-station-${kind}-${station.slug}`}>
            {station.name}
          </button>
          <span>
            {[station.city, station.region].filter(Boolean).join(", ") || "Location unavailable"}
            {station.approximateDistanceMiles != null ? ` · approximately ${station.approximateDistanceMiles} miles away` : ""}
          </span>
        </div>
      </header>

      <div className="explore-card__body">
        {show ? (
          <>
            <span className="explore-card__kicker">{timing?.isLive ? "On air now" : kind === "known" ? "Program identity" : "Next airing"}</span>
            <h3>{show.name}</h3>
            {show.djName ? <p>{show.djName}</p> : <p>Host not listed</p>}
          </>
        ) : (
          <>
            <span className="explore-card__kicker">Why it matches</span>
            <p>{candidate.primaryReason.text}</p>
          </>
        )}
      </div>

      <div className="explore-card__evidence" aria-label="Matching evidence">
        {evidence.profileGenres.map(({ genre, count }) => (
          <button key={genre} type="button" onClick={() => onPivot("genre", genre)} data-testid={`button-pivot-genre-${station.slug}-${genre}`}>
            {genre} · {count}
          </button>
        ))}
        {liveArtist ? (
          <button type="button" onClick={() => onPivot("artist", liveArtist)} data-testid={`button-pivot-artist-${station.slug}`}>
            {liveArtist}
          </button>
        ) : evidence.artistRecentPlays > 0 ? (
          <span>{evidence.artistRecentPlays} matching artist {evidence.artistRecentPlays === 1 ? "play" : "plays"}</span>
        ) : null}
        {evidence.libraryCrossings24h > 0 ? (
          <button type="button" onClick={() => onPivot("library-crossing")} data-testid={`button-pivot-library-${station.slug}`}>
            {evidence.libraryCrossings24h} Library {evidence.libraryCrossings24h === 1 ? "crossing" : "crossings"}
          </button>
        ) : null}
        {candidate.primaryReason.kind === "recent_rotation" ? (
          <button type="button" onClick={() => onPivot("newness")} data-testid={`button-pivot-newness-${station.slug}`}>
            Why newness?
          </button>
        ) : null}
      </div>

      <footer className="explore-card__footer">
        <span className="explore-card__timing">
          {timing?.isLive ? <><span className="explore-card__live-dot" /> Live now</> :
            time ? <><Clock3 aria-hidden="true" size={12} /> {kind === "known" ? `Last aired ${time}` : time}</> :
              "Schedule unavailable"}
        </span>
        {kind === "live" ? (
          <button
            type="button"
            className="explore-card__tune"
            disabled={!playable}
            onClick={onTune}
            aria-pressed={isCurrent}
            data-testid={`button-listen-${station.slug}`}
          >
            {loading ? <Loader2 className="animate-spin" aria-hidden="true" size={13} /> : <Play aria-hidden="true" size={13} fill="currentColor" />}
            {isPlaying ? "Playing" : playable ? "Listen now" : "Stream unavailable"}
          </button>
        ) : (
          <Link className="explore-card__link" href={`/archive/stations/${station.slug}`} data-testid={`link-station-${kind}-${station.slug}`}>
            Station <ArrowRight aria-hidden="true" size={12} />
          </Link>
        )}
        <button
          type="button"
          className="explore-card__link"
          onClick={onToggleFollow}
          aria-pressed={following}
          data-testid={`button-follow-${station.slug}`}
        >
          {following ? "Following" : "Follow"}
        </button>
      </footer>
    </article>
  );
}