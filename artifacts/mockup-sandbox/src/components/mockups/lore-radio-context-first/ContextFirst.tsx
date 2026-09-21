import { useMemo, useState } from "react";
import "./_group.css";

type Surface = "radio" | "inbox";
type Lens = "library" | "rotation" | "shelf";
type SortMode = "Crossings" | "Your keeps" | "Albums filed" | "Premieres";

const stations = [
  { name: "WFMU · Jersey City", meta: "freeform / 91.1 FM", note: "2 crossings · 14 min ago", artists: "Broadcast · Broadcast" },
  { name: "NTS Radio · London", meta: "global / nts.live", note: "1 crossing · 28 min ago", artists: "Nala Sinephro · Tirzah" },
  { name: "KEXP · Seattle", meta: "indie / 90.3 FM", note: "5 crossings · yesterday", artists: "Big Thief · OPN" },
  { name: "Dublab · Los Angeles", meta: "eclectic / dublab.com", note: "3 crossings · yesterday", artists: "Haru Nemuri · Arthur Russell" },
  { name: "WPRB · Princeton", meta: "college / 103.3 FM", note: "1 crossing · 3 days ago", artists: "Elliott Smith · Jessica Pratt" },
];

const records = [
  { artist: "Broadcast", title: "Tender Buttons", type: "ALBUM", date: "filed 12 min ago", count: "12 tracks" },
  { artist: "Nala Sinephro", title: "Endlessness", type: "ALBUM", date: "filed yesterday", count: "9 tracks" },
  { artist: "Tirzah", title: "Colourgrade", type: "ALBUM", date: "filed 2 days ago", count: "10 tracks" },
  { artist: "Arthur Russell", title: "World of Echo", type: "ALBUM", date: "filed Mar 04", count: "18 tracks" },
];

