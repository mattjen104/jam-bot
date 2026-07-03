import { Link, useParams } from "wouter";
import {
  useGetRecording,
  useGetRecordingPreview,
  useGetRecordingEntry,
  useGetRecordingKnowledge,
  useGetRecordingSpins,
  useGetRecordingSegues,
  type EntryPick,
  type RecordingSpin,
  type SegueNext,
  type TrackClaim,
} from "@workspace/api-client-react";
import { LyricView } from "../components/LyricView";
import { usePlayer } from "../player/PlayerProvider";
import { DeepLinks } from "../components/NowPlaying";
import { CONFIDENCE_LABEL } from "../lib/format";
import { ShareButton } from "../components/ShareButton";
import { clockTime, timeAgo } from "../lib/format";
import {
  ArrowLeft,
  ArrowUpRight,
  Disc3,
  ExternalLink,
  MessageSquareQuote,
  Music4,
  Radio,
  Route as RouteIcon,
  Sparkles,
  Users,
} from "lucide-react";

const RUNG_FRAMING: Record<string, string> = {
  dj: "A DJ put this on",
  label: "A label released this",
  blog: "A blog wrote this up",
  curator: "A curator placed this",
  collector: "A collector filed this",
  event: "An event booked this",
  series: "A documentary featured this",
  artist: "Traced to the artist",
  scene: "Rooted in a scene",
  empty: "Nobody has claimed this yet",
};

