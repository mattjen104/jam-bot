import {
  ArrowRight,
  Check,
  Disc3,
  ExternalLink,
  LockKeyhole,
  Radio,
  RotateCw,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";

type Step = "unresolved" | "confirmed";

const station = {
  name: "KEXP",
  place: "Seattle · 90.3 FM",
  song: "Not Strong Enough",
  artist: "boygenius",
  tone: "#a65f48",
  observed: "18 Oct 2024 · 22:14:08 PDT",
};

export function ConfirmedKeepJourney() {
  const [step, setStep] = useState<Step>("unresolved");
  const [candidateReviewed, setCandidateReviewed] = useState(false);

  return (
    <main
      style={{
        minHeight: "100dvh",
        background: "#f4efe4",
        color: "#332f29",
        fontFamily: "Outfit, sans-serif",
        padding: "0 24px 38px",
        boxSizing: "border-box",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Newsreader:opsz,wght@6..72,400;6..72,500&family=Outfit:wght@400;500;600&display=swap');
        .ckj-button { font: inherit; cursor: pointer; border-radius: 3px; min-height: 44px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; font-size: 12px; transition: transform .18s ease, opacity .18s ease; }
        .ckj-button:hover { transform: translateY(-1px); }
        .ckj-button:focus-visible { outline: 2px solid #a65f48; outline-offset: 4px; }
        .ckj-primary { color: #f4efe4; background: #a65f48; border: 1px solid #a65f48; padding: 0 16px; }
        .ckj-quiet { color: #756e62; background: transparent; border: 0; padding: 0 5px; }
        .ckj-card { background: #f8f4eb; border-radius: 4px; }
        .ckj-in { animation: ckj-in .35s ease both; }
        @keyframes ckj-in { from { opacity: 0; transform: translateY(7px); } to { opacity: 1; transform: translateY(0); } }
        @media (max-width: 470px) { .ckj-actions { align-items: stretch !important; flex-direction: column; } .ckj-primary { width: 100%; } }
      `}</style>

      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "21px 0 18px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, fontFamily: "Newsreader, serif", fontSize: 27, letterSpacing: "-.06em" }}>
          <span style={{ display: "grid", placeItems: "center", width: 19, height: 19, borderRadius: "50%", color: "#f4efe4", background: "#a65f48", fontSize: 16 }}>l</span>
          lore
        </div>
        <span style={{ color: "#9b9283", font: "9px 'DM Mono', monospace", letterSpacing: ".04em" }}>Prototype · no audio or saves</span>
      </header>

      <section className="ckj-in" style={{ maxWidth: 650, margin: "0 auto", paddingTop: 12 }}>
        {step === "unresolved" ? (
          <>
            <p style={{ margin: "29px 0 13px", color: "#756e62", font: "10px 'DM Mono', monospace", letterSpacing: ".08em", textTransform: "uppercase" }}>A Keep with a careful edge</p>
            <h1 style={{ margin: 0, maxWidth: 560, font: "500 clamp(44px, 10vw, 74px)/.91 Newsreader, serif", letterSpacing: "-.06em" }}>Keep the<br /><em style={{ color: "#a65f48", fontStyle: "normal" }}>moment first.</em></h1>
            <p style={{ maxWidth: 430, margin: "19px 0 28px", color: "#756e62", fontSize: 14, lineHeight: 1.55 }}>A recording can be useful before its identity is certain. Confirm it later without losing where, when, or how Lore found it.</p>

            <article className="ckj-card" style={{ padding: 18 }}>
              <div style={{ display: "flex", justifyContent: "space-between", color: "#9b9283", font: "9px 'DM Mono', monospace", textTransform: "uppercase" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}><Radio size={14} /> Observed moment</span><span>Not filed</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "25px 0 19px" }}>
                <div style={{ display: "grid", placeItems: "center", width: 43, height: 43, color: "#f4efe4", background: station.tone, borderRadius: 2 }}><Radio size={20} /></div>
                <div><strong style={{ font: "500 18px Newsreader, serif" }}>{station.name}</strong><div style={{ marginTop: 3, color: "#756e62", fontSize: 11 }}>{station.place}</div></div>
                <span style={{ width: 7, height: 7, marginLeft: "auto", borderRadius: "50%", background: "#617b69" }} />
              </div>
              <strong style={{ display: "block", font: "500 27px/1.05 Newsreader, serif", letterSpacing: "-.03em" }}>{station.song}</strong>
              <span style={{ display: "block", marginTop: 5, color: "#756e62", fontSize: 13 }}>{station.artist}</span>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 9, marginTop: 16 }}>
                <span style={{ width: 8, height: 8, marginTop: 4, border: "1px solid #a65f48", borderRadius: "50%", background: "#a65f48" }} />
                <div><b style={{ display: "block", fontSize: 11 }}>Recording only</b><small style={{ display: "block", marginTop: 3, color: "#756e62", fontSize: 10 }}>Identity pending · no album claim</small></div>
              </div>
            </article>

            <div style={{ display: "flex", gap: 13, marginTop: 22 }} className="ckj-actions">
              <button className="ckj-button ckj-primary" onClick={() => setStep("confirmed")} type="button"><RotateCw size={16} /> Simulate evidence arriving <ArrowRight size={16} /></button>
            </div>
          </>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 29, color: "#617b69", font: "11px 'DM Mono', monospace", textTransform: "uppercase", letterSpacing: ".07em" }}><Check size={17} /> Recording confirmed</div>
            <h1 style={{ margin: "19px 0 0", maxWidth: 570, font: "500 clamp(42px, 9vw, 66px)/.94 Newsreader, serif", letterSpacing: "-.06em" }}>A name found,<br /><em style={{ color: "#a65f48", fontStyle: "normal" }}>not a filing.</em></h1>
            <div className="ckj-card" style={{ display: "flex", alignItems: "center", gap: 15, marginTop: 31, padding: 14 }}>
              <div style={{ display: "grid", placeItems: "center", width: 86, height: 86, flex: "0 0 86px", color: "#f4efe4", background: station.tone }}><Disc3 size={42} /></div>
              <div><strong style={{ display: "block", font: "500 21px/1.05 Newsreader, serif" }}>{station.song}</strong><span style={{ display: "block", marginTop: 5, color: "#756e62", fontSize: 12 }}>{station.artist}</span><small style={{ display: "block", marginTop: 13, color: "#9b9283", font: "9px 'DM Mono', monospace" }}>{station.name} · {station.observed}</small></div>
            </div>
            <div style={{ display: "grid", gap: 5, marginTop: 18, padding: "13px 15px", borderLeft: "2px solid #617b69", background: "#ebe3d5" }}>
              <b style={{ fontSize: 12 }}><ShieldCheck size={14} style={{ verticalAlign: "-3px", marginRight: 6 }} />Example evidence received</b>
              <span style={{ color: "#756e62", fontSize: 11 }}>Simulated example only — the original KEXP observation remains attached to this Keep.</span>
            </div>
            <div style={{ marginTop: 18, padding: "15px 16px", border: "1px solid #ded5c7", borderRadius: 4, background: "transparent" }}>
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <LockKeyhole size={16} color="#9b9283" />
                <div><b style={{ display: "block", fontSize: 12 }}>the record <span style={{ color: "#a65f48", font: "10px 'DM Mono', monospace", textTransform: "uppercase" }}>· candidate · not filed</span></b><span style={{ display: "block", marginTop: 4, color: "#756e62", fontSize: 11 }}>boygenius · a lead surfaced by the simulated example evidence. This Keep is not filed to it.</span></div>
              </div>
              <button className="ckj-button ckj-quiet" style={{ marginTop: 12, paddingLeft: 26 }} onClick={() => setCandidateReviewed((v) => !v)} type="button"><ExternalLink size={15} />{candidateReviewed ? "Hide candidate details" : "Review candidate details"}</button>
              {candidateReviewed && <div className="ckj-in" style={{ margin: "12px 0 0 26px", paddingTop: 11, borderTop: "1px solid #ded5c7", color: "#756e62", fontSize: 11, lineHeight: 1.5 }}>Candidate detail: <b style={{ color: "#332f29" }}>the record</b> is the example album match for boygenius. It is shown for review only; Lore has not filed, claimed, or moved this recording.</div>}
            </div>
            <div style={{ display: "flex", gap: 13, marginTop: 22 }} className="ckj-actions">
              <button className="ckj-button ckj-primary" onClick={() => setStep("unresolved")} type="button">Keep another moment <ArrowRight size={16} /></button>
              <button className="ckj-button ckj-quiet" onClick={() => setStep("unresolved")} type="button">Back to recording</button>
            </div>
          </>
        )}
      </section>
    </main>
  );
}