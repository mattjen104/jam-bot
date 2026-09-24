import {
  ArrowRight,
  Check,
  Disc3,
  Radio,
  RotateCw,
  Signal,
} from "lucide-react";
import { useState } from "react";
import "./quiet-keep-journey.css";

type Stage = "scan" | "identity" | "recording" | "kept";
type Station = {
  name: string;
  place: string;
  song: string;
  artist: string;
  tone: string;
};

const stations: Station[] = [
  {
    name: "KEXP",
    place: "Seattle · 90.3 FM",
    song: "Not Strong Enough",
    artist: "boygenius",
    tone: "#ba765d",
  },
  {
    name: "WFMU",
    place: "Jersey City · 91.1 FM",
    song: "The Creator Has a Master Plan",
    artist: "Pharoah Sanders",
    tone: "#6e8c88",
  },
  {
    name: "NTS 1",
    place: "London · online",
    song: "Untitled 06",
    artist: "Kendrick Lamar",
    tone: "#9a8c5b",
  },
];

export function QuietKeepJourney() {
  const [stage, setStage] = useState<Stage>("scan");
  const [station, setStation] = useState(stations[0]);
  const [scanPending, setScanPending] = useState(false);
  const [tuned, setTuned] = useState(false);

  const startScan = () => {
    setScanPending(true);
  };

  const observeLanding = () => {
    setScanPending(false);
    setStage("identity");
  };

  return (
    <main className="quiet-keep-journey">
      <header className="qkj-header">
        <div className="qkj-brand">
          <span className="qkj-brand-mark" aria-hidden="true">l</span>
          <span>lore</span>
        </div>
        <span className="qkj-note">Prototype · no audio or saves</span>
      </header>

      {stage === "scan" && (
        <section className="qkj-screen qkj-enter" aria-labelledby="qkj-scan-title">
          <div className="qkj-intro">
            <h1 id="qkj-scan-title">Keep a station<br /><em>moment.</em></h1>
          </div>

          <div className="qkj-station-tabs" aria-label="Station choices">
            {stations.map((item) => (
              <button
                className={station.name === item.name ? "selected" : ""}
                key={item.name}
                type="button"
                onClick={() => {
                  setStation(item);
                  setScanPending(false);
                }}
              >
                <span className="qkj-station-dot" style={{ backgroundColor: item.tone }} />
                <strong>{item.name}</strong>
                <small>{item.place.split(" · ")[0]}</small>
              </button>
            ))}
          </div>

          <article className="qkj-observation">
            <div className="qkj-observation-top">
              <span><Signal size={14} /> {scanPending ? "Waiting for the landing" : "Latest observed"}</span>
              <span>{scanPending ? "Simulated scan" : "Example observation"}</span>
            </div>
            <div className="qkj-station-line">
              <div className="qkj-station-badge" style={{ backgroundColor: station.tone }}>
                <Radio size={20} />
              </div>
              <div>
                <h2>{station.name}</h2>
                <p>{station.place}</p>
              </div>
            </div>
            <div className="qkj-track">
              <strong>{station.song}</strong>
              <span>{station.artist}</span>
            </div>
            <div className={scanPending ? "qkj-status qkj-status-pending" : "qkj-status"}>
              <span className="qkj-status-mark" aria-hidden="true" />
              <span><b>{scanPending ? "New landing not observed yet" : "Observed, not confirmed"}</b></span>
            </div>
          </article>

          <div className="qkj-actions">
            {!scanPending ? (
              <>
                <button className="qkj-button qkj-button-primary" type="button" onClick={startScan}>
                  <RotateCw size={16} /> Scan for a moment
                </button>
                <button className="qkj-button qkj-button-quiet" type="button" onClick={() => setTuned((value) => !value)}>
                  {tuned ? <Check size={16} /> : <Radio size={16} />}
                  {tuned ? "Tuned to this station" : "Tune this station"}
                </button>
              </>
            ) : (
              <button className="qkj-button qkj-button-primary" type="button" onClick={observeLanding}>
                Check the landed moment <ArrowRight size={16} />
              </button>
            )}
          </div>
        </section>
      )}

      {stage === "identity" && (
        <section className="qkj-screen qkj-enter" aria-labelledby="qkj-identity-title">
          <p className="qkj-eyebrow">A fresh observation</p>
          <h1 id="qkj-identity-title">Is this the<br /><em>moment to keep?</em></h1>

          <div className="qkj-confirm-card">
            <div className="qkj-card-label">Simulated example observation</div>
            <div className="qkj-confirm-title"><span className="qkj-station-dot" style={{ backgroundColor: station.tone }} /><strong>{station.name}</strong><span>{station.place}</span></div>
            <div className="qkj-confirm-track">
              <strong>{station.song}</strong>
              <span>{station.artist}</span>
            </div>
            <div className="qkj-uncertain">
              <span className="qkj-status-mark" />
              <span><b>Identity pending</b><small>Keep the recording without making an album claim.</small></span>
            </div>
          </div>

          <div className="qkj-actions">
            <button className="qkj-button qkj-button-primary" type="button" onClick={() => setStage("recording")}>
              Keep this recording <ArrowRight size={16} />
            </button>
            <button className="qkj-button qkj-button-quiet" type="button" onClick={() => setStage("scan")}>Not this one</button>
          </div>
        </section>
      )}

      {stage === "recording" && (
        <section className="qkj-screen qkj-enter" aria-labelledby="qkj-recording-title">
          <p className="qkj-eyebrow">Ready to keep</p>
          <h1 id="qkj-recording-title">Hold onto<br /><em>this crossing.</em></h1>

          <div className="qkj-record-card">
            <div className="qkj-record-art" style={{ backgroundColor: station.tone }}><Disc3 size={42} /></div>
            <div>
              <strong>{station.song}</strong>
              <span>{station.artist}</span>
              <small>{station.name} · {station.place} · example observation</small>
            </div>
          </div>
          <div className="qkj-review-line"><span className="qkj-status-mark" /><span>Identity pending · recording only</span></div>
          <div className="qkj-actions">
            <button className="qkj-button qkj-button-primary" type="button" onClick={() => setStage("kept")}>
              Keep recording <Check size={16} />
            </button>
            <button className="qkj-button qkj-button-quiet" type="button" onClick={() => setStage("identity")}>Review observation</button>
          </div>
        </section>
      )}

      {stage === "kept" && (
        <section className="qkj-screen qkj-enter qkj-kept-screen" aria-labelledby="qkj-kept-title">
          <div className="qkj-success"><Check size={17} /> Kept</div>
          <div className="qkj-kept-art" style={{ backgroundColor: station.tone }}><Disc3 size={62} /></div>
          <p className="qkj-eyebrow">Your recording</p>
          <h1 id="qkj-kept-title">{station.song}</h1>
          <p className="qkj-deck">{station.artist} · {station.name}<br />Simulated example observation</p>
          <div className="qkj-kept-state">
            <b>Recording only</b>
            <span>Identity pending. No album has been filed.</span>
          </div>
          <div className="qkj-actions">
            <button className="qkj-button qkj-button-primary" type="button" onClick={() => setStage("scan")}>Find another moment <ArrowRight size={16} /></button>
            <button className="qkj-button qkj-button-quiet" type="button" onClick={() => setStage("recording")}>Review this Keep</button>
          </div>
        </section>
      )}
    </main>
  );
}
