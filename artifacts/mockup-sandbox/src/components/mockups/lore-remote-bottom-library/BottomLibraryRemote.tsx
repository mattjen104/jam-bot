import {
  ArrowDownLeft, ArrowUpRight, Check, ChevronDown, CircleHelp, Headphones, Inbox,
  Library, ListMusic, LockKeyhole, MessageCircle, Pause, Play, Radio, RotateCw,
  Search, Sparkles, X,
} from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import "../lore-remote-prototype/_prototype.css";
import "./bottom-library.css";

type Intent = "dig" | "listen" | "ambient";
type LibraryTab = "inbox" | "rotation" | "shelf";
type Album = { id: string; title: string; artist: string; color: string; code: string; detail: string };

const albums: Album[] = [
  { id: "julie", title: "my anti-aircraft friend", artist: "julie", color: "#687479", code: "JA", detail: "A tense, bright record with a soft center." },
  { id: "hodges", title: "The Blue Room", artist: "Bobby Hutcherson", color: "#82715d", code: "BH", detail: "A late-night blue note, found in the KEXP spin log." },
  { id: "jlin", title: "Black Origami", artist: "Jlin", color: "#4d6078", code: "JL", detail: "Percussive, exacting, and still unresolved in your library." },
  { id: "field", title: "A Quiet Corner", artist: "Elaine Radigue", color: "#756f64", code: "ER", detail: "An ambient study, kept from the work session." },
  { id: "sun", title: "Sun Ra Visits Planet Earth", artist: "Sun Ra", color: "#5f6655", code: "SR", detail: "An illustrated journey from the WFMU archive." },
];
const stations = [
  { name: "KEXP", sub: "Seattle · 90.3 FM", song: "Not Strong Enough", artist: "boygenius", tone: "#745d52" },
  { name: "WFMU", sub: "Jersey City · 91.1 FM", song: "The Creator Has a Master Plan", artist: "Pharoah Sanders", tone: "#53616a" },
  { name: "NTS 1", sub: "London · online", song: "Untitled 06", artist: "Kendrick Lamar", tone: "#6c624e" },
  { name: "dublab", sub: "Los Angeles · online", song: "Arpeggi", artist: "Four Tet", tone: "#5c6d61" },
  { name: "KVRX", sub: "Austin · 91.7 FM", song: "Swan", artist: "Pavement", tone: "#766a78" },
];
const ambientStations = [
  { name: "SomaFM", sub: "online · drone zone", song: "An Ending (Ascent)", artist: "Brian Eno", tone: "#526967" },
  { name: "Echoes", sub: "online · atmospheric", song: "Emerald Rush", artist: "Jon Hopkins", tone: "#53657a" },
  { name: "Stillstream", sub: "online · deep ambient", song: "Weightless", artist: "Marconi Union", tone: "#68745e" },
  { name: "Kiosk", sub: "online · leftfield", song: "The Colour of Pomegranates", artist: "Hiroshi Yoshimura", tone: "#706257" },
  { name: "Slowly Radio", sub: "online · longform", song: "Falling Asleep", artist: "A Winged Victory", tone: "#625a70" },
];
const roomMessages = [
  { author: "mara", text: "that WFMU handoff was perfect", time: "2m", kind: "human" },
  { author: "jambot", text: "I don't have enough evidence to match this recording to an album.", time: "5m", kind: "bot", source: "none" },
  { author: "eli", text: "Black Origami still sounds like machinery learning to dance.", time: "11m", kind: "human" },
];

