import { useState } from "react";
import { proxyArtUrl } from "../lib/proxyArt";
import { Link } from "wouter";
import { usePlayer } from "../player/PlayerProvider";
import {
  useJournal,
  clearJournal,
  type JournalEntry,
} from "../lib/local";
import { clockTime } from "../lib/format";
import { RUMOURS, onArtError } from "../components/../lib/rumours";
import { KeepButton } from "../components/KeepButton";
import {
  ArrowLeft,
  BookOpen,
  Disc3,
  Ghost,
  Music2,
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
    <div className="min-h-screen">
      <div className={`mx-auto max-w-4xl px-4 pt-8 sm:px-6 ${dockPadding}`}>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 font-mono text-[13px] uppercase tracking-wide text-muted-foreground hover:text-primary"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to the dial
        </Link>

        <header className="mb-8 mt-6">
          <div className="flex items-center gap-2 font-mono text-[13px] uppercase tracking-[0.3em] text-primary">
            <BookOpen className="h-4 w-4" />
            Your journal
          </div>
          <h1 className="mt-3 max-w-[20ch] font-serif text-4xl font-normal leading-[1.05] text-foreground">
            Everything you heard here.
          </h1>
          <p className="mt-4 max-w-[52ch] text-lg text-muted-foreground">
            Lore remembers what played while you listened — the answer to
            "what was that song?" Stored only on this device, never on a
            server.
          </p>
        </header>

        {entries.length > 0 && (
          <div className="mb-6 flex items-center justify-between gap-3">
            <p className="font-mono text-[13px] text-muted-foreground">
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
                  className="hover-elevate rounded-lg border border-destructive-border bg-destructive/10 px-3 py-1.5 font-mono text-[13px] uppercase tracking-wide text-destructive-foreground"
                >
                  Erase everything
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmClear(false)}
                  className="hover-elevate rounded-lg border border-border bg-card px-3 py-1.5 font-mono text-[13px] uppercase tracking-wide text-muted-foreground"
                >
                  Keep it
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                data-testid="journal-clear"
                className="hover-elevate inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 font-mono text-[13px] uppercase tracking-wide text-muted-foreground"
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
            <p className="mx-auto mt-4 max-w-[32ch] font-serif text-xl text-muted-foreground">
              Nothing heard yet. Tune into a station or ride a trail — every
              track lands here.
            </p>
            <Link
              href="/"
              className="hover-elevate mt-5 inline-flex items-center gap-2 rounded-full border border-primary-border bg-primary/10 px-4 py-2 font-mono text-[13px] uppercase tracking-wide text-primary"
            >
              <Radio className="h-3.5 w-3.5" />
              Open the dial
            </Link>
          </div>
        ) : (
          <div className="flex flex-col gap-8" data-testid="journal-days">
            {days.map(([day, dayEntries]) => (
              <section key={day}>
                <h2 className="mb-3 font-mono text-[13px] uppercase tracking-[0.3em] text-muted-foreground">
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
      className="truncate text-lg font-normal text-foreground hover:text-primary"
    >
      {entry.title}
    </Link>
  ) : (
    <span className="truncate text-lg font-normal text-foreground">
      {entry.title}
    </span>
  );

  return (
    <li
      className="flex items-center gap-3 rounded-xl border border-card-border bg-card p-3"
      data-testid="journal-entry"
    >
      {/* 42×42 artwork swatch */}
      <div className="h-[42px] w-[42px] shrink-0 overflow-hidden rounded-lg">
        <img
          src={proxyArtUrl(entry.artworkUrl) ?? RUMOURS}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          onError={onArtError}
        />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">{title}</div>
        <p className="truncate text-base" style={{ color: "hsl(var(--dim))" }}>
          {entry.artistMbid ? (
            <Link
              href={`/artist/${entry.artistMbid}`}
              className="hover:text-primary hover:underline"
            >
              {entry.artist}
            </Link>
          ) : (
            entry.artist
          )}
        </p>
        {/* IBM Plex Mono source attribution — source name in violet */}
        <p className="mt-0.5 flex items-center gap-1.5 truncate font-mono text-[13px]" style={{ color: "hsl(var(--faint))" }}>
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
        <span className="font-mono text-[13px]" style={{ color: "hsl(var(--faint))" }}>
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
        className="rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide"
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
      className="rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide transition-colors hover:border-primary/40 hover:text-primary"
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


function SourceIcon({ kind }: { kind: JournalEntry["kind"] }) {
  if (kind === "radio") return <Radio className="h-3 w-3 shrink-0 text-primary" />;
  if (kind === "replay") return <Ghost className="h-3 w-3 shrink-0 text-primary" />;
  if (kind === "spotify") return <Music2 className="h-3 w-3 shrink-0 text-primary" />;
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
  if (entry.kind === "spotify") {
    return <span className="truncate">Played in Spotify</span>;
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
