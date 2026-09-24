import { useEffect, useRef, useState, type Dispatch, type MouseEvent, type RefObject, type SetStateAction } from "react";
import "./LoreRemote.css";

type Intent = "dig" | "listen" | "ambient";
type Album = { id: string; title: string; artist: string; station: string; cover: string; preview?: boolean };
type Kept = { id: string; title: string; artist: string; station: string; albumId?: string; source: "dig" | "ambient"; resolved: boolean };
type Preset = { name: string; kind: "station" | "album"; detail: string };

const albumFixtures: Album[] = [
  { id: "fennesz", title: "Endless Summer", artist: "Fennesz", station: "WFMU", cover: "one", preview: true },
  { id: "huerco", title: "For Those Of You", artist: "Huerco S.", station: "NTS 1", cover: "two", preview: false },
  { id: "bark", title: "The Bark Side", artist: "Mount Eerie", station: "KEXP", cover: "one", preview: true },
  { id: "night", title: "Night Walk", artist: "Jefre-Cantu", station: "dublab", cover: "two", preview: false },
  { id: "river", title: "River Without End", artist: "Julianna Barwick", station: "WNYC", cover: "one", preview: true },
  { id: "archive", title: "Archive Fragment", artist: "Identity confirmed", station: "WFMU", cover: "two" },
  { id: "field", title: "Field Notes", artist: "Artist confirmed", station: "KEXP", cover: "one" },
  { id: "unknown-shelf", title: "Filed without station match", artist: "Illustrative Archive", station: "", cover: "two", preview: false },
];
const initialKept: Kept[] = [
  { id: "WFMU-Endless Summer", title: "Endless Summer", artist: "Fennesz", station: "WFMU", albumId: "fennesz", source: "dig", resolved: true },
  { id: "keep-huerco", title: "For Those Of You", artist: "Huerco S.", station: "NTS 1", albumId: "huerco", source: "dig", resolved: true },
  { id: "keep-bark", title: "The Bark Side", artist: "Mount Eerie", station: "KEXP", albumId: "bark", source: "dig", resolved: true },
  { id: "keep-night", title: "Night Walk", artist: "Jefre-Cantu", station: "dublab", albumId: "night", source: "ambient", resolved: true },
  { id: "keep-river", title: "River Without End", artist: "Julianna Barwick", station: "WNYC", albumId: "river", source: "dig", resolved: true },
  { id: "keep-archive", title: "Archive Fragment", artist: "Identity confirmed", station: "WFMU", albumId: "archive", source: "dig", resolved: true },
  { id: "keep-field", title: "Field Notes", artist: "Artist confirmed", station: "KEXP", albumId: "field", source: "dig", resolved: true },
];
const bankFixtures: Record<"dig" | "ambient", Preset[]> = {
  dig: ["WFMU", "KEXP", "NTS 1", "CJSF", "WNYC"].map((name, index) => ({ name, kind: "station", detail: ["91.1 FM · Jersey City", "90.3 FM · Seattle", "London · live", "90.1 FM · Vancouver", "93.9 FM · New York"][index] })),
  ambient: ["dublab", "SomaFM", "NTS Slow", "KEXP", "Night Walk"].map((name, index) => ({ name, kind: index === 4 ? "album" : "station", detail: index === 4 ? "Shelf preset" : "ambient · vetted source" })),
};