export function BottomLibraryRemote({ initialIntent = "dig", initialShelf = false }: { initialIntent?: Intent; initialShelf?: boolean }) {
  const [intent, setIntent] = useState<Intent>(initialIntent);
  const [playing, setPlaying] = useState(false);
  const [tuned, setTuned] = useState(false);
  const [station, setStation] = useState(stations[0]);
  const [scan, setScan] = useState<"idle" | "preview">("idle");
  const [selectedInbox, setSelectedInbox] = useState("julie");
  const [inbox, setInbox] = useState(["julie"]);
  const [rotation, setRotation] = useState(["hodges", "jlin"]);
  const [shelf, setShelf] = useState(["sun", "field"]);
  const [passed, setPassed] = useState<string[]>([]);
  const [sessionKeeps, setSessionKeeps] = useState<string[]>([]);
  const [labels, setLabels] = useState<Record<string, string>>({ julie: "very little effort · julie" });
  const [sessionStarted, setSessionStarted] = useState(false);
  const [roomPeek, setRoomPeek] = useState(false);
  const [libraryTab, setLibraryTab] = useState<LibraryTab>("inbox");
  const [libraryExpanded, setLibraryExpanded] = useState(false);
  const [shelfOpen, setShelfOpen] = useState(initialShelf);
  const [query, setQuery] = useState("");
  const [shelfFilter, setShelfFilter] = useState("all");
  const [selectedShelf, setSelectedShelf] = useState("sun");
  const [presetNote, setPresetNote] = useState("");
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const getAlbum = (id: string) => albums.find((a) => a.id === id) ?? albums[0];
  const openShelf = (source?: HTMLButtonElement | null) => { openerRef.current = source ?? document.activeElement as HTMLButtonElement; setShelfOpen(true); };
  const closeShelf = () => { setShelfOpen(false); window.setTimeout(() => openerRef.current?.focus(), 0); };
  useEffect(() => {
    if (!shelfOpen) return;
    drawerRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeShelf(); }
      if (event.key === "Tab" && drawerRef.current) {
        const nodes = Array.from(drawerRef.current.querySelectorAll<HTMLElement>("button,input")).filter((n) => !n.hasAttribute("disabled"));
        if (!nodes.length) return;
        if (event.shiftKey && document.activeElement === nodes[0]) { event.preventDefault(); nodes[nodes.length - 1].focus(); }
        else if (!event.shiftKey && document.activeElement === nodes[nodes.length - 1]) { event.preventDefault(); nodes[0].focus(); }
      }
    };
    document.addEventListener("keydown", onKey); return () => document.removeEventListener("keydown", onKey);
  }, [shelfOpen]);
  const tune = (next: typeof stations[number]) => { setStation(next); setTuned(true); setPlaying(true); setScan("idle"); };
  const tuneAmbient = (next: typeof ambientStations[number]) => {
    setStation(next); setTuned(true); setPlaying(true); setScan("idle"); setSessionStarted(true);
  };
  const rotate = () => {
    if (!inbox.includes(selectedInbox) || selectedInbox === "ambient-recording" || rotation.length >= 4 || rotation.includes(selectedInbox)) return;
    setRotation((items) => [...items, selectedInbox]); setInbox((items) => items.filter((id) => id !== selectedInbox));
  };
  const keepAmbient = () => {
    const id = "ambient-recording"; const label = `${station.song} · ${station.artist} · ${station.name}`;
    if (inbox.includes(id)) return;
    setInbox((items) => [id, ...items]); setLabels((items) => ({ ...items, [id]: label })); setSessionKeeps((items) => items.includes(label) ? items : [...items, label]);
  };
  const letGo = (id: string) => { setRotation((items) => items.filter((x) => x !== id)); setPassed((items) => items.includes(id) ? items : [...items, id]); };
  const shelve = (id: string) => { setRotation((items) => items.filter((x) => x !== id)); setShelf((items) => items.includes(id) ? items : [...items, id]); };
  const playAmbient = () => { setPlaying((value) => !value); setSessionStarted(true); };

  return <main className={`lore-prototype lore-bottom-library ${intent === "ambient" ? "lore-prototype--ambient" : ""}`}>
    <header className="lore-header"><div className="lore-wordmark"><span className="wordmark-mark">◌</span><span>lore</span><small>LOCAL PROTOTYPE</small></div></header>
    <nav className="intent-switch" aria-label="Listening intent">{(["dig", "listen", "ambient"] as Intent[]).map((item) => <button type="button" key={item} aria-pressed={intent === item} className={intent === item ? "is-active" : ""} onClick={() => setIntent(item)}>{item === "dig" ? "Dig" : item === "listen" ? "Listen" : "Ambient"}</button>)}</nav>
    <div className="prototype-note"><CircleHelp size={13} /> local, non-playing prototype · illustrative data</div>
    {intent === "dig" && <DigView station={station} tuned={tuned} playing={playing} scan={scan} setScan={setScan} setPlaying={setPlaying} tune={tune} openShelf={openShelf} />}
    {intent === "listen" && <ListenView rotation={rotation} playing={playing} setPlaying={setPlaying} shelve={shelve} letGo={letGo} openShelf={openShelf} setIntent={setIntent} tuned={tuned} getAlbum={getAlbum} />}
    {intent === "ambient" && <AmbientView station={station} playing={playing} setPlaying={playAmbient} keepAmbient={keepAmbient} sessionKeeps={sessionKeeps} roomPeek={roomPeek} setRoomPeek={setRoomPeek} setIntent={setIntent} tune={tuneAmbient} sessionStarted={sessionStarted} />}
    <Room quiet={intent === "ambient"} roomPeek={roomPeek} setRoomPeek={setRoomPeek} />
    <LibraryDock expanded={libraryExpanded} setExpanded={setLibraryExpanded} tab={libraryTab} setTab={setLibraryTab} inbox={inbox} rotation={rotation} shelf={shelf} selectedInbox={selectedInbox} setSelectedInbox={setSelectedInbox} labels={labels} rotate={rotate} passed={passed} setPassed={setPassed} setInbox={setInbox} openShelf={openShelf} shelve={shelve} letGo={letGo} playing={playing} setPlaying={setPlaying} getAlbum={getAlbum} setRotation={setRotation} />
    {shelfOpen && <ShelfDrawer drawerRef={drawerRef} closeShelf={closeShelf} shelf={shelf} rotation={rotation} query={query} setQuery={setQuery} shelfFilter={shelfFilter} setShelfFilter={setShelfFilter} selectedShelf={selectedShelf} setSelectedShelf={setSelectedShelf} playing={playing} setPlaying={setPlaying} presetNote={presetNote} setPresetNote={setPresetNote} />}
  </main>;
}