export default function ContextFirst() {
  const [surface, setSurface] = useState<Surface>("radio");
  const [lens, setLens] = useState<Lens>("library");
  const [artist, setArtist] = useState("");
  const [sort, setSort] = useState<SortMode>("Crossings");
  const [age, setAge] = useState("Any age");
  const [expanded, setExpanded] = useState(false);
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState("Albums");
  const [removed, setRemoved] = useState<string[]>([]);

  const visibleRecords = useMemo(
    () => records.filter((record) => !removed.includes(record.title) && `${record.artist} ${record.title}`.toLowerCase().includes(search.toLowerCase())),
    [removed, search],
  );

  const focusLabel = artist || (lens === "library" ? "your full library" : lens);

  return (
    <main className="lore-context" aria-label="Lore radio discovery">
      <header className="lore-context__top">
        <div className="lore-context__wordmark">lore<span>/</span></div>
        <div className="lore-context__top-meta">listening desk <span>·</span> 14:32</div>
      </header>

      <nav className="lore-context__surface" aria-label="Primary surface">
        <button className={surface === "radio" ? "is-active" : ""} onClick={() => setSurface("radio")} aria-pressed={surface === "radio"}>Radio</button>
        <button className={surface === "inbox" ? "is-active" : ""} onClick={() => setSurface("inbox")} aria-pressed={surface === "inbox"}>Inbox / Library</button>
      </nav>

      <section className="lore-context__main">
        <div className="lore-context__heading">
          <div>
            <p className="lore-context__kicker">{surface === "radio" ? "RADIO / NOW" : "INBOX / FILED RECORDS"}</p>
            <h1>{surface === "radio" ? "Find what crosses your path." : "The records you meant to keep."}</h1>
          </div>
          <span className="lore-context__count">{surface === "radio" ? "38 stations" : "214 records"}</span>
        </div>

        {surface === "radio" ? (
          <>
            <section className="lore-command" aria-label="Radio context">
              <div className="lore-command__sentence">
                <span className="lore-command__quiet">Tune through</span>
                <div className="lore-select-wrap">
                  <select aria-label="Choose radio library lens" value={lens} onChange={(e) => setLens(e.target.value as Lens)}>
                    <option value="library">your full library</option>
                    <option value="rotation">your Rotation</option>
                    <option value="shelf">your Shelf</option>
                  </select>
                </div>
                <span className="lore-command__quiet">and listen for</span>
                {artist ? (
                  <button className="lore-focus-chip" onClick={() => setArtist("")} aria-label={`Remove artist focus ${artist}`}>
                    {artist}<span aria-hidden="true"> ×</span>
                  </button>
                ) : (
                  <button className="lore-focus-add" onClick={() => setArtist("Broadcast")}>an artist <span aria-hidden="true">+</span></button>
                )}
              </div>
              <div className="lore-command__subline">
                <span>{artist ? `Stations that play ${artist}` : "Stations that meet your listening history"}</span>
                <button className={`lore-more ${expanded ? "is-open" : ""}`} onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
                  {expanded ? "Close options" : "More options"} <span aria-hidden="true">⌄</span>
                </button>
              </div>
              {expanded && (
                <div className="lore-options">
                  <label>Crossings in <select aria-label="Crossings window"><option>30 days</option><option>90 days</option><option>All time</option></select></label>
                  <label>Sort by <select aria-label="Sort radio results" value={sort} onChange={(e) => setSort(e.target.value as SortMode)}>{["Crossings", "Your keeps", "Albums filed", "Premieres"].map((item) => <option key={item}>{item}</option>)}</select></label>
                  <label>Age <select aria-label="Station age" value={age} onChange={(e) => setAge(e.target.value)}><option>Any age</option><option>New this week</option><option>Established</option></select></label>
                  <button className="lore-toggle" aria-pressed="false">Only my stations</button>
                  <button className="lore-filter" aria-label="Open station type filters">Station type <span>all</span> ⌄</button>
                </div>
              )}
            </section>
            <div className="lore-results-head"><span>{artist ? "FOCUS / BROADCAST" : "YOUR CROSSINGS"}</span><span>{sort.toUpperCase()} · {age.toUpperCase()}</span></div>
            <div className="lore-station-list">
              {stations.map((station, index) => (
                <article className="lore-station" key={station.name}>
                  <div className="lore-station__index">0{index + 1}</div>
                  <div className="lore-station__body"><h2>{station.name}</h2><p>{station.meta}</p><p className="lore-station__artists">{station.artists}</p></div>
                  <div className="lore-station__note">{station.note}</div>
                  <button className="lore-listen" aria-label={`Listen to ${station.name}`} onClick={() => undefined}>listen <span aria-hidden="true">↗</span></button>
                </article>
              ))}
            </div>
          </>
        ) : (
          <>
            <section className="lore-library-bar" aria-label="Library controls">
              <label className="lore-search"><span aria-hidden="true">⌕</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search songs, artists, albums" aria-label="Search songs, artists, albums" /></label>
              <label>Group by <select value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Group library by"><option>Albums</option><option>Songs</option><option>Artists</option></select></label>
              <label>Sort by <select aria-label="Sort library"><option>Recently filed</option><option>Artist</option><option>Title</option></select></label>
            </section>
            <div className="lore-results-head"><span>{group.toUpperCase()} / {visibleRecords.length}</span><span>RECENTLY FILED</span></div>
            <div className="lore-record-list">
              {visibleRecords.map((record, index) => (
                <article className="lore-record" key={record.title}>
                  <div className="lore-record__art" aria-hidden="true">{record.artist.slice(0, 1)}</div>
                  <div className="lore-record__body"><h2>{record.title}</h2><p>{record.artist} <span>·</span> {record.type}</p></div>
                  <div className="lore-record__date">{record.date}<br /><span>{record.count}</span></div>
                  <button className="lore-remove" onClick={() => setRemoved([...removed, record.title])} aria-label={`Remove ${record.title} by ${record.artist}`}>remove</button>
                  <div className="lore-record__index">0{index + 1}</div>
                </article>
              ))}
              {visibleRecords.length === 0 && <div className="lore-empty">No records match that search.</div>}
            </div>
          </>
        )}
      </section>
      <footer className="lore-context__footer"><span>LORE / PERSONAL RADIO DISCOVERY</span><span>SHIFT + / search</span></footer>
    </main>
  );
}