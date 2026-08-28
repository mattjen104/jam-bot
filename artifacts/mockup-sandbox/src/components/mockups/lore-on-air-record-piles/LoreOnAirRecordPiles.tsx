import { useState, type CSSProperties, type FormEvent } from "react";
import "./_group.css";

type Scope = "15m" | "hour" | "day" | "lifetime";
type Cover = { title: string; artist: string; year: string; className: string; imageUrl: string; detail: string };
type FirstPlay = { title: string; artist: string; imageUrl?: string };
type SelectedCover = { cover: Cover; stationName: string };
type Station = {
  name: string;
  frequency: string;
  artist: string;
  track: string;
  matches: Record<Scope, number>;
  covers: Cover[];
  firstPlays?: { count: number; records: FirstPlay[] };
};

const SCOPE_COPY: Record<Scope, { label: string }> = {
  "15m": { label: "last 15 min" },
  hour: { label: "last hour" },
  day: { label: "today" },
  lifetime: { label: "lifetime" },
};

const SCOPE_NOW: Record<Scope, { artist: string; track: string }[]> = {
  "15m": [
    { artist: "Grouper", track: "Clearing" }, { artist: "Broadcast", track: "Echo's Answer" },
    { artist: "Stereolab", track: "The Free Design" }, { artist: "Alice Coltrane", track: "Journey in Satchidananda" },
  ],
  hour: [
    { artist: "Grouper", track: "Clearing" }, { artist: "Broadcast", track: "Echo's Answer" },
    { artist: "Stereolab", track: "The Free Design" }, { artist: "Alice Coltrane", track: "Journey in Satchidananda" },
  ],
  day: [
    { artist: "Nina Simone", track: "I Put a Spell on You" }, { artist: "Low", track: "Sunflower" },
    { artist: "Arthur Russell", track: "A Little Lost" }, { artist: "Pharoah Sanders", track: "Love in Us All" },
  ],
  lifetime: [
    { artist: "Joni Mitchell", track: "Coyote" }, { artist: "Talk Talk", track: "I Believe in You" },
    { artist: "Fela Kuti", track: "Water No Get Enemy" }, { artist: "Sun Ra", track: "Space Is the Place" },
  ],
};

const STATIONS: Station[] = [
  {
    name: "WFMU", frequency: "91.1 FM · JERSEY CITY",
    artist: "Grouper", track: "Clearing", covers: [
      { title: "Ruins", artist: "Grouper", year: "2014", className: "cover-a", imageUrl: "/__mockup/images/grouper-ruins.jpg", detail: "A room-tone record: spare piano, tape hiss, and the feeling of being almost home." },
      { title: "Dragging a Dead Deer Up a Hill", artist: "Grouper", year: "2008", className: "cover-b", imageUrl: "/__mockup/images/grouper-dragging-a-dead-deer.jpg", detail: "A submerged collection of songs, pulled toward the light one guitar at a time." },
      { title: "Grid of Points", artist: "Grouper", year: "2018", className: "cover-c", imageUrl: "/__mockup/images/grouper-grid-of-points.jpg", detail: "Nine brief sketches with the grain left in." },
    ], matches: { "15m": 2, hour: 8, day: 36, lifetime: 312 },
    firstPlays: {
      count: 6,
      records: [
        { title: "Ruins", artist: "Grouper", imageUrl: "/__mockup/images/grouper-ruins.jpg" },
        { title: "Grid of Points", artist: "Grouper", imageUrl: "/__mockup/images/grouper-grid-of-points.jpg" },
      ],
    },
  },
  {
    name: "KEXP", frequency: "90.3 FM · SEATTLE",
    artist: "Broadcast", track: "Echo's Answer", covers: [
      { title: "Tender Buttons", artist: "Broadcast", year: "2005", className: "cover-d", imageUrl: "/__mockup/images/broadcast-tender-buttons.jpg", detail: "Bright, strange pop assembled from analogue edges and impossible little hooks." },
      { title: "The Noise Made by People", artist: "Broadcast", year: "2000", className: "cover-e", imageUrl: "/__mockup/images/broadcast-noise-made-by-people.jpg", detail: "A careful collision between library music, psychedelia, and a future that never arrived." },
      { title: "Haha Sound", artist: "Broadcast", year: "2003", className: "cover-f", imageUrl: "/__mockup/images/broadcast-haha-sound.jpg", detail: "The point where Broadcast's experiments became a language of their own." },
    ], matches: { "15m": 1, hour: 5, day: 24, lifetime: 204 },
    firstPlays: {
      count: 4,
      records: [
        { title: "Tender Buttons", artist: "Broadcast", imageUrl: "/__mockup/images/broadcast-tender-buttons.jpg" },
        { title: "The Noise Made by People", artist: "Broadcast", imageUrl: "/__mockup/images/broadcast-noise-made-by-people.jpg" },
        { title: "Haha Sound", artist: "Broadcast", imageUrl: "/__mockup/images/broadcast-haha-sound.jpg" },
      ],
    },
  },
  {
    name: "KCRW", frequency: "89.9 FM · SANTA MONICA",
    artist: "Stereolab", track: "The Free Design", covers: [
      { title: "Dots and Loops", artist: "Stereolab", year: "1997", className: "cover-f", imageUrl: "/__mockup/images/stereolab-dots-and-loops.jpg", detail: "Motorik rhythms, soft focus electronics, and pop music viewed through a prism." },
      { title: "Emperor Tomato Ketchup", artist: "Stereolab", year: "1996", className: "cover-a", imageUrl: "/__mockup/images/stereolab-emperor-tomato-ketchup.jpg", detail: "The record where the laboratory opened its doors." },
      { title: "Cobra and Phases", artist: "Stereolab", year: "1999", className: "cover-d", imageUrl: "/__mockup/images/stereolab-cobra-and-phases.jpg", detail: "A long-form, many-windowed portrait of a band refusing the straight line." },
    ], matches: { "15m": 3, hour: 11, day: 41, lifetime: 116 },
    firstPlays: {
      count: 2,
      records: [
        { title: "Emperor Tomato Ketchup", artist: "Stereolab" },
      ],
    },
  },
  {
    name: "KBOO", frequency: "90.7 FM · PORTLAND",
    artist: "Alice Coltrane", track: "Journey in Satchidananda", covers: [
      { title: "Journey in Satchidananda", artist: "Alice Coltrane", year: "1971", className: "cover-b", imageUrl: "/__mockup/images/alice-journey-in-satchidananda.jpg", detail: "Harp, tanpura, and Pharoah Sanders in a record that keeps widening." },
      { title: "Ptah, the El Daoud", artist: "Alice Coltrane", year: "1970", className: "cover-c", imageUrl: "/__mockup/images/alice-ptah-the-el-daoud.jpg", detail: "Two saxophones orbit a spiritual center." },
      { title: "Universal Consciousness", artist: "Alice Coltrane", year: "1971", className: "cover-e", imageUrl: "/__mockup/images/alice-universal-consciousness.jpg", detail: "Strings and organ reaching for the same horizon." },
    ], matches: { "15m": 2, hour: 13, day: 27, lifetime: 52 },
  },
];

