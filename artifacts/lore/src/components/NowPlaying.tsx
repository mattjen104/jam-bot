import { useState, useEffect, useRef, useMemo } from "react";
import { Link } from "wouter";
import {
  useGetRecordingKnowledge,
  useGetRecordingSongExploder,
  getGetRecordingKnowledgeQueryKey,
  type RecordingLink,
  type Station,
  type StationNowPlaying,
  type SongExploderAnchor,
} from "@workspace/api-client-react";
import { CONFIDENCE_LABEL, clockTime, timeAgo } from "../lib/format";
import { groupCredits, pressingLine } from "../lib/linerNotes";
import { cn } from "../lib/utils";
import { LikeButton } from "./LikeButton";
import { KeepButton } from "./KeepButton";
import { FollowButton } from "./FollowButton";
import { LyricView } from "./LyricView";
import { usePlayer } from "../player/PlayerProvider";
import { djFollowId } from "../lib/local";
import {
  ArrowUpRight,
  Disc3,
  ExternalLink,
  Heart,
  Mic,
  Mic2,
  MicVocal,
  Music4,
  Search,
} from "lucide-react";

type ArtMode = "art" | "lyrics" | "exploder";

interface NowPlayingProps {
  data: StationNowPlaying | undefined;
  isLoading: boolean;
  fallbackStation: Station | null;
}