function DigView({ station, tuned, playing, scan, setScan, setPlaying, tune, openShelf }: any) {
  return <section className="intent-content"><div className="readout-panel"><div className="eyebrow"><Radio size={13} /> {tuned ? "SELECTED PRESET · ILLUSTRATIVE SNAPSHOT" : "LAST OBSERVATION · ILLUSTRATIVE SNAPSHOT"} <span className="mono">local prototype</span></div><div className="station-line"><strong>{station.name}</strong><span>{station.sub}</span><button className="scan-button" onClick={() => setScan(scan === "preview" ? "idle" : "preview")} type="button"><RotateCw size={13} /> {scan === "preview" ? "Scanning…" : "Scan"}</button></div><h1>{scan === "preview" ? "Landing near a song boundary" : station.song}</h1><p className="artist">{scan === "preview" ? "new metadata not confirmed yet" : station.artist}</p>{scan === "preview" && <div className="status-callout">Preview only — waiting for a fresh station observation. No keep is created.</div>}<button type="button" className="match-meter" onClick={(e) => openShelf(e.currentTarget)}><span className="meter-bars"><i /><i /><i /><i /><i /></span><span><b>UNKNOWN</b><small>recording match not confirmed</small></span><ArrowUpRight size={14} /></button></div><div className="bank-heading"><span><span className="eyebrow">DIG BANK</span><b>Crossings for: all my artists</b></span><button className="link-button" type="button" onClick={() => openShelf()}>Library lens <ArrowUpRight size={13} /></button></div><div className="preset-grid">{stations.map((item) => <button type="button" className="preset" key={item.name} onClick={() => tune(item)}><span className="preset-dot" style={{ background: item.tone }}><Radio size={15} /></span><b>{item.name}</b><small>{item.sub.split(" · ")[0]}</small></button>)}</div><div className="transport"><span>{playing ? "LOCAL STATE · PLAYING" : "LOCAL STATE · NOT PLAYING"}</span><button type="button" onClick={() => setPlaying(!playing)}>{playing ? <Pause size={15} /> : <Play size={15} />} {playing ? "Pause" : "Play"} <small>simulated</small></button></div></section>;
}