export default function Song() {
  const params = useParams();
  const mbid = params.mbid ?? "";
  const { ride } = usePlayer();

  const { data: rec, isLoading, isError, error } = useGetRecording(mbid);
  const { data: preview } = useGetRecordingPreview(mbid);
  const { data: entry } = useGetRecordingEntry(mbid);
  const { data: knowledge } = useGetRecordingKnowledge(mbid);
  const { data: spinsData } = useGetRecordingSpins(mbid);
  const { data: seguesData } = useGetRecordingSegues(mbid);

  const notFound =
    isError && (error as { status?: number } | undefined)?.status === 404;

  const artwork = rec?.artworkUrl ?? preview?.artworkUrl ?? null;
  const isRidingThis = ride.active && ride.current?.mbid === mbid;

  const startRide = () => {
    if (!rec) return;
    ride.start({
      mbid: rec.mbid,
      title: rec.title,
      artist: rec.artist,
      artworkUrl: rec.artworkUrl ?? preview?.artworkUrl ?? null,
      links: rec.links,
    });
  };

  return (
    <div className="lore-grain relative min-h-screen">
      <div className="lore-glow pointer-events-none absolute inset-0" />
      <div
        className={`relative z-10 mx-auto max-w-4xl px-4 pt-8 sm:px-6 ${
          ride.active ? "pb-32" : "pb-16"
        }`}
      >
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wide text-muted-foreground hover:text-primary"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to the dial
        </Link>

        {isLoading && <SongSkeleton />}

        {notFound && (
          <div className="mt-8 rounded-2xl border border-card-border bg-card p-8 text-center">
            <Disc3 className="mx-auto h-10 w-10 text-muted-foreground/50" />
            <h1 className="mt-4 font-serif text-2xl font-semibold text-foreground">
              Not on the spine yet
            </h1>
            <p className="mx-auto mt-2 max-w-[42ch] text-sm text-muted-foreground">
              This recording hasn't been logged on any Lore station. Once a
              station spins it, its full story shows up here.
            </p>
            <p className="mt-3 font-mono text-[11px] text-muted-foreground/70">
              MBID {mbid.slice(0, 8)}
            </p>
          </div>
        )}

        {isError && !notFound && (
          <div className="mt-8 rounded-2xl border border-destructive-border bg-destructive/10 p-6 text-sm text-destructive-foreground">
            Couldn't load this recording. Please refresh.
          </div>
        )}

        {rec && (
          <>
            <header className="mt-6 flex flex-col gap-6 sm:flex-row sm:items-end">
              <div className="h-40 w-40 shrink-0 overflow-hidden rounded-2xl border border-card-border bg-muted shadow-lg">
                {artwork ? (
                  <img
                    src={artwork}
                    alt={`${rec.title} — ${rec.artist}`}
                    className="h-full w-full object-cover"
                    data-testid="song-artwork"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <Disc3 className="h-16 w-16 text-muted-foreground/40" />
                  </div>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary">
                  Recording
                </p>
                <h1
                  className="mt-1 font-serif text-3xl font-semibold leading-tight text-foreground sm:text-4xl"
                  data-testid="song-title"
                >
                  {rec.title}
                </h1>
                <p
                  className="mt-1 text-lg text-muted-foreground"
                  data-testid="song-artist"
                >
                  {rec.artist}
                </p>

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={isRidingThis ? ride.stop : startRide}
                    data-testid="ride-from-here"
                    className="inline-flex h-10 items-center gap-2 rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground shadow-sm transition-transform active:scale-95"
                  >
                    <RouteIcon className="h-4 w-4" />
                    {isRidingThis ? "Stop riding" : "Ride from here"}
                  </button>
                  <ShareButton sharePath={`songs/${rec.mbid}`} kind="song" />
                  <a
                    href={`https://musicbrainz.org/recording/${rec.mbid}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground/80 hover:text-primary"
                    title="This track's canonical MusicBrainz identity"
                  >
                    <Music4 className="h-3 w-3" />
                    MBID {rec.mbid.slice(0, 8)}
                    <ArrowUpRight className="h-3 w-3" />
                  </a>
                </div>
                {preview && preview.previewUrl === null && (
                  <p className="mt-2 font-mono text-[11px] text-muted-foreground/70">
                    No preview clip available — riding will follow the trail and
                    link out for this one.
                  </p>
                )}
              </div>
            </header>

            {rec.links.length > 0 && (
              <div className="mt-2">
                <DeepLinks links={rec.links} />
              </div>
            )}

            <EntryLadder entry={entry} artist={rec.artist} />
            <Claims claims={knowledge?.claims ?? []} />
            <LyricView mbid={rec.mbid} progressMs={ride.progressMs} />
            <Segues next={seguesData?.next ?? []} />
            <Spins spins={spinsData?.spins ?? []} />
          </>
        )}
      </div>
    </div>
  );
}

function SectionHeading({
  icon,
  title,
  hint,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
}) {
  return (
    <div className="mb-3 mt-10 flex items-baseline justify-between">
      <h2 className="flex items-center gap-2 font-serif text-xl font-semibold text-foreground">
        <span className="text-primary">{icon}</span>
        {title}
      </h2>
      {hint ? (
        <span className="font-mono text-xs text-muted-foreground">{hint}</span>
      ) : null}
    </div>
  );
}

function EntryLadder({
  entry,
  artist,
}: {
  entry: import("@workspace/api-client-react").EntryResult | undefined;
  artist: string;
}) {
  if (!entry) return null;
  const isEmpty = entry.rung === "empty" || entry.picks.length === 0;

  return (
    <section>
      <SectionHeading
        icon={<Sparkles className="h-5 w-5" />}
        title="How you'd find this"
        hint={RUNG_FRAMING[entry.rung] ?? entry.rung}
      />
      <div className="rounded-2xl border border-card-border bg-card p-5">
        <p className="text-sm text-muted-foreground">{entry.framing}</p>

        {isEmpty ? (
          <div className="mt-4 rounded-xl border border-dashed border-primary-border bg-primary/5 p-4">
            <p className="font-serif text-base text-foreground">
              {entry.invitation?.message ??
                `No one has vouched for this ${artist} track yet.`}
            </p>
            <p className="mt-1 font-mono text-[11px] uppercase tracking-wide text-primary">
              Be the first to pick it
            </p>
          </div>
        ) : (
          <ul className="mt-4 flex flex-col gap-3" data-testid="entry-picks">
            {entry.picks.map((pick, i) => (
              <EntryPickRow key={`${pick.pickerHandle}-${i}`} pick={pick} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function EntryPickRow({ pick }: { pick: EntryPick }) {
  return (
    <li className="flex items-start gap-3 rounded-xl border border-border bg-secondary/40 p-3">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 font-mono text-[11px] uppercase text-primary">
        {pick.pickerType.slice(0, 2)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">
          {pick.pickerName}
          <span className="ml-2 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
            {pick.pickerType} · trust {pick.trustTier}
          </span>
        </p>
        {pick.context && (
          <p className="mt-0.5 text-sm text-muted-foreground">{pick.context}</p>
        )}
        <p className="mt-1 font-mono text-[11px] text-muted-foreground/70">
          {CONFIDENCE_LABEL[pick.confidence] ?? pick.confidence}
          {pick.pickedAt ? ` · ${timeAgo(pick.pickedAt)}` : ""}
        </p>
      </div>
      {pick.sourceUrl && (
        <a
          href={pick.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="hover-elevate inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-border px-2.5 text-xs text-muted-foreground"
          title={`Source: ${pick.source}`}
        >
          <ExternalLink className="h-3 w-3" />
          Source
        </a>
      )}
    </li>
  );
}

function Segues({ next }: { next: SegueNext[] }) {
  return (
    <section>
      <SectionHeading
        icon={<RouteIcon className="h-5 w-5" />}
        title="What plays next"
        hint={next.length ? `${next.length} real transition${next.length === 1 ? "" : "s"}` : undefined}
      />
      {next.length === 0 ? (
        <div className="rounded-2xl border border-card-border bg-card p-5 text-sm text-muted-foreground">
          No segues observed after this track yet. Ride it and you might set the
          first one.
        </div>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="segues">
          {next.map((n) => (
            <li key={n.mbid}>
              <Link
                href={`/song/${n.mbid}`}
                className="hover-elevate flex items-center gap-3 rounded-xl border border-card-border bg-card p-3"
              >
                <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md bg-muted">
                  {n.artworkUrl ? (
                    <img src={n.artworkUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <Disc3 className="h-6 w-6 text-muted-foreground/40" />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-foreground">{n.title}</p>
                  <p className="truncate text-sm text-muted-foreground">{n.artist}</p>
                  <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground/70">
                    {n.pickers && n.pickers.length > 0
                      ? `Sequenced by ${n.pickers[0].name}`
                      : n.stations.length > 0
                        ? `Segued on ${n.stations[0].name}`
                        : "Observed transition"}
                    {` · seen ${n.count}×`}
                  </p>
                </div>
                <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Spins({ spins }: { spins: RecordingSpin[] }) {
  return (
    <section>
      <SectionHeading
        icon={<Radio className="h-5 w-5" />}
        title="Where it's played"
        hint={spins.length ? `${spins.length} spin${spins.length === 1 ? "" : "s"}` : undefined}
      />
      {spins.length === 0 ? (
        <div className="rounded-2xl border border-card-border bg-card p-5 text-sm text-muted-foreground">
          No logged spins for this recording yet.
        </div>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="spins">
          {spins.map((s, i) => (
            <li
              key={`${s.station.slug}-${s.playedAt}-${i}`}
              className="flex items-center gap-3 rounded-xl border border-card-border bg-card p-3"
            >
              <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {s.station.name}
                  {s.show ? (
                    <span className="text-muted-foreground">
                      {" · "}
                      {s.show.name}
                      {s.show.djName ? ` (${s.show.djName})` : ""}
                    </span>
                  ) : null}
                </p>
                <p className="truncate font-mono text-[11px] text-muted-foreground/70">
                  {CONFIDENCE_LABEL[s.confidence] ?? s.confidence}
                  {" · "}
                  {timeAgo(s.playedAt)}
                  {` · ${clockTime(s.playedAt)}`}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Claims({ claims }: { claims: TrackClaim[] }) {
  if (claims.length === 0) return null;
  return (
    <section>
      <SectionHeading
        icon={<MessageSquareQuote className="h-5 w-5" />}
        title="From the source"
        hint={`${claims.length} claim${claims.length === 1 ? "" : "s"}`}
      />
      <ul className="flex flex-col gap-2" data-testid="track-claims">
        {claims.map((c, i) => (
          <li
            key={i}
            className="rounded-xl border border-card-border bg-card p-4"
          >
            <p className="text-sm leading-relaxed text-foreground">{c.text}</p>
            <div className="mt-2 flex items-center justify-between gap-2">
              <p className="font-mono text-[11px] text-muted-foreground/70">
                {c.sourceLabel}
                {c.positionMs != null
                  ? ` · ${Math.floor(c.positionMs / 60000)}:${String(Math.floor((c.positionMs % 60000) / 1000)).padStart(2, "0")}`
                  : ""}
              </p>
              <a
                href={c.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="hover-elevate inline-flex h-7 shrink-0 items-center gap-1 rounded-lg border border-border px-2.5 text-xs text-muted-foreground"
              >
                <ExternalLink className="h-3 w-3" />
                Source
              </a>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SongSkeleton() {
  return (
    <div className="mt-6 flex animate-pulse flex-col gap-6 sm:flex-row">
      <div className="h-40 w-40 shrink-0 rounded-2xl bg-muted" />
      <div className="flex-1 space-y-3 pt-4">
        <div className="h-3 w-24 rounded bg-muted" />
        <div className="h-8 w-2/3 rounded bg-muted" />
        <div className="h-4 w-1/3 rounded bg-muted" />
        <div className="h-10 w-40 rounded-full bg-muted" />
      </div>
    </div>
  );
}