export function NowPlaying({ data, isLoading, fallbackStation }: NowPlayingProps) {
  const station = data?.station ?? fallbackStation;
  const np = data?.nowPlaying ?? null;
  const rec = np?.recording ?? null;
  const artwork = rec?.artworkUrl ?? np?.artworkUrl ?? null;

  const { ride } = usePlayer();
  const [artMode, setArtMode] = useState<ArtMode>("art");

  const hasMbid = Boolean(rec?.mbid);
  const progressMs = ride.active && ride.current?.mbid === rec?.mbid
    ? ride.progressMs
    : null;

  // Reset to art view whenever the track changes.
  const prevMbidRef = useRef<string | null>(null);
  useEffect(() => {
    if (rec?.mbid !== prevMbidRef.current) {
      prevMbidRef.current = rec?.mbid ?? null;
      setArtMode("art");
    }
  }, [rec?.mbid]);

  const toggleLyrics = () => setArtMode((m) => (m === "lyrics" ? "art" : "lyrics"));
  const toggleExploder = () => setArtMode((m) => (m === "exploder" ? "art" : "exploder"));

  if (!station) {
    return (
      <div className="flex h-full min-h-[420px] flex-col items-center justify-center rounded-2xl border border-card-border bg-card p-8 text-center">
        <Disc3 className="lore-spin h-10 w-10 text-muted-foreground/50" />
        <p className="mt-4 max-w-[24ch] font-serif text-lg text-muted-foreground">
          Pick a station to tune in.
        </p>
        <p className="mt-1 font-mono text-xs text-muted-foreground/70">
          Streams play unmodified from the source.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-card-border bg-card shadow-lg">
      <div className="relative z-10 aspect-square w-full overflow-hidden bg-muted">
        {artwork ? (
          <img
            src={artwork}
            alt={rec ? `${rec.title} — ${rec.artist}` : station.name}
            className="h-full w-full object-cover"
            data-testid="now-playing-artwork"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Disc3
              className={`h-20 w-20 text-muted-foreground/40 ${np ? "lore-spin" : ""}`}
            />
          </div>
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-card via-card/70 to-transparent" />
        <div className="absolute left-4 top-4">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-background/70 px-2.5 py-1 font-mono text-[11px] uppercase tracking-wide text-primary backdrop-blur">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
            On air · {station.name}
          </span>
        </div>

        {/* Corner toggle cluster — knowledge-layer panels: Song Exploder + Lyrics */}
        <div className="absolute bottom-3 right-3 flex items-center gap-1.5">
          {hasMbid && rec && (
            <SEToggleBtn
              mbid={rec.mbid}
              active={artMode === "exploder"}
              onToggle={toggleExploder}
            />
          )}
          <button
            type="button"
            onClick={toggleLyrics}
            title={artMode === "lyrics" ? "Hide lyrics" : "Show lyrics"}
            aria-label={artMode === "lyrics" ? "Hide lyrics" : "Show lyrics"}
            data-testid="lyrics-toggle"
            className={[
              "flex h-7 w-7 cursor-pointer items-center justify-center rounded-full backdrop-blur transition-colors",
              artMode === "lyrics"
                ? "bg-primary text-primary-foreground"
                : "bg-background/70 text-foreground/80 hover:bg-background/90",
            ].join(" ")}
          >
            <MicVocal className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Lyrics panel — slides open beneath the album art */}
      {artMode === "lyrics" && (
        <div
          className="border-b border-card-border animate-in fade-in slide-in-from-top-1 duration-200"
          data-testid="lyrics-panel"
        >
          {hasMbid && rec ? (
            <LyricView mbid={rec.mbid} progressMs={progressMs} />
          ) : (
            <div className="px-5 py-4">
              <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
                Track not yet identified — lyrics unavailable
              </p>
            </div>
          )}
        </div>
      )}

      {/* Song Exploder panel — knowledge layer, parallel to lyrics */}
      {artMode === "exploder" && hasMbid && rec && (
        <div
          className="border-b border-card-border animate-in fade-in slide-in-from-top-1 duration-200"
          data-testid="se-panel"
        >
          <SongExploderPanel mbid={rec.mbid} progressMs={progressMs} />
        </div>
      )}

      <div className="relative -mt-10 p-6">
        {np ? (
          <>
            <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
              {CONFIDENCE_LABEL[np.confidence] ?? "Now playing"}
              {" · "}
              {np.playedAt ? timeAgo(np.playedAt) : ""}
            </p>
            {rec ? (
              <Link
                href={`/song/${rec.mbid}`}
                className="mt-1.5 block font-serif text-2xl font-semibold leading-tight text-foreground hover:text-primary"
                data-testid="now-playing-title"
              >
                {rec.title}
              </Link>
            ) : (
              <h2
                className="mt-1.5 font-serif text-2xl font-semibold leading-tight text-foreground"
                data-testid="now-playing-title"
              >
                {np.rawTitle}
              </h2>
            )}
            <p className="mt-1 text-base text-muted-foreground" data-testid="now-playing-artist">
              {rec?.artist ?? np.rawArtist}
            </p>

            {np.show && (
              <div
                className="mt-4 rounded-xl border border-border bg-secondary/40 p-3"
                data-testid="on-air-show"
              >
                <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
                  <Mic className="mr-1.5 inline h-3 w-3 text-primary" />
                  On air
                </p>
                <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    {np.show.djName && (
                      <p className="truncate font-serif text-base font-semibold text-foreground">
                        {np.show.djName}
                      </p>
                    )}
                    <p className="truncate text-xs text-muted-foreground">
                      {np.show.name}
                    </p>
                  </div>
                  {np.show.djName && (
                    <FollowButton
                      kind="dj"
                      id={djFollowId(station.slug, np.show.djName)}
                      name={`${np.show.djName} (${station.name})`}
                    />
                  )}
                </div>
              </div>
            )}

            {rec && (
              <div className="mt-4 flex flex-wrap gap-2">
                <KeepButton
                  mbid={rec.mbid}
                  provenance={{
                    kind: "keep",
                    stationSlug: station?.slug,
                  }}
                />
                <LikeButton mbid={rec.mbid} />
              </div>
            )}

            {rec && <LinerNotes mbid={rec.mbid} />}

            {rec && (
              <a
                href={`https://musicbrainz.org/recording/${rec.mbid}`}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground/80 hover:text-primary"
                title="This track's canonical MusicBrainz identity"
              >
                <Music4 className="h-3 w-3" />
                MBID {rec.mbid.slice(0, 8)}
                <ArrowUpRight className="h-3 w-3" />
              </a>
            )}

            {rec && rec.links.length > 0 && <DeepLinks links={rec.links} />}
          </>
        ) : (
          <div className="py-2">
            <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
              {isLoading ? "Reading the dial…" : "Awaiting the next spin"}
            </p>
            <h2 className="mt-1.5 font-serif text-2xl font-semibold leading-tight text-foreground">
              {station.name}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Now-playing data appears the moment the station logs its next track.
            </p>
          </div>
        )}

        <StationFooter station={station} playedAt={np?.playedAt} />
      </div>
    </div>
  );
}

/**
 * Renders the Mic2 toggle button only when the recording has a Song Exploder
 * episode — fetches SE data internally so the parent doesn't need to know.
 * Internal component only; not exported.
 */
function SEToggleBtn({
  mbid,
  active,
  onToggle,
}: {
  mbid: string;
  active: boolean;
  onToggle: () => void;
}) {
  const { data } = useGetRecordingSongExploder(mbid);
  if (!data?.episode) return null;
  return (
    <button
      type="button"
      onClick={onToggle}
      title={active ? "Hide Song Exploder" : "Song Exploder"}
      aria-label={active ? "Hide Song Exploder" : "Show Song Exploder"}
      data-testid="se-toggle"
      className={[
        "flex h-7 w-7 cursor-pointer items-center justify-center rounded-full backdrop-blur transition-colors",
        active
          ? "bg-primary text-primary-foreground"
          : "bg-background/70 text-foreground/80 hover:bg-background/90",
      ].join(" ")}
    >
      <Mic2 className="h-3.5 w-3.5" />
    </button>
  );
}

/** Formats milliseconds as M:SS or H:MM:SS. */
function msToTimecode(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/**
 * Song Exploder knowledge panel — parallel to LyricView.
 *
 * Shows the episode's anchor timeline with the current anchor highlighted
 * as progressMs advances. Auto-scrolls to the active anchor like lyrics.
 * No popup, no fire-and-dismiss: the panel is always visible while open.
 */
function SongExploderPanel({
  mbid,
  progressMs,
}: {
  mbid: string;
  progressMs: number | null;
}) {
  const { data, isLoading } = useGetRecordingSongExploder(mbid);
  const episode = data?.episode ?? null;
  const anchors: SongExploderAnchor[] = data?.anchors ?? [];

  // Highest anchor whose positionMs has been passed — null when not started.
  const activeAnchorId = useMemo(() => {
    if (progressMs === null || !anchors.length) return null;
    let best: SongExploderAnchor | null = null;
    for (const a of anchors) {
      if (a.positionMs <= progressMs) best = a;
    }
    return best?.id ?? null;
  }, [progressMs, anchors]);

  const activeRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeAnchorId]);

  if (isLoading) {
    return (
      <div className="px-5 py-4">
        <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-muted-foreground animate-pulse">
          Loading…
        </p>
      </div>
    );
  }

  if (!episode) {
    return (
      <div className="px-5 py-4">
        <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
          No Song Exploder episode for this track.
        </p>
      </div>
    );
  }

  return (
    <div data-testid="se-panel-inner">
      <div className="flex items-center justify-between px-5 pb-2 pt-4">
        <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
          Song Exploder
        </p>
        <a
          href={episode.episodeUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-mono text-[10px] text-primary hover:underline"
        >
          Full episode
          <ExternalLink className="h-2.5 w-2.5" />
        </a>
      </div>

      {anchors.length === 0 ? (
        <p className="px-5 pb-4 text-sm text-muted-foreground">
          Episode cued up — timestamped anchors haven't been added yet.
        </p>
      ) : (
        <ul
          className="max-h-56 overflow-y-auto px-5 pb-4 [&::-webkit-scrollbar]:hidden"
          style={{ scrollbarWidth: "none" }}
        >
          {anchors.map((anchor) => {
            const isActive = anchor.id === activeAnchorId;
            const isPast = progressMs !== null && anchor.positionMs <= progressMs;
            return (
              <li
                key={anchor.id}
                ref={isActive ? activeRef : null}
                className={cn(
                  "py-1 text-sm leading-relaxed transition-colors duration-300",
                  isActive
                    ? "font-semibold text-foreground"
                    : isPast
                      ? "text-muted-foreground/60"
                      : progressMs !== null
                        ? "text-muted-foreground/30"
                        : "text-muted-foreground/70",
                )}
              >
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground/50">
                    {msToTimecode(anchor.positionMs)}
                  </span>
                  <span className="flex-1">{anchor.text}</span>
                  <a
                    href={anchor.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className={cn(
                      "mt-0.5 shrink-0 transition-colors",
                      isActive ? "text-primary" : "text-muted-foreground/40 hover:text-primary",
                    )}
                    aria-label="Hear this moment in the episode"
                  >
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * Real liner-notes credits for the confirmed recording, fetched lazily and
 * shown only when something verifiable came back — Lore never fabricates.
 */
function LinerNotes({ mbid }: { mbid: string }) {
  const { data } = useGetRecordingKnowledge(mbid, {
    query: {
      queryKey: getGetRecordingKnowledgeQueryKey(mbid),
      staleTime: 10 * 60_000,
    },
  });
  const knowledge = data?.knowledge ?? null;
  const claims = data?.claims ?? [];

  const rows = knowledge ? groupCredits(knowledge.personnel) : [];
  const pressing = knowledge ? pressingLine(knowledge) : null;
  const hasNotes = rows.length > 0 || Boolean(pressing);
  if (!hasNotes && claims.length === 0) return null;

  return (
    <div className="mt-5" data-testid="liner-notes">
      {hasNotes && (
        <>
          <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
            Liner notes
            {knowledge?.approximate ? " · matched by title" : ""}
          </p>
          <dl className="space-y-1.5">
            {rows.map((row) => (
              <div key={row.label} className="text-sm leading-snug">
                <dt className="inline font-medium text-foreground">
                  {row.label}{" "}
                </dt>
                <dd className="inline text-muted-foreground">{row.names}</dd>
              </div>
            ))}
            {pressing && (
              <div className="text-sm leading-snug">
                <dt className="inline font-medium text-foreground">Pressing </dt>
                <dd className="inline text-muted-foreground">{pressing}</dd>
              </div>
            )}
          </dl>
        </>
      )}
      {claims.length > 0 && (
        <div className={hasNotes ? "mt-4" : undefined} data-testid="track-claims">
          <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
            From {claims[0]!.sourceLabel}
          </p>
          <ul className="space-y-2">
            {claims.map((claim) => (
              <li key={claim.sourceUrl + claim.text} className="text-sm leading-snug">
                <span className="text-muted-foreground">{claim.text} </span>
                <a
                  href={claim.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 whitespace-nowrap text-primary hover:underline"
                  title="Watch the moment that backs this up"
                >
                  <ExternalLink className="h-3 w-3" />
                  watch
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function DeepLinks({ links }: { links: RecordingLink[] }) {
  return (
    <div className="mt-5">
      <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
        Listen elsewhere
      </p>
      <div className="flex flex-wrap gap-2" data-testid="deep-links">
        {links.map((link) => (
          <a
            key={`${link.name}-${link.url}`}
            href={link.url}
            target="_blank"
            rel="noreferrer"
            className="hover-elevate inline-flex items-center gap-1.5 rounded-lg border border-border bg-secondary px-3 py-1.5 text-sm text-secondary-foreground"
            title={
              link.kind === "exact"
                ? `Open this exact recording on ${link.name}`
                : `Search ${link.name} for this track`
            }
          >
            {link.kind === "exact" ? (
              <ExternalLink className="h-3.5 w-3.5 text-primary" />
            ) : (
              <Search className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            {link.name}
          </a>
        ))}
      </div>
    </div>
  );
}

function StationFooter({
  station,
  playedAt,
}: {
  station: Station;
  playedAt?: string;
}) {
  return (
    <div className="mt-6 border-t border-border pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
            Source
          </p>
          <p className="truncate text-sm text-foreground">
            {[station.org, station.country].filter(Boolean).join(" · ") ||
              station.name}
            {playedAt ? (
              <span className="text-muted-foreground"> · logged {clockTime(playedAt)}</span>
            ) : null}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {station.homepageUrl && (
            <a
              href={station.homepageUrl}
              target="_blank"
              rel="noreferrer"
              className="hover-elevate inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Station
            </a>
          )}
          {station.donateUrl && (
            <a
              href={station.donateUrl}
              target="_blank"
              rel="noreferrer"
              data-testid={`donate-${station.slug}`}
              className="hover-elevate inline-flex items-center gap-1.5 rounded-lg border border-primary-border bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary"
            >
              <Heart className="h-3.5 w-3.5" />
              Support
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