const VISIBLE_COVER_CAP = 3;

function RecordCover({ cover, selected, onSelect }: { cover: Cover; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      className={`air-cover ${cover.className}`}
      aria-label={`Show details for ${cover.title} by ${cover.artist}`}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <img className="air-cover-image" src={cover.imageUrl} alt="" draggable={false} />
      <span className="air-cover-title">{cover.title}</span>
    </button>
  );
}

function FirstPlaysLink({ station }: { station: Station }) {
  if (!station.firstPlays || station.firstPlays.count === 0) return null;

  const resolvedRecords = station.firstPlays.records.filter((record) => record.imageUrl).slice(0, 3);
  const stationParam = encodeURIComponent(station.name);
  return (
    <div className={`air-first-plays${resolvedRecords.length === 0 ? " air-first-plays--text-only" : ""}`}>
      <a
        className="air-first-plays__link"
        href={`/first-plays?station=${stationParam}`}
        target="_blank"
        rel="noreferrer"
        aria-label={`Open ${station.name} First plays, ${station.firstPlays.count} records`}
      >
        <span className="air-first-plays__copy">
          <span className="air-first-plays__label">First plays</span>
          <span className="air-first-plays__count">{station.firstPlays.count} from {station.name}</span>
        </span>
        {resolvedRecords.length > 0 && (
          <span className="air-first-plays__pile" aria-hidden="true">
            {resolvedRecords.map((record, index) => (
              <img
                key={record.title}
                src={record.imageUrl}
                alt=""
                style={{ "--first-play-index": index } as CSSProperties}
              />
            ))}
          </span>
        )}
        <span className="air-first-plays__arrow" aria-hidden="true">↗</span>
      </a>
    </div>
  );
}