function ListenView({ rotation, shelf, playing, setPlaying, shelve, letGo, openShelf, setIntent, tuned, getAlbum }: any) {
  const current = rotation[0] ? getAlbum(rotation[0]) : null;
  if (!current) return <section className="intent-content"><div className="listen-strip"><button type="button" onClick={() => setIntent("dig")}><Radio size={14} /> RADIO · LAST OBSERVATION <ArrowDownLeft size={13} /></button></div><div className="empty-state listen-empty"><b>Rotation is empty</b><span>Promote an album from Dig to begin a focused review.</span><button type="button" onClick={() => setIntent("dig")}>Go to Dig <ArrowUpRight size={13} /></button></div></section>;
  return <section className="intent-content"><div className="listen-strip"><button type="button" onClick={() => setIntent("dig")}><Radio size={14} /> {tuned ? "RADIO · KEXP" : "RADIO · LAST OBSERVATION"} <ArrowDownLeft size={13} /></button></div><div className="album-focus"><div className="focus-cover"><Cover album={current} large /></div><div className="eyebrow">NOW IN ROTATION · SLOT 01</div><h1>{current.title}</h1><p className="artist">{current.artist}</p><div className="focus-meta"><span>MANUAL REVIEW</span><span>pass evidence not measured</span></div><div className="listen-actions"><button type="button" onClick={() => setPlaying(!playing)}><Play size={14} /> {playing ? "Playing preview" : "Play preview"} <small>30s path</small></button><button type="button" className="subtle-action" onClick={() => shelve(current.id)}>Shelve</button><button type="button" className="subtle-action danger" onClick={() => letGo(current.id)}>Let go</button><button type="button" className="subtle-action" onClick={() => openShelf()}>Shelf <ArrowUpRight size={13} /></button></div></div></section>;
}

function AmbientView({ station, playing, setPlaying, keepAmbient, sessionKeeps, roomPeek, setRoomPeek, setIntent, tune, sessionStarted }: any) {
  return <section className="intent-content"><div className="ambient-readout"><div className="eyebrow"><Headphones size={13} /> {sessionStarted ? "WORK SESSION · ACTIVE" : "WORK SESSION · NOT STARTED"} <span className="session-dot" /></div><p className="ambient-station">{station.name}<small>{station.sub} · illustrative snapshot</small></p><h1>{station.song}</h1><p className="artist">{station.artist}</p><div className="ambient-controls"><button type="button" className="keep-button" onClick={keepAmbient}><Inbox size={17} /> KEEP <small>shown recording</small></button><button type="button" className="play-round" onClick={setPlaying} aria-label={playing ? "Pause local simulation" : "Start local simulation"}>{playing ? <Pause size={16} /> : <Play size={16} />}</button></div><div className="transport ambient-transport"><span>{playing ? "LOCAL SIMULATION · PLAYING" : "LOCAL SIMULATION · NOT PLAYING"}</span><button type="button" onClick={setPlaying}>{playing ? "Pause simulation" : "Tune / Play"} <small>explicit action</small></button></div></div><div className="ambient-bank"><div className="bank-heading"><span><span className="eyebrow">AMBIENT BANK · 5 PRESETS</span><b>illustrative music stations · tune explicitly</b></span><Sparkles size={15} /></div><div className="preset-grid">{ambientStations.map((item) => <button className="preset" type="button" key={item.name} onClick={() => tune(item)}><span className="preset-dot" style={{ background: item.tone }}><Radio size={15} /></span><b>{item.name}</b><small>{item.sub.split(" · ")[0]}</small></button>)}</div></div><div className="session-log"><div className="rail-title"><span>KEPT THIS SESSION · {sessionKeeps.length}</span><button type="button" onClick={() => setRoomPeek(!roomPeek)}>{roomPeek ? "Close peek" : "Peek room"} <MessageCircle size={13} /></button></div>{sessionKeeps.length ? sessionKeeps.map((keep: string) => <p key={keep}><Check size={14} /> {keep} <small>private local log</small></p>) : <p className="muted">Keep previews a recording-only Inbox item; nothing is saved to Lore.</p>}</div><button className="ambient-dig-link" type="button" onClick={() => setIntent("dig")}>Open room in Dig <ArrowUpRight size={14} /></button></section>;
}

