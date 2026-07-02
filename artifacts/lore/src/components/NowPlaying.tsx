import { Link } from "wouter";
import {
  useGetRecordingKnowledge,
  getGetRecordingKnowledgeQueryKey,
  type RecordingLink,
  type Station,
  type StationNowPlaying,
} from "@workspace/api-client-react";
import { CONFIDENCE_LABEL, clockTime, timeAgo } from "../lib/format";
import { groupCredits, pressingLine } from "../lib/linerNotes";
import { LikeButton } from "./LikeButton";
import { FollowButton } from "./FollowButton";
import { djFollowId } from "../lib/local";
import {
  ArrowUpRight,
  Disc3,
  ExternalLink,
  Heart,
  Mic,
  Music4,
  Search,
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
      <div className="relative aspect-square w-full overflow-hidden bg-muted">
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
        <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-card via-card/70 to-transparent" />
        <div className="absolute left-4 top-4">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-background/70 px-2.5 py-1 font-mono text-[11px] uppercase tracking-wide text-primary backdrop-blur">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
            On air · {station.name}
          </span>
        </div>
      </div>

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
              <div className="mt-4">
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
  if (!knowledge) return null;

  const rows = groupCredits(knowledge.personnel);
  const pressing = pressingLine(knowledge);
  if (rows.length === 0 && !pressing) return null;

  return (
    <div className="mt-5" data-testid="liner-notes">
      <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
        Liner notes
        {knowledge.approximate ? " · matched by title" : ""}
      </p>
      <dl className="space-y-1.5">
        {rows.map((row) => (
          <div key={row.label} className="text-sm leading-snug">
            <dt className="inline font-medium text-foreground">{row.label} </dt>
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