function StationMark({ name }: { name: string }) {
  // Extracted from Lore's stationArt.ts / StationMark fallback, with no image proxy in this sandbox.
  const words = name.replace(/\b(?:AM|FM)\b/gi, " ").replace(/[^A-Za-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
  const callsign = words.find((word) => /^[A-Z0-9]{2,5}$/.test(word) && /[A-Z]/.test(word));
  const initials = !words.length ? "RAD" : callsign ? callsign.slice(0, 4) : words.length === 1 ? words[0].slice(0, 3).toUpperCase() : words.slice(0, 2).map((word) => word[0]).join("").toUpperCase();
  return <span className="lr-mark station-mark station-mark--fallback" aria-hidden="true" title={name}>{initials}</span>;
}
function Cover({ album, className = "" }: { album: Album; className?: string }) {
  // Adapted from WorkflowAlbums.tsx's demo-album-card square art/fallback block.
  return <div className={`demo-album-card lr-cover ${album.cover} ${className}`} aria-label={`${album.title} cover`} style={{ aspectRatio: "1/1", borderRadius: 6, overflow: "hidden", border: "1px solid hsl(var(--border) / 0.5)" }}>{album.cover ? "LORE" : <span style={{ color: "hsl(var(--faint))", fontFamily: "var(--lore-font-mono)" }}>NO ART</span>}</div>;
}
function currentTrack(station: string): { title: string; artist: string; resolved: boolean; albumId?: string } {
  if (station === "CJSF") return { title: "Unresolved recording", artist: "Identity pending", resolved: false };
  const album = albumFixtures.find((item) => item.station === station);
  if (!album) return { title: "Unresolved recording", artist: "Identity pending", resolved: false };
  return { title: album.title, artist: album.artist, resolved: true, albumId: album.id };
}

export function LoreRemote() {
  const [intent, setIntent] = useState<Intent>(() => {
    const value = localStorage.getItem("lore-remote-intent");
    return value === "listen" || value === "ambient" ? value : "dig";
  });
  const [station, setStation] = useState("WFMU");
  const [playback, setPlayback] = useState<"idle" | "loading" | "playing" | "failure">("playing");
  const [scan, setScan] = useState(false);
  const [kept, setKept] = useState<Kept[]>(initialKept);
  const [rotation, setRotation] = useState<string[]>(["fennesz", "huerco"]);
  const [shelf, setShelf] = useState<string[]>(["bark", "night", "unknown-shelf"]);
  const [passed, setPassed] = useState<string[]>([]);
  const [sessionStarted, setSessionStarted] = useState<number | null>(null);
  const [keptThisSession, setKeptThisSession] = useState<string[]>([]);
  const [roomPeek, setRoomPeek] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [menu, setMenu] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [drawerFilter, setDrawerFilter] = useState("All");
  const [drawerSearch, setDrawerSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [banks, setBanks] = useState(bankFixtures);
  const [unresolvedOpen, setUnresolvedOpen] = useState(false);
  const [selectedRotation, setSelectedRotation] = useState<string | null>("fennesz");
  const opener = useRef<HTMLButtonElement | null>(null);
  const wasDrawerOpen = useRef(false);
  const tuneTimer = useRef<number | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);

  useEffect(() => { localStorage.setItem("lore-remote-intent", intent); }, [intent]);
  useEffect(() => {
    if (!drawer) {
      if (wasDrawerOpen.current) opener.current?.focus();
      wasDrawerOpen.current = false;
      return;
    }
    wasDrawerOpen.current = true;
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setDrawer(false); return; }
      if (event.key !== "Tab" || !drawerRef.current) return;
      const focusable = Array.from(drawerRef.current.querySelectorAll<HTMLElement>("button,input,[href],select,textarea")).filter((node) => !node.hasAttribute("disabled"));
      if (!focusable.length) return;
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer]);
  useEffect(() => () => { if (tuneTimer.current !== null) window.clearTimeout(tuneTimer.current); }, []);
  useEffect(() => {
    if (!sessionStarted) return;
    const timer = window.setInterval(() => { if (Date.now() - sessionStarted >= 60 * 60 * 1000) setSessionStarted(null); }, 1000);
    return () => window.clearInterval(timer);
  }, [sessionStarted]);

  const tune = (name: string) => {
    if (tuneTimer.current !== null) window.clearTimeout(tuneTimer.current);
    setStation(name); setPlayback("loading"); setScan(false);
    tuneTimer.current = window.setTimeout(() => setPlayback(name === "NTS Slow" ? "failure" : "playing"), 650);
  };
  const addKeep = (source: "dig" | "ambient") => {
    if (playback !== "playing" || scan) { setNotice("Wait for a playing station and fresh track evidence before Keep."); return; }
    const track = currentTrack(station);
    const keep: Kept = { id: `${station}-${track.title}`, title: track.title, artist: track.artist, station, albumId: track.albumId, source, resolved: track.resolved };
    setKept((items) => items.some((item) => item.id === keep.id) ? items : [keep, ...items]);
    if (source === "ambient" && sessionStarted) setKeptThisSession((items) => items.includes(keep.id) ? items : [keep.id, ...items]);
    setNotice(track.resolved ? "Kept recording · album remains separate until filed." : "Pending Keep · identity unresolved, no album was invented.");
  };
  const moveRotation = (albumId: string) => {
    if (shelf.includes(albumId) || passed.includes(albumId)) { setNotice("This album is no longer in Inbox."); return; }
    if (rotation.includes(albumId)) { setNotice("Already in Rotation."); return; }
    if (rotation.length >= 4) { setNotice("Rotation full · move an album first."); return; }
    setRotation((items) => [...items, albumId]); setNotice("Album moved to Rotation.");
  };
  const moveShelf = (albumId: string) => {
    setRotation((items) => items.filter((id) => id !== albumId));
    setShelf((items) => items.includes(albumId) ? items : [albumId, ...items]);
    setNotice("Album filed to Shelf. The kept recording remains owned separately.");
  };
  const letGo = (albumId: string) => {
    setRotation((items) => items.filter((id) => id !== albumId));
    setPassed((items) => items.includes(albumId) ? items : [...items, albumId]);
    if (selectedRotation === albumId) setSelectedRotation(null);
    setNotice("Album moved to Passed. Individually kept tracks remain in Library.");
  };
  const openShelf = (event: MouseEvent<HTMLButtonElement>) => { opener.current = event.currentTarget; setSelected(null); setDrawer(true); };
  const openStationShelf = (event: MouseEvent<HTMLButtonElement>) => {
    setDrawerFilter(`Matches · ${station}`);
    openShelf(event);
  };
  const openAlbumPreset = (event: MouseEvent<HTMLButtonElement>, item: Preset) => {
    const found = albumFixtures.find((album) => album.title === item.name && shelf.includes(album.id));
    opener.current = event.currentTarget;
    setSelected(found?.id ?? null);
    setDrawer(true);
  };
  const addPreset = (bank: "dig" | "ambient", slot: number, item: Album) => {
    setBanks((existing) => ({ ...existing, [bank]: existing[bank].map((preset, index) => index === slot ? { name: item.title, kind: "album", detail: "Shelf album · preview only" } : preset) }));
    setNotice(`${item.title} placed in ${bank} preset ${slot + 1}. Nothing started playing.`);
  };
  const album = (id: string) => albumFixtures.find((item) => item.id === id)!;
  const shelfAlbums = shelf.map(album);

  return <main className="lr-root"><div className="lr-shell">
    <header className="lr-top"><div className="lr-wordmark" data-testid="text-lore-wordmark">lore</div><div style={{ display: "flex", alignItems: "center", gap: 6 }}><div className="lr-proto">Prototype · local simulation</div><button className="lr-link" onClick={() => setMenu((open) => !open)} aria-expanded={menu} data-testid="button-more-menu">more</button></div></header>
    {menu && <div className="lr-menu"><button className="lr-link" onClick={() => setUnresolvedOpen((value) => !value)} data-testid="link-unresolved">Unresolved · {kept.filter((item) => !item.resolved).length} recording(s)</button>{unresolvedOpen && <div className="lr-small">{kept.filter((item) => !item.resolved).map((item) => <p key={item.id}>{item.title} · {item.station} · kept track, no album candidate</p>)}{!kept.some((item) => !item.resolved) && "No unresolved keeps yet. Tune CJSF and Keep to try this state."}</div>}</div>}
    <nav className="lr-intents" aria-label="Intent">{(["dig", "listen", "ambient"] as Intent[]).map((item) => <button key={item} data-testid={`button-intent-${item}`} aria-pressed={intent === item} onClick={() => setIntent(item)}>{item}</button>)}</nav>
    {intent === "dig" && <DigView station={station} playback={playback} scan={scan} setScan={setScan} tune={tune} openShelf={openShelf} openStationShelf={openStationShelf} openAlbumPreset={openAlbumPreset} kept={kept.filter((item) => !item.albumId || (!rotation.includes(item.albumId) && !shelf.includes(item.albumId) && !passed.includes(item.albumId)))} allKept={kept} showAll={showAll} setShowAll={setShowAll} rotation={rotation} addKeep={() => addKeep("dig")} moveRotation={moveRotation} passAlbum={letGo} banks={banks} setBanks={setBanks} />}
    {intent === "listen" && <ListenView rotation={rotation} selectedRotation={selectedRotation} setSelectedRotation={setSelectedRotation} moveShelf={moveShelf} letGo={letGo} openShelf={openShelf} playback={playback} station={station} setIntent={setIntent} />}
    {intent === "ambient" && <AmbientView station={station} playback={playback} tune={tune} openAlbumPreset={openAlbumPreset} sessionStarted={sessionStarted} setSessionStarted={setSessionStarted} addKeep={() => addKeep("ambient")} kept={keptThisSession.map((id) => kept.find((item) => item.id === id)).filter((item): item is Kept => Boolean(item))} roomPeek={roomPeek} setRoomPeek={setRoomPeek} setIntent={setIntent} banks={banks} setBanks={setBanks} />}
    {notice && <div className="lr-notice" role="status" data-testid="status-notice">{notice}<button className="lr-link" onClick={() => setNotice("")}>dismiss</button></div>}
    <button className="lr-link" onClick={openShelf} data-testid="button-open-shelf">the shelf · {shelf.length} filed</button>
    {drawer && <ShelfDrawer drawerRef={drawerRef} drawerClose={closeButton} close={() => setDrawer(false)} shelf={shelfAlbums} station={station} filter={drawerFilter} setFilter={setDrawerFilter} search={drawerSearch} setSearch={setDrawerSearch} selected={selected ? album(selected) : null} setSelected={(item) => setSelected(item.id)} onAddPreset={addPreset} />}
  </div></main>;
}

function Readout({ station, playback, scan, onScan, ambient = false, onTune, onPreview, onKeep, onMeter, kept = [] }: { station: string; playback: string; scan?: boolean; onScan?: () => void; ambient?: boolean; onTune?: () => void; onPreview?: () => void; onKeep?: () => void; onMeter?: (event: MouseEvent<HTMLButtonElement>) => void; kept?: Kept[] }) {
  const track = currentTrack(station);
  const match = !track.resolved || scan || playback !== "playing" ? "unknown" : kept.some((item) => item.title === track.title && item.artist === track.artist) ? "exact" : kept.some((item) => item.artist === track.artist) ? "artist" : "none";
  const identity = match === "exact" ? "Exact recording kept · illustrative" : match === "artist" ? "Artist in your library · illustrative" : match === "none" ? "No confirmed match · illustrative" : "Unknown · awaiting identity evidence";
  return <section className={`lr-readout ${ambient ? "lr-ambient" : ""}`} data-testid="panel-now-playing">
    <div className="lr-readout-top"><div className="lr-station"><StationMark name={station} /><div><strong>{station}</strong><small>{station === "WFMU" ? "91.1 FM · Jersey City" : "local fixture · no live claim"}</small></div></div><span className="lr-live">{playback === "playing" ? "DEMO PLAYING" : playback === "loading" ? "TUNING…" : playback === "failure" ? "NO SIGNAL" : "READY"}</span></div>
    <div className="lr-title">{scan || playback !== "playing" ? "Awaiting track evidence" : track.title}</div><div className="lr-artist">{scan || playback !== "playing" ? "A fresh station observation has not arrived" : `${track.artist} · illustrative fixture`}</div>
    {!ambient && <button className="lr-meter-control" aria-label={`${identity}. Open station matches in Shelf`} onClick={onMeter}><span className="lr-meter" aria-hidden="true">{[0, 1, 2, 3, 4].map((i) => <i className={i < (match === "exact" ? 5 : match === "artist" ? 3 : 0) ? "on" : ""} key={i} />)}</span><span className="lr-meter-label">{identity} · Shelf</span></button>}
    <div className="lr-readout-actions">{onScan && <button className="lr-button" onClick={onScan} data-testid="button-scan">{scan ? "landed · awaiting evidence" : "Scan"}</button>}{ambient && onTune && <button className="lr-button primary wide" onClick={onTune}>Tune {station}</button>}{onKeep && <button className="lr-button primary wide" onClick={onKeep}>Keep recording</button>}{onPreview && <button className="lr-button wide" onClick={onPreview}>30s preview · Play</button>}</div>
  </section>;
}

function PresetRail({ bank, tune, banks, setBanks, onAlbum }: { bank: "dig" | "ambient"; tune: (name: string) => void; banks: typeof bankFixtures; setBanks: Dispatch<SetStateAction<typeof bankFixtures>>; onAlbum: (event: MouseEvent<HTMLButtonElement>, preset: Preset) => void }) {
  const [editing, setEditing] = useState(false);
  return <section className="lr-presets"><div className="lr-presets-head"><span className="lr-section-label">{bank} bank · 5 presets</span><button className="lr-link" onClick={() => setEditing((open) => !open)}>{editing ? "done" : "edit"}</button></div><div className="lr-rule" /><div className="lr-preset-row">{banks[bank].map((preset, index) => editing ? <label className="lr-preset" key={`${bank}-${index}`}><input aria-label={`Edit ${bank} preset ${index + 1}`} value={preset.name} onChange={(event) => setBanks((old) => ({ ...old, [bank]: old[bank].map((item, n) => n === index ? { ...item, name: event.target.value } : item) }))} /><span>Slot {index + 1} · {preset.kind}</span></label> : <button className="lr-preset" key={`${bank}-${index}`} onClick={(event) => preset.kind === "station" ? tune(preset.name) : onAlbum(event, preset)} data-testid={`button-tune-${bank}-${index}`}><strong>{preset.name}</strong><span>{preset.kind} · {preset.detail}</span></button>)}</div></section>;
}

function Room({ ambient, onPeek, onInbox }: { ambient?: boolean; onPeek?: () => void; onInbox?: () => void }) {
  if (ambient) return <section className="lr-muted"><strong>Room muted while you work</strong><span>Local illustrative room preview · no messages sent</span><button className="lr-link" onClick={onPeek} data-testid="button-peek-room">Peek</button><button className="lr-link" onClick={onInbox} data-testid="button-open-inbox">Open inbox</button></section>;
  return <section className="lr-room"><div className="lr-room-head"><h2>the room</h2><span className="lr-room-meta">illustrative · read-only</span></div><div className="lr-message"><b>mara</b> · That bassline arrived sideways.<span className="lr-source">SPIN CARD · illustrative fixture</span></div><div className="lr-message"><b>jambot</b> · I have no sourced claim about the track yet.<span className="lr-source">NO SOURCE · LIMITATION</span></div><button className="lr-composer" disabled title="Read-only prototype room">Room is read-only · posting not enabled</button></section>;
}

function DigView({ station, playback, scan, setScan, tune, openShelf, openStationShelf, openAlbumPreset, kept, allKept, showAll, setShowAll, rotation, addKeep, moveRotation, passAlbum, banks, setBanks }: { station: string; playback: string; scan: boolean; setScan: (v: boolean) => void; tune: (s: string) => void; openShelf: (event: MouseEvent<HTMLButtonElement>) => void; openStationShelf: (event: MouseEvent<HTMLButtonElement>) => void; openAlbumPreset: (event: MouseEvent<HTMLButtonElement>, preset: Preset) => void; kept: Kept[]; allKept: Kept[]; showAll: boolean; setShowAll: (v: boolean) => void; rotation: string[]; addKeep: () => void; moveRotation: (id: string) => void; passAlbum: (id: string) => void; banks: typeof bankFixtures; setBanks: Dispatch<SetStateAction<typeof bankFixtures>> }) {
  const [preview, setPreview] = useState<"idle" | "playing" | "ended">("idle");
  const visible = showAll ? kept : kept.slice(0, 6);
  return <><Readout station={station} playback={playback} scan={scan} kept={allKept} onMeter={openStationShelf} onScan={() => setScan(true)} onKeep={addKeep} onPreview={playback === "playing" && !scan ? () => { setPreview("playing"); window.setTimeout(() => setPreview("ended"), 1000); } : undefined} /><div className="lr-small" role="status">{preview === "playing" ? "Preview simulation · no album pass counted" : preview === "ended" ? "Preview ended · no album pass counted" : ""}</div><PresetRail bank="dig" tune={tune} banks={banks} setBanks={setBanks} onAlbum={openAlbumPreset} /><Room /><section className="lr-rail"><div className="lr-rail-head"><span className="lr-section-label">Inbox · {kept.length} kept recordings</span><span className="lr-count">Rotation {rotation.length}/4</span></div><div className="lr-inbox">{visible.map((item) => { const itemAlbum = item.albumId ? albumFixtures.find((a) => a.id === item.albumId) : undefined; return <article className="lr-tile" key={item.id} data-testid={`card-inbox-${item.id}`}><Cover album={itemAlbum ?? { id: item.id, title: item.title, artist: item.artist, station: item.station, cover: "" }} /><strong>{item.title}</strong><span>{item.artist}</span><span>{item.station} · {item.resolved ? "recording kept" : "Unresolved"}</span>{itemAlbum && <div className="lr-actions"><button className="lr-link" onClick={() => moveRotation(itemAlbum.id)} disabled={rotation.length >= 4 && !rotation.includes(itemAlbum.id)} title={rotation.length >= 4 ? "Rotation full · move an album first" : "Move album to Rotation"}>{rotation.length >= 4 ? "Rotation full" : "Rotate album"}</button><button className="lr-link" onClick={() => passAlbum(itemAlbum.id)}>Let go of album</button></div>}</article>; })}</div>{kept.length > 6 && <button className="lr-link" onClick={() => setShowAll(!showAll)}>{showAll ? "Show recent six" : "See all inbox"}</button>}<button className="lr-link" onClick={openShelf}>Open shelf</button></section></>;
}

function ListenView({ rotation, selectedRotation, setSelectedRotation, moveShelf, letGo, openShelf, playback, station, setIntent }: { rotation: string[]; selectedRotation: string | null; setSelectedRotation: (v: string | null) => void; moveShelf: (id: string) => void; letGo: (id: string) => void; openShelf: (event: MouseEvent<HTMLButtonElement>) => void; playback: string; station: string; setIntent: (v: Intent) => void }) {
  const [preview, setPreview] = useState<"idle" | "playing" | "ended">("idle");
  const current = albumFixtures.find((item) => item.id === selectedRotation && rotation.includes(item.id)) ?? albumFixtures.find((item) => item.id === rotation[0]);
  return <><button className="lr-radio-strip" onClick={() => setIntent("dig")} data-testid="button-return-dig">Radio {playback === "playing" ? `playing · ${station}` : `${playback} · ${station}`} · Open Dig</button><section className="lr-rail"><div className="lr-section-label">Selected from Rotation · no verified passes</div>{current ? <div className="lr-listen-card"><Cover album={current} className="lr-listen-cover" /><div className="lr-listen-copy"><h2>{current.title}</h2><div className="lr-artist">{current.artist}</div><div className="lr-small">Album in Rotation · no focused-play progress available</div></div></div> : <p className="lr-small">No album in rotation.</p>}{current && <div className="lr-actions"><button className="lr-button" disabled={!current.preview} onClick={() => { setPreview("playing"); window.setTimeout(() => setPreview("ended"), 1000); }}>{current.preview ? "Play 30s preview" : "Preview unavailable"}</button><button className="lr-button primary" onClick={() => moveShelf(current.id)}>Shelve</button><button className="lr-button" onClick={() => letGo(current.id)}>Let go</button></div>}<p role="status" className="lr-small">{preview === "playing" ? "Preview simulation playing · no pass counted" : preview === "ended" ? "Preview ended · no pass counted" : ""}</p></section><Room /><section className="lr-rail"><div className="lr-rail-head"><span className="lr-section-label">Rotation · {rotation.length}/4</span><button className="lr-link" onClick={openShelf}>Shelf drawer</button></div><div className="lr-slot-grid">{[0, 1, 2, 3].map((index) => { const item = rotation[index] ? albumFixtures.find((a) => a.id === rotation[index]) : undefined; return item ? <button className={`lr-slot filled ${current?.id === item.id ? "active" : ""}`} key={index} onClick={() => { setSelectedRotation(item.id); setPreview("idle"); }}><strong>{item.title}</strong><span>Choose album · no autoplay</span></button> : <button className="lr-slot" key={index} onClick={() => setIntent("dig")}><strong>Open slot</strong><span>Promote from Dig</span></button>; })}</div></section></>;
}

function AmbientView({ station, playback, tune, openAlbumPreset, sessionStarted, setSessionStarted, addKeep, kept, roomPeek, setRoomPeek, setIntent, banks, setBanks }: { station: string; playback: string; tune: (s: string) => void; openAlbumPreset: (event: MouseEvent<HTMLButtonElement>, preset: Preset) => void; sessionStarted: number | null; setSessionStarted: (v: number | null) => void; addKeep: () => void; kept: Kept[]; roomPeek: boolean; setRoomPeek: (v: boolean) => void; setIntent: (v: Intent) => void; banks: typeof bankFixtures; setBanks: Dispatch<SetStateAction<typeof bankFixtures>> }) {
  const end = sessionStarted ? new Date(sessionStarted + 60 * 60 * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
  return <div className="lr-ambient"><Readout station={station} playback={playback} ambient onTune={() => tune(station)} onKeep={addKeep} /><PresetRail bank="ambient" tune={tune} banks={banks} setBanks={setBanks} onAlbum={openAlbumPreset} />{sessionStarted ? <div className="lr-session">WORK SESSION · UNTIL {end} · <button className="lr-link" onClick={() => setSessionStarted(null)}>End</button></div> : <button className="lr-button wide" onClick={() => setSessionStarted(Date.now())}>Start work session · label only</button>}<Room ambient onPeek={() => setRoomPeek(true)} onInbox={() => setIntent("dig")} /><section className="lr-rail"><span className="lr-section-label">Kept this session · {kept.length}</span>{kept.map((item) => <div className="lr-small" key={item.id}>{item.title} · {item.station} · {item.resolved ? "kept recording" : "unresolved keep"}</div>)}</section>{roomPeek && <div className="lr-drawer-backdrop" onClick={() => setRoomPeek(false)}><div className="lr-drawer" onClick={(event) => event.stopPropagation()} role="dialog" aria-label="Room peek"><div className="lr-drawer-head"><h2>the room · peek</h2><button className="lr-close" onClick={() => setRoomPeek(false)}>Close</button></div><Room /></div></div>}</div>;
}

function ShelfDrawer({ drawerRef, drawerClose, close, shelf, station, filter, setFilter, search, setSearch, selected, setSelected, onAddPreset }: { drawerRef: RefObject<HTMLElement | null>; drawerClose: RefObject<HTMLButtonElement | null>; close: () => void; shelf: Album[]; station: string; filter: string; setFilter: (v: string) => void; search: string; setSearch: (v: string) => void; selected: Album | null; setSelected: (item: Album) => void; onAddPreset: (bank: "dig" | "ambient", slot: number, album: Album) => void }) {
  const [presetBank, setPresetBank] = useState<"dig" | "ambient">("dig");
  const [presetSlot, setPresetSlot] = useState(0);
  const [management, setManagement] = useState(false);
  const [preview, setPreview] = useState<"idle" | "playing" | "ended">("idle");
  const filtered = shelf.filter((item) => item.title.toLowerCase().includes(search.toLowerCase()) || item.artist.toLowerCase().includes(search.toLowerCase())).filter((item) => filter === "All" || (filter === "Recently shelved" ? shelf.indexOf(item) < 2 : !item.station || (filter === "Ambient" ? item.station === "dublab" : item.station === station)));
  return <><div className="lr-drawer-backdrop" onClick={close} /><aside ref={drawerRef} className="lr-drawer" aria-label="The shelf" aria-modal="true" role="dialog"><div className="lr-drawer-head"><div><span className="lr-section-label">Library · same filed albums</span><h2>the shelf</h2></div><button ref={drawerClose} className="lr-close" onClick={close} data-testid="button-close-shelf">Close</button></div>{management ? <div className="lr-selected"><strong>Library management · local preview</strong><p className="lr-small">Filed Shelf albums: {shelf.length}. The live Library manages albums, songs, Passed and Unresolved; no server changes occur here.</p><button className="lr-button" onClick={() => setManagement(false)}>Back to shelf</button></div> : <><p className="lr-small">Same filed albums; unknown station membership stays visible.</p><input className="lr-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search your shelf" aria-label="Search shelf" data-testid="input-search-shelf" /><div className="lr-filters">{["All", `Matches · ${station}`, "Ambient", "Recently shelved"].map((name) => <button aria-pressed={filter === name} className={`lr-filter ${filter === name ? "active" : ""}`} key={name} onClick={() => setFilter(name)}>{name}</button>)}</div><div className="lr-wall">{filtered.map((item) => <button className={`lr-cover ${item.cover} ${selected?.id === item.id ? "selected" : ""}`} key={item.id} onClick={() => { setSelected(item); setPreview("idle"); }}>{selected?.id === item.id ? item.title : "LORE"}{!item.station && <span className="lr-unknown">Membership unknown</span>}</button>)}</div>{!filtered.length && <p className="lr-small">No filed albums match this filter.</p>}{selected && <div className="lr-selected"><strong>{selected.title}</strong><div className="lr-small">{selected.artist} · station membership: {selected.station || "Unknown"}</div><div className="lr-actions"><button className="lr-button primary" disabled={!selected.preview} onClick={() => { setPreview("playing"); window.setTimeout(() => setPreview("ended"), 1000); }}>{selected.preview ? "Play 30s preview" : "Preview unavailable"}</button></div><p className="lr-small" role="status">{preview === "playing" ? "Preview simulation playing · no focused pass" : preview === "ended" ? "Preview ended · no focused pass" : ""}</p><div className="lr-filters"><button className={`lr-filter ${presetBank === "dig" ? "active" : ""}`} onClick={() => setPresetBank("dig")}>Dig bank</button><button className={`lr-filter ${presetBank === "ambient" ? "active" : ""}`} onClick={() => setPresetBank("ambient")}>Ambient bank</button><select aria-label="Preset slot" value={presetSlot} onChange={(event) => setPresetSlot(Number(event.target.value))}>{[0, 1, 2, 3, 4].map((slot) => <option value={slot} key={slot}>Slot {slot + 1}</option>)}</select><button className="lr-button" onClick={() => onAddPreset(presetBank, presetSlot, selected)}>Add to preset</button></div></div>}<button className="lr-link" onClick={() => setManagement(true)} data-testid="button-library-management">Open Library management</button></>}</aside></>;
}

export default LoreRemote;