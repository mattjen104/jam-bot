import { useState, useEffect, useRef } from "react";
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
  X,
} from "lucide-react";

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
  const [showLyrics, setShowLyrics] = useState(false);

  const hasMbid = Boolean(rec?.mbid);
  const progressMs = ride.active && ride.current?.mbid === rec?.mbid
    ? ride.progressMs
    : null;

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
        {/* Corner toggle cluster — bottom-right of album art */}
        <div className="absolute bottom-3 right-3 flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setShowLyrics((v) => !v)}
            title={showLyrics ? "Hide lyrics" : "Show lyrics"}
            aria-label={showLyrics ? "Hide lyrics" : "Show lyrics"}
            data-testid="lyrics-toggle"
            className={[
              "flex h-7 w-7 cursor-pointer items-center justify-center rounded-full backdrop-blur transition-colors",
              showLyrics
                ? "bg-primary text-primary-foreground"
                : "bg-background/70 text-foreground/80 hover:bg-background/90",
            ].join(" ")}
          >
            <MicVocal className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Lyrics panel — slides open beneath the album art */}
      {showLyrics && (
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
            {rec && progressMs !== null && (
              <SongExploderSignpost mbid={rec.mbid} progressMs={progressMs} />
            )}

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

/**
 * Playback-synced Song Exploder anchor signpost.
 *
 * Fires a dismissable card when `progressMs` crosses an anchor's `positionMs`.
 * Resets when the MBID changes (new track). Auto-dismisses after 14 seconds.
 * Uses a ref-based "fired" Set to avoid re-firing on each render tick.
 */
function SongExploderSignpost({
  mbid,
  progressMs,
}: {
  mbid: string;
  progressMs: number | null;
}) {
  const { data } = useGetRecordingSongExploder(mbid);
  const anchors: SongExploderAnchor[] = data?.anchors ?? [];

  const firedRef = useRef<Set<number>>(new Set());
  const [activeAnchor, setActiveAnchor] = useState<SongExploderAnchor | null>(null);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset fired set and dismiss any shown anchor when the MBID changes.
  useEffect(() => {
    firedRef.current = new Set();
    setActiveAnchor(null);
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
  }, [mbid]);

  // Detect when progressMs crosses an unfired anchor.
  useEffect(() => {
    if (progressMs === null || !anchors.length) return;
    for (const anchor of anchors) {
      if (anchor.positionMs <= progressMs && !firedRef.current.has(anchor.id)) {
        firedRef.current.add(anchor.id);
        setActiveAnchor(anchor);
        if (dismissTimer.current) clearTimeout(dismissTimer.current);
        dismissTimer.current = setTimeout(() => setActiveAnchor(null), 14_000);
      }
    }
  }, [progressMs, anchors]);

  if (!activeAnchor) return null;

  return (
    <div
      className="mt-4 animate-in fade-in slide-in-from-bottom-2 duration-300"
      data-testid="se-signpost"
    >
      <div className="flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3">
        <Mic2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] uppercase tracking-wide text-primary">
            Song Exploder
          </p>
          <p className="mt-0.5 text-sm leading-snug text-foreground">
            {activeAnchor.text}
          </p>
          <a
            href={activeAnchor.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-1.5 inline-flex items-center gap-1 font-mono text-[11px] text-primary hover:underline"
          >
            <ExternalLink className="h-2.5 w-2.5" />
            Hear this in the episode
          </a>
        </div>
        <button
          type="button"
          onClick={() => {
            setActiveAnchor(null);
            if (dismissTimer.current) clearTimeout(dismissTimer.current);
          }}
          aria-label="Dismiss"
          className="shrink-0 rounded-full p-1 text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
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