function Room({ quiet, roomPeek, setRoomPeek }: { quiet: boolean; roomPeek: boolean; setRoomPeek: (v: boolean) => void }) {
  if (quiet && !roomPeek) return <section className="room-muted"><div><MessageCircle size={15} /><b>Room muted while you work</b><small>quiet by design · no notifications</small></div><button type="button" onClick={() => setRoomPeek(true)}>Peek <ArrowUpRight size={13} /></button></section>;
  return <section className={`room ${quiet ? "room--peek" : ""}`}><div className="room-header"><span><MessageCircle size={15} /> THE ROOM <small>· illustrative preview examples</small></span><span className="room-lock"><LockKeyhole size={12} /> READ-ONLY PREVIEW</span></div><div className="messages">{roomMessages.map((message) => <article className={message.kind === "bot" ? "bot-message" : ""} key={message.author + message.time}><div><b>{message.author}</b><small>{message.time}</small></div><p>{message.text}</p>{message.source && <em>EVIDENCE UNAVAILABLE · example only</em>}</article>)}</div><div className="composer"><input disabled placeholder={quiet ? "Peek is read-only" : "Message the room · posting unavailable"} /><button disabled type="button">Send</button><small>Public posting requires a verifiable Lore identity and moderation gate. Nothing here is saved.</small></div>{quiet && <button className="peek-close" type="button" onClick={() => setRoomPeek(false)}><ChevronDown size={14} /> Close peek</button>}</section>;
}

function LibraryDock({ expanded, setExpanded, tab, setTab, inbox, rotation, shelf, selectedInbox, setSelectedInbox, labels, rotate, passed, setPassed, setInbox, openShelf, playing, setPlaying, getAlbum, setRotation }: any) {
  const recording = selectedInbox === "ambient-recording";
  const pass = () => { if (!inbox.includes(selectedInbox) || recording) return; setPassed((items: string[]) => items.includes(selectedInbox) ? items : [...items, selectedInbox]); setInbox((items: string[]) => items.filter((id) => id !== selectedInbox)); };
  const switchTab = (next: LibraryTab) => { setTab(next); setExpanded(tab === next ? !expanded : true); };
  return <section className={`library-dock ${expanded ? "is-expanded" : "is-collapsed"}`} aria-label="Personal library"><div className="library-dock__head"><span><Library size={15} /> PERSONAL LIBRARY</span><small>{expanded ? "keeps stay private · tap active tab to close" : "keeps stay private"}</small></div><div className="library-tabs" role="tablist">{(["inbox", "rotation", "shelf"] as LibraryTab[]).map((item) => <button key={item} type="button" role="tab" aria-selected={expanded && tab === item} className={expanded && tab === item ? "is-active" : ""} onClick={() => switchTab(item)}>{item === "inbox" ? <Inbox size={14} /> : item === "rotation" ? <ListMusic size={14} /> : <Library size={14} />}{item}<b>{item === "inbox" ? inbox.length : item === "rotation" ? rotation.length : shelf.length}</b></button>)}</div>{expanded && tab === "inbox" && <div className="library-panel"><div className="rail-title"><span>INBOX · KEPT FROM RADIO</span><b>ROTATION {rotation.length}/4</b></div>{inbox.length === 0 ? <div className="empty-state">No unfiled recordings. New keeps will land here.</div> : <div className="inbox-list">{inbox.map((id: string) => { const album = getAlbum(id); const rowIsRecording = id === "ambient-recording"; return <button type="button" className={`inbox-card ${selectedInbox === id ? "is-selected" : ""}`} onClick={() => setSelectedInbox(id)} key={id}><Cover album={rowIsRecording ? { id, title: "Kept recording", artist: "Ambient session", color: "#5f6c66", code: "REC", detail: "Recording-only Inbox item." } : album} /><span><b>{labels[id] ?? album.title}</b><small>{rowIsRecording ? "Album not matched" : "kept recording"}</small><em>{rowIsRecording ? "SOURCE · AMBIENT SESSION" : "SOURCE · KEXP · KEPT"}</em></span></button>; })}</div>}<div className="selected-actions"><span>{recording ? "Recording-only item · match an album later; no workflow action." : "Kept recording remains yours; Pass only moves the album."}</span><button type="button" onClick={pass} disabled={!inbox.includes(selectedInbox) || recording}>Pass <ArrowDownLeft size={13} /></button><button type="button" onClick={rotate} disabled={rotation.length >= 4 || !inbox.includes(selectedInbox) || recording}>{recording ? "Album not matched" : rotation.length >= 4 ? "Rotation full" : "Rotate album"} <ArrowUpRight size={13} /></button><button type="button" className="text-action" onClick={() => openShelf()}>See Shelf</button></div>{passed.length > 0 && <div className="passed-note"><Check size={13} /> Passed albums: {passed.length} · kept recordings retained</div>}</div>}{expanded && tab === "rotation" && <div className="library-panel"><div className="rail-title"><span><ListMusic size={15} /> ROTATION · {rotation.length}/4</span><button className="link-button" type="button" onClick={() => openShelf()}>Shelf <ArrowUpRight size={13} /></button></div><div className="rotation-grid">{[0, 1, 2, 3].map((slot) => { const id = rotation[slot]; const album = id && getAlbum(id); return album ? <button className="rotation-card" key={slot} onClick={() => setRotation((items: string[]) => [id, ...items.filter((x) => x !== id)])} type="button"><Cover album={album} /><span><b>{album.artist}</b><small>in rotation</small></span></button> : <div className="open-slot" key={slot}><span>0{slot + 1}</span>Open slot<br /><small>Promote from Dig</small></div>; })}</div></div>}{expanded && tab === "shelf" && <div className="library-panel shelf-teaser"><span><Library size={15} /> {shelf.length} filed albums</span><button type="button" onClick={() => openShelf()}>Open Shelf <ArrowUpRight size={13} /></button></div>}</section>;
}

