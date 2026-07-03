import { useState } from "react";
import { Link } from "wouter";
import { useQueries } from "@tanstack/react-query";
import { getPickerArchive, getPickerRun } from "@workspace/api-client-react";
import { usePlayer } from "../player/PlayerProvider";
import {
  useJournal,
  clearJournal,
  useFollows,
  type JournalEntry,
} from "../lib/local";
import { clockTime } from "../lib/format";
import { KeepButton } from "../components/KeepButton";
import {
  ArrowLeft,
  BookOpen,
  Disc3,
  Ghost,
  Radio,
  Trash2,
  UserCheck,
  Waypoints,
} from "lucide-react";

/** Everything heard on this device, newest first, grouped by day. */
export default function Journal() {
  const { ride, radio } = usePlayer();
  const entries = useJournal();
  const [confirmClear, setConfirmClear] = useState(false);

  const dockPadding = ride.active || radio.station ? "pb-32" : "pb-16";
  const days = groupByDay(entries);

  return (
    <div className="min-h-screen">
      <div className={`mx-auto max-w-4xl px-4 pt-8 sm:px-6 ${dockPadding}`}>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wide text-muted-foreground hover:text-primary"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to the dial
        </Link>

        <header className="mb-8 mt-6">
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.3em] text-primary">
            <BookOpen className="h-4 w-4" />
            Your journal
          </div>
          <h1 className="mt-3 max-w-[20ch] font-serif text-4xl font-semibold leading-[1.05] text-foreground">
            Everything you heard here.
          </h1>
          <p className="mt-4 max-w-[52ch] text-base text-muted-foreground">
            Lore remembers what played while you listened — the answer to
            "what was that song?" Stored only on this device, never on a
            server.
          </p>
        </header>

        {entries.length > 0 && (
          <div className="mb-6 flex items-center justify-between gap-3">
            <p className="font-mono text-[11px] text-muted-foreground">
              {entries.length} listen{entries.length === 1 ? "" : "s"} on this
              device
            </p>
            {confirmClear ? (
              <span className="inline-flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    clearJournal();
                    setConfirmClear(false);
                  }}
                  data-testid="journal-clear-confirm"
                  className="hover-elevate rounded-lg border border-destructive-border bg-destructive/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide text-destructive-foreground"
                >
                  Erase everything
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmClear(false)}
                  className="hover-elevate rounded-lg border border-border bg-card px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide text-muted-foreground"
                >
                  Keep it
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                data-testid="journal-clear"
                className="hover-elevate inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide text-muted-foreground"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Clear journal
              </button>
            )}
          </div>
        )}

        {/* Inflow strip — new runs from followed pickers */}
        <InflowRow />

        {entries.length === 0 ? (
          <div className="rounded-xl border border-card-border bg-card p-8 text-center">
            <Disc3 className="mx-auto h-10 w-10 text-muted-foreground/50" />
            <p className="mx-auto mt-4 max-w-[32ch] font-serif text-lg text-muted-foreground">
              Nothing heard yet. Tune into a station or ride a trail — every
              track lands here.
            </p>
            <Link
              href="/"
              className="hover-elevate mt-5 inline-flex items-center gap-2 rounded-full border border-primary-border bg-primary/10 px-4 py-2 font-mono text-[11px] uppercase tracking-wide text-primary"
            >
              <Radio className="h-3.5 w-3.5" />
              Open the dial
            </Link>
          </div>
        ) : (
          <div className="flex flex-col gap-8" data-testid="journal-days">
            {days.map(([day, dayEntries]) => (
              <section key={day}>
                <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.3em] text-muted-foreground">
                  {day}
                </h2>
                <ul className="flex flex-col gap-2">
                  {dayEntries.map((e, i) => (
                    <JournalRow key={`${e.at}-${i}`} entry={e} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function JournalRow({ entry }: { entry: JournalEntry }) {
  const title = entry.mbid ? (
    <Link
      href={`/song/${entry.mbid}`}
      className="truncate text-base font-medium text-foreground hover:text-primary"
    >
      {entry.title}
    </Link>
  ) : (
    <span className="truncate text-base font-medium text-foreground">
      {entry.title}
    </span>
  );

  return (
    <li
      className="flex items-center gap-3 rounded-xl border border-card-border bg-card p-3"
      data-testid="journal-entry"
    >
      {/* 42×42 artwork swatch with gradient fallback */}
      <div
        className="h-[42px] w-[42px] shrink-0 overflow-hidden rounded-lg"
        style={{
          background: entry.artworkUrl
            ? undefined
            : "linear-gradient(135deg, hsl(var(--secondary)), hsl(var(--muted)))",
        }}
      >
        {entry.artworkUrl ? (
          <img
            src={entry.artworkUrl}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Disc3 className="h-4 w-4 text-muted-foreground/40" />
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">{title}</div>
        <p className="truncate text-sm" style={{ color: "hsl(var(--dim))" }}>
          {entry.artist}
        </p>
        {/* IBM Plex Mono source attribution — source name in violet */}
        <p className="mt-0.5 flex items-center gap-1.5 truncate font-mono text-[11px]" style={{ color: "hsl(var(--faint))" }}>
          <SourceIcon kind={entry.kind} />
          <span className="text-primary">
            <SourceLabel entry={entry} />
          </span>
          {!entry.mbid && (
            <span style={{ color: "hsl(var(--faint))" }}>· unresolved</span>
          )}
        </p>
      </div>

      {/* Right side: time + service sync badge */}
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="font-mono text-[11px]" style={{ color: "hsl(var(--faint))" }}>
          {clockTime(entry.at)}
        </span>
        {entry.mbid && <ServiceBadge mbid={entry.mbid} />}
      </div>
    </li>
  );
}

/** Right-aligned service sync badge — shows "Spotify ✓" when connected + resolved. */
function ServiceBadge({ mbid }: { mbid: string }) {
  const { spotify } = usePlayer();
  if (!spotify.configured) {
    return (
      <span
        className="rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide"
        style={{ borderColor: "hsl(var(--faint))", color: "hsl(var(--dim))" }}
      >
        ID'd ✓
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={spotify.connected ? undefined : spotify.connect}
      title={spotify.connected ? "Saved to Spotify Liked Songs" : "Connect Spotify to save"}
      className="rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide transition-colors hover:border-primary/40 hover:text-primary"
      style={{
        borderColor: "hsl(var(--faint))",
        color: spotify.connected ? "hsl(var(--dim))" : "hsl(var(--faint))",
        cursor: spotify.connected ? "default" : "pointer",
      }}
    >
      {spotify.connected ? "Spotify ✓" : "Spotify →"}
    </button>
  );
  void mbid; // mbid available for future per-track saved-state checks
}

/**
 * Horizontal-scroll inflow strip sourced from followed pickers.
 * Two-level query: archive → run detail → first resolved track per picker.
 * Each card: artwork, picker name in violet, track title in Fraunces,
 * artist in --dim, lime KeepButton. Only renders when following pickers.
 */
function InflowRow() {
  const follows = useFollows();
  const pickerFollows = follows.filter((f) => f.kind === "picker");

  // Level 1: latest run from each followed picker
  const archiveQueries = useQueries({
    queries: pickerFollows.map((f) => ({
      queryKey: ["following", "picker", f.id],
      queryFn: () => getPickerArchive(f.id),
      staleTime: 60_000,
    })),
  });

  // Level 2: run detail (tracks) for each picker's most recent run
  const runDetailQueries = useQueries({
    queries: archiveQueries.map((aq) => {
      const runId = aq.data?.runs[0]?.runId ?? null;
      return {
        queryKey: ["picker-run", runId],
        queryFn: () => getPickerRun(runId!),
        staleTime: 300_000,
        enabled: !!runId,
      };
    }),
  });

  if (pickerFollows.length === 0) return null;

  interface InflowCard {
    key: string;
    runHref: string;
    songHref: string;
    pickerName: string;
    mbid: string;
    title: string;
    artist: string;
    artworkUrl: string | null;
  }

  const cards = runDetailQueries
    .map((rq, i): InflowCard | null => {
      if (!rq.data) return null;
      const archiveData = archiveQueries[i]?.data;
      const runId = archiveData?.runs[0]?.runId;
      if (!archiveData || !runId) return null;
      const pickerName = archiveData.picker.name;
      const track = rq.data.tracks.find((t) => t.recording != null);
      if (!track?.recording) return null;
      return {
        key: `picker-${i}-${track.recording.mbid}`,
        runHref: `/archive/picker-runs/${runId}`,
        songHref: `/song/${track.recording.mbid}`,
        pickerName,
        mbid: track.recording.mbid,
        title: track.recording.title,
        artist: track.recording.artist,
        artworkUrl: track.recording.artworkUrl ?? null,
      };
    })
    .filter((c): c is InflowCard => c !== null);

  if (cards.length === 0) return null;

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-primary">
          <UserCheck className="h-3.5 w-3.5" />
          New from your pickers
        </h2>
        <Link
          href="/archive"
          className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground hover:text-primary"
        >
          See all →
        </Link>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2" style={{ scrollbarWidth: "none" }}>
        {cards.map((card) => (
          <div
            key={card.key}
            className="flex w-[160px] shrink-0 flex-col gap-2 rounded-xl border border-card-border bg-card p-3"
          >
            {/* Artwork swatch with gradient fallback */}
            <Link href={card.songHref}>
              <div
                className="h-[100px] w-full overflow-hidden rounded-lg"
                style={{
                  background: card.artworkUrl
                    ? undefined
                    : "linear-gradient(135deg, hsl(var(--secondary)), hsl(var(--muted)))",
                }}
              >
                {card.artworkUrl ? (
                  <img src={card.artworkUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <Disc3 className="h-8 w-8 text-muted-foreground/30" />
                  </div>
                )}
              </div>
            </Link>
            {/* Picker name in violet IBM Plex Mono */}
            <Link href={card.runHref} className="truncate font-mono text-[10px] uppercase tracking-wide text-primary hover:opacity-80">
              {card.pickerName}
            </Link>
            {/* Track title in Fraunces */}
            <Link href={card.songHref} className="line-clamp-2 font-serif text-sm font-semibold leading-tight text-foreground hover:text-primary">
              {card.title}
            </Link>
            {/* Artist in --dim */}
            <p className="truncate font-mono text-[10px]" style={{ color: "hsl(var(--dim))" }}>
              {card.artist}
            </p>
            {/* Lime Keep button */}
            <KeepButton mbid={card.mbid} />
          </div>
        ))}
      </div>
    </section>
  );
}

function SourceIcon({ kind }: { kind: JournalEntry["kind"] }) {
  if (kind === "radio") return <Radio className="h-3 w-3 shrink-0 text-primary" />;
  if (kind === "replay") return <Ghost className="h-3 w-3 shrink-0 text-primary" />;
  return <Waypoints className="h-3 w-3 shrink-0 text-primary" />;
}

function SourceLabel({ entry }: { entry: JournalEntry }) {
  if (entry.kind === "radio" && entry.stationSlug) {
    return (
      <Link
        href={`/archive/stations/${entry.stationSlug}`}
        className="truncate hover:text-primary"
      >
        {entry.stationName ?? entry.stationSlug}
      </Link>
    );
  }
  if (entry.kind === "replay") {
    return <span className="truncate">{entry.context ?? "Replay"}</span>;
  }
  return <span className="truncate">Segue trail</span>;
}

/** Group newest-first entries into [dayLabel, entries][] preserving order. */
function groupByDay(entries: JournalEntry[]): [string, JournalEntry[]][] {
  const out: [string, JournalEntry[]][] = [];
  for (const e of entries) {
    const d = new Date(e.at);
    const label = Number.isNaN(d.getTime())
      ? "Sometime"
      : d.toLocaleDateString(undefined, {
          weekday: "long",
          month: "long",
          day: "numeric",
        });
    const last = out[out.length - 1];
    if (last && last[0] === label) last[1].push(e);
    else out.push([label, [e]]);
  }
  return out;
}
