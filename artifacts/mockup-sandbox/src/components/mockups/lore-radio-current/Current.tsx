import { useState } from "react";
import { ChevronDown, Filter, MoreHorizontal, Play, Search, SlidersHorizontal, X } from "lucide-react";
import "./_group.css";

type Station = {
  name: string;
  kind: string;
  place: string;
  note: string;
  count: string;
  matched: string;
  live?: boolean;
};

const STATIONS: Station[] = [
  { name: "KEXP", kind: "community radio", place: "Seattle, WA", note: "Fleet Foxes · Mykonos", count: "14 crossings", matched: "Fleet Foxes, Big Thief", live: true },
  { name: "NTS Radio", kind: "online radio", place: "London, UK", note: "L'Rain · Two Faces", count: "9 crossings", matched: "L'Rain, Tirzah" },
  { name: "WFMU", kind: "freeform radio", place: "Jersey City, NJ", note: "Yo La Tengo · Autumn Sweater", count: "7 crossings", matched: "Yo La Tengo, Sonic Youth" },
  { name: "KUTX", kind: "public radio", place: "Austin, TX", note: "Adrianne Lenker · Ruined", count: "4 crossings", matched: "Adrianne Lenker" },
  { name: "Dublab", kind: "web radio", place: "Los Angeles, CA", note: "Mount Eerie · Real Lost Cause", count: "3 crossings", matched: "Mount Eerie, Grouper" },
];

const lensOptions = ["My library", "Rotation", "Shelf"];
const sortOptions = ["Crossings", "Your keeps", "Albums filed", "Premieres"];

function SelectControl({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <label className="lr-control">
      <span>{label}</span>
      <span className="lr-select-wrap">
        <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
          {options.map((option) => <option key={option}>{option}</option>)}
        </select>
        <ChevronDown aria-hidden="true" />
      </span>
    </label>
  );
}

