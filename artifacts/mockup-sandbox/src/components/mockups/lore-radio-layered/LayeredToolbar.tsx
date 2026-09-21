import { useMemo, useState } from "react";
import "./_group.css";

type Lens = "library" | "rotation" | "shelf";
type SortKey = "crossings" | "keeps" | "albums" | "premieres";

type Station = {
  name: string;
  city: string;
  type: string;
  track: string;
  artist: string;
  crossings: number;
  age: string;
  mark: string;
  tone: string;
  mine?: boolean;
};

const STATIONS: Station[] = [
  { name: "WFMU", city: "Jersey City, NJ", type: "Freeform", track: "Clearing", artist: "Grouper", crossings: 18, age: "12 min ago", mark: "FM", tone: "violet", mine: true },
  { name: "KEXP", city: "Seattle, WA", type: "Eclectic", track: "Echo's Answer", artist: "Broadcast", crossings: 14, age: "28 min ago", mark: "KX", tone: "rust", mine: true },
  { name: "NTS 1", city: "London, UK", type: "Online", track: "The Free Design", artist: "Stereolab", crossings: 9, age: "41 min ago", mark: "N1", tone: "blue" },
  { name: "KBOO", city: "Portland, OR", type: "Community", track: "Journey in Satchidananda", artist: "Alice Coltrane", crossings: 6, age: "1 hr ago", mark: "KB", tone: "olive" },
  { name: "Dublab", city: "Los Angeles, CA", type: "Online", track: "A Little Lost", artist: "Arthur Russell", crossings: 4, age: "2 hr ago", mark: "DL", tone: "sand" },
];

const lensCopy: Record<Lens, string> = {
  library: "My library",
  rotation: "Rotation",
  shelf: "Shelf",
};

