import { useState } from "react";
import { Link } from "wouter";
import { Play, Radio } from "lucide-react";
import { usePlayer, type RideSeed } from "../player/PlayerProvider";
import { localDateKey, useMyHeard, type HeardItem } from "../lib/meHooks";
import { proxyArtUrl } from "../lib/proxyArt";
import { onArtError } from "../lib/rumours";

function heardDayLabel(day: string): string {
  const parsed = new Date(`${day}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return day;
  return parsed.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function heardTime(value: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: timezone,
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return "time unavailable";
  }
}

function HeardPlayButton({ item }: { item: HeardItem }) {
  const { ride } = usePlayer();
  const recording = item.recording;
  if (!recording) return null;
  const play = () => {
    const seed: RideSeed = {
      mbid: recording.mbid,
      title: recording.title,
      artist: recording.artist,
      artworkUrl: recording.artworkUrl,
      links: [],
    };
    ride.startReplay([seed], recording.title, {
      timeOrientation: "past",
      context: "heard",
    });
  };
  return (
    <button
      type="button"
      className="heard-row__play"
      onClick={play}
      aria-label={`Play ${recording.title}`}
      data-testid="heard-play"
    >
      <Play size={13} fill="currentColor" />
    </button>
  );
}

function HeardRow({ item, timezone }: { item: HeardItem; timezone: string }) {
  const title = item.recording?.title ?? item.rawTitle ?? "Recording unavailable";
  const artist = item.recording?.artist ?? item.rawArtist ?? "Artist unavailable";
  return (
    <article className="heard-row" data-testid="heard-row">
      <div className="heard-row__art" aria-hidden="true">
        {item.recording?.artworkUrl ? (
          <img
            src={proxyArtUrl(item.recording.artworkUrl) ?? item.recording.artworkUrl}
            alt=""
            onError={onArtError}
            loading="lazy"
          />
        ) : (
          <Radio size={15} />
        )}
      </div>
      <div className="heard-row__body">
        <div className="heard-row__title">
          {item.recording?.mbid ? (
            <Link href={`/song/${item.recording.mbid}`}>{title}</Link>
          ) : (
            <span>{title}</span>
          )}
        </div>
        <div className="heard-row__artist">
          {item.recording?.artistMbid ? (
            <Link href={`/artist/${item.recording.artistMbid}`}>{artist}</Link>
          ) : (
            <span>{artist}</span>
          )}
        </div>
        <div className="heard-row__context">
          {item.station?.slug ? (
            <Link href={`/archive/stations/${item.station.slug}`}>{item.station.name}</Link>
          ) : (
            <span>Station unavailable</span>
          )}
          {item.show?.name && <span> · {item.show.name}</span>}
          <span> · confirmed at {heardTime(item.heardAt, timezone)}</span>
        </div>
      </div>
      <HeardPlayButton item={item} />
    </article>
  );
}

export default function Heard() {
  const today = localDateKey();
  const [selectedDate, setSelectedDate] = useState(today);
  const activeDate = selectedDate > today ? today : selectedDate;
  const isToday = activeDate === today;
  const { data, isLoading, isError } = useMyHeard(activeDate);
  const selectedDayLabel = isToday ? "today" : heardDayLabel(activeDate);

  return (
    <div className="dial-root content-pad-shell" data-testid="heard-page">
      <div className="dial-topbar">
        <span className="dial-topbar__wordmark">Lore</span>
        <span className="dial-topbar__title dial-topbar__title--active">Heard</span>
      </div>
      <main className="heard-page">
        <header className="heard-page__header">
          <div>
            <h1 className="lore-heading lore-heading--page">
              {isToday ? "Heard today" : `Heard ${heardDayLabel(activeDate)}`}
            </h1>
            <p>Confirmed listening, in the order it happened.</p>
          </div>
          {data && <span className="heard-page__count">{data.items.length}{data.partial ? "+" : ""} spins</span>}
        </header>
        <div className="heard-page__date-picker">
          <label htmlFor="heard-date">Review another local day</label>
          <div className="heard-page__date-row">
            <input
              id="heard-date"
              type="date"
              value={activeDate}
              max={today}
              onChange={(event) => {
                const nextDate = event.target.value;
                if (nextDate && nextDate <= today) setSelectedDate(nextDate);
              }}
              data-testid="heard-date"
            />
            {!isToday && (
              <button
                type="button"
                className="heard-page__today"
                onClick={() => setSelectedDate(today)}
                data-testid="heard-today"
              >
                Back to today
              </button>
            )}
          </div>
        </div>
        <p className="heard-page__intent" data-testid="heard-intent-note">
          Heard is automatic attendance. It never saves a track to Stack.
        </p>
        {isLoading && (
          <div className="heard-page__state" data-testid="heard-loading">
            Loading confirmed listening…
          </div>
        )}
        {isError && (
          <div className="heard-page__state" data-testid="heard-unavailable">
            Heard is unavailable right now. No listening claim was made.
          </div>
        )}
        {!isLoading && !isError && data === null && (
          <div className="heard-page__state" data-testid="heard-unavailable">
            Heard is unavailable right now. No listening claim was made.
          </div>
        )}
        {!isLoading && !isError && data && data.items.length === 0 && (
          <div className="heard-page__state" data-testid="heard-empty">
            Nothing confirmed {selectedDayLabel}.
            <span>Heard only includes listening that crossed Lore’s attendance threshold.</span>
          </div>
        )}
        {!isLoading && !isError && data && data.items.length > 0 && (
          <>
            <div className="heard-page__list">
              {data.items.map((item) => (
                <HeardRow key={item.attendanceId} item={item} timezone={data.timezone} />
              ))}
            </div>
            {data.partial && (
              <p className="heard-page__partial" data-testid="heard-partial">
                Showing the first 200 confirmed spins {selectedDayLabel}.
              </p>
            )}
            {data.items.some((item) => !item.recording || !item.station) && (
              <p className="heard-page__partial" data-testid="heard-metadata-note">
                Some recording or station details are unavailable; they are not inferred.
              </p>
            )}
          </>
        )}
      </main>
    </div>
  );
}