export function Current() {
  const [surface, setSurface] = useState<"Radio" | "Inbox">("Radio");
  const [lens, setLens] = useState("My library");
  const [sort, setSort] = useState("Crossings");
  const [crossings, setCrossings] = useState("30 days");
  const [age, setAge] = useState("Any age");
  const [artist, setArtist] = useState("");
  const [focusOpen, setFocusOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [onlyMine, setOnlyMine] = useState(false);
  const [type, setType] = useState("All types");
  const [removed, setRemoved] = useState<string[]>([]);

  const visibleStations = STATIONS.filter((station) => !removed.includes(station.name));

  return (
    <div className="lr-app">
      <header className="lr-header">
        <div className="lr-brand">LORE <span>RADIO DESK</span></div>
        <nav className="lr-surface-nav" aria-label="Primary">
          {(["Radio", "Inbox"] as const).map((item) => (
            <button key={item} className={surface === item ? "is-active" : ""} onClick={() => setSurface(item)} aria-current={surface === item ? "page" : undefined}>
              {item}
            </button>
          ))}
        </nav>
        <div className="lr-header-meta">TUE 14 MAY <span>·</span> 22:41</div>
      </header>

      <main className="lr-main">
        <div className="lr-page-line">
          <div>
            <p className="lr-kicker">LISTENING SURFACE</p>
            <h1>{surface}</h1>
          </div>
          <p className="lr-count">{surface === "Radio" ? "118 stations in your orbit" : "324 records in the inbox"}</p>
        </div>

        <section className="lr-focus-band" aria-label="Artist focus">
          <button className={`lr-focus-trigger ${artist ? "has-focus" : ""}`} onClick={() => setFocusOpen((open) => !open)} aria-expanded={focusOpen}>
            <Search aria-hidden="true" />
            <span>{artist || "Find artist"}</span>
            {artist ? <X aria-label="Clear artist focus" onClick={(event) => { event.stopPropagation(); setArtist(""); }} /> : <ChevronDown aria-hidden="true" />}
          </button>
          <span className="lr-focus-note">{artist ? "focused artist" : "optional focus"}</span>
          {focusOpen && (
            <div className="lr-focus-popover">
              <label htmlFor="artist-input">Focus the radio on an artist</label>
              <input id="artist-input" autoFocus value={artist} placeholder="Try Big Thief, Grouper…" onChange={(event) => setArtist(event.target.value)} />
              <div className="lr-focus-suggestions">
                {["Big Thief", "Broadcast", "Grouper"].map((name) => <button key={name} onClick={() => { setArtist(name); setFocusOpen(false); }}>{name}</button>)}
              </div>
            </div>
          )}
        </section>

        {surface === "Radio" ? (
          <>
            <section className="lr-toolbar" aria-label="Radio controls">
              <div className="lr-lens-group" role="group" aria-label="Radio lens">
                {lensOptions.map((option) => <button key={option} className={lens === option ? "is-selected" : ""} onClick={() => setLens(option)}>{option}</button>)}
              </div>
              <div className="lr-toolbar-secondary">
                <SelectControl label="Crossings in" value={crossings} options={["7 days", "30 days", "90 days", "All time"]} onChange={setCrossings} />
                <SelectControl label="Sort by" value={sort} options={sortOptions} onChange={setSort} />
                <SelectControl label="Age" value={age} options={["Any age", "New this week", "New this month", "Older"]} onChange={setAge} />
                <button className={`lr-filter-button ${filterOpen ? "is-active" : ""}`} onClick={() => setFilterOpen((open) => !open)} aria-expanded={filterOpen}><Filter aria-hidden="true" /> Type / Filters</button>
                <label className="lr-check"><input type="checkbox" checked={onlyMine} onChange={(event) => setOnlyMine(event.target.checked)} /> Only my stations</label>
              </div>
              {filterOpen && <div className="lr-filter-popover"><strong>Station type</strong>{["All types", "Community", "Public", "Online"].map((option) => <button key={option} className={type === option ? "is-selected" : ""} onClick={() => { setType(option); setFilterOpen(false); }}>{option}</button>)}</div>}
            </section>
            <div className="lr-results-label"><span>{artist ? `Stations that play ${artist}` : lens}</span><span>{visibleStations.length} stations</span></div>
            <section className="lr-stations" aria-label="Radio stations">
              {visibleStations.map((station, index) => (
                <article className="lr-station" key={station.name}>
                  <div className="lr-station-index">{String(index + 1).padStart(2, "0")}</div>
                  <button className="lr-play" aria-label={`Play ${station.name}`}><Play aria-hidden="true" /></button>
                  <div className="lr-station-copy">
                    <div className="lr-station-title"><h2>{station.name}</h2>{station.live && <span className="lr-live">LIVE</span>}</div>
                    <p className="lr-station-meta">{station.kind} <span>·</span> {station.place}</p>
                    <p className="lr-station-note">{station.note}</p>
                  </div>
                  <div className="lr-station-evidence"><span>{station.count}</span><small>{station.matched}</small></div>
                  <button className="lr-more" aria-label={`More actions for ${station.name}`}><MoreHorizontal aria-hidden="true" /></button>
                </article>
              ))}
            </section>
          </>
        ) : (
          <section className="lr-inbox">
            <div className="lr-library-toolbar">
              <span className="lr-sentence">Group by <SelectControl label="Group by" value="Albums" options={["Albums", "Songs", "Artists"]} onChange={() => {}} /> <span className="lr-inline-word">and sort by</span> <SelectControl label="Sort by" value="Recently added" options={["Recently added", "Artist", "Title"]} onChange={() => {}} /></span>
              <label className="lr-search"><Search aria-hidden="true" /><input aria-label="Search songs" placeholder="Search songs" /></label>
            </div>
            {["Songs from the wire", "Albums to file", "Artists to investigate"].map((group, i) => <div className="lr-library-row" key={group}><span className="lr-library-count">0{i + 1}</span><div><h2>{group}</h2><p>{i === 0 ? "12 songs · added this week" : i === 1 ? "8 albums · not yet filed" : "5 artists · new to the desk"}</p></div><button className="lr-remove" onClick={() => undefined}>Remove selected</button></div>)}
          </section>
        )}
      </main>
      <footer className="lr-footer"><span>LORE / RADIO</span><span>THE DESK IS QUIET. THE SIGNAL IS NOT.</span></footer>
    </div>
  );
}

export default Current;