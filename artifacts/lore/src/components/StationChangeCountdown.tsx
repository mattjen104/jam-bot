import { useEffect, useState } from "react";

import type { DialSpin } from "../hooks/useDialData";
import { stationChangeCountdownLabel } from "./stationChangeCountdownLabel";
import "./StationChangeCountdown.css";

export function StationChangeCountdown({
  track,
  className = "",
}: {
  track: DialSpin | null | undefined;
  className?: string;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!track?.estimatedRemainingMs || !track.serverTime) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [track?.estimatedRemainingMs, track?.serverTime]);

  const label = stationChangeCountdownLabel(track, now);
  if (!label) return null;

  return (
    <span
      className={`station-change-countdown ${className}`.trim()}
      aria-label={`Likely change in ${label}`}
    >
      {label}
    </span>
  );
}