function ShelfDrawer({ drawerRef, closeShelf, shelf, rotation, query, setQuery, shelfFilter, setShelfFilter, selectedShelf, setSelectedShelf, playing, setPlaying, presetNote, setPresetNote }: any) {
  const available = albums.filter((album) => shelf.includes(album.id)).filter((album) => shelfFilter === "ambient" ? album.id === "field" : shelfFilter === "match" ? album.id === "sun" : shelfFilter === "recent" ? album.id === "sun" : true).filter((album) => `${album.title} ${album.artist}`.toLowerCase().includes(query.toLowerCase()));
  const selected = available.find((album) => album.id === selectedShelf) ?? available[0];
  return <div className="drawer-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && closeShelf()}><aside className="shelf-drawer" ref={drawerRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="bottom-shelf-title"><div className="drawer-handle" /><header><div><span className="eyebrow">LIBRARY / COLLECTION</span><h2 id="bottom-shelf-title">the shelf</h2></div><button type="button" className="close-button" onClick={closeShelf} aria-label="Close Shelf"><X size={18} /></button></header><div className="drawer-rotation"><span>TOP OF ROTATION</span>{rotation.slice(0, 4).map((id: string) => <Cover album={albums.find((a) => a.id === id) ?? albums[0]} key={id} />)}</div><label className="shelf-search"><Search size={15} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search your shelf" /></label><div className="shelf-filters" role="group" aria-label="Shelf membership filters">{[["all", "All"], ["match", "KEXP match"], ["ambient", "Ambient"], ["recent", "Recently shelved"]].map(([value, label]) => <button type="button" className={shelfFilter === value ? "is-active" : ""} key={value} onClick={() => setShelfFilter(value)}>{label}</button>)}</div><div className="cover-wall">{available.map((album) => <button type="button" aria-label={`Select ${album.title}`} className={`shelf-cover ${selected?.id === album.id ? "is-selected" : ""}`} key={album.id} onClick={() => setSelectedShelf(album.id)}><Cover album={album} /><span>{album.title}</span><i>FILED</i></button>)}</div><div className="selected-detail"><div><span className="eyebrow">SELECTED ALBUM</span><h3>{selected?.title ?? "Nothing found"}</h3><p>{selected?.detail ?? "Try a different search."}</p>{presetNote && <small className="preset-note">{presetNote}</small>}</div>{selected && <div className="detail-actions"><button type="button" onClick={() => setPlaying(!playing)}><Play size={13} /> Play preview</button><button type="button" onClick={() => setPresetNote("Demo only: choose a real preset slot before adding.")}>Add to preset</button></div>}</div><p className="drawer-footnote">Shelf membership is local illustrative state. It does not save to Lore.</p></aside></div>;
}

function Cover({ album, large = false }: { album: Album; large?: boolean }) {
  return <span className={`cover ${large ? "cover--large" : ""}`} style={{ "--cover": album.color } as CSSProperties}><span>{album.code}</span><i /></span>;
}