export function LayeredToolbar() {
  const [surface, setSurface] = useState<"radio" | "inbox">("radio");
  const [lens, setLens] = useState<Lens>("library");
  const [sort, setSort] = useState<SortKey>("crossings");
  const [age, setAge] = useState("Any age");
  const [type, setType] = useState("All types");
  const [onlyMine, setOnlyMine] = useState(false);
  const [artist, setArtist] = useState("");
  const [focusOpen, setFocusOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [removed, setRemoved] = useState<string[]>([]);

  const visibleStations = useMemo(() => STATIONS.filter((station) => {
    if (removed.includes(station.name)) return false;
    if (onlyMine && !station.mine) return false;
    if (type !== "All types" && station.type !== type) return false;
    if (artist && !`${station.artist} ${station.track}`.toLowerCase().includes(artist.toLowerCase())) return false;
    return true;
  }).sort((a, b) => {
    if (sort === "keeps") return b.crossings - a.crossings;
    if (sort === "albums") return a.track.localeCompare(b.track);
    if (sort === "premieres") return a.age.localeCompare(b.age);
    return b.crossings - a.crossings;
  }), [artist, onlyMine, removed, sort, type]);

  const resetFilters = () => {
    setAge("Any age");
    setType("All types");
    setOnlyMine(false);
  };

  return (
    <main className="lore-layered">
      <div className="layered-shell">
        <header className="layered-masthead">
          <div className="layered-brand" aria-label="Lore home"><span className="layered-brand__mark">lo</span><span>lore</span></div>
          <div className="layered-account">LISTENING DESK <span className="layered-account__dot" aria-hidden="true" /></div>
        </header>

        <nav className="surface-nav" aria-label="Primary">
          <button type="button" className={surface === "radio" ? "is-active" : ""} onClick={() => setSurface("radio")} aria-current={surface === "radio" ? "page" : undefined}>
            <span className="surface-nav__index">01</span><span>Radio</span><small>live crossings</small>
          </button>
          <button type="button" className={surface === "inbox" ? "is-active" : ""} onClick={() => setSurface("inbox")} aria-current={surface === "inbox" ? "page" : undefined}>
            <span className="surface-nav__index">02</span><span>Inbox</span><small>your records</small>
          </button>
        </nav>

        <section className="layered-heading">
          <div>
            <p className="section-kicker">{surface === "radio" ? "Radio / live now" : "Inbox / library"}</p>
            <h1>{surface === "radio" ? "Where your records cross." : "The records you meant to keep."}</h1>
          </div>
          <p className="layered-heading__count">{surface === "radio" ? "05 stations" : "248 records"}<br /><span>updated just now</span></p>
        </section>

        {surface === "radio" ? (
          <>
            <section className="lens-layer" aria-label="Radio lens">
              <div className="layer-label">Lens</div>
              <div className="lens-options">
                {(["library", "rotation", "shelf"] as Lens[]).map((item) => (
                  <button key={item} type="button" className={lens === item ? "is-selected" : ""} onClick={() => setLens(item)} aria-pressed={lens === item}>
                    {lensCopy[item]} {item === "library" && <span>248</span>}
                  </button>
                ))}
                <button type="button" className={`focus-trigger ${focusOpen || artist ? "is-selected" : ""}`} onClick={() => setFocusOpen((open) => !open)} aria-expanded={focusOpen}>
                  <span className="focus-trigger__plus">+</span>{artist || "Find artist"}
                </button>
              </div>
              {focusOpen && (
                <div className="focus-popover">
                  <label htmlFor="artist-focus">Focus this radio on an artist</label>
                  <div className="focus-popover__row">
                    <input id="artist-focus" value={artist} onChange={(event) => setArtist(event.target.value)} placeholder="Try Grouper" autoFocus />
                    {artist && <button type="button" onClick={() => setArtist("")}>Clear</button>}
                  </div>
                  <p>Optional focus. Your full library remains the default.</p>
                </div>
              )}
            </section>

            <section className="control-layer" aria-label="Radio controls">
              <div className="control-sentence">
                <span>Showing</span>
                <label><span className="sr-only">Crossings window</span><select value={age} onChange={(event) => setAge(event.target.value)}><option>Any age</option><option>Last 24 hours</option><option>Last 7 days</option><option>Last 30 days</option></select></label>
                <span>· sorted by</span>
                <label><span className="sr-only">Sort radio results</span><select value={sort} onChange={(event) => setSort(event.target.value as SortKey)}><option value="crossings">Crossings</option><option value="keeps">Your keeps</option><option value="albums">Albums filed</option><option value="premieres">Premieres</option></select></label>
              </div>
              <button type="button" className={`filter-toggle ${filtersOpen ? "is-open" : ""}`} onClick={() => setFiltersOpen((open) => !open)} aria-expanded={filtersOpen}>
                Filters <span>{[type !== "All types", onlyMine].filter(Boolean).length || ""}</span><b aria-hidden="true">+</b>
              </button>
              {filtersOpen && (
                <div className="filter-drawer">
                  <label>Station type<select value={type} onChange={(event) => setType(event.target.value)}><option>All types</option><option>Freeform</option><option>Eclectic</option><option>Online</option><option>Community</option></select></label>
                  <label className="switch-label"><input type="checkbox" checked={onlyMine} onChange={(event) => setOnlyMine(event.target.checked)} /><span>Only my stations</span></label>
                  <button type="button" className="reset-button" onClick={resetFilters}>Reset filters</button>
                </div>
              )}
            </section>

            <section className="station-list" aria-label="Radio stations">
              <div className="list-caption"><span>Station crossings</span><span>{visibleStations.length} of 5</span></div>
              {visibleStations.map((station, index) => (
                <article className="station-row" key={station.name}>
                  <div className={`station-mark station-mark--${station.tone}`}>{station.mark}</div>
                  <div className="station-main">
                    <div className="station-line"><h2>{station.name}</h2><span>{station.city}</span></div>
                    <p><strong>{station.artist}</strong> — {station.track}</p>
                    <small>{station.type} · {station.age}</small>
                  </div>
                  <div className="station-evidence"><strong>{station.crossings}</strong><span>crossings</span><em>{index === 0 ? "most relevant" : station.mine ? "in your library" : "near your taste"}</em></div>
                  <button type="button" className="row-listen" aria-label={`Listen to ${station.name}`} onClick={() => alert(`Tuning to ${station.name}`)}>Listen</button>
                </article>
              ))}
              {visibleStations.length === 0 && <div className="empty-state">No crossings match this lens.<button type="button" onClick={() => { setArtist(""); resetFilters(); }}>Clear the desk</button></div>}
            </section>
          </>
        ) : (
          <section className="inbox-layer" aria-label="Inbox controls">
            <div className="inbox-toolbar">
              <label className="search-field"><span aria-hidden="true">/</span><span className="sr-only">Search songs</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search songs, artists, albums" /></label>
              <div className="inbox-sentence"><span>Group by</span><select><option>Albums</option><option>Songs</option><option>Artists</option></select><span>· sort by</span><select><option>Recently added</option><option>Artist</option><option>Album</option><option>Title</option></select></div>
            </div>
            <div className="inbox-group"><div className="inbox-group__head"><span>Albums <b>3</b></span><span>sorted recently added</span></div>{["Ruins / Grouper", "Tender Buttons / Broadcast", "Journey in Satchidananda / Alice Coltrane"].filter((item) => item.toLowerCase().includes(query.toLowerCase())).map((item) => <div className="inbox-item" key={item}><span className="inbox-item__square" /><span>{item}</span><button type="button" onClick={() => setRemoved((items) => [...items, item])} aria-label={`Remove ${item} from Inbox`}>Remove</button></div>)}</div>
          </section>
        )}
      </div>
    </main>
  );
}

export default LayeredToolbar;