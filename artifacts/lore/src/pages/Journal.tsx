import { useState } from "react";
import { Link } from "wouter";
import { usePlayer } from "../player/PlayerProvider";
import {
  useJournal,
  clearJournal,
  type JournalEntry,
} from "../lib/local";
import { clockTime } from "../lib/format";
import {
  ArrowLeft,
  BookOpen,
  Disc3,
  Ghost,
  Radio,
  Trash2,
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
    <div className="lore-grain relative min-h-screen">
      <div className="lore-glow pointer-events-none absolute inset-0" />
      <div className={`relative z-10 mx-auto max-w-4xl px-4 pt-8 sm:px-6 ${dockPadding}`}>
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
      className="truncate font-serif text-base font-semibold text-foreground hover:text-primary"
    >
      {entry.title}
    </Link>
  ) : (
    <span className="truncate font-serif text-base font-semibold text-foreground">
      {entry.title}
    </span>
  );

  return (
    <li
      className="flex items-center gap-3 rounded-xl border border-card-border bg-card p-3"
      data-testid="journal-entry"
    >
      <div className="h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-muted">
        {entry.artworkUrl ? (
          <img
            src={entry.artworkUrl}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Disc3 className="h-5 w-5 text-muted-foreground/40" />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">{title}</div>
        <p className="truncate text-sm text-muted-foreground">{entry.artist}</p>
        <p className="mt-0.5 flex items-center gap-1.5 truncate font-mono text-[11px] text-muted-foreground/80">
          <SourceIcon kind={entry.kind} />
          <SourceLabel entry={entry} />
          {!entry.mbid && (
            <span className="text-muted-foreground/60">· unidentified</span>
          )}
        </p>
      </div>
      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
        {clockTime(entry.at)}
      </span>
    </li>
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