export function LoreOnAirRecordPiles() {
  const scope: Scope = "hour";
  const [selected, setSelected] = useState<SelectedCover | null>(null);
  const [expandedStation, setExpandedStation] = useState<string | null>(null);
  const [artistCommand, setArtistCommand] = useState("");
  const [addedArtists, setAddedArtists] = useState<string[]>([]);

  const submitArtistCommand = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = artistCommand.trim();
    const remainder = trimmed.replace(/^\/add\b/i, "").trim();
    if (!remainder) return;
    const tokens = /[,\n]/.test(remainder) ? remainder.split(/[,\n]+/) : remainder.split(/\s+/);
    const names = tokens
      .map((name) => name.trim())
      .filter(Boolean)
      .filter((name, index, all) =>
        all.findIndex((candidate) => candidate.toLowerCase() === name.toLowerCase()) === index,
      );
    if (names.length === 0) return;
    setAddedArtists((current) => [...current, ...names.filter((name) =>
      !current.some((artist) => artist.toLowerCase() === name.toLowerCase()),
    )]);
    setArtistCommand("");
  };

  return (
    <main className="lore-air lore-grain">
      <div className="air-shell">
        <header className="air-header">
          <div>
            <div className="air-kicker">Lore / on air</div>
            <h1>Your records are on the radio right now.</h1>
            <p className="air-deck">Add artists to see which stations are playing your music.</p>
            <section className="air-command" aria-label="Add artists">
              <form className="air-artist-cli" onSubmit={submitArtistCommand}>
                <span className="air-artist-cli__prompt" aria-hidden="true">&gt;_</span>
                <input
                  aria-label="Add artists"
                  value={artistCommand}
                  onChange={(event) => setArtistCommand(event.target.value)}
                  placeholder="/add Radiohead, Grouper"
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                />
                <button type="submit">Add</button>
              </form>
              <p className="air-command-hint">Type <code>/add artist, artist</code> to see where they’re playing</p>
              {addedArtists.length > 0 && (
                <div className="air-added-artists" aria-live="polite">
                  {addedArtists.map((artist) => <span key={artist}>{artist}</span>)}
                </div>
              )}
            </section>
          </div>
          <div className="air-live-mark"><span className="air-live-dot" aria-hidden="true" /> live crossing</div>
        </header>

        <section className="air-grid" aria-label={`Live stations, ${SCOPE_COPY[scope].label}`}>
          {STATIONS.map((station, stationIndex) => {
            const now = SCOPE_NOW[scope][stationIndex];
            const matches = station.matches[scope];
            const visibleCovers = station.covers.slice(0, Math.min(matches, VISIBLE_COVER_CAP));
            const hasOverflow = matches > VISIBLE_COVER_CAP;
            const isExpanded = expandedStation === station.name;
            return (
            <article className="air-card" key={station.name}>
              <div className="air-card-head">
                <div>
                  <div className="air-station">{station.name}</div>
                  <div className="air-frequency">{station.frequency}</div>
                </div>
                <div className="air-card-live"><span className="air-live-dot" aria-hidden="true" /> now</div>
              </div>
              <div className="air-now">
                <div>
                  <div className="air-now-label">current transmission</div>
                  <div className="air-artist">{now.artist}</div>
                  <div className="air-track">{now.track}</div>
                </div>
                <div className="air-pile" aria-label={`${visibleCovers.length} visible records from ${station.artist}`}>
                  {visibleCovers.map((cover) => (
                    <RecordCover
                      key={cover.title}
                      cover={cover}
                      selected={selected?.cover.title === cover.title}
                      onSelect={() => setSelected({ cover, stationName: station.name })}
                    />
                  ))}
                </div>
              </div>
              <div className="air-footer">
                <span>{visibleCovers.length} visible · {matches} matched</span>
                {hasOverflow ? (
                  <button
                    type="button"
                    className="air-overflow"
                    onClick={() => setExpandedStation(isExpanded ? null : station.name)}
                    aria-expanded={isExpanded}
                    aria-controls={`${station.name}-overflow`}
                  >
                    {isExpanded ? `showing ${visibleCovers.length} of ${matches}` : `+${matches - visibleCovers.length} more`}
                  </button>
                ) : (
                  <span className="air-complete">fully readable</span>
                )}
              </div>
              <FirstPlaysLink station={station} />
              {isExpanded && hasOverflow && (
                <div id={`${station.name}-overflow`} className="air-overflow-note">
                  <span aria-hidden="true">↳</span>
                  {matches - visibleCovers.length} more records stay stacked behind this cap.
                </div>
              )}
            </article>
            );
          })}
          {selected && (
            <aside className="air-detail" aria-live="polite">
              <img className="air-detail-swatch" src={selected.cover.imageUrl} alt="" aria-hidden="true" />
              <div>
                <div className="air-detail-kicker">selected from {selected.stationName} · {SCOPE_COPY[scope].label} remains active</div>
                <strong>{selected.cover.title}</strong>
                <p>{selected.cover.artist} · {selected.cover.year} — {selected.cover.detail}</p>
              </div>
            </aside>
          )}
        </section>
        <p className="air-note">Shared visible-cover cap: {VISIBLE_COVER_CAP} per station. Overflow stays explicit so a large set can communicate hundreds without rendering hundreds of tiles. Selecting a cover opens detail without moving the station grid.</p>
      </div>
    </main>
  );
}