import { useState } from "react";
import { Check, ChevronDown, ChevronUp, Radio, RotateCw, X } from "lucide-react";
import type { HandoffCandidate, NextChangeView } from "../player/liveHandoff";
import type { PendingHandoff } from "../player/useLiveHandoff";

export interface LiveHandoffControls {
  nextChange: NextChangeView;
  candidates: HandoffCandidate[];
  pending: PendingHandoff | null;
  noQualifiedStation: boolean;
  scanning?: boolean;
  onCatchCurrent: () => void;
  onCatchBest: () => void;
  onCatchCandidate: (candidate: HandoffCandidate) => void;
  onCancel: () => void;
  onSwitchNow: () => void;
  onKeepWatching: () => void;
}

function timingLabel(pending: PendingHandoff): string {
  if (pending.phase === "ready") return "confirmed fresh";
  if (pending.destinationNow?.freshness === "stale") return "stale signal";
  if (pending.destinationNow?.timingConfidence === "trusted") return "timing confirmed";
  if (pending.destinationNow?.timingConfidence === "estimated") return "timing estimated";
  return "timing unknown";
}

export function LiveHandoffPanel(props: LiveHandoffControls) {
  const [open, setOpen] = useState(false);
  const {
    nextChange,
    candidates,
    pending,
    noQualifiedStation,
    scanning = false,
    onCatchCurrent,
    onCatchBest,
    onCatchCandidate,
    onCancel,
    onSwitchNow,
    onKeepWatching,
  } = props;

  if (pending) {
    const track = pending.destinationNow;
    return (
      <section className="live-handoff live-handoff--pending" aria-label="Pending live handoff" data-testid="live-handoff-pending">
        <div className="live-handoff__summary">
          <Radio size={15} aria-hidden="true" />
          <div className="live-handoff__copy">
            <strong>{pending.phase === "ready" ? "Fresh song ready" : `Catching next on ${pending.target.name}`}</strong>
            <span>
              {track ? `${track.title} · ${track.artist}` : "Checking the destination's live signal…"}
              {" · "}
              {timingLabel(pending)}
            </span>
            <small>{pending.reason}</small>
          </div>
          <button type="button" className="live-handoff__icon" onClick={onCancel} aria-label="Cancel Catch Next" title="Cancel Catch Next" data-testid="live-handoff-cancel">
            <X size={15} aria-hidden="true" />
          </button>
        </div>
        {pending.phase === "ready" ? (
          <button type="button" className="live-handoff__primary" onClick={onSwitchNow} data-testid="live-handoff-switch">
            <Check size={14} aria-hidden="true" /> {pending.target.slug === pending.sourceSlug ? "Continue on" : "Switch to"} {pending.target.name}
          </button>
        ) : pending.phase === "timed-out" ? (
          <div className="live-handoff__actions">
            <span className="live-handoff__muted">No trustworthy boundary arrived yet.</span>
            <button type="button" onClick={onSwitchNow} data-testid="live-handoff-switch-now">Switch now</button>
            <button type="button" onClick={onKeepWatching} data-testid="live-handoff-keep-watching"><RotateCw size={13} aria-hidden="true" /> Keep watching</button>
          </div>
        ) : (
          <div className="live-handoff__watching" aria-live="polite">Current audio continues while Lore watches for a fresh song.</div>
        )}
      </section>
    );
  }

  return (
    <section className="live-handoff" aria-label="Next change and Catch Next" data-testid="live-handoff">
      <div className={`live-handoff__next live-handoff__next--${nextChange.state}`} aria-live="polite">
        <span className="live-handoff__dot" aria-hidden="true" />
        <span>{nextChange.label}</span>
        {nextChange.state === "estimated" && <small>advisory</small>}
      </div>
      <button
        type="button"
        className="live-handoff__catch"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        data-testid="catch-next"
      >
        Catch Next {open ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
      </button>
      {open && (
        <div className="live-handoff__menu">
          <p className="live-handoff__hint">
            Keep the current broadcast until a fresh destination song is confirmed.
            {scanning ? " Preview scan stays separate and does not become listening history." : ""}
          </p>
          <div className="live-handoff__menu-actions">
            <button type="button" onClick={onCatchCurrent} data-testid="catch-current">Stay here · catch this station</button>
            <button type="button" onClick={onCatchBest} data-testid="catch-best">Find the strongest live sound</button>
          </div>
          {noQualifiedStation && (
            <p className="live-handoff__empty" role="status">No other fresh, playable station is qualified right now. You can stay here and catch the next song.</p>
          )}
          {candidates.length > 0 && (
            <div className="live-handoff__candidates">
              <span className="live-handoff__eyebrow">Other fresh live sounds</span>
              {candidates.map((candidate) => (
                <button
                  type="button"
                  key={candidate.station.slug}
                  className="live-handoff__candidate"
                  onClick={() => onCatchCandidate(candidate)}
                  data-testid={`catch-candidate-${candidate.station.slug}`}
                >
                  <span><strong>{candidate.station.name}</strong><small>{candidate.now.title} · {candidate.now.artist}</small></span>
                  <small>{candidate.reasons.join(" · ")}</small>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}