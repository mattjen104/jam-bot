import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleHelp,
  Disc3,
  Fingerprint,
  Headphones,
  Info,
  LockKeyhole,
  Mic2,
  Pause,
  Play,
  Radio,
  RotateCw,
  ShieldCheck,
  Sparkles,
  Waves,
} from "lucide-react";
import { useState } from "react";
import "./keep-journey.css";

type Stage = "scan" | "identity" | "recording" | "kept";

const stations = [
  { name: "KEXP", place: "Seattle · 90.3 FM", song: "Not Strong Enough", artist: "boygenius", tone: "#806552" },
  { name: "WFMU", place: "Jersey City · 91.1 FM", song: "The Creator Has a Master Plan", artist: "Pharoah Sanders", tone: "#5e7275" },
  { name: "NTS 1", place: "London · online", song: "Untitled 06", artist: "Kendrick Lamar", tone: "#776e59" },
];

export function KeepJourney() {
  const [stage, setStage] = useState<Stage>("scan");
  const [station, setStation] = useState(stations[0]);
  const [playing, setPlaying] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [marked, setMarked] = useState(false);

  const scanAgain = () => {
    setScanning(true);
    window.setTimeout(() => setScanning(false), 850);
  };

  return (
    <main className="keep-journey">
      <header className="kj-header">
        <div className="kj-wordmark"><span className="kj-orbit">◌</span><span>lore</span><small>REMOTE / KEEP</small></div>
        <button className="kj-help" type="button"><CircleHelp size={15} /> How it works</button>
      </header>

      <div className="kj-progress" aria-label="Keep journey progress">
        {(["scan", "identity", "recording", "kept"] as Stage[]).map((item, index) => (
          <span key={item} className={stage === item ? "active" : stage === "kept" || index < ["scan", "identity", "recording", "kept"].indexOf(stage) ? "done" : ""}>
            <i>{stage === "kept" || index < ["scan", "identity", "recording", "kept"].indexOf(stage) ? <Check size={10} /> : index + 1}</i>{item === "scan" ? "Scan" : item === "identity" ? "Identity" : item === "recording" ? "Recording" : "Keep"}
          </span>
        ))}
      </div>

      {stage === "scan" && (
        <section className="kj-panel kj-enter">
          <div className="kj-kicker"><Radio size={13} /> LIVE REMOTE · DIG <em>local snapshot</em></div>
          <div className="kj-hero-copy">
            <p className="kj-overline">A softer way to catch something</p>
            <h1>Hear a fragment.<br /><i>Keep the thread.</i></h1>
            <p className="kj-lede">Point Lore at a station. We’ll wait for a real crossing before anything becomes yours.</p>
          </div>
          <div className="kj-scan-card">
            <div className="kj-scan-top"><span className="kj-signal"><i></i><i></i><i></i><i></i></span><span>{scanning ? "LISTENING FOR A FRESH CROSSING…" : "LAST OBSERVATION · 10:42 PM"}</span><button type="button" onClick={scanAgain} aria-label="Scan for a fresh crossing"><RotateCw size={14} className={scanning ? "kj-spin" : ""} /></button></div>
            <div className="kj-station"><div className="kj-station-mark" style={{ background: station.tone }}><Radio size={22} /></div><div><b>{station.name}</b><small>{station.place}</small></div><span className="kj-live"><i></i> LIVE</span></div>
            <div className="kj-track"><strong>{station.song}</strong><span>{station.artist}</span></div>
            <div className="kj-uncertain"><span className="kj-meter"><i></i><i></i><i></i><i></i><i></i></span><div><b>UNCONFIRMED</b><small>recording match will be checked later</small></div></div>
          </div>
          <div className="kj-station-picker">
            {stations.map((item) => <button key={item.name} className={station.name === item.name ? "selected" : ""} onClick={() => setStation(item)} type="button"><span style={{ background: item.tone }}><Radio size={13} /></span><b>{item.name}</b><small>{item.place.split(" · ")[0]}</small></button>)}
          </div>
          <div className="kj-action-row"><button className="kj-primary" type="button" onClick={() => setStage("identity")}>Keep this crossing <ArrowRight size={15} /></button><span><LockKeyhole size={12} /> no account yet · nothing public</span></div>
        </section>
      )}

      {stage === "identity" && (
        <section className="kj-panel kj-enter">
          <button className="kj-back" type="button" onClick={() => setStage("scan")}><ArrowLeft size={14} /> Back to crossing</button>
          <div className="kj-identity-wrap"><div className="kj-identity-icon"><Fingerprint size={31} /></div><div className="kj-kicker">ONE SMALL CHECK <em>before the keep</em></div><h1>Who should<br /><i>remember this?</i></h1><p className="kj-lede">Lore uses a quiet identity check so a kept recording stays attached to you — not a public profile.</p></div>
          <div className="kj-proof-list"><div><ShieldCheck size={18} /><span><b>Private by default</b><small>Your name is never shown in the room.</small></span><Check size={15} /></div><div><Headphones size={18} /><span><b>Keep the evidence</b><small>The station, moment, and match status travel with it.</small></span><Check size={15} /></div><div><Sparkles size={18} /><span><b>Return when ready</b><small>Finish setup now, or leave this crossing here.</small></span><Check size={15} /></div></div>
          <div className="kj-action-row"><button className="kj-primary" type="button" onClick={() => setStage("recording")}>Continue as local listener <ArrowRight size={15} /></button><span><Info size={12} /> this prototype stores nothing outside this frame</span></div>
        </section>
      )}

      {stage === "recording" && (
        <section className="kj-panel kj-enter">
          <div className="kj-kicker"><Mic2 size={13} /> RECORDING KEEP <em>identity pending</em></div>
          <div className="kj-record-head"><div className={`kj-record-disc ${playing ? "is-playing" : ""}`}><Disc3 size={43} /></div><div><p className="kj-overline">Listening now</p><h1>Stay with<br /><i>the moment.</i></h1></div></div>
          <div className="kj-record-card"><div className="kj-wave">{Array.from({ length: 34 }, (_, index) => <i key={index} style={{ height: `${14 + ((index * 17) % 38)}%` }} />)}</div><div className="kj-record-meta"><span><b>{station.name}</b> · {station.song}</span><span>{playing ? "00:18" : "00:00"} / 00:30</span></div></div>
          <div className="kj-record-note"><Waves size={16} /><span><b>We’re holding a place in the spin log.</b><small>A match may arrive later. You can still keep the recording now.</small></span></div>
          <div className="kj-action-row kj-record-actions"><button className="kj-primary" type="button" onClick={() => { setMarked(true); setStage("kept"); }}><Disc3 size={15} /> Mark as Keep <ArrowRight size={15} /></button><button className="kj-play" type="button" onClick={() => setPlaying((value) => !value)}>{playing ? <Pause size={15} /> : <Play size={15} />} {playing ? "Pause listen" : "Listen first"}</button></div>
          <p className="kj-footnote"><LockKeyhole size={12} /> Recording-only until Lore can confirm the album. {marked ? "Ready to file." : "No album claim is made."}</p>
        </section>
      )}

      {stage === "kept" && (
        <section className="kj-panel kj-enter kj-kept">
          <div className="kj-kept-stamp"><Check size={17} /> KEPT LOCALLY</div>
          <div className="kj-kept-art" style={{ background: `linear-gradient(135deg, ${station.tone}, #25231e)` }}><Disc3 size={63} /><span>REC<br /><small>KEEP 01</small></span></div>
          <p className="kj-overline">Your crossing · just now</p><h1>{station.song}</h1><p className="kj-lede">{station.artist} · {station.name}<br /><span className="kj-muted">Album match pending</span></p>
          <div className="kj-kept-status"><span><i></i> RECORDING-ONLY</span><b>Not yet an album</b><small>Lore will attach the confirmed identity if a later station observation supports it.</small></div>
          <div className="kj-action-row"><button className="kj-primary" type="button" onClick={() => setStage("scan")}>Find another crossing <ArrowRight size={15} /></button><button className="kj-text-btn" type="button" onClick={() => setStage("recording")}>Open this Keep</button></div>
          <div className="kj-done-note"><Check size={14} /> It’s in your local inbox. Nothing was posted to the room.</div>
        </section>
      )}

      <footer className="kj-footer"><span><LockKeyhole size={11} /> local prototype · illustrative data</span><span>Dig / Keep journey</span></footer>
    </main>
  );
}